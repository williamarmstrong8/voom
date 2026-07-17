"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Check,
  Circle,
  Download,
  Film,
  Layers,
  Loader2,
  Pause,
  Play,
  RectangleHorizontal,
  RotateCcw,
  Save,
  Square,
  Video,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { CameraOverlay } from "@/components/studio/camera-overlay"
import { Timeline } from "@/components/studio/timeline"
import { useFfmpeg } from "@/hooks/use-ffmpeg"
import { compositeToWebm, type ExportQuality } from "@/lib/export"
import { extractFrames } from "@/lib/frames"
import { captureThumbnail, saveVideoToLibrary, updateVideoInLibrary } from "@/lib/upload-video"
import {
  DEFAULT_CAMERA_LAYOUT,
  type CameraLayout,
  type RecordingResult,
  type SavedVideo,
  type TrimRange,
} from "@/lib/studio-types"
import { cn } from "@/lib/utils"

type ExportPhase = "idle" | "compositing" | "transcoding" | "done" | "error"
type ExportFormat = "mp4" | "webm"

interface EditorScreenProps {
  recording: RecordingResult
  /** Camera shape/size chosen during setup; used as the starting layout. */
  initialLayout?: CameraLayout
  onReset: () => void
  /** Existing library video when the editor is updating rather than creating. */
  sourceVideo?: SavedVideo | null
  /** Called after a recording is successfully saved to the library. */
  onSaved: (video?: SavedVideo) => void
}

type SavePhase = "idle" | "processing" | "uploading" | "done" | "error"

