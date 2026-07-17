"use client"

import { Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CameraPreview } from "@/components/studio/camera-preview"
import { PrompterPill, RecordingControlPill } from "@/components/prompter-pill"
import { createPortal } from "react-dom"
import type { ParsedScript } from "@/lib/prompter"

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, "0")}`
}

interface RecordingScreenProps {
  elapsed: number
  recordingPaused: boolean
  onToggleRecordingPaused: () => void
  cameraStream: MediaStream | null
  cameraEnabled: boolean
  prompterEnabled: boolean
  onStop: () => void
  // Prompter wiring
  script: ParsedScript
  cursor: number
  fontSize: number
  listening: boolean
  micSupported: boolean
  onTogglePause: () => void
  onPrevLine: () => void
  onNextLine: () => void
  onRestart: () => void
  pipOpen: boolean
  pipContainer: HTMLElement | null
}

export function RecordingScreen({
  elapsed,
  recordingPaused,
  onToggleRecordingPaused,
  cameraStream,
  cameraEnabled,
  prompterEnabled,
  onStop,
  script,
  cursor,
  fontSize,
  listening,
  micSupported,
  onTogglePause,
  onPrevLine,
  onNextLine,
  onRestart,
  pipOpen,
  pipContainer,
}: RecordingScreenProps) {
  return (
    <>
      {/* Private prompter — shown here, never part of the recorded screen unless
          the user chooses to share this exact tab. Only rendered when the
          teleprompter is turned on. */}
      {pipOpen && pipContainer &&
        createPortal(
          prompterEnabled ? (
            <PrompterPill
              script={script}
              cursor={cursor}
              fontSize={Math.min(fontSize, 30)}
              listening={listening}
              micSupported={micSupported}
              elapsed={elapsed}
              recordingActive
              recordingPaused={recordingPaused}
              onToggleListening={onTogglePause}
              onToggleRecordingPaused={onToggleRecordingPaused}
              onStopRecording={onStop}
              onPrevLine={onPrevLine}
              onNextLine={onNextLine}
              onRestart={onRestart}
            />
          ) : (
            <RecordingControlPill
              elapsed={elapsed}
              recordingPaused={recordingPaused}
              onToggleRecordingPaused={onToggleRecordingPaused}
              onStopRecording={onStop}
            />
          ),
          pipContainer,
        )}

      <main className="flex min-h-[calc(100svh-3rem)] flex-col items-center justify-center gap-6 px-6 py-24">
        <div className="flex items-center gap-2.5 rounded-full border border-destructive/40 bg-destructive/10 px-4 py-2">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
          </span>
          <span className="font-mono text-sm font-medium tabular-nums text-foreground">
            {formatTime(elapsed)}
          </span>
          <span className="text-sm text-muted-foreground">
            {recordingPaused ? "Paused" : "Recording"}
          </span>
        </div>

        {cameraEnabled && cameraStream && (
          <div className="w-full max-w-xs">
            <CameraPreview enabled stream={cameraStream} />
            <p className="mt-2 text-center text-xs text-muted-foreground">Your camera feed</p>
          </div>
        )}

        <div className="max-w-md space-y-1.5 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-balance">
            {!prompterEnabled
              ? "You're live"
              : pipOpen
                ? "Prompter is floating on top"
                : "You're live"}
          </h1>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            {!prompterEnabled
              ? "Switch to the tab or app you're demoing. Come back here when you're done to stop the recording."
              : pipOpen
                ? "Switch to the tab or app you're demoing — the prompter stays on top and follows your voice. Come back here to stop."
                : "Read from the prompter above. Pop it out into a floating window to keep it visible while you demo another window."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="lg" onClick={onToggleRecordingPaused}>
            {recordingPaused ? "Resume recording" : "Pause recording"}
          </Button>
          <Button variant="destructive" size="lg" onClick={onStop} className="gap-2">
            <Square className="size-4 fill-current" />
            Stop recording
          </Button>
        </div>
      </main>
    </>
  )
}
