// Canvas compositing pipeline: burns the camera overlay onto the screen video
// at the chosen position, mixes audio, and captures the trimmed range to WebM.

import type { BrandKit, CaptionCue, EditorSegment, TitleCard } from "@/lib/editor-types"
import type { CameraLayout, TrimRange } from "@/lib/studio-types"

export type ExportQuality = "720p" | "1080p"
export type ExportFormat = "mp4" | "webm"

interface CompositeOptions {
  screenUrl: string
  cameraUrl: string | null
  /** Dedicated microphone track, mixed in independently of the camera layer. */
  audioUrl?: string | null
  layout: CameraLayout
  trim: TrimRange
  quality: ExportQuality
  /** Preferred container. MP4 is used natively when the browser supports it. */
  format?: ExportFormat
  segments?: EditorSegment[]
  captions?: CaptionCue[]
  titleCards?: TitleCard[]
  brandKit?: BrandKit
  onProgress?: (fraction: number) => void
}

export interface CompositeResult {
  blob: Blob
  /** Actual container produced ('mp4' only when natively supported). */
  format: ExportFormat
}

/**
 * MediaRecorder can emit H.264/MP4 natively in modern Chromium. When true, we
 * record straight to MP4 and skip the slow FFmpeg.wasm second pass entirely.
 */
export function nativeMp4RecordingSupported(): boolean {
  if (typeof MediaRecorder === "undefined") return false
  return (
    MediaRecorder.isTypeSupported("video/mp4;codecs=avc1,mp4a") ||
    MediaRecorder.isTypeSupported("video/mp4;codecs=h264,aac") ||
    MediaRecorder.isTypeSupported("video/mp4")
  )
}

