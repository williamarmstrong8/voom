import type { SavedVideo } from "@/lib/studio-types"

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

interface SaveVideoInput {
  video: Blob
  thumbnail: Blob | null
  title: string
  durationSeconds: number
  filename?: string
}

/**
 * Send the finished recording (and thumbnail) to the server, which uploads the
 * file to Blob with `put()` and persists its metadata. Server-side upload keeps
 * the browser from making a cross-origin request to the Blob API.
 */
export async function saveVideoToLibrary({
  video,
  thumbnail,
  title,
  durationSeconds,
  filename = "recording.mp4",
}: SaveVideoInput): Promise<SavedVideo> {
  const form = new FormData()
  form.append("video", video, filename)
  if (thumbnail) form.append("thumbnail", thumbnail, "thumbnail.jpg")
  form.append("title", title.trim() || "Untitled recording")
  form.append("durationSeconds", String(durationSeconds))

  const res = await fetch("/api/videos", { method: "POST", body: form })

  if (!res.ok) throw new Error("Failed to save video")
  const { video: saved } = await res.json()
  return saved as SavedVideo
}

export async function updateVideoInLibrary(
  id: string,
  input: SaveVideoInput,
): Promise<SavedVideo> {
  const form = new FormData()
  form.append("video", input.video, input.filename ?? "recording.mp4")
  if (input.thumbnail) form.append("thumbnail", input.thumbnail, "thumbnail.jpg")
  form.append("title", input.title.trim() || "Untitled recording")
  form.append("durationSeconds", String(input.durationSeconds))

  const res = await fetch(`/api/videos/${id}`, { method: "PUT", body: form })
  if (!res.ok) throw new Error("Failed to update video")
  const { video: saved } = await res.json()
  return saved as SavedVideo
}
