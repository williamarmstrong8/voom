"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Captions,
  Check,
  Circle,
  Download,
  Expand,
  Film,
  Layers,
  Loader2,
  Pause,
  Play,
  RectangleHorizontal,
  Redo2,
  Save,
  RotateCcw,
  RotateCw,
  Scissors,
  Square,
  Trash2,
  Undo2,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { CameraOverlay } from "@/components/studio/camera-overlay"
import { Timeline } from "@/components/studio/timeline"
import { useFfmpeg } from "@/hooks/use-ffmpeg"
import {
  DEFAULT_BRAND_KIT,
  type BrandKit,
  type CaptionCue,
  type EditorSegment,
  type TitleCard,
} from "@/lib/editor-types"
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

function formatTransportTime(time: number) {
  const safe = Math.max(0, time)
  const minutes = Math.floor(safe / 60)
  const seconds = Math.floor(safe % 60)
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

function downloadBlobUrl(url: string, filename: string) {
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function extractCaptionAudio(videoBlob: Blob): Promise<Blob> {
  const audioContext = new AudioContext()
  try {
    const decoded = await audioContext.decodeAudioData(await videoBlob.arrayBuffer())
    if (decoded.duration <= 0 || decoded.numberOfChannels === 0) {
      throw new Error("This recording does not contain audio to caption.")
    }

    const sampleRate = 16_000
    const frameCount = Math.ceil(decoded.duration * sampleRate)
    const offline = new OfflineAudioContext(1, frameCount, sampleRate)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const mono = await offline.startRendering()
    return encodePcmWav(mono.getChannelData(0), sampleRate)
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not contain audio")) throw error
    throw new Error("Voom could not read this recording's audio. Try recording with microphone or tab audio enabled.")
  } finally {
    void audioContext.close()
  }
}

function encodePcmWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
  }

  writeText(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeText(8, "WAVE")
  writeText(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, "data")
  view.setUint32(40, samples.length * 2, true)

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return new Blob([buffer], { type: "audio/wav" })
}

export function EditorScreen({
  recording,
  initialLayout = DEFAULT_CAMERA_LAYOUT,
  sourceVideo = null,
  onSaved,
}: EditorScreenProps) {
  const hasCamera = !!recording.camera
  const screenRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)

  const [title, setTitle] = useState(sourceVideo?.title ?? "")
  const [savePhase, setSavePhase] = useState<SavePhase>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)

  const [duration, setDuration] = useState(recording.duration || 0)
  const [trim, setTrim] = useState<TrimRange>({ start: 0, end: recording.duration || 0 })
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [aspect, setAspect] = useState(16 / 9)
  const [frames, setFrames] = useState<string[]>([])
  const framesForUrl = useRef<string | null>(null)
  const [segments, setSegments] = useState<EditorSegment[]>([])
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null)
  const [history, setHistory] = useState<EditorSegment[][]>([])
  const [future, setFuture] = useState<EditorSegment[][]>([])
  const [timelineZoom, setTimelineZoom] = useState(1)
  const [captions, setCaptions] = useState<CaptionCue[]>([])
  const [captioning, setCaptioning] = useState(false)
  const [captionError, setCaptionError] = useState<string | null>(null)
  const [titleCards, setTitleCards] = useState<TitleCard[]>([])
  const [brandKit, setBrandKit] = useState<BrandKit>(DEFAULT_BRAND_KIT)
  const [activeTool, setActiveTool] = useState<"captions" | "brand" | "camera" | "export">("captions")

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
    setSegments((current) => current.length ? current : [{ id: crypto.randomUUID(), sourceStart: 0, sourceEnd: dur }])
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

  const editedDuration = useMemo(() => segments.reduce((total, segment) => total + segment.sourceEnd - segment.sourceStart, 0), [segments])

  const sourceToProjectTime = useCallback((sourceTime: number) => {
    let elapsed = 0
    for (const segment of segments) {
      if (sourceTime >= segment.sourceStart && sourceTime <= segment.sourceEnd) return elapsed + sourceTime - segment.sourceStart
      if (sourceTime < segment.sourceStart) return elapsed
      elapsed += segment.sourceEnd - segment.sourceStart
    }
    return elapsed
  }, [segments])

  const projectToSourceTime = useCallback((projectTime: number) => {
    let elapsed = 0
    const bounded = Math.max(0, Math.min(editedDuration, projectTime))
    for (const segment of segments) {
      const length = segment.sourceEnd - segment.sourceStart
      if (bounded <= elapsed + length) return segment.sourceStart + bounded - elapsed
      elapsed += length
    }
    return segments.at(-1)?.sourceEnd ?? 0
  }, [editedDuration, segments])

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
    const segmentIndex = segments.findIndex((segment) => v.currentTime >= segment.sourceStart - 0.03 && v.currentTime <= segment.sourceEnd)
    if (segments.length && segmentIndex >= 0 && v.currentTime >= segments[segmentIndex].sourceEnd - 0.03) {
      const next = segments[segmentIndex + 1]
      if (next) {
        v.currentTime = next.sourceStart
        if (cameraRef.current) cameraRef.current.currentTime = next.sourceStart
      }
    }
    if (v.currentTime >= trim.end || (segments.length > 0 && v.currentTime >= segments.at(-1)!.sourceEnd)) {
      pause()
      v.currentTime = segments.at(-1)?.sourceEnd ?? trim.end
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [segments, trim.end, pause])

  const play = useCallback(() => {
    const v = screenRef.current
    if (!v || !segments.length) return
    const retained = segments.some((segment) => v.currentTime >= segment.sourceStart && v.currentTime < segment.sourceEnd - 0.05)
    if (!retained) {
      v.currentTime = segments[0].sourceStart
      if (cameraRef.current) cameraRef.current.currentTime = segments[0].sourceStart
    }
    v.playbackRate = playbackRate
    if (cameraRef.current) cameraRef.current.playbackRate = playbackRate
    void v.play()
    void cameraRef.current?.play()
    setPlaying(true)
    rafRef.current = requestAnimationFrame(tick)
  }, [playbackRate, segments, tick])

  const seek = useCallback((time: number) => {
    if (screenRef.current) screenRef.current.currentTime = time
    if (cameraRef.current) cameraRef.current.currentTime = time
    setCurrentTime(time)
  }, [])

  const skipBy = useCallback((seconds: number) => {
    seek(projectToSourceTime(sourceToProjectTime(currentTime) + seconds))
  }, [currentTime, projectToSourceTime, seek, sourceToProjectTime])

  const commitSegments = useCallback((next: EditorSegment[], selectedId: string | null = null) => {
    setHistory((items) => [...items.slice(-49), segments])
    setFuture([])
    setSegments(next)
    setSelectedSegmentId(selectedId)
  }, [segments])

  const splitAtPlayhead = useCallback(() => {
    const target = segments.find((segment) => currentTime > segment.sourceStart + 0.1 && currentTime < segment.sourceEnd - 0.1)
    if (!target) return
    commitSegments(segments.flatMap((segment) => segment.id === target.id ? [
      { ...segment, id: crypto.randomUUID(), sourceEnd: currentTime },
      { ...segment, id: crypto.randomUUID(), sourceStart: currentTime },
    ] : [segment]), null)
  }, [commitSegments, currentTime, segments])

  const deleteSelected = useCallback(() => {
    if (!selectedSegmentId || segments.length <= 1) return
    const index = segments.findIndex((segment) => segment.id === selectedSegmentId)
    const next = segments.filter((segment) => segment.id !== selectedSegmentId)
    const neighbor = next[Math.min(index, next.length - 1)]
    commitSegments(next, neighbor?.id ?? null)
    if (neighbor) seek(neighbor.sourceStart)
  }, [commitSegments, seek, segments, selectedSegmentId])

  const commitSegmentTrim = useCallback((previous: EditorSegment[]) => {
    setHistory((items) => [...items.slice(-49), previous])
    setFuture([])
  }, [])

  const undo = useCallback(() => {
    const previous = history.at(-1)
    if (!previous) return
    setFuture((items) => [segments, ...items])
    setSegments(previous)
    setHistory((items) => items.slice(0, -1))
    setSelectedSegmentId(null)
  }, [history, segments])

  const redo = useCallback(() => {
    const next = future[0]
    if (!next) return
    setHistory((items) => [...items, segments])
    setSegments(next)
    setFuture((items) => items.slice(1))
    setSelectedSegmentId(null)
  }, [future, segments])

  const generateCaptions = useCallback(async () => {
    setCaptioning(true)
    setCaptionError(null)
    try {
      const audio = await extractCaptionAudio(recording.screen.blob)
      const form = new FormData()
      form.append("media", audio, "recording.wav")
      const response = await fetch("/api/captions", { method: "POST", body: form })
      const data = await response.json() as { captions?: CaptionCue[]; error?: string }
      if (!response.ok) throw new Error(data.error || "Caption generation failed")
      setCaptions(data.captions ?? [])
    } catch (error) {
      const message = error instanceof Error ? error.message : "Caption generation failed"
      console.error("[v0] caption generation failed:", message)
      setCaptionError(message)
    } finally {
      setCaptioning(false)
    }
  }, [recording.screen.blob])

  const activeCaption = useMemo(
    () => captions.find((caption) => currentTime >= caption.start && currentTime <= caption.end),
    [captions, currentTime],
  )
  const activeTitleCard = useMemo(
    () => titleCards.find((card) => currentTime >= card.start && currentTime <= card.end),
    [titleCards, currentTime],
  )

  // Keep the playhead within the trim window when the in-point moves past it.
  useEffect(() => {
    if (currentTime < trim.start) seek(trim.start)
    if (currentTime > trim.end) seek(trim.end)
  }, [trim.start, trim.end, currentTime, seek])

  useEffect(() => () => stopLoop(), [stopLoop])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return
      if (event.code === "Space") {
        event.preventDefault()
        playing ? pause() : play()
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault()
        splitAtPlayhead()
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault()
        deleteSelected()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        event.shiftKey ? redo() : undo()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [deleteSelected, pause, play, playing, redo, splitAtPlayhead, undo])

  const trimmedDuration = segments.length
    ? segments.reduce((total, segment) => total + segment.sourceEnd - segment.sourceStart, 0)
    : Math.max(0, trim.end - trim.start)

  const getRenderedOutput = useCallback(async (): Promise<Blob> => {
    const key = JSON.stringify({ cameraVisible, layout, trim, segments, captions, titleCards, brandKit, exportFormat, exportQuality })
    if (renderKeyRef.current === key && exportedBlob) return exportedBlob

    setCompositeProgress(0)
    setPhase("compositing")
    const webm = await compositeToWebm({
      screenUrl: recording.screen.url,
      cameraUrl: cameraVisible && recording.camera ? recording.camera.url : null,
      layout,
      trim,
      quality: exportQuality,
      segments,
      captions,
      titleCards,
      brandKit,
      onProgress: setCompositeProgress,
    })
    const output =
      exportFormat === "mp4"
        ? (setPhase("transcoding"), await ffmpeg.transcodeToMp4(webm))
        : webm
    setExportedBlob(output)
    renderKeyRef.current = key
    return output
  }, [recording, cameraVisible, layout, trim, segments, captions, titleCards, brandKit, exportFormat, exportQuality, exportedBlob, ffmpeg])

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
      durationSeconds: trimmedDuration,
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
  }, [getRenderedOutput, trim.start, trim.end, segments, pause, title, exportFormat, sourceVideo, onSaved])

  useEffect(() => {
    renderKeyRef.current = null
    setExportedBlob(null)
    setExportedUrl((url) => {
      if (url) URL.revokeObjectURL(url)
      return null
    })
    setPhase("idle")
  }, [layout, trim, segments, captions, titleCards, brandKit, cameraVisible, exportFormat, exportQuality])

  const busy = phase === "compositing" || phase === "transcoding"
  const saving = savePhase === "processing" || savePhase === "uploading"
  return (
    <main className="flex min-h-[calc(100svh-3rem)] w-full flex-col px-5 py-5 lg:px-8">
      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        {/* Preview + timeline */}
        <div className="flex flex-col gap-4">
          <div
            ref={previewRef}
            className="group relative w-full overflow-hidden bg-black"
            style={{ aspectRatio: String(aspect) }}
          >
            <video
              ref={screenRef}
              src={recording.screen.url}
              onLoadedMetadata={onScreenMeta}
              onClick={() => (playing ? pause() : play())}
              onVolumeChange={(event) => setVolume(event.currentTarget.muted ? 0 : event.currentTarget.volume)}
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
            {activeTitleCard && (
              <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/70 px-12 text-center text-white backdrop-blur-sm">
                <p className="text-balance text-3xl font-semibold tracking-tight">{activeTitleCard.title}</p>
                <p className="mt-2 text-pretty text-sm text-white/70">{activeTitleCard.subtitle}</p>
              </div>
            )}
            {activeCaption && (
              <div className="pointer-events-none absolute inset-x-8 bottom-16 z-30 flex justify-center">
                <p className="max-w-3xl rounded-md bg-black/80 px-4 py-2 text-center text-lg font-semibold text-white shadow-lg">
                  {activeCaption.text}
                </p>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 z-40 flex items-center gap-1 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-3 pt-8 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <button type="button" onClick={() => (playing ? pause() : play())} className="rounded-sm p-2 hover:bg-white/15" aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
              <button type="button" onClick={() => skipBy(-10)} className="rounded-sm p-2 hover:bg-white/15" aria-label="Back 10 seconds"><RotateCcw className="size-4" /></button>
              <button type="button" onClick={() => skipBy(10)} className="rounded-sm p-2 hover:bg-white/15" aria-label="Forward 10 seconds"><RotateCw className="size-4" /></button>
              <button type="button" onClick={() => { const video = screenRef.current; if (!video) return; video.muted = !video.muted; setVolume(video.muted ? 0 : video.volume) }} className="rounded-sm p-2 hover:bg-white/15" aria-label={volume === 0 ? "Unmute" : "Mute"}>{volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</button>
              <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); if (screenRef.current) { screenRef.current.volume = next; screenRef.current.muted = next === 0 } }} aria-label="Volume" className="w-20 accent-white" />
              <span className="ml-2 text-xs tabular-nums text-white/80">{formatTransportTime(sourceToProjectTime(currentTime))} / {formatTransportTime(editedDuration)}</span>
              <div className="flex-1" />
              <select value={playbackRate} onChange={(event) => { const next = Number(event.target.value); setPlaybackRate(next); if (screenRef.current) screenRef.current.playbackRate = next; if (cameraRef.current) cameraRef.current.playbackRate = next }} aria-label="Playback speed" className="rounded-sm bg-white/10 px-2 py-1.5 text-xs text-white outline-none"><option className="text-black" value="0.5">0.5×</option><option className="text-black" value="1">1×</option><option className="text-black" value="1.5">1.5×</option><option className="text-black" value="2">2×</option></select>
              <button type="button" onClick={() => void previewRef.current?.requestFullscreen()} className="rounded-sm p-2 hover:bg-white/15" aria-label="Fullscreen"><Expand className="size-4" /></button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-card p-1.5">
            <Button size="sm" variant="ghost" onClick={splitAtPlayhead} className="gap-2"><Scissors className="size-3.5" />Split</Button>
            <Button size="sm" variant="ghost" onClick={deleteSelected} disabled={!selectedSegmentId || segments.length <= 1} className="gap-2"><Trash2 className="size-3.5" />Delete</Button>
            <div className="mx-1 h-5 w-px bg-border" />
            <Button size="icon" variant="ghost" onClick={undo} disabled={!history.length} aria-label="Undo"><Undo2 className="size-4" /></Button>
            <Button size="icon" variant="ghost" onClick={redo} disabled={!future.length} aria-label="Redo"><Redo2 className="size-4" /></Button>
            <span className="ml-auto text-xs text-muted-foreground">Select a clip to trim or delete it</span>
          </div>

          <Timeline
            sourceDuration={duration}
            currentTime={currentTime}
            frames={frames}
            segments={segments}
            captions={captions}
            selectedSegmentId={selectedSegmentId}
            zoom={timelineZoom}
            onZoomChange={setTimelineZoom}
            onSelectSegment={setSelectedSegmentId}
            onSegmentsChange={setSegments}
            onSegmentsCommit={commitSegmentTrim}
            onSeek={seek}
          />
        </div>

        {/* Controls */}
        <aside className="flex flex-col gap-4">
          <div className={cn("grid gap-1 rounded-md border border-border bg-card p-1", hasCamera ? "grid-cols-4" : "grid-cols-3")}>
            {([
              ["captions", Captions, "CC"],
              ["brand", Film, "Brand"],
              ...(hasCamera ? [["camera", Video, "Camera"]] as const : []),
              ["export", Download, "Export"],
            ] as const).map(([tool, Icon, label]) => (
              <button key={tool} type="button" onClick={() => setActiveTool(tool)} className={cn("flex flex-col items-center gap-1 rounded-sm px-1 py-2 text-[11px] font-medium transition-colors", activeTool === tool ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>

          {activeTool === "captions" && (
            <div className="rounded-md border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Captions</p>
                <Button size="sm" variant="secondary" onClick={() => void generateCaptions()} disabled={captioning}>
                  {captioning ? <Loader2 className="size-3.5 animate-spin" /> : captions.length ? "Regenerate" : "Auto caption"}
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Generate timed captions, then correct the transcript below.</p>
              {captionError && <p className="mt-2 text-xs text-destructive-foreground">{captionError}</p>}
              <div className="mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto">
                {captions.map((caption) => (
                  <label key={caption.id} className="rounded-sm border border-border bg-background p-2">
                    <span className="mb-1 block text-[10px] tabular-nums text-muted-foreground">{caption.start.toFixed(1)}s – {caption.end.toFixed(1)}s</span>
                    <textarea value={caption.text} onChange={(event) => setCaptions((items) => items.map((item) => item.id === caption.id ? { ...item, text: event.target.value } : item))} rows={2} className="w-full resize-none bg-transparent text-xs outline-none" />
                  </label>
                ))}
              </div>
            </div>
          )}

          {activeTool === "brand" && (
            <div className="rounded-md border border-border bg-card p-4">
              <p className="text-sm font-medium">Brand kit</p>
              <p className="mt-1 text-xs text-muted-foreground">Set a consistent look for captions and exported videos in this project.</p>
              <label className="mt-3 block text-xs text-muted-foreground">Kit name<input value={brandKit.name} onChange={(event) => setBrandKit((kit) => ({ ...kit, name: event.target.value }))} className="mt-1 w-full rounded-sm border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none" /></label>
              <label className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">Accent color<input type="color" value={brandKit.primaryColor} onChange={(event) => setBrandKit((kit) => ({ ...kit, primaryColor: event.target.value }))} className="size-8 rounded-sm border border-border bg-transparent" /></label>
              <label className="mt-3 block text-xs text-muted-foreground">Typeface<select value={brandKit.fontFamily} onChange={(event) => setBrandKit((kit) => ({ ...kit, fontFamily: event.target.value as BrandKit["fontFamily"] }))} className="mt-1 w-full rounded-sm border border-border bg-background px-2 py-1.5 text-sm text-foreground"><option value="geist">Geist Sans</option><option value="serif">Editorial Serif</option><option value="mono">Geist Mono</option></select></label>
            </div>
          )}

          {activeTool === "camera" && hasCamera && (
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

          {activeTool === "export" && (
            <>
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
            </>
          )}
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
