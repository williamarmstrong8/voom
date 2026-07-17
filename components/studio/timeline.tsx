"use client"

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import type { CaptionCue, EditorSegment, TitleCard } from "@/lib/editor-types"
import type { TrimRange } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

function fmt(time: number) {
  const safe = Math.max(0, time)
  const minutes = Math.floor(safe / 60)
  const seconds = Math.floor(safe % 60)
  const frames = Math.floor((safe % 1) * 30)
  return `${minutes}:${seconds.toString().padStart(2, "0")}:${frames.toString().padStart(2, "0")}`
}

interface TimelineProps {
  duration: number
  trim: TrimRange
  currentTime: number
  frames?: string[]
  segments?: EditorSegment[]
  captions?: CaptionCue[]
  titleCards?: TitleCard[]
  selectedSegmentId?: string | null
  zoom?: number
  onZoomChange?: (zoom: number) => void
  onSelectSegment?: (id: string) => void
  onTrimChange: (trim: TrimRange) => void
  onSeek: (time: number) => void
}

type TrimSide = "start" | "end"

export function Timeline({
  duration,
  trim,
  currentTime,
  frames = [],
  segments = [],
  captions = [],
  titleCards = [],
  selectedSegmentId,
  zoom = 1,
  onZoomChange,
  onSelectSegment,
  onTrimChange,
  onSeek,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [activeHandle, setActiveHandle] = useState<TrimSide | null>(null)
  const [hoveredHandle, setHoveredHandle] = useState<TrimSide | null>(null)
  const contentWidth = `${Math.max(100, zoom * 100)}%`
  const pct = (time: number) => duration > 0 ? (time / duration) * 100 : 0

  const timeAtPointer = useCallback((clientX: number, clampToTrim = true) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return 0
    const rawTime = ((clientX - rect.left) / rect.width) * duration
    const minimum = clampToTrim ? trim.start : 0
    const maximum = clampToTrim ? trim.end : duration
    return Math.max(minimum, Math.min(maximum, rawTime))
  }, [duration, trim.end, trim.start])

  const seekAt = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || activeHandle) return
    onSeek(timeAtPointer(event.clientX))
  }, [activeHandle, onSeek, timeAtPointer])

  const startTrimDrag = useCallback((side: TrimSide, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setActiveHandle(side)
  }, [])

  const moveTrimHandle = useCallback((side: TrimSide, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (activeHandle !== side) return
    const minimumRange = Math.min(0.25, duration)
    const pointerTime = timeAtPointer(event.clientX, false)
    const next = side === "start"
      ? { start: Math.min(pointerTime, trim.end - minimumRange), end: trim.end }
      : { start: trim.start, end: Math.max(pointerTime, trim.start + minimumRange) }
    onTrimChange(next)
    onSeek(side === "start" ? next.start : next.end)
  }, [activeHandle, duration, onSeek, onTrimChange, timeAtPointer, trim.end, trim.start])

  const finishTrimDrag = useCallback((side: TrimSide, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (activeHandle === side) setActiveHandle(null)
  }, [activeHandle])

  return (
    <section className="rounded-md border border-border bg-card p-3" aria-label="Video timeline">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span className="font-medium text-foreground">{fmt(currentTime)}</span>
          <span className="text-muted-foreground">/ {fmt(duration)}</span>
          <span className="text-muted-foreground">In {fmt(trim.start)} · Out {fmt(trim.end)}</span>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Timeline zoom
          <input type="range" min="1" max="6" step="0.25" value={zoom} onChange={(event) => onZoomChange?.(Number(event.target.value))} className="w-28 accent-primary" />
          <span className="w-8 tabular-nums text-foreground">{Math.round(zoom * 100)}%</span>
        </label>
      </div>

      <div className="overflow-x-auto pb-2">
        <div ref={trackRef} className="relative min-w-full" style={{ width: contentWidth }}>
          <div className="relative h-20 touch-none overflow-hidden rounded-sm border border-border bg-secondary/40" onPointerDown={seekAt}>
            {frames.length > 0 && (
              <div className="pointer-events-none absolute inset-0 flex">
                {frames.map((src, index) => <img key={index} src={src || "/placeholder.svg"} alt="" className="h-full min-w-0 flex-1 object-cover opacity-70" draggable={false} />)}
              </div>
            )}
            {segments.map((segment) => (
              <button
                type="button"
                key={segment.id}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  onSelectSegment?.(segment.id)
                  onSeek(timeAtPointer(event.clientX))
                }}
                className={cn("absolute inset-y-0 border-x transition-colors", selectedSegmentId === segment.id ? "z-10 border-primary bg-primary/20 ring-2 ring-inset ring-primary" : "border-background/70 hover:bg-primary/10")}
                style={{ left: `${pct(segment.sourceStart)}%`, width: `${pct(segment.sourceEnd - segment.sourceStart)}%` }}
                aria-label={`Select and seek clip from ${fmt(segment.sourceStart)} to ${fmt(segment.sourceEnd)}`}
              />
            ))}

            <div className="pointer-events-none absolute inset-y-0 z-20 bg-background/70" style={{ left: 0, width: `${pct(trim.start)}%` }} />
            <div className="pointer-events-none absolute inset-y-0 z-20 bg-background/70" style={{ left: `${pct(trim.end)}%`, right: 0 }} />
            <div className="pointer-events-none absolute inset-y-0 z-20 border-y border-primary/60" style={{ left: `${pct(trim.start)}%`, width: `${pct(trim.end - trim.start)}%` }} />

            {(["start", "end"] as const).map((side) => {
              const time = side === "start" ? trim.start : trim.end
              const visible = activeHandle === side || hoveredHandle === side
              return (
                <button
                  key={side}
                  type="button"
                  aria-label={`Drag ${side === "start" ? "in" : "out"} trim handle`}
                  className="group absolute inset-y-0 z-40 w-6 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  style={{ left: `${pct(time)}%` }}
                  onPointerEnter={() => setHoveredHandle(side)}
                  onPointerLeave={() => setHoveredHandle(null)}
                  onPointerDown={(event) => startTrimDrag(side, event)}
                  onPointerMove={(event) => moveTrimHandle(side, event)}
                  onPointerUp={(event) => finishTrimDrag(side, event)}
                  onPointerCancel={(event) => finishTrimDrag(side, event)}
                >
                  <span className={cn("absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-primary transition-[width] group-hover:w-1", activeHandle === side && "w-1")} />
                  <span className={cn("absolute left-1/2 top-1/2 h-8 w-2 -translate-x-1/2 -translate-y-1/2 border-y-2 border-primary opacity-0 transition-opacity group-hover:opacity-100", side === "start" ? "border-l-2 rounded-l-sm" : "border-r-2 rounded-r-sm", activeHandle === side && "opacity-100")} />
                  {visible && <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm border border-border bg-popover px-1.5 py-1 text-[10px] font-medium tabular-nums text-popover-foreground shadow-md">{side === "start" ? "In" : "Out"} {fmt(time)}</span>}
                </button>
              )
            })}

            <div className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-foreground" style={{ left: `${pct(currentTime)}%` }}>
              <div className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-foreground" />
            </div>
          </div>

          <div className="relative mt-2 h-7 cursor-pointer rounded-sm bg-secondary/50" aria-label="Captions track" onPointerDown={seekAt}>
            <span className="pointer-events-none absolute left-2 top-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">CC</span>
            {captions.map((caption) => <div key={caption.id} title={caption.text} className="pointer-events-none absolute inset-y-1 overflow-hidden rounded-sm bg-blue-500/30 px-1 text-[10px] leading-5 text-foreground" style={{ left: `${pct(caption.start)}%`, width: `${Math.max(1, pct(caption.end - caption.start))}%` }}>{caption.text}</div>)}
          </div>

          {titleCards.length > 0 && (
            <div className="relative mt-1 h-7 cursor-pointer rounded-sm bg-secondary/50" aria-label="Title cards track" onPointerDown={seekAt}>
              <span className="pointer-events-none absolute left-2 top-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Text</span>
              {titleCards.map((card) => <div key={card.id} title={card.title} className="pointer-events-none absolute inset-y-1 overflow-hidden rounded-sm bg-purple-500/30 px-1 text-[10px] leading-5 text-foreground" style={{ left: `${pct(card.start)}%`, width: `${Math.max(1, pct(card.end - card.start))}%` }}>{card.title}</div>)}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
