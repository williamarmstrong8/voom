import { NextResponse } from "next/server"
import {
  ensureVideosSchema,
  listVideos,
  pool,
  rowToSavedVideo,
  SELECT_COLUMNS,
  type EditorState,
  type VideoRow,
} from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The Blob store is private, so files are streamed back through /api/file
// rather than served from a public URL.
const serveUrl = (pathname: string) => `/api/file?pathname=${encodeURIComponent(pathname)}`

interface CreateProjectBody {
  title?: string
  durationSeconds?: number
  sizeBytes?: number
  /** Primary track shown in the library player (the raw screen recording). */
  pathname: string
  thumbnailPathname?: string | null
  screenPathname?: string | null
  cameraPathname?: string | null
  audioPathname?: string | null
  editorState?: EditorState | null
}

// List all saved videos, newest first.
export async function GET() {
  try {
    const videos = await listVideos()
    return NextResponse.json(
      { videos },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    )
  } catch (error) {
    console.error("[v0] list videos failed:", error)
    return NextResponse.json({ error: "Failed to list videos" }, { status: 500 })
  }
}

// Persist metadata for a recording whose media was already uploaded to Blob
// directly from the browser (client upload). No file body is sent here, so the
// request is tiny and fast — the heavy bytes never touch this function.
export async function POST(request: Request) {
  try {
    await ensureVideosSchema()
    const body = (await request.json()) as CreateProjectBody
    const title = body.title?.trim() || "Untitled recording"
    const durationSeconds = Number(body.durationSeconds) || 0
    const sizeBytes = Number(body.sizeBytes) || 0

    if (!body.pathname) {
      return NextResponse.json({ error: "Missing uploaded video pathname" }, { status: 400 })
    }

    const isProject = Boolean(body.screenPathname && body.editorState)

    const { rows } = await pool.query<VideoRow>(
      `INSERT INTO videos
         (title, pathname, url, thumbnail_url, duration_seconds, size_bytes,
          kind, screen_pathname, camera_pathname, audio_pathname, editor_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${SELECT_COLUMNS}`,
      [
        title,
        body.pathname,
        serveUrl(body.pathname),
        body.thumbnailPathname ? serveUrl(body.thumbnailPathname) : null,
        durationSeconds,
        sizeBytes,
        isProject ? "project" : "legacy",
        body.screenPathname ?? null,
        body.cameraPathname ?? null,
        body.audioPathname ?? null,
        body.editorState ? JSON.stringify(body.editorState) : null,
      ],
    )

    return NextResponse.json({ video: rowToSavedVideo(rows[0]) })
  } catch (error) {
    console.error("[v0] save video failed:", error)
    return NextResponse.json(
      { error: "Failed to save video", detail: (error as Error)?.message },
      { status: 500 },
    )
  }
}
