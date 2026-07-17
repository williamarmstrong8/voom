"use client"

import { useCallback, useRef } from "react"
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
  const contentWidth = `${Math.max(100, zoom * 100)}%`
  const pct = (time: number) => duration > 0 ? (time / duration) * 100 : 0
  const seekAt = useCallback((event: React.PointerEvent) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    onSeek(Math.max(trim.start, Math.min(trim.end, ((event.clientX - rect.left) / rect.width) * duration)))
  }, [duration, onSeek, trim])

  return (
    <section className="rounded-md border border-border bg-card p-3" aria-label="Video timeline">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span className="font-medium text-foreground">{fmt(currentTime)}</span>
          <span className="text-muted-foreground">/ {fmt(duration)}</span>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Timeline zoom
          <input
            type="range"
            min="1"
            max="6"
            step="0.25"
            value={zoom}
            onChange={(event) => onZoomChange?.(Number(event.target.value))}
            className="w-28 accent-primary"
          />
          <span className="w-8 tabular-nums text-foreground">{Math.round(zoom * 100)}%</span>
        </label>
      </div>

      <div className="overflow-x-auto pb-2">
        <div ref={trackRef} className="relative min-w-full" style={{ width: contentWidth }}>
          <div className="relative h-20 overflow-hidden rounded-sm border border-border bg-secondary/40" onPointerDown={seekAt}>
            {frames.length > 0 && (
              <div className="pointer-events-none absolute inset-0 flex">
                {frames.map((src, index) => (
                  <img key={index} src={src || "/placeholder.svg"} alt="" className="h-full min-w-0 flex-1 object-cover opacity-70" draggable={false} />
                ))}
              </div>
            )}
            {segments.map((segment) => (
              <button
                type="button"
                key={segment.id}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onSelectSegment?.(segment.id)}
                className={cn(
                  "absolute inset-y-0 border-x transition-colors",
                  selectedSegmentId === segment.id
                    ? "z-10 border-primary bg-primary/20 ring-2 ring-inset ring-primary"
                    : "border-background/70 hover:bg-primary/10",
                )}
                style={{ left: `${pct(segment.sourceStart)}%`, width: `${pct(segment.sourceEnd - segment.sourceStart)}%` }}
                aria-label={`Select clip from ${fmt(segment.sourceStart)} to ${fmt(segment.sourceEnd)}`}
              />
            ))}
            <div className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-foreground" style={{ left: `${pct(currentTime)}%` }}>
              <div className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-foreground" />
            </div>
          </div>

          <div className="relative mt-2 h-7 rounded-sm bg-secondary/50" aria-label="Captions track">
            <span className="absolute left-2 top-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">CC</span>
            {captions.map((caption) => (
              <div key={caption.id} title={caption.text} className="absolute inset-y-1 overflow-hidden rounded-sm bg-blue-500/30 px-1 text-[10px] leading-5 text-foreground" style={{ left: `${pct(caption.start)}%`, width: `${Math.max(1, pct(caption.end - caption.start))}%` }}>
                {caption.text}
              </div>
            ))}
          </div>

          <div className="relative mt-1 h-7 rounded-sm bg-secondary/50" aria-label="Title cards track">
            <span className="absolute left-2 top-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Text</span>
            {titleCards.map((card) => (
              <div key={card.id} title={card.title} className="absolute inset-y-1 overflow-hidden rounded-sm bg-purple-500/30 px-1 text-[10px] leading-5 text-foreground" style={{ left: `${pct(card.start)}%`, width: `${Math.max(1, pct(card.end - card.start))}%` }}>
                {card.title}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
