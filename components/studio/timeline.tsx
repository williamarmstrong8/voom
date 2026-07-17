"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import type { CaptionCue, EditorSegment } from "@/lib/editor-types"
import { cn } from "@/lib/utils"

function fmt(time: number) {
  const safe = Math.max(0, time)
  const minutes = Math.floor(safe / 60)
  const seconds = Math.floor(safe % 60)
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

interface TimelineProps {
  sourceDuration: number
  currentTime: number
  frames?: string[]
  segments: EditorSegment[]
  captions?: CaptionCue[]
  selectedSegmentId?: string | null
  zoom?: number
  onZoomChange?: (zoom: number) => void
  onSelectSegment: (id: string | null) => void
  onSegmentsChange: (segments: EditorSegment[]) => void
  onSegmentsCommit: (previous: EditorSegment[]) => void
  onSeek: (sourceTime: number) => void
}

type Edge = "start" | "end"

export function Timeline({
  sourceDuration,
  currentTime,
  frames = [],
  segments,
  captions = [],
  selectedSegmentId,
  zoom = 1,
  onZoomChange,
  onSelectSegment,
  onSegmentsChange,
  onSegmentsCommit,
  onSeek,
}: TimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragStartSegments = useRef<EditorSegment[] | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [draggingEdge, setDraggingEdge] = useState<{ id: string; edge: Edge } | null>(null)
  const displayDuration = Math.max(0.01, sourceDuration)
  const editedDuration = Math.max(0.01, segments.reduce((sum, item) => sum + item.sourceEnd - item.sourceStart, 0))
  const contentWidth = `${Math.max(100, zoom * 100)}%`
  const thumbnailCount = Math.max(1, Math.ceil((viewportWidth * zoom) / 112))
  const thumbnailFrames = useMemo(
    () => Array.from({ length: thumbnailCount }, (_, index) => {
      if (frames.length === 0) return "/placeholder.svg"
      const sourceIndex = Math.min(
        frames.length - 1,
        Math.floor((index / thumbnailCount) * frames.length),
      )
      return frames[sourceIndex] || "/placeholder.svg"
    }),
    [frames, thumbnailCount],
  )

  const sourceAtPointer = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(displayDuration, ((clientX - rect.left) / rect.width) * displayDuration))
  }, [displayDuration])

  const scrub = useCallback((clientX: number) => onSeek(sourceAtPointer(clientX)), [onSeek, sourceAtPointer])

  const beginScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setScrubbing(true)
    onSelectSegment(null)
    scrub(event.clientX)
  }

  const tickStep = displayDuration <= 15 ? 1 : displayDuration <= 60 ? 5 : displayDuration <= 180 ? 10 : 30
  const minorStep = tickStep / 5
  const ticks = Array.from({ length: Math.floor(displayDuration / minorStep) + 1 }, (_, index) => index * minorStep)
  const playhead = (currentTime / displayDuration) * 100

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width))
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  // Zoom changes the amount of time visible inside a fixed viewport. Keep the
  // current playhead in view while the underlying timeline becomes wider.
  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return
    const playheadX = (currentTime / displayDuration) * track.scrollWidth
    const nextLeft = playheadX - viewport.clientWidth / 2
    viewport.scrollTo({ left: Math.max(0, nextLeft) })
  }, [zoom, currentTime, displayDuration])

  const beginEdgeDrag = (id: string, edge: Edge, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartSegments.current = segments.map((segment) => ({ ...segment }))
    setDraggingEdge({ id, edge })
  }

  const moveEdge = (id: string, edge: Edge, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (draggingEdge?.id !== id || draggingEdge.edge !== edge) return
    const index = segments.findIndex((segment) => segment.id === id)
    if (index < 0) return
    const segment = segments[index]
    const pointerTime = sourceAtPointer(event.clientX)
    const minimum = 0.15
    const lowerBound = edge === "start" ? (segments[index - 1]?.sourceEnd ?? 0) : segment.sourceStart + minimum
    const upperBound = edge === "end" ? (segments[index + 1]?.sourceStart ?? sourceDuration) : segment.sourceEnd - minimum
    const value = Math.max(lowerBound, Math.min(upperBound, pointerTime))
    const next = segments.map((item) => item.id === id ? { ...item, [edge === "start" ? "sourceStart" : "sourceEnd"]: value } : item)
    onSegmentsChange(next)
    onSeek(value)
  }

  const endEdgeDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (dragStartSegments.current) onSegmentsCommit(dragStartSegments.current)
    dragStartSegments.current = null
    setDraggingEdge(null)
  }

  return (
    <section className="rounded-md border border-border bg-card p-3" aria-label="Video timeline">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-muted-foreground">{fmt(currentTime)} / {fmt(displayDuration)} <span className="ml-1 text-foreground">({fmt(editedDuration)} kept)</span></span>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">Zoom<input type="range" min="1" max="6" step="0.25" value={zoom} onChange={(event) => onZoomChange?.(Number(event.target.value))} className="w-24 accent-primary" /><span className="w-8 tabular-nums text-foreground">{Math.round(zoom * 100)}%</span></label>
      </div>
      <div
        ref={viewportRef}
        className="w-full min-w-0 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div ref={trackRef} className="relative min-w-full max-w-none touch-none select-none" style={{ width: contentWidth }}>
          <div className="relative h-8 cursor-ew-resize border-b border-border" onPointerDown={beginScrub} onPointerMove={(event) => scrubbing && scrub(event.clientX)} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setScrubbing(false) }} onPointerCancel={() => setScrubbing(false)}>
            {ticks.map((time) => {
              const major = Math.abs(time / tickStep - Math.round(time / tickStep)) < 0.01
              return <div key={time} className={cn("pointer-events-none absolute bottom-0 border-l border-border", major ? "h-4" : "h-2")} style={{ left: `${(time / displayDuration) * 100}%` }}>{major && <span className="absolute bottom-3 left-1 text-[10px] tabular-nums text-muted-foreground">{fmt(time)}</span>}</div>
            })}
          </div>

          <div className="relative mt-2 h-20 overflow-visible rounded-md bg-secondary/30" onPointerDown={(event) => { if ((event.target as HTMLElement).closest("[data-clip]")) return; beginScrub(event) }} onPointerMove={(event) => scrubbing && scrub(event.clientX)} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setScrubbing(false) }}>
            <div className="pointer-events-none absolute inset-0 flex overflow-hidden rounded-[inherit] opacity-20 grayscale">
              {thumbnailFrames.map((src, frameIndex) => (
                <img
                  key={frameIndex}
                  src={src}
                  alt=""
                  className="h-full min-w-0 flex-1 object-cover"
                  draggable={false}
                />
              ))}
            </div>
            {segments.map((segment, index) => {
              const selected = selectedSegmentId === segment.id
              const left = (segment.sourceStart / displayDuration) * 100
              const width = ((segment.sourceEnd - segment.sourceStart) / displayDuration) * 100
              return (
                <div key={segment.id} data-clip="true" className={cn("group absolute inset-y-0 cursor-pointer overflow-visible rounded-md border bg-secondary transition-colors", selected ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-foreground/40")} style={{ left: `${left}%`, width: `${width}%` }} onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setScrubbing(true); onSelectSegment(segment.id); scrub(event.clientX) }} onPointerMove={(event) => scrubbing && scrub(event.clientX)} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setScrubbing(false) }} onPointerCancel={() => setScrubbing(false)}>
                  <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
                    <div
                      className="absolute inset-y-0 flex"
                      style={{
                        left: `${-(segment.sourceStart / (segment.sourceEnd - segment.sourceStart)) * 100}%`,
                        width: `${(displayDuration / (segment.sourceEnd - segment.sourceStart)) * 100}%`,
                      }}
                    >
                      {thumbnailFrames.map((src, frameIndex) => (
                <img
                  key={frameIndex}
                  src={src}
                  alt=""
                  className="h-full min-w-0 flex-1 object-cover"
                  draggable={false}
                />
              ))}
                    </div>
                  </div>
                  <span className="pointer-events-none absolute bottom-1 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">Clip {index + 1}</span>
                  {(["start", "end"] as const).map((edge) => (
                    <button key={edge} type="button" aria-label={`Trim clip ${index + 1} ${edge}`} className={cn("absolute inset-y-0 z-20 w-7 cursor-ew-resize touch-none opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100", selected && "opacity-100", edge === "start" ? "-left-3" : "-right-3")} onPointerDown={(event) => beginEdgeDrag(segment.id, edge, event)} onPointerMove={(event) => moveEdge(segment.id, edge, event)} onPointerUp={endEdgeDrag} onPointerCancel={endEdgeDrag}>
                      <span className={cn("absolute top-1/2 flex h-12 w-4 -translate-y-1/2 items-center justify-center rounded-md bg-primary shadow-md", edge === "start" ? "left-1" : "right-1")}>
                        <span className="h-6 w-0.5 rounded-full bg-primary-foreground" />
                      </span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>

          {captions.length > 0 && <div className="relative mt-2 h-7 cursor-ew-resize rounded-sm bg-secondary/50" onPointerDown={beginScrub} onPointerMove={(event) => scrubbing && scrub(event.clientX)} onPointerUp={() => setScrubbing(false)}>{captions.map((caption) => <div key={caption.id} className="pointer-events-none absolute inset-y-1 overflow-hidden rounded-sm bg-blue-500/30 px-1 text-[10px] leading-5" style={{ left: `${(caption.start / displayDuration) * 100}%`, width: `${Math.max(1, ((caption.end - caption.start) / displayDuration) * 100)}%` }}>{caption.text}</div>)}</div>}
          <div className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-primary" style={{ left: `${playhead}%` }}>
            <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 border-x-[6px] border-t-[9px] border-x-transparent border-t-primary" />
          </div>
        </div>
      </div>
    </section>
  )
}
