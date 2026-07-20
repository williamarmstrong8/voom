import { del } from "@vercel/blob"
import { NextResponse } from "next/server"
import {
  ensureVideosSchema,
  pool,
  rowToSavedVideo,
  SELECT_COLUMNS,
  type EditorState,
  type VideoRow,
} from "@/lib/db"
import { isVercelProductTag } from "@/lib/studio-types"

export const runtime = "nodejs"

const serveUrl = (pathname: string) => `/api/file?pathname=${encodeURIComponent(pathname)}`

// Recover the raw blob pathname from a stored serve URL (/api/file?pathname=X).
function pathnameFromServeUrl(url: string | null): string | null {
  if (!url) return null
  return new URLSearchParams(url.split("?")[1] ?? "").get("pathname")
}

interface UpdateProjectBody {
  title?: string
  durationSeconds?: number
  sizeBytes?: number
  pathname: string
  thumbnailPathname?: string | null
  screenPathname?: string | null
  cameraPathname?: string | null
  audioPathname?: string | null
  editorState?: EditorState | null
}

// Update project metadata after the browser has uploaded any new/changed media
// directly to Blob. Old, now-orphaned blobs are removed afterward.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    await ensureVideosSchema()
    const { rows: existingRows } = await pool.query<VideoRow>(
      `SELECT ${SELECT_COLUMNS} FROM videos WHERE id = $1`,
      [id],
    )
    if (existingRows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const existing = existingRows[0]

    const body = (await request.json()) as UpdateProjectBody
    const title = body.title?.trim() || "Untitled recording"
    const durationSeconds = Number(body.durationSeconds) || 0
    const sizeBytes = Number(body.sizeBytes) || existing.size_bytes || 0
    if (!body.pathname) {
      return NextResponse.json({ error: "Missing uploaded video pathname" }, { status: 400 })
    }

    const isProject = Boolean(body.screenPathname && body.editorState)
    const thumbnailUrl = body.thumbnailPathname
      ? serveUrl(body.thumbnailPathname)
      : existing.thumbnail_url

    const { rows: updated } = await pool.query<VideoRow>(
      `UPDATE videos
         SET title = $1, pathname = $2, url = $3, thumbnail_url = $4,
             duration_seconds = $5, size_bytes = $6, kind = $7,
             screen_pathname = $8, camera_pathname = $9, audio_pathname = $10,
             editor_state = $11
       WHERE id = $12
       RETURNING ${SELECT_COLUMNS}`,
      [
        title,
        body.pathname,
        serveUrl(body.pathname),
        thumbnailUrl,
        durationSeconds,
        sizeBytes,
        isProject ? "project" : "legacy",
        body.screenPathname ?? null,
        body.cameraPathname ?? null,
        body.audioPathname ?? null,
        body.editorState ? JSON.stringify(body.editorState) : null,
        id,
      ],
    )

    // Clean up blobs that this update replaced.
    const newPaths = new Set(
      [
        body.pathname,
        body.thumbnailPathname,
        body.screenPathname,
        body.cameraPathname,
        body.audioPathname,
      ].filter(Boolean) as string[],
    )
    const obsolete = [
      existing.pathname,
      pathnameFromServeUrl(existing.thumbnail_url),
      existing.screen_pathname,
      existing.camera_pathname,
      existing.audio_pathname,
    ].filter((p): p is string => Boolean(p) && !newPaths.has(p as string))
    if (obsolete.length) {
      await del(obsolete).catch((error) => console.error("[v0] old blob cleanup failed:", error))
    }

    return NextResponse.json({ video: rowToSavedVideo(updated[0]) })
  } catch (error) {
    console.error("[v0] update video failed:", error)
    return NextResponse.json({ error: "Failed to update video" }, { status: 500 })
  }
}

// Update lightweight metadata (title and/or product tags) without touching the
// media blobs or editor state.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const body = (await request.json()) as { title?: string; tags?: string[] }

    const sets: string[] = []
    const values: unknown[] = []

    if (body.title !== undefined) {
      const title = body.title.trim()
      if (!title) {
        return NextResponse.json({ error: "Title is required" }, { status: 400 })
      }
      values.push(title)
      sets.push(`title = $${values.length}`)
    }

    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags)) {
        return NextResponse.json({ error: "Tags must be an array" }, { status: 400 })
      }
      // Constrain to the canonical catalog and de-duplicate while preserving order.
      const seen = new Set<string>()
      const tags = body.tags.filter(
        (tag): tag is string =>
          typeof tag === "string" && isVercelProductTag(tag) && !seen.has(tag) && (seen.add(tag), true),
      )
      values.push(JSON.stringify(tags))
      sets.push(`tags = $${values.length}::jsonb`)
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    await ensureVideosSchema()
    values.push(id)
    const { rows } = await pool.query<VideoRow>(
      `UPDATE videos SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING ${SELECT_COLUMNS}`,
      values,
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json({ video: rowToSavedVideo(rows[0]) })
  } catch (error) {
    console.error("[v0] update video metadata failed:", error)
    return NextResponse.json({ error: "Failed to update video" }, { status: 500 })
  }
}

// Delete a saved video: remove every associated blob, then the DB row.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    await ensureVideosSchema()
    const { rows } = await pool.query<VideoRow>(
      `SELECT ${SELECT_COLUMNS} FROM videos WHERE id = $1`,
      [id],
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const row = rows[0]
    const toDelete = [
      row.pathname,
      pathnameFromServeUrl(row.thumbnail_url),
      row.screen_pathname,
      row.camera_pathname,
      row.audio_pathname,
    ].filter((p): p is string => Boolean(p))
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