function downloadBlobUrl(url: string, filename: string) {
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function EditorScreen({
  recording,
  initialLayout = DEFAULT_CAMERA_LAYOUT,
  sourceVideo = null,
  onReset,
  onSaved,
}: EditorScreenProps) {
  const hasCamera = !!recording.camera
  const screenRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<HTMLVideoElement>(null)
  const rafRef = useRef(0)

  const [title, setTitle] = useState(sourceVideo?.title ?? "")
  const [savePhase, setSavePhase] = useState<SavePhase>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)

  const [duration, setDuration] = useState(recording.duration || 0)
  const [trim, setTrim] = useState<TrimRange>({ start: 0, end: recording.duration || 0 })
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [aspect, setAspect] = useState(16 / 9)
  const [frames, setFrames] = useState<string[]>([])
  const framesForUrl = useRef<string | null>(null)

  const [layout, setLayout] = useState<CameraLayout>(initialLayout)
  const [cameraVisible, setCameraVisible] = useState(hasCamera)

  const [phase, setPhase] = useState<ExportPhase>("idle")
  const [compositeProgress, setCompositeProgress] = useState(0)
  const [exportedUrl, setExportedUrl] = useState<string | null>(null)
  const [exportedBlob, setExportedBlob] = useState<Blob | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportFormat, setExportFormat] = useState<ExportFormat>("mp4")
  const [exportQuality, setExportQuality] = useState<ExportQuality>("1080p")
  const renderKeyRef = useRef<string | null>(null)

  const ffmpeg = useFfmpeg()

  // Sync duration/trim once the screen video metadata is known.
  const onScreenMeta = useCallback(() => {
    const v = screenRef.current
    if (!v) return
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : recording.duration
    setDuration(dur)
    setTrim({ start: 0, end: dur })
    if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight)
  }, [recording.duration])

  // Build a filmstrip of the actual recording once we know its real duration.
  useEffect(() => {
    const url = recording.screen.url
    if (!url || duration <= 0 || framesForUrl.current === url) return
    framesForUrl.current = url
    let cancelled = false
    void extractFrames(url, duration, 12).then((f) => {
      if (!cancelled) setFrames(f)
    })
    return () => {
      cancelled = true
    }
  }, [recording.screen.url, duration])

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
  }, [])

  const pause = useCallback(() => {
    screenRef.current?.pause()
    cameraRef.current?.pause()
    setPlaying(false)
    stopLoop()
  }, [stopLoop])

  const tick = useCallback(() => {
    const v = screenRef.current
    if (!v) return
    setCurrentTime(v.currentTime)
    if (v.currentTime >= trim.end) {
      pause()
      v.currentTime = trim.end
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [trim.end, pause])

  const play = useCallback(() => {
    const v = screenRef.current
    if (!v) return
    if (v.currentTime >= trim.end - 0.05) {
      v.currentTime = trim.start
      if (cameraRef.current) cameraRef.current.currentTime = trim.start
    }
    void v.play()
    void cameraRef.current?.play()
    setPlaying(true)
    rafRef.current = requestAnimationFrame(tick)
  }, [trim.start, trim.end, tick])

  const seek = useCallback((time: number) => {
    if (screenRef.current) screenRef.current.currentTime = time
    if (cameraRef.current) cameraRef.current.currentTime = time
    setCurrentTime(time)
  }, [])

  // Keep the playhead within the trim window when the in-point moves past it.
  useEffect(() => {
    if (currentTime < trim.start) seek(trim.start)
    if (currentTime > trim.end) seek(trim.end)
  }, [trim.start, trim.end, currentTime, seek])

  useEffect(() => () => stopLoop(), [stopLoop])

  const getRenderedOutput = useCallback(async (): Promise<Blob> => {
    const key = JSON.stringify({ cameraVisible, layout, trim, exportFormat, exportQuality })
    if (renderKeyRef.current === key && exportedBlob) return exportedBlob

    setCompositeProgress(0)
    setPhase("compositing")
    const webm = await compositeToWebm({
      screenUrl: recording.screen.url,
      cameraUrl: cameraVisible && recording.camera ? recording.camera.url : null,
      layout,
      trim,
      quality: exportQuality,
      onProgress: setCompositeProgress,
    })
    const output =
      exportFormat === "mp4"
        ? (setPhase("transcoding"), await ffmpeg.transcodeToMp4(webm))
        : webm
    setExportedBlob(output)
    renderKeyRef.current = key
    return output
  }, [recording, cameraVisible, layout, trim, exportFormat, exportQuality, exportedBlob, ffmpeg])

  const runExport = useCallback(async () => {
    setExportError(null)
    pause()
    try {
      const output = await getRenderedOutput()
      if (exportedUrl) URL.revokeObjectURL(exportedUrl)
      const url = URL.createObjectURL(output)
      setExportedUrl(url)
      setPhase("done")
    } catch (err) {
      console.log("[v0] export failed:", err)
      setExportError(
        "Export failed while processing the video. This works best in Chrome or Edge on desktop.",
      )
      setPhase("error")
    }
  }, [getRenderedOutput, exportedUrl, pause])

  const saveToLibrary = useCallback(async () => {
    setSaveError(null)
    pause()
    try {
      setSavePhase("processing")
      const output = await getRenderedOutput()

      // Grab a poster frame from the start of the trim window.
      let thumbnail: Blob | null = null
      if (screenRef.current) {
        thumbnail = await captureThumbnail(screenRef.current, trim.start)
      }

      setSavePhase("uploading")
    const saveInput = {
      video: output,
      thumbnail,
      title: title.trim() || "Untitled recording",
      durationSeconds: Math.max(0, trim.end - trim.start),
      filename: `recording.${exportFormat}`,
    }
    const saved = sourceVideo
      ? await updateVideoInLibrary(sourceVideo.id, saveInput)
      : await saveVideoToLibrary(saveInput)
    setSavePhase("done")
    // Give a beat for the success state, then return to the saved video.
    setTimeout(() => onSaved(saved), 700)
    } catch (err) {
      console.log("[v0] save failed:", err)
      setSaveError(
        "Couldn't save the video. Processing works best in Chrome or Edge on desktop.",
      )
      setSavePhase("error")
    }
  }, [getRenderedOutput, trim, pause, title, exportFormat, sourceVideo, onSaved])

  useEffect(() => {
    renderKeyRef.current = null
    setExportedBlob(null)
    setExportedUrl((url) => {
      if (url) URL.revokeObjectURL(url)
      return null
    })
    setPhase("idle")
  }, [layout, trim, cameraVisible, exportFormat, exportQuality])

  const busy = phase === "compositing" || phase === "transcoding"
  const saving = savePhase === "processing" || savePhase === "uploading"
  const trimmedDuration = Math.max(0, trim.end - trim.start)

  return (
    <main className="flex min-h-[calc(100svh-3rem)] w-full flex-col gap-5 px-5 py-8 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-xl border border-border bg-card">
            <Film className="size-4 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight tracking-tight">Edit your demo</h1>
            <p className="text-xs text-muted-foreground">
              Trim the ends, place your camera, then export to MP4.
            </p>
          </div>
        </div>
        <Button variant="ghost" onClick={onReset} className="gap-2">
          <RotateCcw className="size-4" />
          Record again
        </Button>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        {/* Preview + timeline */}
        <div className="flex flex-col gap-4">
          <div
            className="relative w-full overflow-hidden bg-black"
            style={{ aspectRatio: String(aspect) }}
          >
            <video
              ref={screenRef}
              src={recording.screen.url}
              onLoadedMetadata={onScreenMeta}
              onClick={() => (playing ? pause() : play())}
              playsInline
              className="h-full w-full object-fill"
            />

            {hasCamera && cameraVisible && (
              <CameraOverlay layout={layout} onLayoutChange={setLayout}>
                <video
                  ref={cameraRef}
                  src={recording.camera!.url}
                  muted
                  playsInline
                  className="h-full w-full -scale-x-100 object-cover"
                />
              </CameraOverlay>
            )}
          </div>

          {/* Transport */}
          <div className="flex items-center gap-3">
            <Button
              size="icon"
              variant="secondary"
              onClick={() => (playing ? pause() : play())}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
            <div className="flex-1">
              <Timeline
                duration={duration}
                trim={trim}
                currentTime={currentTime}
                frames={frames}
                onTrimChange={setTrim}
                onSeek={seek}
              />
            </div>
          </div>
        </div>

        {/* Controls */}
        <aside className="flex flex-col gap-4">
          {hasCamera && (
            <div className="rounded-md border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Video className="size-4 text-muted-foreground" />
                  Camera
                </span>
                <button
                  type="button"
                  onClick={() => setCameraVisible((v) => !v)}
                  className={cn(
                    "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                    cameraVisible
                      ? "bg-primary/15 text-primary"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  {cameraVisible ? "Shown" : "Hidden"}
                </button>
              </div>

              {cameraVisible && (
                <>
                  <p className="mb-2 text-xs text-muted-foreground">Shape</p>
                  <div className="mb-4 grid grid-cols-3 gap-2">
                    <ShapeButton
                      active={layout.shape === "rounded"}
                      onClick={() => setLayout((l) => ({ ...l, shape: "rounded" }))}
                      icon={<RectangleHorizontal className="size-4" />}
                      label="Wide"
                    />
                    <ShapeButton
                      active={layout.shape === "square"}
                      onClick={() => setLayout((l) => ({ ...l, shape: "square" }))}
                      icon={<Square className="size-4" />}
                      label="Square"
                    />
                    <ShapeButton
                      active={layout.shape === "circle"}
                      onClick={() => setLayout((l) => ({ ...l, shape: "circle" }))}
                      icon={<Circle className="size-4" />}
                      label="Circle"
                    />
                  </div>

                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Size</span>
                    <span className="tabular-nums text-muted-foreground">
                      {Math.round(layout.width * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={12}
                    max={40}
                    step={1}
                    value={Math.round(layout.width * 100)}
                    onChange={(e) =>
                      setLayout((l) => ({ ...l, width: Number(e.target.value) / 100 }))
                    }
                    aria-label="Camera size"
                    className="w-full accent-primary"
                  />
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    Drag the camera in the preview. It snaps when the gap to the left and
                    bottom edges is equal.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Output: export + library save */}
          <div className="rounded-md border border-border bg-card p-4">
            <p className="mb-1 flex items-center gap-2 text-sm font-medium">
              <Download className="size-4 text-muted-foreground" />
              Output
            </p>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              Export a file or save the same rendered version to your library.
            </p>

            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Video title"
              aria-label="Video title"
              disabled={saving || savePhase === "done"}
              className="mb-3 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 disabled:opacity-60"
            />

            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">Format</p>
                <div className="grid grid-cols-2 gap-1 rounded-sm bg-secondary p-1">
                  {(["mp4", "webm"] as const).map((format) => (
                    <OptionButton
                      key={format}
                      active={exportFormat === format}
                      onClick={() => setExportFormat(format)}
                      label={format.toUpperCase()}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">Quality</p>
                <div className="grid grid-cols-2 gap-1 rounded-sm bg-secondary p-1">
                  {(["720p", "1080p"] as const).map((quality) => (
                    <OptionButton
                      key={quality}
                      active={exportQuality === quality}
                      onClick={() => setExportQuality(quality)}
                      label={quality}
                    />
                  ))}
                </div>
              </div>
            </div>

            <p className="mb-3 text-xs text-muted-foreground">
              {trimmedDuration > 0 ? `${trimmedDuration.toFixed(1)}s` : "0s"} · {exportFormat.toUpperCase()} · {exportQuality}
            </p>

            {(busy || saving) && (
              <div className="mb-3">
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{
                      width: `${Math.round(
                        (phase === "compositing"
                          ? compositeProgress * (exportFormat === "mp4" ? 0.6 : 1)
                          : exportFormat === "mp4"
                            ? 0.6 + ffmpeg.progress * 0.4
                            : compositeProgress) * 100,
                      )}%`,
                    }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {savePhase === "uploading"
                    ? "Uploading to library…"
                    : phase === "transcoding"
                      ? ffmpeg.loading
                        ? "Loading MP4 encoder…"
                        : "Encoding MP4…"
                      : "Compositing camera + screen…"}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {phase === "done" && exportedUrl ? (
                <Button
                  onClick={() => downloadBlobUrl(exportedUrl, `demo.${exportFormat}`)}
                  className="w-full gap-2"
                >
                  <Download className="size-4" />
                  Download {exportFormat.toUpperCase()}
                </Button>
              ) : (
                <Button onClick={runExport} disabled={busy || saving} className="w-full gap-2">
                  <Film className="size-4" />
                  {busy ? "Exporting…" : `Export ${exportFormat.toUpperCase()}`}
                </Button>
              )}

              {savePhase === "done" ? (
                <Button disabled variant="secondary" className="w-full gap-2">
                  <Check className="size-4" />
                  Saved
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={saveToLibrary}
                  disabled={busy || saving || trimmedDuration <= 0}
                  className="w-full gap-2"
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {saving
                    ? savePhase === "uploading"
                      ? "Uploading…"
                      : "Processing…"
                    : "Save to library"}
                </Button>
              )}
            </div>

            {(exportError || saveError) && (
              <p className="mt-2 text-xs text-destructive-foreground">
                {exportError || saveError}
              </p>
            )}
          </div>

          {/* Separate layers */}
          <div className="rounded-md border border-border bg-card p-4">
            <p className="mb-1 flex items-center gap-2 text-sm font-medium">
              <Layers className="size-4 text-muted-foreground" />
              Separate layers
            </p>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              Download the raw tracks to recompose in another editor.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="justify-start gap-2"
                onClick={() => downloadBlobUrl(recording.screen.url, "screen.webm")}
              >
                <Download className="size-3.5" />
                Screen track
              </Button>
              {recording.camera && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="justify-start gap-2"
                  onClick={() => downloadBlobUrl(recording.camera!.url, "camera.webm")}
                >
                  <Download className="size-3.5" />
                  Camera track
                </Button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}

function OptionButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
        active ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  )
}

function ShapeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-sm border px-2 py-2.5 text-xs font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/15 text-foreground"
          : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  )
}
