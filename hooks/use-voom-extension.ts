"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { RecordingResult } from "@/lib/studio-types"

const WEB_SOURCE = "voom-web-app"
const EXTENSION_SOURCE = "voom-extension"

interface ExtensionConfig {
  cameraEnabled: boolean
  micEnabled: boolean
  teleprompterEnabled: boolean
  script: string
  fontSize: number
}

interface PrompterUpdate {
  currentLine: string | null
  nextLine: string | null
}

interface PendingRequest {
  resolve: (value: boolean) => void
  timeout: number
}

export function useVoomExtension(onRecording: (recording: RecordingResult) => void) {
  const [available, setAvailable] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [status, setStatus] = useState("idle")
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [now, setNow] = useState(Date.now())
  const pending = useRef(new Map<string, PendingRequest>())
  const recordingHandler = useRef(onRecording)

  useEffect(() => {
    recordingHandler.current = onRecording
  }, [onRecording])

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      const message = event.data
      if (message?.source !== EXTENSION_SOURCE) return
      if (message.type === "VOOM_PONG") {
        setAvailable(true)
        setVersion(message.version || null)
      }
      if (message.type === "VOOM_STATE") {
        setStatus(message.state?.status || "idle")
        setStartedAt(message.state?.startedAt || null)
        setElapsedMs(Number(message.state?.elapsedMs || 0))
      }
      if (message.type === "VOOM_COMMAND_RESULT") {
        const request = pending.current.get(message.requestId)
        if (!request) return
        window.clearTimeout(request.timeout)
        pending.current.delete(message.requestId)
        request.resolve(Boolean(message.response?.ok))
      }
      if (message.type === "VOOM_RECORDING_READY" && message.recording?.dataUrl) {
        const response = await fetch(message.recording.dataUrl)
        const blob = await response.blob()
        recordingHandler.current({
          screen: {
            blob,
            url: URL.createObjectURL(blob),
            mimeType: message.recording.mimeType || blob.type || "video/webm",
          },
          camera: null,
          duration: Math.max(0, Number(message.recording.durationMs || 0) / 1000),
        })
      }
    }
    window.addEventListener("message", onMessage)
    const ping = () => window.postMessage({ source: WEB_SOURCE, type: "VOOM_PING" }, window.location.origin)
    ping()
    const interval = window.setInterval(ping, 1500)
    const timeout = window.setTimeout(() => window.clearInterval(interval), 6000)
    return () => {
      window.removeEventListener("message", onMessage)
      window.clearInterval(interval)
      window.clearTimeout(timeout)
      for (const request of pending.current.values()) window.clearTimeout(request.timeout)
      pending.current.clear()
    }
  }, [])

  useEffect(() => {
    if (status !== "recording") return
    const interval = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(interval)
  }, [status])

  const command = useCallback((name: string, config?: ExtensionConfig | PrompterUpdate) => {
    return new Promise<boolean>((resolve) => {
      const requestId = crypto.randomUUID()
      const timeout = window.setTimeout(() => {
        pending.current.delete(requestId)
        resolve(false)
      }, 8000)
      pending.current.set(requestId, { resolve, timeout })
      window.postMessage(
        { source: WEB_SOURCE, type: "VOOM_COMMAND", requestId, command: name, config },
        window.location.origin,
      )
    })
  }, [])

  return {
    available,
    version,
    status,
    startedAt,
    elapsedMs: status === "recording" && startedAt ? Math.max(0, now - startedAt) : elapsedMs,
    start: (config: ExtensionConfig) => command("VOOM_START", config),
    pause: () => command("VOOM_PAUSE"),
    resume: () => command("VOOM_RESUME"),
    updatePrompter: (update: PrompterUpdate) => command("VOOM_UPDATE_PROMPTER", update),
    stop: () => command("VOOM_STOP"),
  }
}
