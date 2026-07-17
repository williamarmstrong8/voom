"use client"

import { ArrowLeft, Download, Pencil, Video as VideoIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SavedVideo } from "@/lib/studio-types"

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, "0")}`
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function formatSize(bytes: number) {
  const megabytes = bytes / 1024 / 1024
  return megabytes >= 1000 ? `${(megabytes / 1024).toFixed(1)} GB` : `${megabytes.toFixed(0)} MB`
}

export function VideoViewScreen({
  video,
  onBack,
  onEdit,
}: {
  video: SavedVideo
  onBack: () => void
  onEdit: () => void
}) {
  return (
    <main className="flex min-h-[calc(100svh-3rem)] w-full flex-col gap-6 px-5 py-8 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="secondary" size="icon" onClick={onBack} aria-label="Back to library">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <p className="text-label-12 text-muted-foreground">Video</p>
            <h1 className="truncate text-heading-24 text-balance">{video.title}</h1>
            <p className="text-copy-13 text-muted-foreground">
              {formatDate(video.created_at)} · {formatDuration(video.duration_seconds)} · {formatSize(video.size_bytes)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={video.url}
            download={`${video.title}.mp4`}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-secondary px-3 text-button-14 text-foreground transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download className="size-4" />
            Download
          </a>
          <Button onClick={onEdit} className="gap-2">
            <Pencil className="size-4" />
            Edit video
          </Button>
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-black shadow-sm" aria-label="Video player">
        {video.url ? (
          <video
            src={video.url}
            poster={video.thumbnail_url ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="max-h-[calc(100svh-15rem)] w-full object-contain"
          >
            <track kind="captions" />
          </video>
        ) : (
          <div className="flex min-h-96 flex-col items-center justify-center gap-3 text-muted-foreground">
            <VideoIcon className="size-8" />
            <p className="text-copy-14">This video is unavailable.</p>
          </div>
        )}
      </section>
    </main>
  )
}
