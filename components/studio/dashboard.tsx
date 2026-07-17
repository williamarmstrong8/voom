"use client"

import { useState } from "react"
import {
  Clock,
  Loader2,
  Play,
  Plus,
  Trash2,
  Video as VideoIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useVideos } from "@/hooks/use-videos"
import type { SavedVideo } from "@/lib/studio-types"

function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}:${rem.toString().padStart(2, "0")}`
}

function formatSize(bytes: number) {
  if (!bytes) return ""
  const mb = bytes / (1024 * 1024)
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb.toFixed(0)} MB`
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return ""
  }
}

interface DashboardProps {
  onRecord: () => void
  /** Videos read on the server for the first paint. */
  initialVideos?: SavedVideo[]
  onOpenVideo: (video: SavedVideo) => void
}

export function Dashboard({ onRecord, onOpenVideo, initialVideos = [] }: DashboardProps) {
  const { videos, loading, error, refresh, setVideos } = useVideos(initialVideos)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleDelete(id: string) {
    setDeletingId(id)
    // Optimistically drop it from the list.
    setVideos((curr) => curr.filter((v) => v.id !== id))
    try {
      await fetch(`/api/videos/${id}`, { method: "DELETE" })
    } finally {
      setDeletingId(null)
      void refresh()
    }
  }

  return (
    <main className="flex min-h-[calc(100svh-3rem)] w-full flex-col gap-8 px-5 py-8 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold leading-tight tracking-tight">
            Library
          </h1>
          <p className="text-sm text-muted-foreground">
            Your recorded demos and screen walkthroughs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onRecord} size="lg" className="gap-2">
            <VideoIcon className="size-4" />
            Record
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="ml-2 text-sm">Loading your library…</span>
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-center">
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load your library.
          </p>
          <Button variant="secondary" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      ) : videos.length === 0 ? (
        <EmptyState onRecord={onRecord} />
      ) : (
        <section
          className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Saved videos"
        >
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              deleting={deletingId === video.id}
              onOpen={() => onOpenVideo(video)}
              onDelete={() => handleDelete(video.id)}
            />
          ))}
        </section>
      )}

    </main>
  )
}

function VideoCard({
  video,
  deleting,
  onOpen,
  onDelete,
}: {
  video: SavedVideo
  deleting: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <div className="group relative overflow-hidden rounded-md border border-border bg-card transition-colors hover:border-primary/40">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left"
        aria-label={`Play ${video.title}`}
      >
        <div className="relative aspect-video w-full overflow-hidden bg-secondary">
          {video.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={video.thumbnail_url || "/placeholder.svg"}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover [image-rendering:auto]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <VideoIcon className="size-8 text-muted-foreground" />
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
            <div className="flex size-12 items-center justify-center rounded-full bg-background/90">
              <Play className="size-5 translate-x-0.5 text-foreground" />
            </div>
          </div>
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white">
            {formatDuration(video.duration_seconds)}
          </span>
        </div>
      </button>

      <div className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{video.title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3" />
            {formatDate(video.created_at)}
            {formatSize(video.size_bytes) && ` · ${formatSize(video.size_bytes)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          aria-label="Delete video"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
        >
          {deleting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
        </button>
      </div>
    </div>
  )
}

function EmptyState({ onRecord }: { onRecord: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-md border border-dashed border-border py-20 text-center">
      <div className="flex size-14 items-center justify-center rounded-md border border-border bg-card">
        <VideoIcon className="size-6 text-muted-foreground" />
      </div>
      <div>
        <p className="text-base font-medium">No recordings yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Record a screen demo with the teleprompter, then save it to your library.
        </p>
      </div>
      <Button onClick={onRecord} className="gap-2">
        <Plus className="size-4" />
        Record your first video
      </Button>
    </div>
  )
}
