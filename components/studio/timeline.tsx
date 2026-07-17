"use client"

import { useCallback, useRef } from "react"
import type { TrimRange } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

function fmt(t: number): string {
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.floor((s % 1) * 10)
  return `${m}:${sec.toString().padStart(2, "0")}.${cs}`
}

type DragTarget = "start" | "end" | "seek" | null

interface TimelineProps {
  duration: number
  trim: TrimRange
  currentTime: number
  /** Evenly spaced poster frames rendered as a filmstrip behind the track. */
  frames?: string[]
  onTrimChange: (trim: TrimRange) => void
  onSeek: (time: number) => void
}

const MIN_SPAN = 0.5

export function Timeline({
  duration,
  trim,
  currentTime,
  frames = [],
  onTrimChange,
  onSeek,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragTarget>(null)

  const timeAt = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return 0
      const frac = (clientX - rect.left) / rect.width
      return Math.max(0, Math.min(duration, frac * duration))
    },
    [duration],
  )

  const handleMove = useCallback(
    (clientX: number) => {
      const t = timeAt(clientX)
      const target = dragRef.current
      if (target === "start") {
        onTrimChange({ start: Math.min(t, trim.end - MIN_SPAN), end: trim.end })
      } else if (target === "end") {
        onTrimChange({ start: trim.start, end: Math.max(t, trim.start + MIN_SPAN) })
      } else if (target === "seek") {
        onSeek(Math.max(trim.start, Math.min(trim.end, t)))
      }
    },
    [timeAt, trim, onTrimChange, onSeek],
  )

  const startDrag = useCallback(
    (target: DragTarget, e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = target
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      handleMove(e.clientX)
    },
    [handleMove],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return
      handleMove(e.clientX)
    },
    [handleMove],
  )

  const endDrag = useCallback(() => {
    dragRef.current = null
  }, [])

  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0)

  return (
    <div className="select-none">
      <div className="mb-1.5 flex items-center justify-between text-xs tabular-nums text-muted-foreground">
        <span>In {fmt(trim.start)}</span>
        <span className="text-foreground">{fmt(currentTime)}</span>
        <span>Out {fmt(trim.end)}</span>
      </div>

      <div
        ref={trackRef}
        className="relative h-16 w-full overflow-hidden rounded-sm border border-border bg-secondary/50"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Filmstrip of the actual recording */}
        {frames.length > 0 && (
          <div className="pointer-events-none absolute inset-0 flex">
            {frames.map((src, i) => (
              <img
                key={i}
                src={src || "/placeholder.svg"}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="h-full min-w-0 flex-1 object-cover opacity-80"
              />
            ))}
          </div>
        )}

        {/* Seek hit area */}
        <div
          className="absolute inset-0 cursor-pointer"
          onPointerDown={(e) => startDrag("seek", e)}
        />

        {/* Dimmed trimmed-out regions */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0  bg-background/70"
          style={{ width: `${pct(trim.start)}%` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0  bg-background/70"
          style={{ width: `${100 - pct(trim.end)}%` }}
        />

        {/* Active selection outline */}
        <div
          className="pointer-events-none absolute inset-y-0 border-y-2 border-primary/70"
          style={{ left: `${pct(trim.start)}%`, right: `${100 - pct(trim.end)}%` }}
        />

        {/* Playhead */}
        <div
          className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-foreground"
          style={{ left: `${pct(currentTime)}%` }}
        >
          <div className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-foreground" />
        </div>

        {/* Trim handles */}
        <Handle side="start" leftPct={pct(trim.start)} onPointerDown={(e) => startDrag("start", e)} />
        <Handle side="end" leftPct={pct(trim.end)} onPointerDown={(e) => startDrag("end", e)} />
      </div>
    </div>
  )
}

function Handle({
  side,
  leftPct,
  onPointerDown,
}: {
  side: "start" | "end"
  leftPct: number
  onPointerDown: (e: React.PointerEvent) => void
}) {
  return (
    <div
      role="slider"
      aria-label={side === "start" ? "Trim start" : "Trim end"}
      aria-valuenow={Math.round(leftPct)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      className={cn(
        "absolute top-1/2 z-20 flex h-[calc(100%+8px)] w-4 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-md bg-primary shadow-md",
        side === "start" ? "-translate-x-1/2" : "-translate-x-1/2",
      )}
      style={{ left: `${leftPct}%` }}
    >
      <div className="h-6 w-0.5 rounded-full bg-primary-foreground/70" />
    </div>
  )
}
