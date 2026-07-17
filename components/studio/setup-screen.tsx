"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CameraOff,
  Check,
  ChevronDown,
  Circle,
  Info,
  Mic,
  MicOff,
  MonitorPlay,
  RectangleHorizontal,
  Square,
  Triangle,
  Type,
  Video,
  VideoOff,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useMediaDevices, type DeviceOption } from "@/hooks/use-media-devices"
import type { CameraOptions } from "@/hooks/use-recorder"
import { parseScript } from "@/lib/prompter"
import type { CameraLayout } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

const SAMPLE = `Hi everyone, thanks for joining today. I'm excited to walk you through what we've been building.
Over the past few weeks our team focused on one question: how do we make demos feel effortless?
The answer is this little teleprompter that lives right under your camera.
You paste your notes, hit start, and it follows your voice as you speak.
No clicking, no scrolling, no losing your place in the middle of a sentence.
Let me show you exactly how it works with a quick live walkthrough.`

interface SetupScreenProps {
  screenStream: MediaStream | null
  cameraStream: MediaStream | null
  screenBusy: boolean
  onPickScreen: () => void
  acquireCamera: (opts: CameraOptions) => Promise<boolean>
  cameraEnabled: boolean
  onCameraEnabled: (v: boolean) => void
  micEnabled: boolean
  onMicEnabled: (v: boolean) => void
  cameraId?: string
  onCameraId: (v: string) => void
  micId?: string
  onMicId: (v: string) => void
  layout: CameraLayout
  onLayout: (l: CameraLayout) => void
  prompterEnabled: boolean
  onPrompterEnabled: (v: boolean) => void
  notes: string
  onNotes: (v: string) => void
  fontSize: number
  onFontSize: (v: number) => void
  micSupported: boolean
  extensionAvailable: boolean
  extensionVersion: string | null
  onStart: () => void
  onBack?: () => void
  error: string | null
}

