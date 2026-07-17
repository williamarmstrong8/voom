import { Pool } from "pg"

// Reuse a single pool across hot reloads / lambda invocations.
const globalForDb = globalThis as unknown as { _pgPool?: Pool }

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
}

/** List saved videos, newest first. Shared by the API route and the RSC page. */
export async function listVideos(): Promise<VideoRow[]> {
  const { rows } = await pool.query<VideoRow>(
    `SELECT id, title, pathname, url, thumbnail_url, duration_seconds, size_bytes, created_at
     FROM videos
     ORDER BY created_at DESC`,
  )
  return rows
}
