import { Pool } from "pg"
import type { EditorState as SharedEditorState, SavedVideo } from "@/lib/studio-types"

// Reuse a single pool across hot reloads / lambda invocations.
const globalForDb = globalThis as unknown as { _pgPool?: Pool; _videosMigrated?: Promise<void> }

export const pool =
  globalForDb._pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
  })

if (!globalForDb._pgPool) globalForDb._pgPool = pool

export interface VideoRow {
  id: string
  title: string
  pathname: string
  url: string
  thumbnail_url: string | null
  duration_seconds: number
  size_bytes: number
  created_at: string
  /** 'project' rows keep raw editable tracks; 'legacy' rows are flattened files. */
  kind: "project" | "legacy"
  /** Raw source track pathnames (private Blob) for editable projects. */
  screen_pathname: string | null
  camera_pathname: string | null
  audio_pathname: string | null
  /** Serialized editor state (trim, segments, camera layout, captions, etc.). */
  editor_state: EditorState | null
  /** Vercel product categories, stored as a JSON string array. */
  tags: string[] | null
}

/** Re-exported from studio-types so route handlers can import from one place. */
export type EditorState = SharedEditorState

const SELECT_COLUMNS = `id, title, pathname, url, thumbnail_url, duration_seconds, size_bytes,
  created_at, kind, screen_pathname, camera_pathname, audio_pathname, editor_state, tags`

// Private blobs are served through /api/file, never via a public URL.
const serveUrl = (pathname: string | null) =>
  pathname ? `/api/file?pathname=${encodeURIComponent(pathname)}` : null

/**
 * Shape a raw DB row into the client-facing SavedVideo, converting stored blob
 * pathnames into serve URLs. Track URLs are only exposed for editable projects.
 */
export function rowToSavedVideo(row: VideoRow): SavedVideo {
  return {
    id: row.id,
    title: row.title,
    pathname: row.pathname,
    url: row.url,
    thumbnail_url: row.thumbnail_url,
    duration_seconds: row.duration_seconds,
    size_bytes: row.size_bytes,
    created_at: row.created_at,
    kind: row.kind,
    screen_url: serveUrl(row.screen_pathname),
    camera_url: serveUrl(row.camera_pathname),
    audio_url: serveUrl(row.audio_pathname),
    editor_state: row.editor_state,
    tags: Array.isArray(row.tags) ? row.tags : [],
  }
}

/**
 * Idempotently add the columns that turn a flattened video row into an editable
 * project (raw track pathnames + editor_state JSON). Runs once per process and
 * is safe to call repeatedly. Existing rows default to the 'legacy' kind.
 */
export function ensureVideosSchema(): Promise<void> {
  if (globalForDb._videosMigrated) return globalForDb._videosMigrated
  globalForDb._videosMigrated = pool
    .query(
      `ALTER TABLE videos
         ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'legacy',
         ADD COLUMN IF NOT EXISTS screen_pathname text,
         ADD COLUMN IF NOT EXISTS camera_pathname text,
         ADD COLUMN IF NOT EXISTS audio_pathname text,
         ADD COLUMN IF NOT EXISTS editor_state jsonb,
         ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb`,
    )
    .then(() => undefined)
    .catch((error) => {
      // Reset so a later call can retry rather than caching the failure.
      globalForDb._videosMigrated = undefined
      throw error
    })
  return globalForDb._videosMigrated
}

/** List saved videos, newest first. Shared by the API route and the RSC page. */
export async function listVideos(): Promise<SavedVideo[]> {
  await ensureVideosSchema()
  const { rows } = await pool.query<VideoRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM videos
     ORDER BY created_at DESC`,
  )
  return rows.map(rowToSavedVideo)
}

export { SELECT_COLUMNS }
