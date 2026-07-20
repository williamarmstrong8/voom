"use client"

import { useEffect, useRef, useState } from "react"
import { Menu } from "@base-ui/react/menu"
import {
  Clock,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Trash2,
  Video as VideoIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { SavedVideo } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

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
  onOpenVideo: (video: SavedVideo) => void
  videos: SavedVideo[]
  refresh: () => Promise<void>
  setVideos: React.Dispatch<React.SetStateAction<SavedVideo[]>>
}

export function Dashboard({ onRecord, onOpenVideo, videos, refresh, setVideos }: DashboardProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // The video queued for deletion. Non-null means the confirm dialog is open.
  const [pendingDelete, setPendingDelete] = useState<SavedVideo | null>(null)
  const [pendingRename, setPendingRename] = useState<SavedVideo | null>(null)
  const [renameTitle, setRenameTitle] = useState("")
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  function beginRename(video: SavedVideo) {
    setPendingRename(video)
    setRenameTitle(video.title)
    setRenameError(null)
  }

  async function confirmRename() {
    const target = pendingRename
    const title = renameTitle.trim()
    if (!target || !title || renaming) return

    setRenaming(true)
    setRenameError(null)
    try {
      const response = await fetch(`/api/videos/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
      if (!response.ok) throw new Error(`Rename failed: ${response.status}`)
      const { video } = (await response.json()) as { video: SavedVideo }
      setVideos((current) => current.map((item) => (item.id === video.id ? video : item)))
      setPendingRename(null)
    } catch {
      setRenameError("Couldn’t rename this video. Please try again.")
    } finally {
      setRenaming(false)
    }
  }

  async function confirmDelete() {
    const target = pendingDelete
    if (!target) return
    setPendingDelete(null)
    setDeletingId(target.id)
    // Optimistically drop it from the list.
    setVideos((curr) => curr.filter((v) => v.id !== target.id))
    try {
      await fetch(`/api/videos/${target.id}`, { method: "DELETE" })
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

      {videos.length === 0 ? (
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
              renaming={pendingRename?.id === video.id}
              renameTitle={renameTitle}
              renameError={pendingRename?.id === video.id ? renameError : null}
              savingRename={renaming && pendingRename?.id === video.id}
              onOpen={() => onOpenVideo(video)}
              onRename={() => beginRename(video)}
              onRenameTitleChange={setRenameTitle}
              onRenameSave={() => void confirmRename()}
              onRenameCancel={() => {
                if (!renaming) setPendingRename(null)
              }}
              onDelete={() => setPendingDelete(video)}
            />
          ))}
        </section>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this video?</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `“${pendingDelete.title}” will be permanently removed from your library. This can’t be undone.`
                : "This can’t be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={<Button variant="outline">Cancel</Button>}
            />
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              className="gap-2"
            >
              <Trash2 className="size-4" />
              Delete video
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function LibraryCameraPreview({ video }: { video: SavedVideo }) {
  const ref = useRef<HTMLVideoElement>(null)
  const state = video.editor_state
  const firstSegment = state?.segments[0]
  const cameraOnly = firstSegment?.composition === "camera-only"
  const visible = cameraOnly || state?.camera.visible
  const layout = state?.camera.layout

  useEffect(() => {
    const element = ref.current
    if (!element || !firstSegment) return
    const seekToCoverFrame = () => {
      element.currentTime = Math.min(firstSegment.sourceStart + 0.05, firstSegment.sourceEnd)
    }
    element.addEventListener("loadeddata", seekToCoverFrame)
    if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) seekToCoverFrame()
    return () => element.removeEventListener("loadeddata", seekToCoverFrame)
  }, [firstSegment])

  if (!video.camera_url || !state || !visible || !layout) return null

  const shapeClass =
    layout.shape === "circle"
      ? "rounded-full"
      : layout.shape === "triangle"
        ? "[clip-path:polygon(50%_0%,100%_100%,0%_100%)]"
        : layout.shape === "rounded"
          ? "rounded-lg"
          : "rounded-md"

  return (
    <div
      className={cn(
        "pointer-events-none absolute z-10 overflow-hidden border border-white/30 bg-black shadow-md",
        cameraOnly ? "inset-0 border-0" : shapeClass,
      )}
      style={cameraOnly ? undefined : {
        left: `${layout.left * 100}%`,
        bottom: `${layout.bottom * 100}%`,
        width: `${layout.width * 100}%`,
        aspectRatio: layout.shape === "rounded" ? "16 / 9" : "1 / 1",
      }}
      aria-hidden="true"
    >
      <video
        ref={ref}
        src={video.camera_url}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full -scale-x-100 object-cover"
      />
    </div>
  )
}

function VideoCard({
  video,
  deleting,
  renaming,
  renameTitle,
  renameError,
  savingRename,
  onOpen,
  onRename,
  onRenameTitleChange,
  onRenameSave,
  onRenameCancel,
  onDelete,
}: {
  video: SavedVideo
  deleting: boolean
  renaming: boolean
  renameTitle: string
  renameError: string | null
  savingRename: boolean
  onOpen: () => void
  onRename: () => void
  onRenameTitleChange: (title: string) => void
  onRenameSave: () => void
  onRenameCancel: () => void
  onDelete: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Play ${video.title}`}
      onPointerDown={(event) => {
        if (event.button === 0 && !(event.target as HTMLElement).closest("[data-card-action]")) onOpen()
      }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !(event.target as HTMLElement).closest("[data-card-action]")) {
          event.preventDefault()
          onOpen()
        }
      }}
      className="group relative cursor-pointer touch-manipulation overflow-hidden rounded-md border border-border bg-card outline-none transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
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
          <LibraryCameraPreview video={video} />
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
            <div className="flex size-12 items-center justify-center rounded-full bg-background/90">
              <Play className="size-5 translate-x-0.5 text-foreground" />
            </div>
          </div>
          <span className="absolute bottom-2 right-2 z-30 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white">
            {formatDuration(video.duration_seconds)}
          </span>
        </div>

      <div className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form
              data-card-action
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault()
                onRenameSave()
              }}
            >
              <input
                autoFocus
                value={renameTitle}
                onChange={(event) => onRenameTitleChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") onRenameCancel()
                }}
                disabled={savingRename}
                aria-label="Video name"
                className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-background px-2 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!renameTitle.trim() || savingRename}
                className="rounded-sm px-2 py-1 text-xs font-medium hover:bg-secondary disabled:opacity-50"
              >
                {savingRename ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
              </button>
            </form>
          ) : (
            <p className="truncate text-sm font-medium">{video.title}</p>
          )}
          {renameError && <p className="mt-1 text-xs text-destructive">{renameError}</p>}
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3" />
            {formatDate(video.created_at)}
            {formatSize(video.size_bytes) && ` · ${formatSize(video.size_bytes)}`}
          </p>
        </div>
        <Menu.Root>
          <Menu.Trigger
            data-card-action
            disabled={deleting}
            aria-label={`More actions for ${video.title}`}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={6} align="end" className="z-50 outline-none">
              <Menu.Popup
                data-card-action
                className="min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none transition data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
              >
                <Menu.Item
                  onClick={onRename}
                  className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-copy-14 outline-none data-highlighted:bg-secondary"
                >
                  <Pencil className="size-4" />
                  Rename
                </Menu.Item>
                <Menu.Item
                  onClick={onDelete}
                  className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-copy-14 text-destructive outline-none data-highlighted:bg-destructive/10"
                >
                  <Trash2 className="size-4" />
                  Delete
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
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
