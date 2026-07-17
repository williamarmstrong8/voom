import { del, put } from "@vercel/blob"
import { NextResponse } from "next/server"
import { pool, type VideoRow } from "@/lib/db"

export const runtime = "nodejs"
export const maxDuration = 60

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const { rows } = await pool.query<VideoRow>(
      `SELECT pathname, thumbnail_url FROM videos WHERE id = $1`,
      [id],
    )
    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const form = await request.formData()
    const video = form.get("video")
    const thumbnail = form.get("thumbnail")
    const title = (form.get("title") as string | null)?.trim() || "Untitled recording"
    const durationSeconds = Number(form.get("durationSeconds")) || 0
    if (!(video instanceof Blob) || video.size === 0) {
      return NextResponse.json({ error: "Missing video file" }, { status: 400 })
    }

    const stamp = Date.now()
    const safeTitle = title.replace(/[^\w-]+/g, "-").toLowerCase().replace(/^-+|-+$/g, "") || "recording"
    const serveUrl = (pathname: string) => `/api/file?pathname=${encodeURIComponent(pathname)}`
    const videoBlob = await put(`videos/${safeTitle}-${stamp}.mp4`, video, {
      access: "private",
      contentType: video.type || "video/mp4",
      addRandomSuffix: true,
    })

    let thumbnailUrl: string | null = rows[0].thumbnail_url
    let newThumbnailPath: string | null = null
    if (thumbnail instanceof Blob && thumbnail.size > 0) {
      const thumbnailBlob = await put(`thumbnails/${safeTitle}-${stamp}.jpg`, thumbnail, {
        access: "private",
        contentType: "image/jpeg",
        addRandomSuffix: true,
      })
      newThumbnailPath = thumbnailBlob.pathname
      thumbnailUrl = serveUrl(thumbnailBlob.pathname)
    }

    const { rows: updated } = await pool.query<VideoRow>(
      `UPDATE videos
       SET title = $1, pathname = $2, url = $3, thumbnail_url = $4,
           duration_seconds = $5, size_bytes = $6
       WHERE id = $7
       RETURNING id, title, pathname, url, thumbnail_url, duration_seconds, size_bytes, created_at`,
      [title, videoBlob.pathname, serveUrl(videoBlob.pathname), thumbnailUrl, durationSeconds, video.size, id],
    )

    const previousThumbnailPath = rows[0].thumbnail_url
      ? new URLSearchParams(rows[0].thumbnail_url.split("?")[1] ?? "").get("pathname")
      : null
    const obsolete = [rows[0].pathname, newThumbnailPath ? previousThumbnailPath : null].filter(Boolean) as string[]
    if (obsolete.length) await del(obsolete).catch((error) => console.error("[v0] old blob cleanup failed:", error))

    return NextResponse.json({ video: updated[0] })
  } catch (error) {
    console.error("[v0] update video failed:", error)
    return NextResponse.json({ error: "Failed to update video" }, { status: 500 })
  }
}

// Delete a saved video: remove the blob files, then the DB row.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const { rows } = await pool.query<VideoRow>(
      `SELECT pathname, thumbnail_url FROM videos WHERE id = $1`,
      [id],
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    // url/thumbnail_url hold serve URLs (/api/file?pathname=X); recover the raw
    // blob pathnames so del() targets the actual files.
    const { pathname, thumbnail_url } = rows[0]
    const thumbPathname = thumbnail_url
      ? new URLSearchParams(thumbnail_url.split("?")[1] ?? "").get("pathname")
      : null
    const toDelete = [pathname, thumbPathname].filter(Boolean) as string[]
    if (toDelete.length > 0) {
      await del(toDelete).catch((e) => console.error("[v0] blob del failed:", e))
    }

    await pool.query(`DELETE FROM videos WHERE id = $1`, [id])
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] delete video failed:", error)
    return NextResponse.json({ error: "Failed to delete video" }, { status: 500 })
  }
}
