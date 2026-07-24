"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { BookOpen } from "lucide-react"
import { activeGuideStep, type GuideStep } from "@/lib/editor-types"
import { GuideMarkdown } from "@/components/studio/guide-markdown"
import { cn } from "@/lib/utils"

const FADE_MS = 220

function formatTimestamp(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`
}

/**
 * Side panel that shows the build-guide step active at the current project time.
 * Exactly one step shows at a time and it cross-fades whenever the active step
 * changes as the demo plays. Renders nothing until the first step's start.
 */
export function GuidePanel({
  steps,
  currentTime,
  className,
}: {
  steps: GuideStep[]
  /** Current playback position in project (edited-timeline) seconds. */
  currentTime: number
  className?: string
}) {
  const sorted = useMemo(() => [...steps].sort((a, b) => a.start - b.start), [steps])
  const active = useMemo(() => activeGuideStep(sorted, currentTime), [sorted, currentTime])

  // Cross-fade: when the active step changes, fade out, swap content, fade in.
  const [shown, setShown] = useState<GuideStep | null>(active)
  const [visible, setVisible] = useState(true)
  const activeId = active?.id ?? null
  const shownId = shown?.id ?? null

  useEffect(() => {
    if (activeId === shownId) return
    setVisible(false)
    const timer = window.setTimeout(() => {
      setShown(active)
      setVisible(true)
    }, FADE_MS)
    return () => window.clearTimeout(timer)
  }, [activeId, shownId, active])

  const index = shown ? sorted.findIndex((step) => step.id === shown.id) : -1

  return (
    <div className={cn("flex min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-lg border border-border bg-card", className)}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-copy-13 font-medium">Build guide</span>
        {sorted.length > 0 && index >= 0 && (
          <span className="ml-auto text-copy-13 tabular-nums text-muted-foreground">
            Step {index + 1} of {sorted.length}
          </span>
        )}
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-4 py-4 transition-opacity ease-out",
          visible ? "opacity-100" : "opacity-0",
        )}
        style={{ transitionDuration: `${FADE_MS}ms` }}
        aria-live="polite"
      >
        {shown ? (
          <article key={shown.id} className="w-full min-w-0 max-w-full">
            <div className="mb-4 rounded-md border border-[var(--ds-gray-alpha-400)] bg-[var(--ds-background-100)] px-3 py-3 shadow-[var(--ds-shadow-border)]">
              <div className="flex items-baseline gap-2">
                <h2 className="text-pretty text-heading-16">{shown.title || "Untitled step"}</h2>
                <span className="ml-auto shrink-0 text-copy-13 tabular-nums text-[var(--ds-gray-700)]">
                  {formatTimestamp(shown.start)}
                </span>
              </div>
            </div>
            {shown.body.trim() ? (
              <GuideMarkdown>{shown.body}</GuideMarkdown>
            ) : (
              <p className="text-copy-14 text-muted-foreground">No content for this step yet.</p>
            )}
          </article>
        ) : (
          <div className="flex h-full min-h-32 flex-col items-center justify-center gap-1 text-center">
            <p className="text-copy-14 font-medium text-muted-foreground">Guide starts shortly</p>
            <p className="text-copy-13 text-muted-foreground">
              The first step appears at {formatTimestamp(sorted[0]?.start ?? 0)}.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