function pickMp4MimeType(): string | null {
  const candidates = [
    "video/mp4;codecs=avc1.640028,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4;codecs=h264,aac",
    "video/mp4",
  ]
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return null
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

function pickWebmMimeType(): string {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return "video/webm"
}

/**
 * Composite the screen + camera + captions/title cards onto a canvas and record
 * the result in a single native pass to the requested container (MP4 when the
 * browser supports it, otherwise WebM). No second transcode is performed, which
 * preserves color and avoids the long/hanging FFmpeg.wasm step.
 */
export async function compositeToFile({
  screenUrl,
  cameraUrl,
  audioUrl,
  layout,
  trim,
  quality,
  format = "webm",
  segments = [],
  captions = [],
  titleCards = [],
  brandKit,
  onProgress,
}: CompositeOptions): Promise<CompositeResult> {
  const screen = await loadVideo(screenUrl)
  const camera = cameraUrl ? await loadVideo(cameraUrl) : null
  // Microphone narration lives on its own track so it plays back even when the
  // camera overlay is hidden or the recording had no camera at all.
  const mic = audioUrl ? await loadVideo(audioUrl) : null

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
  // Request a Display P3 canvas so wide-gamut source video (modern webcams,
  // Retina/P3 displays) keeps its saturation. Drawing P3 video into the default
  // sRGB canvas clamps colors into the smaller gamut, which is what washes the
  // export out. Fall back to sRGB where P3 isn't supported.
  let ctx = canvas.getContext("2d", { colorSpace: "display-p3" }) as CanvasRenderingContext2D | null
  if (!ctx) ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D context unavailable")
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
  if (mic) connectAudio(mic)

  const canvasStream = canvas.captureStream(30)
  const mixed = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ])

  // Record straight to the requested container. MP4 is used only when the
  // browser can encode H.264 natively; otherwise we fall back to WebM (and the
  // caller decides whether a legacy FFmpeg pass is warranted).
  const mp4Type = format === "mp4" ? pickMp4MimeType() : null
  const outputType = mp4Type ?? pickWebmMimeType()
  const producedFormat: ExportFormat = mp4Type ? "mp4" : "webm"

  const recorder = new MediaRecorder(mixed, {
    mimeType: outputType,
    videoBitsPerSecond: quality === "1080p" ? 12_000_000 : 6_000_000,
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
  if (mic) await seek(mic, Math.min(start, mic.duration || start))

  await Promise.all([screen.play(), camera?.play(), mic?.play()].filter(Boolean) as Promise<void>[])

  let raf = 0
  let settled = false
  let lastProgressAt = performance.now()
  // Watchdog: if playback stalls (no frame progress) for this long, bail out
  // instead of leaving the UI stuck on "Exporting…" forever.
  const STALL_TIMEOUT_MS = 15_000
  let watchdog: ReturnType<typeof setInterval> | null = null

  const teardown = () => {
    cancelAnimationFrame(raf)
    if (watchdog) {
      clearInterval(watchdog)
      watchdog = null
    }
    try {
      screen.pause()
      camera?.pause()
      mic?.pause()
    } catch {
      // ignore
    }
    void audioCtx.close().catch(() => {})
  }

  // Assigned inside the promise executor below; called by the render loop when
  // it reaches the end of the last segment.
  let stopRecording: () => void = () => {}

  const done = new Promise<CompositeResult>((resolve, reject) => {
    const finish = () => {
      if (settled) return
      settled = true
      teardown()
      const blob = new Blob(chunks, { type: outputType })
      if (blob.size === 0) {
        reject(new Error("Recording produced no data"))
        return
      }
      onProgress?.(1)
      resolve({ blob, format: producedFormat })
    }
    const fail = (message: string) => {
      if (settled) return
      settled = true
      teardown()
      if (recorder.state !== "inactive") {
        try {
          recorder.stop()
        } catch {
          // ignore
        }
      }
      reject(new Error(message))
    }

    recorder.onstop = finish
    recorder.onerror = () => fail("The video encoder failed while exporting.")

    watchdog = setInterval(() => {
      if (settled) return
      if (performance.now() - lastProgressAt > STALL_TIMEOUT_MS) {
        // Force a stop so whatever was captured is still returned; if nothing
        // was captured, finish() rejects with a clear message.
        if (recorder.state !== "inactive") {
          try {
            recorder.stop()
          } catch {
            fail("Export stalled and could not recover.")
          }
        } else {
          fail("Export stalled and could not recover.")
        }
      }
    }, 2_000)

    // Expose a stopper the render loop can call when it reaches the end.
    stopRecording = () => {
      if (recorder.state !== "inactive") recorder.stop()
      else finish()
    }
  })

  recorder.start(200)
  const render = () => {
    const activeSegment = activeSegments[segmentIndex]
    const cameraOnly = activeSegment.composition === "camera-only" && camera

    ctx.fillStyle = "#000000"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    if (cameraOnly) {
      // Presenter cutaways fill the same output frame as the screen recording.
      // Mirror the camera to match the editor's self-view.
      ctx.save()
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
      drawCover(ctx, camera, 0, 0, canvas.width, canvas.height)
      ctx.restore()
    } else {
      drawCover(ctx, screen, 0, 0, canvas.width, canvas.height)
    }

    if (camera && !cameraOnly) {
      const camW = layout.width * canvas.width
      // An equilateral triangle's height is √3 / 2 of its width.
      const camH = layout.shape === "rounded" ? camW * (9 / 16) : layout.shape === "triangle" ? camW * (Math.sqrt(3) / 2) : camW
      const x = layout.left * canvas.width
      const y = canvas.height - layout.bottom * canvas.height - camH
      // Square uses a slightly larger corner radius than the 16:9 card.
      const cornerRadius = layout.shape === "square" ? canvas.width * 0.02 : canvas.width * 0.012

      const traceShape = () => {
        if (layout.shape === "circle") {
          ctx.beginPath()
          ctx.arc(x + camW / 2, y + camH / 2, Math.min(camW, camH) / 2, 0, Math.PI * 2)
          ctx.closePath()
        } else if (layout.shape === "triangle") {
          ctx.beginPath()
          ctx.moveTo(x + camW / 2, y)
          ctx.lineTo(x + camW, y + camH)
          ctx.lineTo(x, y + camH)
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

    // Frame advanced — reset the stall watchdog.
    lastProgressAt = performance.now()
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
          mic?.pause()
          void Promise.all([
            seek(screen, next.sourceStart),
            camera ? seek(camera, Math.min(next.sourceStart, camera.duration || next.sourceStart)) : Promise.resolve(),
            mic ? seek(mic, Math.min(next.sourceStart, mic.duration || next.sourceStart)) : Promise.resolve(),
          ]).then(() => Promise.all([screen.play(), camera?.play(), mic?.play()].filter(Boolean) as Promise<void>[])).finally(() => {
            switchingSegment = false
          })
        }
      } else {
        // Reached the end of the last segment — stop cleanly. teardown() (run
        // by finish()) cancels the RAF, pauses media, and closes the audio ctx.
        stopRecording()
        return
      }
    }
    raf = requestAnimationFrame(render)
  }
  raf = requestAnimationFrame(render)

  return done
}

interface PassthroughCheck {
  cameraVisible: boolean
  hasCamera: boolean
  captions: CaptionCue[]
  titleCards: TitleCard[]
  segments: EditorSegment[]
  sourceDuration: number
  screenMimeType: string
  requestedFormat: ExportFormat
}

/**
 * A render can be skipped entirely (instant, lossless export) when there are no
 * compositing edits: no visible camera overlay, no captions/title cards, and a
 * single segment covering the whole source — and the raw screen container
 * already matches the requested format. In that case the original screen blob
 * is the finished file.
 */
export function canPassthrough({
  cameraVisible,
  hasCamera,
  captions,
  titleCards,
  segments,
  sourceDuration,
  screenMimeType,
  requestedFormat,
}: PassthroughCheck): boolean {
  if (
    (hasCamera && cameraVisible) ||
    segments.some((segment) => segment.composition === "camera-only") ||
    captions.length > 0 ||
    titleCards.length > 0
  ) return false
  const sourceIsMp4 = screenMimeType.includes("mp4")
  const sourceIsWebm = screenMimeType.includes("webm")
  const formatMatches =
    (requestedFormat === "mp4" && sourceIsMp4) || (requestedFormat === "webm" && sourceIsWebm)
  if (!formatMatches) return false
  if (segments.length !== 1) return false
  const [only] = segments
  const coversStart = only.sourceStart <= 0.05
  const coversEnd = sourceDuration <= 0 || only.sourceEnd >= sourceDuration - 0.1
  return coversStart && coversEnd
}
