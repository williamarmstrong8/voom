import { put } from "@vercel/blob"
import { NextResponse } from "next/server"
import { listVideos, pool, type VideoRow } from "@/lib/db"

export const runtime = "nodejs"
// Allow time to stream the recording up to Blob.
export const maxDuration = 60

// List all saved videos, newest first.
export async function GET() {
  try {
    const videos = await listVideos()
    return NextResponse.json({ videos })
  } catch (error) {
    console.error("[v0] list videos failed:", error)
    return NextResponse.json({ error: "Failed to list videos" }, { status: 500 })
  }
}

// Receive the finished recording as multipart form data, upload the file (and
// optional thumbnail) to Blob from the server, then persist its metadata.
// Uploading server-side avoids the browser making a cross-origin request to the
// Blob API, which is blocked by CORS in some hosting environments.
export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const video = form.get("video")
    const thumbnail = form.get("thumbnail")
    const title = (form.get("title") as string | null)?.trim() || "Untitled recording"
    const durationSeconds = Number(form.get("durationSeconds")) || 0

    if (!(video instanceof Blob) || video.size === 0) {
      return NextResponse.json({ error: "Missing video file" }, { status: 400 })
    }

    const stamp = Date.now()
    const safeTitle =
      title.replace(/[^\w-]+/g, "-").toLowerCase().replace(/^-+|-+$/g, "") || "recording"

    // The Blob store is private, so files are streamed back through /api/file
    // rather than served from a public URL.
    const serveUrl = (p: string) => `/api/file?pathname=${encodeURIComponent(p)}`

    const videoBlob = await put(`videos/${safeTitle}-${stamp}.mp4`, video, {
      access: "private",
      contentType: "video/mp4",
      addRandomSuffix: true,
    })

    let thumbnailUrl: string | null = null
    if (thumbnail instanceof Blob && thumbnail.size > 0) {
      const thumbBlob = await put(`thumbnails/${safeTitle}-${stamp}.jpg`, thumbnail, {
        access: "private",
        contentType: "image/jpeg",
        addRandomSuffix: true,
      })
      thumbnailUrl = serveUrl(thumbBlob.pathname)
    }

    const { rows } = await pool.query<VideoRow>(
      `INSERT INTO videos (title, pathname, url, thumbnail_url, duration_seconds, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, pathname, url, thumbnail_url, duration_seconds, size_bytes, created_at`,
      [
        title,
        videoBlob.pathname,
        serveUrl(videoBlob.pathname),
        thumbnailUrl,
        durationSeconds,
        video.size,
      ],
    )

    return NextResponse.json({ video: rows[0] })
  } catch (error) {
    console.error("[v0] save video failed:", error)
    return NextResponse.json(
      { error: "Failed to save video", detail: (error as Error)?.message },
      { status: 500 },
    )
  }
}
