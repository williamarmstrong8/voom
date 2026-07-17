"use client"

import { useCallback, useState } from "react"
import type { SavedVideo } from "@/lib/studio-types"

interface UseVideos {
  videos: SavedVideo[]
  loading: boolean
  error: boolean
  /** Re-fetch from the server. */
  refresh: () => Promise<void>
  /** Optimistically replace the local list (e.g. after a delete). */
  setVideos: (updater: (curr: SavedVideo[]) => SavedVideo[]) => void
}

/**
 * Holds the saved-video library. The initial list is fetched on the server and
 * passed in as `initialVideos`, so the first render already has data and never
 * shows a loading spinner — this sidesteps the v0 preview iframe issue where a
 * client fetch effect could resolve but never apply its state. `refresh()` is
 * still used after mutations (save/delete).
 */
export function useVideos(initialVideos: SavedVideo[] = []): UseVideos {
  const [videos, setVideosState] = useState<SavedVideo[]>(initialVideos)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  // Imperative fetch for manual refresh / retry (always applies its result).
  const refresh = useCallback(async () => {
    try {
      setError(false)
      const res = await fetch("/api/videos", { cache: "no-store" })
      if (!res.ok) throw new Error(`Request failed: ${res.status}`)
      const json = (await res.json()) as { videos: SavedVideo[] }
      setVideosState(json.videos ?? [])
    } catch (err) {
      console.log("[v0] failed to load videos:", err)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const setVideos = useCallback(
    (updater: (curr: SavedVideo[]) => SavedVideo[]) => {
      setVideosState((curr) => updater(curr))
    },
    [],
  )

  return { videos, loading, error, refresh, setVideos }
}
