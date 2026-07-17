// Canvas compositing pipeline: burns the camera overlay onto the screen video
// at the chosen position, mixes audio, and captures the trimmed range to WebM.

import type { BrandKit, CaptionCue, EditorSegment, TitleCard } from "@/lib/editor-types"
import type { CameraLayout, TrimRange } from "@/lib/studio-types"

export type ExportQuality = "720p" | "1080p"

interface CompositeOptions {
  screenUrl: string
  cameraUrl: string | null
  layout: CameraLayout
  trim: TrimRange
  quality: ExportQuality
  segments?: EditorSegment[]
  captions?: CaptionCue[]
  titleCards?: TitleCard[]
  brandKit?: BrandKit
  onProgress?: (fraction: number) => void
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video")
    video.src = url
    video.crossOrigin = "anonymous"
    video.muted = false
    video.playsInline = true
    video.preload = "auto"
    video.onloadedmetadata = () => resolve(video)
    video.onerror = () => reject(new Error("Failed to load recorded video"))
  })
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked)
      resolve()
    }
    video.addEventListener("seeked", onSeeked)
    video.currentTime = time
  })
}

/** Draw a source video into a destination rect using object-cover semantics. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const vw = video.videoWidth || 16
  const vh = video.videoHeight || 9
  const scale = Math.max(dw / vw, dh / vh)
  const sw = dw / scale
  const sh = dh / scale
  const sx = (vw - sw) / 2
  const sy = (vh - sh) / 2
  ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh)
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function pickMimeType(): string {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return "video/webm"
}

export async function compositeToWebm({
  screenUrl,
  cameraUrl,
  layout,
  trim,
  quality,
  segments = [],
  captions = [],
  titleCards = [],
  brandKit,
  onProgress,
}: CompositeOptions): Promise<Blob> {
  const screen = await loadVideo(screenUrl)
  const camera = cameraUrl ? await loadVideo(cameraUrl) : null

  // Preserve the source aspect ratio while targeting the selected maximum
  // height. Never upscale beyond the source recording's native dimensions.
  const sourceWidth = screen.videoWidth || 1280
  const sourceHeight = screen.videoHeight || 720
  const targetHeight = quality === "1080p" ? 1080 : 720
  const scale = Math.min(1, targetHeight / sourceHeight)
  const canvas = document.createElement("canvas")
  // H.264/WebM encoders prefer even dimensions.
  canvas.width = Math.max(2, Math.round((sourceWidth * scale) / 2) * 2)
  canvas.height = Math.max(2, Math.round((sourceHeight * scale) / 2) * 2)
  const ctx = canvas.getContext("2d")!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"

  // Audio mixing via WebAudio.
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const audioCtx = new AudioCtx()
  await audioCtx.resume()
  const dest = audioCtx.createMediaStreamDestination()
  const connectAudio = (el: HTMLVideoElement) => {
    try {
      const src = audioCtx.createMediaElementSource(el)
      src.connect(dest)
    } catch {
      // Element has no audio track — ignore.
    }
  }
  connectAudio(screen)
  if (camera) connectAudio(camera)

  const canvasStream = canvas.captureStream(30)
  const mixed = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ])

  const recorder = new MediaRecorder(mixed, {
    mimeType: pickMimeType(),
    videoBitsPerSecond: quality === "1080p" ? 8_000_000 : 4_500_000,
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const activeSegments = segments.length
    ? segments
    : [{ id: "trim", sourceStart: Math.max(0, trim.start), sourceEnd: Math.min(trim.end, screen.duration || trim.end) }]
  let segmentIndex = 0
  let completedDuration = 0
  let switchingSegment = false
  const span = Math.max(0.1, activeSegments.reduce((sum, segment) => sum + segment.sourceEnd - segment.sourceStart, 0))
  const start = activeSegments[0].sourceStart

  await seek(screen, start)
  if (camera) await seek(camera, Math.min(start, camera.duration || start))

  await Promise.all([screen.play(), camera?.play()].filter(Boolean) as Promise<void>[])

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: "video/webm" }))
    }
  })

  recorder.start(200)

  let raf = 0
  const render = () => {
    ctx.fillStyle = "#000000"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    drawCover(ctx, screen, 0, 0, canvas.width, canvas.height)

    if (camera) {
      const camW = layout.width * canvas.width
      // rounded = 16:9; square & circle = 1:1.
      const camH = layout.shape === "rounded" ? camW * (9 / 16) : camW
      const x = layout.left * canvas.width
      const y = canvas.height - layout.bottom * canvas.height - camH
      // Square uses a slightly larger corner radius than the 16:9 card.
      const cornerRadius = layout.shape === "square" ? canvas.width * 0.02 : canvas.width * 0.012

      const traceShape = () => {
        if (layout.shape === "circle") {
          ctx.beginPath()
          ctx.arc(x + camW / 2, y + camH / 2, Math.min(camW, camH) / 2, 0, Math.PI * 2)
          ctx.closePath()
        } else {
          roundedRectPath(ctx, x, y, camW, camH, cornerRadius)
        }
      }

      ctx.save()
      traceShape()
      ctx.clip()
      // Match the mirrored live self-view. Translate within the camera rect so
      // only the camera layer flips; the shared screen remains unchanged.
      ctx.translate(x + camW, y)
      ctx.scale(-1, 1)
      drawCover(ctx, camera, 0, 0, camW, camH)
      ctx.restore()

      // Subtle border around the overlay.
      ctx.save()
      ctx.strokeStyle = "rgba(255,255,255,0.14)"
      ctx.lineWidth = Math.max(1, canvas.width * 0.0015)
      traceShape()
      ctx.stroke()
      ctx.restore()
    }

    const t = screen.currentTime
    const titleCard = titleCards.find((card) => t >= card.start && t <= card.end)
    if (titleCard) {
      ctx.fillStyle = "rgba(0,0,0,0.72)"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = brandKit?.primaryColor ?? "#ffffff"
      ctx.textAlign = "center"
      ctx.font = `600 ${Math.round(canvas.width * 0.045)}px sans-serif`
      ctx.fillText(titleCard.title, canvas.width / 2, canvas.height / 2)
      ctx.fillStyle = "rgba(255,255,255,0.7)"
      ctx.font = `400 ${Math.round(canvas.width * 0.018)}px sans-serif`
      ctx.fillText(titleCard.subtitle, canvas.width / 2, canvas.height / 2 + canvas.height * 0.07)
    }
    const caption = captions.find((cue) => t >= cue.start && t <= cue.end)
    if (caption) {
      ctx.font = `600 ${Math.round(canvas.width * 0.025)}px sans-serif`
      ctx.textAlign = "center"
      const metrics = ctx.measureText(caption.text)
      const padding = canvas.width * 0.018
      const boxHeight = canvas.height * 0.075
      const boxX = Math.max(canvas.width * 0.04, (canvas.width - metrics.width) / 2 - padding)
      const boxWidth = Math.min(canvas.width * 0.92, metrics.width + padding * 2)
      ctx.fillStyle = "rgba(0,0,0,0.82)"
      roundedRectPath(ctx, boxX, canvas.height - boxHeight - canvas.height * 0.04, boxWidth, boxHeight, 10)
      ctx.fill()
      ctx.fillStyle = "#ffffff"
      ctx.fillText(caption.text, canvas.width / 2, canvas.height - canvas.height * 0.07)
    }

    const activeSegment = activeSegments[segmentIndex]
    onProgress?.(Math.max(0, Math.min(1, (completedDuration + t - activeSegment.sourceStart) / span)))

    if (t >= activeSegment.sourceEnd || screen.ended) {
      const next = activeSegments[segmentIndex + 1]
      if (next) {
        if (!switchingSegment) {
          switchingSegment = true
          completedDuration += activeSegment.sourceEnd - activeSegment.sourceStart
          segmentIndex += 1
          screen.pause()
          camera?.pause()
          void Promise.all([
            seek(screen, next.sourceStart),
            camera ? seek(camera, Math.min(next.sourceStart, camera.duration || next.sourceStart)) : Promise.resolve(),
          ]).then(() => Promise.all([screen.play(), camera?.play()].filter(Boolean) as Promise<void>[])).finally(() => {
            switchingSegment = false
          })
        }
      } else {
        cancelAnimationFrame(raf)
        screen.pause()
        camera?.pause()
        if (recorder.state !== "inactive") recorder.stop()
        void audioCtx.close()
        return
      }
    }
    raf = requestAnimationFrame(render)
  }
  raf = requestAnimationFrame(render)

  return done
}
