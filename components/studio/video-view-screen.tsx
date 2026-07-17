"use client"

import { useRef, useState } from "react"
import { ArrowLeft, Download, Loader2, Pencil, Video as VideoIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useFfmpeg } from "@/hooks/use-ffmpeg"
import { compositeToFile } from "@/lib/export"
import { DEFAULT_CAMERA_LAYOUT, type SavedVideo } from "@/lib/studio-types"

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

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
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
  const baseUrl = playbackUrl ?? video.url
  const [videoReady, setVideoReady] = useState(false)
  const [screenAspect, setScreenAspect] = useState(16 / 9)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const ffmpeg = useFfmpeg()
  const cameraState = video.kind === "project" ? video.editor_state?.camera : null
  const cameraLayout = cameraState?.layout ?? DEFAULT_CAMERA_LAYOUT
  const cameraAspect = cameraLayout.shape === "rounded"
    ? 16 / 9
    : cameraLayout.shape === "triangle"
      ? 2 / Math.sqrt(3)
      : 1
  const showCamera = Boolean(cameraState?.visible && video.camera_url)

  const syncProjectTracks = () => {
    const player = videoRef.current
    if (!player) return

    const camera = cameraRef.current
    if (camera && Math.abs(camera.currentTime - player.currentTime) > 0.12) {
      camera.currentTime = player.currentTime
    }

    const narration = audioRef.current
    if (narration && Math.abs(narration.currentTime - player.currentTime) > 0.12) {
      narration.currentTime = player.currentTime
    }
  }

  const playProjectTracks = () => {
    const player = videoRef.current
    if (!player) return

    const camera = cameraRef.current
    if (camera) {
      camera.currentTime = player.currentTime
      camera.playbackRate = player.playbackRate
      void camera.play()
    }

    const narration = audioRef.current
    if (narration) {
      narration.currentTime = player.currentTime
      narration.playbackRate = player.playbackRate
      narration.volume = player.volume
      narration.muted = player.muted
      void narration.play()
    }
  }

  const pauseProjectTracks = () => {
    cameraRef.current?.pause()
    audioRef.current?.pause()
  }

  const downloadMp4 = async () => {
    if (!baseUrl || downloading) return
    setDownloading(true)
    setDownloadError(null)
    try {
      let output: Blob
      if (video.kind === "project" && video.editor_state && video.screen_url) {
        const state = video.editor_state
        const { blob, format } = await compositeToFile({
          screenUrl: video.screen_url,
          cameraUrl: state.camera.visible ? video.camera_url : null,
          audioUrl: video.audio_url,
          layout: state.camera.layout ?? DEFAULT_CAMERA_LAYOUT,
          trim: { start: 0, end: state.duration },
          quality: "1080p",
          format: "mp4",
          segments: state.segments,
          captions: state.captions,
          titleCards: state.titleCards,
          brandKit: state.brandKit,
        })
        output = format === "mp4" ? blob : await ffmpeg.transcodeToMp4(blob)
      } else {
        const response = await fetch(baseUrl)
        if (!response.ok) throw new Error("Could not load video")
        const source = await response.blob()
        output = source.type.includes("mp4") || baseUrl.includes(".mp4")
          ? source
          : await ffmpeg.transcodeToMp4(source)
      }
      saveBlob(output, `${video.title || "video"}.mp4`)
    } catch (error) {
      console.error("[v0] MP4 download failed:", error)
      setDownloadError("Couldn't create the MP4. Please try again.")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <main className="flex min-h-[calc(100svh-3rem)] w-full flex-col gap-6 px-5 py-8 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="secondary" size="icon" onClick={onBack} aria-label="Back to library">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-heading-24 text-balance">{video.title}</h1>
            <p className="text-copy-13 text-muted-foreground">
              {formatDate(video.created_at)} · {formatDuration(video.duration_seconds)} · {formatSize(video.size_bytes)}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void downloadMp4()}
              disabled={downloading}
              className="gap-2"
            >
              {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {downloading
                ? ffmpeg.loading
                  ? "Preparing MP4…"
                  : "Creating MP4…"
                : "Download MP4"}
            </Button>
            {editable && (
              <Button onClick={onEdit} disabled={editLoading} className="gap-2">
                {editLoading ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
                {editLoading ? "Opening…" : "Edit video"}
              </Button>
            )}
          </div>
          {(editError || downloadError) && (
            <p className="text-copy-13 text-destructive">{editError || downloadError}</p>
          )}
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center overflow-hidden" aria-label="Video player">
        {playbackUrl ? (
          <div
            className="relative w-full max-w-7xl overflow-hidden rounded-lg border border-border bg-black shadow-sm"
            style={{ aspectRatio: String(screenAspect) }}
          >
            {!videoReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-secondary" aria-label="Loading video">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}
            <video
              ref={videoRef}
              src={playbackUrl}
              controls={videoReady}
              playsInline
              preload="auto"
              onLoadedMetadata={(event) => {
                const { videoWidth, videoHeight } = event.currentTarget
                if (videoWidth > 0 && videoHeight > 0) {
                  setScreenAspect(videoWidth / videoHeight)
                }
              }}
              onLoadedData={() => setVideoReady(true)}
              onPlay={playProjectTracks}
              onPause={pauseProjectTracks}
              onEnded={pauseProjectTracks}
              onSeeking={syncProjectTracks}
              onTimeUpdate={syncProjectTracks}
              onRateChange={() => {
                if (cameraRef.current && videoRef.current) {
                  cameraRef.current.playbackRate = videoRef.current.playbackRate
                }
                if (audioRef.current && videoRef.current) {
                  audioRef.current.playbackRate = videoRef.current.playbackRate
                }
              }}
              onVolumeChange={() => {
                if (audioRef.current && videoRef.current) {
                  audioRef.current.volume = videoRef.current.volume
                  audioRef.current.muted = videoRef.current.muted
                }
              }}
              className={`h-full w-full object-fill transition-opacity ${videoReady ? "opacity-100" : "opacity-0"}`}
            >
              <track kind="captions" />
            </video>
            {showCamera && (
              <div
                className={`pointer-events-none absolute z-10 overflow-hidden border border-white/20 bg-black ${
                  cameraLayout.shape === "circle"
                    ? "rounded-full"
                    : cameraLayout.shape === "square"
                      ? "rounded-md"
                      : cameraLayout.shape === "triangle"
                        ? "border-0"
                        : "rounded-sm"
                }`}
                style={{
                  width: `${cameraLayout.width * 100}%`,
                  aspectRatio: String(cameraAspect),
                  left: `${cameraLayout.left * 100}%`,
                  bottom: `${cameraLayout.bottom * 100}%`,
                  clipPath: cameraLayout.shape === "triangle"
                    ? "polygon(50% 0%, 100% 100%, 0% 100%)"
                    : undefined,
                }}
                aria-hidden="true"
              >
                <video
                  ref={cameraRef}
                  src={video.camera_url ?? undefined}
                  muted
                  playsInline
                  preload="auto"
                  className="h-full w-full -scale-x-100 object-cover"
                />
              </div>
            )}
            {video.kind === "project" && video.audio_url && (
              <audio ref={audioRef} src={video.audio_url} preload="auto" className="hidden" />
            )}
          </div>
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