export function SetupScreen({
  screenStream,
  cameraStream,
  screenBusy,
  onPickScreen,
  acquireCamera,
  cameraEnabled,
  onCameraEnabled,
  micEnabled,
  onMicEnabled,
  cameraId,
  onCameraId,
  micId,
  onMicId,
  layout,
  onLayout,
  prompterEnabled,
  onPrompterEnabled,
  notes,
  onNotes,
  fontSize,
  onFontSize,
  micSupported,
  extensionAvailable,
  extensionVersion,
  onStart,
  onBack,
  error,
}: SetupScreenProps) {
  const { cameras, mics, refresh } = useMediaDevices()
  const [cameraOpen, setCameraOpen] = useState(false)
  const [micOpen, setMicOpen] = useState(false)
  const [prompterInfoOpen, setPrompterInfoOpen] = useState(false)

  useEffect(() => {
    if (!prompterInfoOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPrompterInfoOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [prompterInfoOpen])

  // Acquire (or re-acquire) the live camera/mic stream whenever the selection
  // changes, then refresh the device list so labels appear once permitted.
  useEffect(() => {
    let cancelled = false
    void acquireCamera({ camera: cameraEnabled, micEnabled, cameraId, micId }).then(() => {
      if (!cancelled) void refresh()
    })
    return () => {
      cancelled = true
    }
  }, [cameraEnabled, micEnabled, cameraId, micId, acquireCamera, refresh])

  const hasScreen = !!screenStream
  const hasCameraVideo = cameraEnabled && !!cameraStream?.getVideoTracks().length
  const wordCount = notes.trim() ? notes.trim().split(/\s+/).length : 0
  const previewScript = useMemo(() => parseScript(notes), [notes])

  return (
    <main className="flex min-h-[calc(100svh-3rem)] w-full flex-col gap-6 px-5 py-8 lg:px-8">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              Back to library
            </button>
          )}
        </div>
      </header>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          Set up your recording
        </h1>
        <p className="mt-1 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
          Choose what to share and it shows up in the preview. Pick your camera and
          microphone, set how the camera looks, then start recording.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Live preview stage */}
        <div className="flex flex-col gap-3">
          <div className="relative aspect-video w-full overflow-hidden rounded-md border border-border bg-black">
            {hasScreen ? (
              <ScreenPreview stream={screenStream} />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                <MonitorPlay className="size-9 opacity-60" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Choose a window or screen to share
                  </p>
                  <p className="text-xs">It will appear right here before you record.</p>
                </div>
                <Button onClick={onPickScreen} disabled={screenBusy} className="mt-1 gap-2">
                  <MonitorPlay className="size-4" />
                  {screenBusy ? "Opening picker…" : "Choose what to share"}
                </Button>
              </div>
            )}

            {hasScreen && hasCameraVideo && (
              <PreviewCameraBubble stream={cameraStream} layout={layout} />
            )}

            {prompterEnabled && previewScript.lines.length > 0 && (
              <TeleprompterPreview
                currentLine={previewScript.lines[0]?.text ?? ""}
                nextLine={previewScript.lines[1]?.text}
                fontSize={fontSize}
              />
            )}
          </div>

          {hasScreen && (
            <div className="flex items-center justify-between gap-2">
              <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <MonitorPlay className="size-3.5 shrink-0" />
                <span className="truncate">
                  Sharing:{" "}
                  <span className="text-foreground">
                    {screenStream?.getVideoTracks()[0]?.label || "your screen"}
                  </span>
                </span>
              </p>
              <button
                type="button"
                onClick={onPickScreen}
                className="shrink-0 text-xs font-medium text-primary hover:underline"
              >
                Change
              </button>
            </div>
          )}
        </div>

        {/* Control panel */}
        <aside className="flex flex-col gap-3">
          {/* Screen source */}
          <div className="rounded-md border border-border bg-card p-3">
            <div className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-secondary text-muted-foreground">
                <MonitorPlay className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Screen or window</p>
                <p className="truncate text-xs text-muted-foreground">
                  {hasScreen
                    ? screenStream?.getVideoTracks()[0]?.label || "Sharing your screen"
                    : "Nothing selected yet"}
                </p>
              </div>
              <Button
                size="sm"
                variant={hasScreen ? "secondary" : "default"}
                onClick={onPickScreen}
                disabled={screenBusy}
              >
                {hasScreen ? "Change" : "Choose"}
              </Button>
            </div>
          </div>

          {/* Camera source + shape/size */}
          <div className="rounded-md border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCameraOpen((open) => !open)}
                aria-expanded={cameraOpen}
                aria-controls="camera-settings"
                className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-secondary text-muted-foreground">
                  {cameraEnabled ? <Camera className="size-4" /> : <CameraOff className="size-4" />}
                </span>
                <span className="flex-1 text-sm font-medium">Camera</span>
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    cameraOpen && "rotate-180",
                  )}
                />
              </button>
              <Switch
                active={cameraEnabled}
                onClick={() => onCameraEnabled(!cameraEnabled)}
                label="Toggle camera"
              />
            </div>

            {cameraOpen && (
              <div id="camera-settings" className="mt-3 flex flex-col gap-3">
                {cameraEnabled ? (
                  <SourceSelect
                    options={cameras}
                    value={cameraId}
                    onChange={onCameraId}
                    placeholder="Default camera"
                  />
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Turn the camera on to choose a source and customize its appearance.
                  </p>
                )}

                {cameraEnabled && <>
                  <div>
                    <p className="mb-1.5 text-xs text-muted-foreground">Shape</p>
                    <div className="grid grid-cols-4 gap-2">
                    <ShapeButton
                      active={layout.shape === "rounded"}
                      onClick={() => onLayout({ ...layout, shape: "rounded" })}
                      icon={<RectangleHorizontal className="size-4" />}
                      label="Wide"
                    />
                    <ShapeButton
                      active={layout.shape === "square"}
                      onClick={() => onLayout({ ...layout, shape: "square" })}
                      icon={<Square className="size-4" />}
                      label="Square"
                    />
                    <ShapeButton
                      active={layout.shape === "circle"}
                      onClick={() => onLayout({ ...layout, shape: "circle" })}
                      icon={<Circle className="size-4" />}
                      label="Circle"
                    />
                    <ShapeButton
                      active={layout.shape === "triangle"}
                      onClick={() => onLayout({ ...layout, shape: "triangle" })}
                      icon={<Triangle className="size-4" />}
                      label="Triangle"
                    />
                  </div>
                </div>

                <div>
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
                    onChange={(e) => onLayout({ ...layout, width: Number(e.target.value) / 100 })}
                    aria-label="Camera size"
                    className="w-full accent-primary"
                  />
                </div>
                </>}
              </div>
            )}
          </div>

          {/* Microphone source */}
          <div className="rounded-md border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMicOpen((open) => !open)}
                aria-expanded={micOpen}
                aria-controls="microphone-settings"
                className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-secondary text-muted-foreground">
                  {micEnabled ? <Mic className="size-4" /> : <MicOff className="size-4" />}
                </span>
                <span className="flex-1 text-sm font-medium">Microphone</span>
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    micOpen && "rotate-180",
                  )}
                />
              </button>
              <Switch
                active={micEnabled}
                onClick={() => onMicEnabled(!micEnabled)}
                label="Toggle microphone"
              />
            </div>
            {micOpen && (
              <div id="microphone-settings" className="mt-3">
                {micEnabled ? (
                  <SourceSelect
                    options={mics}
                    value={micId}
                    onChange={onMicId}
                    placeholder="Default microphone"
                  />
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Turn the microphone on to choose an audio source.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Teleprompter */}
          <div className="rounded-md border border-border bg-card p-3">
            <div className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-secondary text-muted-foreground">
                <Type className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium">Teleprompter</p>
                  <button
                    type="button"
                    onClick={() => setPrompterInfoOpen(true)}
                    aria-label="About the teleprompter"
                    className="flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Info className="size-3.5" />
                  </button>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {prompterEnabled ? "Script follows your voice" : "Off"}
                </p>
              </div>
              <Switch
                active={prompterEnabled}
                onClick={() => onPrompterEnabled(!prompterEnabled)}
                label="Toggle teleprompter"
              />
            </div>

            {prompterEnabled && (
              <div className="mt-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {wordCount} {wordCount === 1 ? "word" : "words"}
                  </span>
                  <button
                    type="button"
                    onClick={() => onNotes(SAMPLE)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Use sample
                  </button>
                </div>
                <textarea
                  value={notes}
                  onChange={(e) => onNotes(e.target.value)}
                  placeholder="Paste the script you'll read while recording…"
                  className="h-28 w-full resize-none rounded-sm border border-input bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/40"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Type className="size-3.5 text-muted-foreground" />
                  <input
                    type="range"
                    min={20}
                    max={44}
                    step={2}
                    value={fontSize}
                    onChange={(e) => onFontSize(Number(e.target.value))}
                    aria-label="Teleprompter text size"
                    className="w-full accent-primary"
                  />
                  <span className="w-10 text-right text-xs text-muted-foreground">
                    {fontSize}px
                  </span>
                </div>
                {!micSupported && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    Voice-following needs Chrome or Edge. You can still advance the prompter
                    with the arrow keys.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-sm border border-border bg-secondary/40 p-3 text-xs leading-relaxed text-muted-foreground">
            {extensionAvailable ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-foreground" />
            ) : (
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-foreground" />
            )}
            <p>
              {extensionAvailable
                ? `Voom extension ${extensionVersion ? `v${extensionVersion} ` : ""}is ready. Camera, controls, and teleprompter will use the private custom overlay.`
                : "Voom extension not detected. Recording will use the browser Picture-in-Picture fallback; install the extension for custom private cross-tab overlays."}
            </p>
          </div>

          <Button
            size="lg"
            onClick={onStart}
            disabled={!extensionAvailable && !hasScreen}
            className="mt-1 h-11 gap-2"
          >
            <Video className="size-4" />
            {extensionAvailable
              ? "Start private tab recording"
              : hasScreen
                ? "Start recording"
                : "Choose a screen first"}
          </Button>

          {error && (
            <div className="flex items-start gap-2 rounded-sm border border-destructive/40 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>{error}</p>
            </div>
          )}
        </aside>
      </div>

      {prompterInfoOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setPrompterInfoOpen(false)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="teleprompter-info-title"
            className="w-full max-w-md rounded-md border border-border bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <Info className="size-4 text-muted-foreground" />
                <h2 id="teleprompter-info-title" className="text-sm font-semibold">
                  What is the teleprompter?
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPrompterInfoOpen(false)}
                aria-label="Close teleprompter information"
                className="rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Close
              </button>
            </div>
            <div className="flex flex-col gap-3 px-5 py-4 text-sm leading-6 text-muted-foreground">
              <p>
                The teleprompter displays your script in a small always-on-top window while
                you record, so your notes stay close to the camera without appearing in the video.
              </p>
              <p>
                In Chrome or Edge, voice following tracks the words you say and moves through
                the script automatically. You can also pause it or move backward and forward manually.
              </p>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

/** Live view of the chosen screen/window stream. */
function ScreenPreview({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream
      void ref.current.play().catch(() => {})
    }
  }, [stream])
  return <video ref={ref} muted playsInline className="h-full w-full object-contain" />
}

/** Camera overlay in the preview — shows exactly how it will sit in the video. */
function PreviewCameraBubble({
  stream,
  layout,
}: {
  stream: MediaStream | null
  layout: CameraLayout
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream
      void ref.current.play().catch(() => {})
    }
  }, [stream])

  const previewAspect = layout.shape === "rounded" ? "16 / 9" : layout.shape === "triangle" ? `2 / ${Math.sqrt(3)}` : "1 / 1"
  return (
    <div
      className="absolute overflow-hidden border-2 border-background"
      style={{
        left: `${layout.left * 100}%`,
        bottom: `${layout.bottom * 100}%`,
        width: `${layout.width * 100}%`,
        aspectRatio: previewAspect,
        borderRadius: layout.shape === "circle" ? "9999px" : layout.shape === "triangle" ? "0" : "0.75rem",
        clipPath: layout.shape === "triangle" ? "polygon(50% 0%, 100% 100%, 0% 100%)" : undefined,
      }}
    >
      <video ref={ref} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
    </div>
  )
}

function TeleprompterPreview({
  currentLine,
  nextLine,
  fontSize,
}: {
  currentLine: string
  nextLine?: string
  fontSize: number
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-4 bottom-4 z-20 mx-auto max-w-2xl overflow-hidden rounded-md border border-white/15 bg-black/75 text-white shadow-2xl backdrop-blur-xl"
      aria-label="Teleprompter preview"
    >
      <div className="h-0.5 bg-white/15">
        <div className="h-full w-0 bg-white" />
      </div>
      <div className="px-5 py-4">
        <p
          className="text-pretty font-medium leading-[1.3] tracking-tight"
          style={{ fontSize: `clamp(16px, ${fontSize * 0.08}vw, ${fontSize}px)` }}
        >
          {currentLine}
        </p>
        {nextLine && (
          <p
            className="mt-2 line-clamp-1 text-pretty leading-[1.35] text-white/55"
            style={{ fontSize: `clamp(13px, ${fontSize * 0.06}vw, ${Math.max(16, fontSize * 0.72)}px)` }}
          >
            {nextLine}
          </p>
        )}
      </div>
    </div>
  )
}

/** Custom (non-native) source picker dropdown. */
function SourceSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: DeviceOption[]
  value?: string
  onChange: (v: string) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const selected = options.find((o) => o.deviceId === value) ?? options[0]
  const empty = options.length === 0

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={empty}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-sm border border-input bg-background px-3 py-2 text-left text-sm outline-none transition-colors hover:border-ring/60 focus:border-ring focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 truncate">
          {empty ? "No devices found" : selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && !empty && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-sm border border-border bg-popover p-1 shadow-lg"
        >
          {options.map((o) => {
            const active = o.deviceId === selected?.deviceId
            return (
              <button
                key={o.deviceId}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(o.deviceId)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {active && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
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

function Switch({
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
      role="switch"
      aria-checked={active}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        active ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 rounded-full bg-background shadow transition-transform",
          active ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  )
}
