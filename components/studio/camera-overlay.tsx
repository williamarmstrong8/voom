"use client"

import { useCallback, useRef, useState } from "react"
import type { CameraLayout } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

interface CameraOverlayProps {
  layout: CameraLayout
  onLayoutChange: (layout: CameraLayout) => void
  /** The camera <video> element (owned by the editor for playback sync). */
  children: React.ReactNode
}

// How close (as a fraction of frame size) two values must be to snap together.
const SNAP = 0.025

export function CameraOverlay({ layout, onLayoutChange, children }: CameraOverlayProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragOffset = useRef({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [equalSnap, setEqualSnap] = useState(false)

  // rounded = 16:9, square & circle = 1:1.
  const aspect = layout.shape === "rounded" ? 9 / 16 : 1

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const parent = wrapRef.current?.parentElement
      const self = wrapRef.current
      if (!parent || !self) return
      e.preventDefault()
      const selfRect = self.getBoundingClientRect()
      dragOffset.current = {
        x: e.clientX - selfRect.left,
        y: e.clientY - selfRect.top,
      }
      setDragging(true)
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      const parent = wrapRef.current?.parentElement
      const self = wrapRef.current
      if (!parent || !self) return

      const frame = parent.getBoundingClientRect()
      const w = self.offsetWidth
      const h = self.offsetHeight

      let leftPx = e.clientX - frame.left - dragOffset.current.x
      let topPx = e.clientY - frame.top - dragOffset.current.y

      // Clamp inside the frame.
      leftPx = Math.max(0, Math.min(frame.width - w, leftPx))
      topPx = Math.max(0, Math.min(frame.height - h, topPx))

      const bottomPx = frame.height - topPx - h
      let leftFrac = leftPx / frame.width
      let bottomFrac = bottomPx / frame.height

      // Snap to frame edges using equal visible pixel gaps. Fractions differ
      // across axes because the preview is usually wider than it is tall.
      const edgeGapPx = frame.width * 0.02
      if (leftPx < frame.width * SNAP) leftFrac = edgeGapPx / frame.width
      if (bottomPx < frame.height * SNAP) bottomFrac = edgeGapPx / frame.height
      if (leftFrac > 1 - layout.width - SNAP) leftFrac = 1 - layout.width - 0.02

      // Magnetic snap: equal physical distance from bottom and left.
      const equalThresholdPx = Math.min(frame.width, frame.height) * SNAP
      const isEqual = Math.abs(leftPx - bottomPx) < equalThresholdPx
      if (isEqual) {
        const equalPx = (leftPx + bottomPx) / 2
        leftFrac = equalPx / frame.width
        bottomFrac = equalPx / frame.height
      }
      setEqualSnap(isEqual)

      onLayoutChange({ ...layout, left: leftFrac, bottom: bottomFrac })
    },
    [dragging, layout, onLayoutChange],
  )

  const endDrag = useCallback(() => {
    setDragging(false)
    setEqualSnap(false)
  }, [])

  return (
    <>
      {/* Diagonal guide from the bottom-left corner while equal-snapped. */}
      {equalSnap && (
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
          <div className="absolute bottom-0 left-0 h-[141%] w-px origin-bottom-left -rotate-45 bg-primary/60" />
        </div>
      )}

      <div
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          "absolute z-30 cursor-grab touch-none overflow-hidden border border-white/20 bg-black active:cursor-grabbing",
          layout.shape === "circle"
            ? "rounded-full"
            : layout.shape === "square"
              ? "rounded-md"
              : layout.shape === "triangle"
                ? "border-0"
                : "rounded-sm",
          dragging && "ring-2 ring-primary",
        )}
        style={{
          width: `${layout.width * 100}%`,
          aspectRatio: String(1 / aspect),
          left: `${layout.left * 100}%`,
          bottom: `${layout.bottom * 100}%`,
          clipPath: layout.shape === "triangle" ? "polygon(50% 0%, 100% 100%, 0% 100%)" : undefined,
        }}
      >
        {children}
      </div>
    </>
  )
}
