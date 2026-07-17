"use client"

import { useMemo } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Square,
} from "lucide-react"
import type { ParsedScript } from "@/lib/prompter"
import { cn } from "@/lib/utils"

interface PrompterPillProps {
  script: ParsedScript
  cursor: number
  fontSize: number
  listening: boolean
  micSupported: boolean
  elapsed: number
  recordingActive: boolean
  recordingPaused: boolean
  onToggleListening: () => void
  onToggleRecordingPaused: () => void
  onStopRecording: () => void
  onPrevLine: () => void
  onNextLine: () => void
  onRestart: () => void
}

function formatTime(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`
}

export function PrompterPill({
  script,
  cursor,
  fontSize,
  listening,
  micSupported,
  elapsed,
  recordingActive,
  recordingPaused,
  onToggleListening,
  onToggleRecordingPaused,
  onStopRecording,
  onPrevLine,
  onNextLine,
  onRestart,
}: PrompterPillProps) {
  const { words, lines } = script
  const currentLineIndex = useMemo(() => {
    if (words.length === 0) return 0
    const clamped = Math.min(cursor, words.length - 1)
    return words[clamped]?.lineIndex ?? Math.max(0, lines.length - 1)
  }, [cursor, words, lines])
  const currentLine = lines[currentLineIndex]
  const nextLine = lines[currentLineIndex + 1]
  const progress = words.length > 0 ? Math.min(100, (cursor / words.length) * 100) : 0

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden border border-border/70 bg-background/75 text-foreground backdrop-blur-2xl">
      <div className="h-0.5 shrink-0 bg-muted/60">
        <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${progress}%` }} />
      </div>

      <section className="flex min-h-0 flex-1 items-center overflow-y-auto px-4 py-3 sm:px-6" aria-label="Teleprompter text">
        <div className="w-full min-w-0 font-medium tracking-tight">
          {currentLine ? (
            <p className="w-full whitespace-normal break-normal text-left leading-[1.3]" style={{ fontSize }}>
              {words.slice(currentLine.startWord, currentLine.endWord + 1).map((word, index) => {
                const globalIndex = currentLine.startWord + index
                return (
                  <span
                    key={globalIndex}
                    className={cn(
                      "inline transition-colors duration-200",
                      globalIndex < cursor ? "text-muted-foreground/60" : "text-foreground",
                      globalIndex === cursor && "rounded-sm bg-primary/20 text-foreground underline decoration-primary decoration-2 underline-offset-4",
                    )}
                  >
                    {word.display}{index < currentLine.endWord - currentLine.startWord ? " " : ""}
                  </span>
                )
              })}
            </p>
          ) : (
            <p className="text-muted-foreground" style={{ fontSize }}>You&apos;re at the end of your notes.</p>
          )}
          {nextLine && (
            <p className="mt-2 w-full whitespace-normal break-normal text-left leading-[1.35] text-muted-foreground" style={{ fontSize: Math.max(16, fontSize * 0.72) }}>
              {nextLine.text}
            </p>
          )}
        </div>
      </section>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-background/45 px-3 py-2 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          {recordingActive && (
            <span className={cn("flex items-center gap-1.5 rounded-full bg-muted/70 px-2.5 py-1 font-mono text-xs tabular-nums", recordingPaused && "text-muted-foreground")}>
              <span className={cn("size-1.5 rounded-full bg-destructive", !recordingPaused && "animate-pulse")} />
              {formatTime(elapsed)}
            </span>
          )}
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            {micSupported && listening ? <Mic className="size-3.5" /> : <MicOff className="size-3.5" />}
            {micSupported ? (listening ? "Following" : "Manual") : "Manual"}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <PopupButton label="Previous line" onClick={onPrevLine}><ChevronLeft /></PopupButton>
          {micSupported && <PopupButton label={listening ? "Pause voice following" : "Resume voice following"} onClick={onToggleListening}>{listening ? <MicOff /> : <Mic />}</PopupButton>}
          <PopupButton label="Next line" onClick={onNextLine}><ChevronRight /></PopupButton>
          <PopupButton label="Restart script" onClick={onRestart}><RotateCcw /></PopupButton>
          {recordingActive && (
            <>
              <span className="mx-1 h-5 w-px bg-border" />
              <PopupButton label={recordingPaused ? "Resume recording" : "Pause recording"} onClick={onToggleRecordingPaused}>{recordingPaused ? <Play /> : <Pause />}</PopupButton>
              <button type="button" onClick={onStopRecording} aria-label="Stop recording" title="Stop recording" className="flex h-8 items-center gap-1.5 rounded-md bg-destructive px-2.5 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Square className="size-3 fill-current" />
                Stop
              </button>
            </>
          )}
        </div>
      </footer>
    </main>
  )
}

export function RecordingControlPill({
  elapsed,
  recordingPaused,
  onToggleRecordingPaused,
  onStopRecording,
}: {
  elapsed: number
  recordingPaused: boolean
  onToggleRecordingPaused: () => void
  onStopRecording: () => void
}) {
  return (
    <main className="flex h-screen w-screen items-center justify-center overflow-hidden bg-transparent p-2 text-foreground">
      <div className="flex flex-col items-center gap-1 rounded-full border border-border bg-background/90 p-1.5 shadow-lg backdrop-blur-xl">
        <span className="px-1 py-1 font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatTime(elapsed)}
        </span>
        <PopupButton
          label={recordingPaused ? "Resume recording" : "Pause recording"}
          onClick={onToggleRecordingPaused}
        >
          {recordingPaused ? <Play /> : <Pause />}
        </PopupButton>
        <button
          type="button"
          onClick={onStopRecording}
          aria-label="Stop recording"
          title="Stop recording"
          className="flex size-8 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
        >
          <Square className="fill-current" />
        </button>
      </div>
    </main>
  )
}

function PopupButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4">
      {children}
    </button>
  )
}
