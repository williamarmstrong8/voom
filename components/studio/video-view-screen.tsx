"use client"

import { ArrowLeft, Download, Loader2, Pencil, Video as VideoIcon } from "lucide-react"
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
  editable,
  editLoading = false,
  editError = null,
}: {
  video: SavedVideo
  onBack: () => void
  onEdit: () => void
  /** Only editable projects (raw tracks + editor_state) can reopen the editor. */
  editable: boolean
  editLoading?: boolean
  editError?: string | null
}) {
  // Projects play their raw screen track (no flattened file exists until export);
  // legacy rows play their stored flattened file.
  const playbackUrl = video.kind === "project" ? video.screen_url : video.url
  const downloadUrl = playbackUrl ?? video.url
  const downloadExt = downloadUrl && downloadUrl.includes("mp4") ? "mp4" : "webm"

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
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <a
              href={downloadUrl ?? undefined}
              download={`${video.title}.${downloadExt}`}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-secondary px-3 text-button-14 text-foreground transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Download className="size-4" />
              Download
            </a>
            {editable && (
              <Button onClick={onEdit} disabled={editLoading} className="gap-2">
                {editLoading ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
                {editLoading ? "Opening…" : "Edit video"}
              </Button>
            )}
          </div>
          {editError && <p className="text-copy-13 text-destructive">{editError}</p>}
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center overflow-hidden" aria-label="Video player">
        {playbackUrl ? (
          <video
            src={playbackUrl}
            poster={video.thumbnail_url ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="max-h-[calc(100svh-15rem)] h-auto w-auto max-w-full rounded-lg border border-border bg-black object-contain shadow-sm"
          >
            <track kind="captions" />
          </video>
        ) : (
          <div className="flex min-h-96 w-full flex-col items-center justify-center gap-3 rounded-lg border border-border bg-secondary text-muted-foreground shadow-sm">
            <VideoIcon className="size-8" />
            <p className="text-copy-14">This video is unavailable.</p>
          </div>
        )}
      </section>
    </main>
  )
}
