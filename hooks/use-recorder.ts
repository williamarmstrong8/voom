"use client"

import { useCallback, useRef, useState } from "react"
import type { RecordedTrack, RecordingResult } from "@/lib/studio-types"

function pickAudioMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm"]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "audio/webm"
}

function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm",
  ]
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
      return type
    }
  }
  return "video/webm"
}

interface RecorderChannel {
  recorder: MediaRecorder
  chunks: Blob[]
  stream: MediaStream
}

export interface CameraOptions {
  camera: boolean
  micEnabled: boolean
  /** Preferred camera device id (from enumerateDevices). */
  cameraId?: string
  /** Preferred microphone device id (from enumerateDevices). */
  micId?: string
}

export interface UseRecorder {
  status: "idle" | "requesting" | "ready" | "recording" | "finalizing"
  error: string | null
  elapsed: number
  paused: boolean
  screenStream: MediaStream | null
  cameraStream: MediaStream | null
  /** Prompt the browser's screen/window/tab picker and hold the chosen stream. */
  pickScreen: () => Promise<boolean>
  /** Acquire (or re-acquire) the camera + mic stream for the live preview. */
  acquireCamera: (opts: CameraOptions) => Promise<boolean>
  /** Begin recording the already-acquired streams. */
  begin: () => boolean
  /** Pause or resume every active recorder and the elapsed timer together. */
  togglePaused: () => void
  stop: () => Promise<RecordingResult | null>
  cancel: () => void
}

