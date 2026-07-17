import { upload } from "@vercel/blob/client"
import type { EditorState, SavedVideo } from "@/lib/studio-types"

/** Capture a poster frame from a playing/seekable <video> as a JPEG blob. */
export async function captureThumbnail(
  video: HTMLVideoElement,
  atTime: number,
): Promise<Blob | null> {
  try {
    // Seek to the requested time and wait for the frame to be ready.
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked)
        resolve()
      }
      video.addEventListener("seeked", onSeeked)
      video.currentTime = atTime
      // Fallback in case "seeked" never fires.
      setTimeout(resolve, 800)
    })

    const w = video.videoWidth || 1280
    const h = video.videoHeight || 720
    const canvas = document.createElement("canvas")
    // Preserve enough detail for wide, full-width library cards on high-DPI displays.
    const scale = Math.min(1, 1280 / w)
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
    )
  } catch {
    return null
  }
}

/**
 * Capture a poster frame from a source track (screen recording). Used for the
 * library cover. We deliberately grab it from the raw screen track — matching
 * the raw-preview library player — rather than rendering a composited frame.
 */
export async function captureThumbnailFromBlob(
  blob: Blob,
  atTime = 0,
): Promise<Blob | null> {
  const url = URL.createObjectURL(blob)
  try {
    const video = await new Promise<HTMLVideoElement>((resolve, reject) => {
      const v = document.createElement("video")
      v.src = url
      v.muted = true
      v.playsInline = true
      v.preload = "auto"
      v.onloadeddata = () => resolve(v)
      v.onerror = () => reject(new Error("Failed to load video for thumbnail"))
    })
    // Nudge slightly past the very first frame to avoid an occasional black frame,
    // but stay within the clip.
    const dur = Number.isFinite(video.duration) ? video.duration : 0
    const t = dur > 0 ? Math.min(atTime, Math.max(0, dur - 0.05)) : atTime
    const thumb = await captureThumbnail(video, t)
    video.src = ""
    return thumb
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Upload one already-encoded media blob straight to Blob storage from the
 * browser, bypassing the serverless request-body limit. Returns the stored
 * pathname (private store → served later through /api/file).
 */
async function uploadTrack(
  folder: string,
  blob: Blob,
  extension: string,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const result = await upload(`${folder}/track-${Date.now()}.${extension}`, blob, {
    access: "private",
    handleUploadUrl: "/api/videos/upload",
    contentType: blob.type || undefined,
    onUploadProgress: onProgress
      ? ({ percentage }) => onProgress(Math.max(0, Math.min(1, percentage / 100)))
      : undefined,
  })
  return result.pathname
}

function extensionFor(mimeType: string, fallback: string): string {
  if (mimeType.includes("mp4")) return "mp4"
  if (mimeType.includes("webm")) return "webm"
  if (mimeType.includes("ogg")) return "ogg"
  return fallback
}

export interface SaveProjectInput {
  screen: Blob
  camera: Blob | null
  audio: Blob | null
  thumbnail: Blob | null
  mimeTypes: { screen: string; camera: string | null; audio: string | null }
  title: string
  durationSeconds: number
  editorState: EditorState
  /** 0-1 upload progress across all tracks. */
  onProgress?: (fraction: number) => void
}

/**
 * Save an editable project: upload the ORIGINAL recorded tracks (screen, and
 * optionally camera + mic) directly to Blob — no canvas, no MediaRecorder, no
 * FFmpeg — then persist a tiny metadata row with the editor state. This is why
 * saving is fast and lossless: it's a plain transfer of already-encoded bytes,
 * and the full quality/color of the originals is preserved.
 */
export async function saveProjectToLibrary(input: SaveProjectInput): Promise<SavedVideo> {
  return persistProject(input, null)
}

/** Update an existing project row, re-uploading its tracks + editor state. */
export async function updateProjectInLibrary(
  id: string,
  input: SaveProjectInput,
): Promise<SavedVideo> {
  return persistProject(input, id)
}

async function persistProject(input: SaveProjectInput, id: string | null): Promise<SavedVideo> {
  const { screen, camera, audio, thumbnail, mimeTypes } = input

  // Weight progress across the tracks we actually upload.
  const sizes = [screen.size, camera?.size ?? 0, audio?.size ?? 0]
  const totalBytes = sizes.reduce((a, b) => a + b, 0) || 1
  let baseFraction = 0
  const trackProgress = (bytes: number) => (fraction: number) => {
    input.onProgress?.(Math.min(1, (baseFraction + fraction * bytes) / totalBytes))
  }

  const screenPathname = await uploadTrack(
    "videos",
    screen,
    extensionFor(mimeTypes.screen, "webm"),
    trackProgress(screen.size),
  )
  baseFraction += screen.size

  let cameraPathname: string | null = null
  if (camera) {
    cameraPathname = await uploadTrack(
      "cameras",
      camera,
      extensionFor(mimeTypes.camera ?? "", "webm"),
      trackProgress(camera.size),
    )
    baseFraction += camera.size
  }

  let audioPathname: string | null = null
  if (audio) {
    audioPathname = await uploadTrack(
      "audio",
      audio,
      extensionFor(mimeTypes.audio ?? "", "webm"),
      trackProgress(audio.size),
    )
    baseFraction += audio.size
  }

  let thumbnailPathname: string | null = null
  if (thumbnail && thumbnail.size > 0) {
    thumbnailPathname = await uploadTrack("thumbnails", thumbnail, "jpg")
  }
  input.onProgress?.(1)

  const body = {
    title: input.title.trim() || "Untitled recording",
    durationSeconds: input.durationSeconds,
    sizeBytes: totalBytes,
    // Library player shows the raw screen recording (no pre-render).
    pathname: screenPathname,
    thumbnailPathname,
    screenPathname,
    cameraPathname,
    audioPathname,
    editorState: input.editorState,
  }

  const res = await fetch(id ? `/api/videos/${id}` : "/api/videos", {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error("Failed to save project")
  const { video } = (await res.json()) as { video: SavedVideo }
  return video
}
