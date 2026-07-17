"use client"

import { useEffect, useRef, useState } from "react"
import { VideoOff } from "lucide-react"
import { cn } from "@/lib/utils"

interface CameraPreviewProps {
  enabled: boolean
  className?: string
  mirrored?: boolean
  /** When provided, render this stream instead of requesting a new one. */
  stream?: MediaStream | null
}

/** Live self-view. Manages its own getUserMedia stream unless one is passed in. */
export function CameraPreview({
  enabled,
  className,
  mirrored = true,
  stream: externalStream,
}: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setError(false)
      return
    }

    // Use the externally supplied stream when given (e.g. live recording feed).
    if (externalStream) {
      if (videoRef.current) {
        videoRef.current.srcObject = externalStream
        void videoRef.current.play().catch(() => {})
      }
      return
    }

    let stream: MediaStream | null = null
    let cancelled = false

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
          void videoRef.current.play().catch(() => {})
        }
      })
      .catch(() => setError(true))

    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [enabled, externalStream])

  if (!enabled) return null

  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-md border border-border bg-secondary",
        className,
      )}
    >
      {error ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
          <VideoOff className="size-6" />
          <p className="text-xs">Camera unavailable</p>
        </div>
      ) : (
        <video
          ref={videoRef}
          muted
          playsInline
          className={cn("h-full w-full object-cover", mirrored && "-scale-x-100")}
        />
      )}
    </div>
  )
}