export function useRecorder(): UseRecorder {
  const [status, setStatus] = useState<UseRecorder["status"]>("idle")
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)

  // Source streams, held from acquisition until recording begins.
  const displayRef = useRef<MediaStream | null>(null)
  const camRef = useRef<MediaStream | null>(null)

  const screenChanRef = useRef<RecorderChannel | null>(null)
  const cameraChanRef = useRef<RecorderChannel | null>(null)
  const audioChanRef = useRef<RecorderChannel | null>(null)
  const startTimeRef = useRef(0)
  const pausedAtRef = useRef<number | null>(null)
  const totalPausedRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const cleanupStreams = useCallback(() => {
    displayRef.current?.getTracks().forEach((t) => t.stop())
    camRef.current?.getTracks().forEach((t) => t.stop())
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    cleanupStreams()
    displayRef.current = null
    camRef.current = null
    screenChanRef.current = null
    cameraChanRef.current = null
    audioChanRef.current = null
    setScreenStream(null)
    setCameraStream(null)
    pausedAtRef.current = null
    totalPausedRef.current = 0
    setPaused(false)
    setStatus("idle")
    setElapsed(0)
  }, [cleanupStreams])

  // Screen capture — the browser shows its native tab/window/screen picker.
  // Held until the user starts recording so it can be shown in the preview.
  const pickScreen = useCallback(async () => {
    setError(null)
    setStatus("requesting")
    let display: MediaStream
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: true,
      })
    } catch (err) {
      setStatus("idle")
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Screen sharing was cancelled. Choose a screen, window, or tab to record.")
      } else {
        setError(
          "Couldn't start screen capture. This requires Chrome or Edge, and the page must be allowed to capture your screen.",
        )
      }
      return false
    }

    // Replace any previously-picked source.
    displayRef.current?.getTracks().forEach((t) => t.stop())
    displayRef.current = display
    setScreenStream(display)
    setStatus("ready")

    // If the user ends the share from the browser UI before recording starts,
    // clear it so the preview prompts them to choose again.
    display.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (screenChanRef.current) return // recording in progress — handled below
      displayRef.current?.getTracks().forEach((t) => t.stop())
      displayRef.current = null
      setScreenStream(null)
    })
    return true
  }, [])

  // Camera + mic (optional, separate stream = separate layer). Requesting a
  // high resolution keeps the composited overlay crisp after scaling. Called
  // during setup for the live preview and re-called when the device changes.
  const acquireCamera = useCallback(
    async ({ camera, micEnabled, cameraId, micId }: CameraOptions) => {
      // Drop any previous camera/mic stream first.
      camRef.current?.getTracks().forEach((t) => t.stop())
      camRef.current = null
      setCameraStream(null)

      if (!camera && !micEnabled) return true

      try {
        const cam = await navigator.mediaDevices.getUserMedia({
          video: camera
            ? {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 },
                ...(cameraId
                  ? { deviceId: { exact: cameraId } }
                  : { facingMode: "user" }),
              }
            : false,
          audio: micEnabled
            ? micId
              ? { deviceId: { exact: micId } }
              : true
            : false,
        })
        camRef.current = cam
        setCameraStream(cam)
        return true
      } catch {
        if (camera) {
          setError(
            "Camera or microphone access was blocked. Allow access in your browser to record a camera overlay.",
          )
        }
        return false
      }
    },
    [],
  )

  const begin = useCallback(() => {
    const display = displayRef.current
    if (!display) return false

    const cam = camRef.current
    const mimeType = pickMimeType()

    // Generous bitrates keep both layers sharp; the camera track especially,
    // since it gets scaled down into a small overlay during export.
    const screenRecorder = new MediaRecorder(display, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    })
    const screenChunks: Blob[] = []
    screenRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) screenChunks.push(e.data)
    }
    screenChanRef.current = { recorder: screenRecorder, chunks: screenChunks, stream: display }

    if (cam && cam.getVideoTracks().length > 0) {
      const cameraRecorder = new MediaRecorder(cam, {
        mimeType,
        videoBitsPerSecond: 6_000_000,
      })
      const cameraChunks: Blob[] = []
      cameraRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) cameraChunks.push(e.data)
      }
      cameraChanRef.current = { recorder: cameraRecorder, chunks: cameraChunks, stream: cam }
    } else {
      cameraChanRef.current = null
    }

    const captionAudioTrack = cam?.getAudioTracks()[0] ?? display.getAudioTracks()[0]
    if (captionAudioTrack) {
      const audioStream = new MediaStream([captionAudioTrack])
      const audioRecorder = new MediaRecorder(audioStream, {
        mimeType: pickAudioMimeType(),
        audioBitsPerSecond: 128_000,
      })
      const audioChunks: Blob[] = []
      audioRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunks.push(event.data)
      }
      audioChanRef.current = { recorder: audioRecorder, chunks: audioChunks, stream: audioStream }
    } else {
      audioChanRef.current = null
    }

    // If the user ends the share from the browser's own control, stop cleanly.
    display.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (screenChanRef.current?.recorder.state === "recording") {
        screenChanRef.current.recorder.requestData()
      }
    })

    screenRecorder.start(200)
    cameraChanRef.current?.recorder.start(200)
    audioChanRef.current?.recorder.start(200)

    startTimeRef.current = performance.now()
    pausedAtRef.current = null
    totalPausedRef.current = 0
    setPaused(false)
    setElapsed(0)
    timerRef.current = setInterval(() => {
      if (pausedAtRef.current !== null) return
      setElapsed(
        (performance.now() - startTimeRef.current - totalPausedRef.current) / 1000,
      )
    }, 100)

    setStatus("recording")
    return true
  }, [])

  const togglePaused = useCallback(() => {
    const channels = [screenChanRef.current, cameraChanRef.current, audioChanRef.current].filter(
      (channel): channel is RecorderChannel => channel !== null,
    )
    if (channels.length === 0) return

    const shouldResume = screenChanRef.current?.recorder.state === "paused"
    if (shouldResume) {
      channels.forEach(({ recorder }) => {
        if (recorder.state === "paused") recorder.resume()
      })
      if (pausedAtRef.current !== null) {
        totalPausedRef.current += performance.now() - pausedAtRef.current
        pausedAtRef.current = null
      }
      setPaused(false)
      return
    }

    channels.forEach(({ recorder }) => {
      if (recorder.state === "recording") recorder.pause()
    })
    pausedAtRef.current = performance.now()
    setPaused(true)
  }, [])

  const stop = useCallback(async (): Promise<RecordingResult | null> => {
    const screenChan = screenChanRef.current
    if (!screenChan) return null
    setStatus("finalizing")

    const pauseInProgress =
      pausedAtRef.current === null ? 0 : performance.now() - pausedAtRef.current
    const duration =
      (performance.now() - startTimeRef.current - totalPausedRef.current - pauseInProgress) /
      1000
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    const finalize = (chan: RecorderChannel): Promise<RecordedTrack> =>
      new Promise((resolve) => {
        chan.recorder.onstop = () => {
          const blob = new Blob(chan.chunks, { type: chan.recorder.mimeType })
          resolve({ blob, url: URL.createObjectURL(blob), mimeType: chan.recorder.mimeType })
        }
        if (chan.recorder.state !== "inactive") chan.recorder.stop()
        else {
          const blob = new Blob(chan.chunks, { type: chan.recorder.mimeType })
          resolve({ blob, url: URL.createObjectURL(blob), mimeType: chan.recorder.mimeType })
        }
      })

    const screen = await finalize(screenChan)
    const camera = cameraChanRef.current ? await finalize(cameraChanRef.current) : null
    const audio = audioChanRef.current ? await finalize(audioChanRef.current) : null

    cleanupStreams()
    displayRef.current = null
    camRef.current = null
    screenChanRef.current = null
    cameraChanRef.current = null
    audioChanRef.current = null
    setScreenStream(null)
    setCameraStream(null)
    pausedAtRef.current = null
    totalPausedRef.current = 0
    setPaused(false)
    setStatus("idle")

    return { screen, camera, audio, duration }
  }, [cleanupStreams])

  return {
    status,
    error,
    elapsed,
    paused,
    screenStream,
    cameraStream,
    pickScreen,
    acquireCamera,
    begin,
    togglePaused,
    stop,
    cancel,
  }
}
