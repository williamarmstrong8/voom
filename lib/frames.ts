// Extracts a handful of poster frames from a local recording so the timeline
// can render a filmstrip of the actual video content.

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video")
    v.src = url
    v.crossOrigin = "anonymous"
    v.muted = true
    v.playsInline = true
    v.preload = "auto"
    v.onloadeddata = () => resolve(v)
    v.onerror = () => reject(new Error("Failed to load video for frames"))
  })
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      video.removeEventListener("seeked", done)
      resolve()
    }
    video.addEventListener("seeked", done)
    video.currentTime = time
    // Fallback for containers that don't reliably fire "seeked".
    setTimeout(done, 600)
  })
}

/**
 * Capture `count` evenly spaced JPEG data URLs across [0, duration].
 * Runs sequentially to keep a single decoder happy; fine for short demos.
 */
export async function extractFrames(
  url: string,
  duration: number,
  count = 10,
  frameWidth = 160,
): Promise<string[]> {
  if (!Number.isFinite(duration) || duration <= 0) return []
  const video = await loadVideo(url)
  const vw = video.videoWidth || 1280
  const vh = video.videoHeight || 720
  const canvas = document.createElement("canvas")
  canvas.width = frameWidth
  canvas.height = Math.round((frameWidth * vh) / vw)
  const ctx = canvas.getContext("2d")
  if (!ctx) return []

  const frames: string[] = []
  for (let i = 0; i < count; i++) {
    // Sample at the middle of each slice to avoid black start/end frames.
    const t = ((i + 0.5) / count) * duration
    try {
      await seek(video, Math.min(t, Math.max(0, duration - 0.05)))
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push(canvas.toDataURL("image/jpeg", 0.6))
    } catch {
      // Skip a frame we couldn't grab.
    }
  }

  video.src = ""
  return frames
}
