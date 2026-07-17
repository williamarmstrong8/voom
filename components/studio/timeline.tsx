"use client"

import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
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
  const trackRef = useRef<HTMLDivElement>(null)
  const dragStartSegments = useRef<EditorSegment[] | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const [draggingEdge, setDraggingEdge] = useState<{ id: string; edge: Edge } | null>(null)
  const projectDuration = Math.max(0.01, segments.reduce((sum, item) => sum + item.sourceEnd - item.sourceStart, 0))
  const contentWidth = `${Math.max(100, zoom * 100)}%`

  const clips = useMemo(() => {
    let projectStart = 0
    return segments.map((segment) => {
      const clip = { segment, projectStart, projectEnd: projectStart + segment.sourceEnd - segment.sourceStart }
      projectStart = clip.projectEnd
      return clip
    })
  }, [segments])

  const sourceToProject = useCallback((sourceTime: number) => {
    const clip = clips.find(({ segment }) => sourceTime >= segment.sourceStart && sourceTime <= segment.sourceEnd)
    if (clip) return clip.projectStart + sourceTime - clip.segment.sourceStart
    const next = clips.find(({ segment }) => sourceTime < segment.sourceStart)
    return next?.projectStart ?? projectDuration
  }, [clips, projectDuration])

  const projectToSource = useCallback((projectTime: number) => {
    const bounded = Math.max(0, Math.min(projectDuration, projectTime))
    const clip = clips.find((item, index) => bounded < item.projectEnd || index === clips.length - 1)
    return clip ? clip.segment.sourceStart + Math.min(clip.projectEnd - clip.projectStart, bounded - clip.projectStart) : 0
  }, [clips, projectDuration])

  const projectAtPointer = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(projectDuration, ((clientX - rect.left) / rect.width) * projectDuration))
  }, [projectDuration])

  const scrub = useCallback((clientX: number) => onSeek(projectToSource(projectAtPointer(clientX))), [onSeek, projectAtPointer, projectToSource])

  const beginScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setScrubbing(true)
    onSelectSegment(null)
    scrub(event.clientX)
  }

  const tickStep = projectDuration <= 15 ? 1 : projectDuration <= 60 ? 5 : projectDuration <= 180 ? 10 : 30
  const minorStep = tickStep / 5
  const ticks = Array.from({ length: Math.floor(projectDuration / minorStep) + 1 }, (_, index) => index * minorStep)
  const playhead = (sourceToProject(currentTime) / projectDuration) * 100

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
    const deltaProject = projectAtPointer(event.clientX) - (edge === "start" ? clips[index].projectStart : clips[index].projectEnd)
    const minimum = 0.15
    const lowerBound = edge === "start" ? (segments[index - 1]?.sourceEnd ?? 0) : segment.sourceStart + minimum
    const upperBound = edge === "end" ? (segments[index + 1]?.sourceStart ?? sourceDuration) : segment.sourceEnd - minimum
    const value = edge === "start"
      ? Math.max(lowerBound, Math.min(upperBound, segment.sourceStart + deltaProject))
      : Math.max(lowerBound, Math.min(upperBound, segment.sourceEnd + deltaProject))
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
        <span className="text-xs tabular-nums text-muted-foreground">{fmt(sourceToProject(currentTime))} / {fmt(projectDuration)}</span>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">Zoom<input type="range" min="1" max="6" step="0.25" value={zoom} onChange={(event) => onZoomChange?.(Number(event.target.value))} className="w-24 accent-primary" /><span className="w-8 tabular-nums text-foreground">{Math.round(zoom * 100)}%</span></label>
      </div>
      <div className="overflow-x-auto pb-2">
        <div ref={trackRef} className="relative min-w-full touch-none select-none" style={{ width: contentWidth }}>
          <div className="relative h-7 cursor-ew-resize border-b border-border" onPointerDown={beginScrub} onPointerMove={(event) => scrubbing && scrub(event.clientX)} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setScrubbing(false) }} onPointerCancel={() => setScrubbing(false)}>
            {ticks.map((time) => {
              const major = Math.abs(time / tickStep - Math.round(time / tickStep)) < 0.01
              return <div key={time} className={cn("pointer-events-none absolute bottom-0 border-l border-border", major ? "h-4" : "h-2")} style={{ left: `${(time / projectDuration) * 100}%` }}>{major && <span className="absolute bottom-3 left-1 text-[10px] tabular-nums text-muted-foreground">{fmt(time)}</span>}</div>
            })}
          </div>

          <div className="relative mt-2 flex h-20 gap-1" onPointerDown={(event) => { if ((event.target as HTMLElement).dataset.clip) return; beginScrub(event) }} onPointerMove={(event) => scrubbing && scrub(event.clientX)} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setScrubbing(false) }}>
            {clips.map(({ segment, projectStart, projectEnd }, index) => {
              const selected = selectedSegmentId === segment.id
              const width = ((projectEnd - projectStart) / projectDuration) * 100
              return (
                <div key={segment.id} data-clip="true" className={cn("group relative h-full shrink-0 cursor-pointer overflow-visible rounded-md border bg-secondary/50 transition-colors", selected ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-foreground/40")} style={{ width: `calc(${width}% - 2px)` }} onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setScrubbing(true); onSelectSegment(segment.id); scrub(event.clientX) }} onPointerMove={(event) => scrubbing && scrub(event.clientX)} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setScrubbing(false) }} onPointerCancel={() => setScrubbing(false)}>
                  <div className="pointer-events-none absolute inset-0 flex overflow-hidden rounded-[inherit] opacity-70">
                    {frames.map((src, frameIndex) => <img key={frameIndex} src={src || "/placeholder.svg"} alt="" className="h-full min-w-0 flex-1 object-cover" draggable={false} />)}
                  </div>
                  <span className="pointer-events-none absolute bottom-1 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">Clip {index + 1}</span>
                  {selected && (["start", "end"] as const).map((edge) => (
                    <button key={edge} type="button" aria-label={`Trim clip ${index + 1} ${edge}`} className={cn("absolute inset-y-0 z-20 w-5 cursor-ew-resize touch-none", edge === "start" ? "-left-2" : "-right-2")} onPointerDown={(event) => beginEdgeDrag(segment.id, edge, event)} onPointerMove={(event) => moveEdge(segment.id, edge, event)} onPointerUp={endEdgeDrag} onPointerCancel={endEdgeDrag}>
                      <span className={cn("absolute top-1/2 h-10 w-2 -translate-y-1/2 border-y-2 border-primary bg-background/80", edge === "start" ? "left-1 rounded-l-sm border-l-2" : "right-1 rounded-r-sm border-r-2")} />
                    </button>
                  ))}
                </div>
              )
            })}
            <div className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-foreground" style={{ left: `${playhead}%` }}><div className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-foreground" /></div>
          </div>

          {captions.length > 0 && <div className="relative mt-2 h-7 cursor-ew-resize rounded-sm bg-secondary/50" onPointerDown={beginScrub} onPointerMove={(event) => scrubbing && scrub(event.clientX)} onPointerUp={() => setScrubbing(false)}>{captions.map((caption) => { const start = sourceToProject(caption.start); const end = sourceToProject(caption.end); return <div key={caption.id} className="pointer-events-none absolute inset-y-1 overflow-hidden rounded-sm bg-blue-500/30 px-1 text-[10px] leading-5" style={{ left: `${(start / projectDuration) * 100}%`, width: `${Math.max(1, ((end - start) / projectDuration) * 100)}%` }}>{caption.text}</div> })}</div>}
        </div>
      </div>
    </section>
  )
}
