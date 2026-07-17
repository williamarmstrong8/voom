import { StudioApp } from "@/components/studio/studio-app"
import { listVideos } from "@/lib/db"
import type { SavedVideo } from "@/lib/studio-types"

// Always read the current library on the server so the first paint has data
// (no client fetch race, no loading spinner on load).
export const dynamic = "force-dynamic"

export default async function Page() {
  let initialVideos: SavedVideo[] = []
  try {
    initialVideos = await listVideos()
  } catch (error) {
    console.error("[v0] initial video load failed:", error)
  }

  return <StudioApp initialVideos={initialVideos} />
}
