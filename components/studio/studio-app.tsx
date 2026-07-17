"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { AppSidebar } from "@/components/studio/app-sidebar"
import { Dashboard } from "@/components/studio/dashboard"
import { EditorScreen } from "@/components/studio/editor-screen"
import { RecordingScreen } from "@/components/studio/recording-screen"
import { SetupScreen } from "@/components/studio/setup-screen"
import { VideoViewScreen } from "@/components/studio/video-view-screen"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useDocumentPip } from "@/hooks/use-document-pip"
import { useRecorder } from "@/hooks/use-recorder"
import { useVoomExtension } from "@/hooks/use-voom-extension"
import {
  useSpeechRecognition,
  type SpeechTranscriptUpdate,
} from "@/hooks/use-speech-recognition"
import { alignTranscript, parseScript, transcriptToWords } from "@/lib/prompter"
import {
  DEFAULT_CAMERA_LAYOUT,
  type CameraLayout,
  type RecordingResult,
  type SavedVideo,
  type StudioMode,
} from "@/lib/studio-types"

interface StudioAppProps {
  /** Videos read on the server for the first paint (avoids a client fetch race). */
  initialVideos: SavedVideo[]
}

export function StudioApp({ initialVideos }: StudioAppProps) {
  const [mode, setMode] = useState<StudioMode>("dashboard")
  const [notes, setNotes] = useState("")
  const [fontSize, setFontSize] = useState(30)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [micEnabled, setMicEnabled] = useState(true)
  const [cameraId, setCameraId] = useState<string | undefined>(undefined)
  const [micId, setMicId] = useState<string | undefined>(undefined)
  const [prompterEnabled, setPrompterEnabled] = useState(false)
  const [layout, setLayout] = useState<CameraLayout>(DEFAULT_CAMERA_LAYOUT)
  const [recording, setRecording] = useState<RecordingResult | null>(null)
  const [selectedVideo, setSelectedVideo] = useState<SavedVideo | null>(null)
  const [extensionActive, setExtensionActive] = useState(false)

  const handleExtensionRecording = useCallback((result: RecordingResult) => {
    setRecording(result)
    setExtensionActive(false)
    setMode("editing")
  }, [])
  const extension = useVoomExtension(handleExtensionRecording)

  const [cursor, setCursor] = useState(0)
  const cursorRef = useRef(0)

  const script = useMemo(() => parseScript(notes), [notes])
  const scriptRef = useRef(script)
  useEffect(() => {
    scriptRef.current = script
  }, [script])

  const setCursorBoth = useCallback((next: number) => {
    cursorRef.current = next
    setCursor(next)
  }, [])

  const handleTranscript = useCallback(
    ({ finalTranscript, interimTranscript }: SpeechTranscriptUpdate) => {
      const spoken = transcriptToWords(`${finalTranscript} ${interimTranscript}`)
      const next = alignTranscript(scriptRef.current.words, spoken)
      setCursorBoth(next)
    },
    [setCursorBoth],
  )

  const { supported, listening, start, stop, reset } = useSpeechRecognition({
    onTranscript: handleTranscript,
  })

  const recorder = useRecorder()
  const pip = useDocumentPip()

  // Prefer the extension's private overlay, but retain Document PiP when the
  // extension is unavailable so controls can still follow the shared tab.
  const handlePrompterEnabled = useCallback(
    (enabled: boolean) => {
      setPrompterEnabled(enabled)
      if (enabled && !extension.available) {
        void pip.open()
      } else if (!enabled) {
        stop()
        reset()
        setCursorBoth(0)
        pip.close()
      }
    },
    [extension.available, pip, stop, reset, setCursorBoth],
  )

  // Open the browser's screen/window picker; the chosen source shows live in
  // the setup preview. Streams are held until the user starts recording.
  const pickScreen = useCallback(() => {
    void recorder.pickScreen()
  }, [recorder])

  // Prefer the extension recorder: it captures the tab while rendering Voom's
  // controls in a private Shadow DOM overlay. Fall back to browser screen capture.
  const startRecording = useCallback(async () => {
    setCursorBoth(0)
    reset()
    if (extension.available) {
      const ok = await extension.start({
        cameraEnabled,
        micEnabled,
        teleprompterEnabled: prompterEnabled,
        script: notes,
        fontSize,
      })
      if (!ok) return
      setExtensionActive(true)
      setMode("recording")
      return
    }

    const ok = recorder.begin()
    if (!ok) return
    if (prompterEnabled && supported) start()
    setMode("recording")
    if (pip.supported && !pip.isOpen) {
      void pip.open(
        prompterEnabled && notes.trim().length > 0
          ? undefined
          : { width: 72, height: 164 },
      )
    }
  }, [cameraEnabled, extension, fontSize, micEnabled, notes, pip, prompterEnabled, recorder, reset, setCursorBoth, start, supported])

  const stopRecording = useCallback(async () => {
    stop()
    pip.close()
    if (extensionActive) {
      await extension.stop()
      return
    }
    const result = await recorder.stop()
    if (result) {
      setRecording(result)
      setMode("editing")
    } else {
      setMode("setup")
    }
  }, [stop, pip, extensionActive, extension, recorder])

  const cleanupRecording = useCallback(() => {
    if (recording) {
      URL.revokeObjectURL(recording.screen.url)
      if (recording.camera) URL.revokeObjectURL(recording.camera.url)
    }
    setRecording(null)
    setCursorBoth(0)
  }, [recording, setCursorBoth])

  // "Record again" from the editor — start a fresh setup.
  const resetStudio = useCallback(() => {
    cleanupRecording()
    setMode("setup")
  }, [cleanupRecording])

  // After saving, or leaving the editor/setup — release any live streams and
  // return to the library.
  const goToDashboard = useCallback(() => {
    recorder.cancel()
    pip.close()
    setPrompterEnabled(false)
    cleanupRecording()
    setSelectedVideo(null)
    setMode("dashboard")
  }, [recorder, pip, cleanupRecording])

  const openSavedVideo = useCallback((video: SavedVideo) => {
    setSelectedVideo(video)
    setMode("viewing")
  }, [])

  const editSavedVideo = useCallback(async () => {
    if (!selectedVideo) return
    try {
      const response = await fetch(selectedVideo.url)
      if (!response.ok) throw new Error("Could not load the saved video")
      const blob = await response.blob()
      setRecording({
        screen: {
          blob,
          url: URL.createObjectURL(blob),
          mimeType: blob.type || "video/mp4",
        },
        camera: null,
        duration: selectedVideo.duration_seconds,
      })
      setMode("editing")
    } catch (error) {
      console.error("[v0] saved video load failed:", error)
    }
  }, [selectedVideo])

  // Record button on the dashboard.
  const startNewRecording = useCallback(() => {
    setSelectedVideo(null)
    setMode("setup")
  }, [])

  const renderShell = (content: ReactNode) => (
    <SidebarProvider>
      <AppSidebar
        mode={mode}
        onLibrary={goToDashboard}
        onRecord={startNewRecording}
      />
      <SidebarInset className="min-w-0">
        <header className="flex h-12 shrink-0 items-center border-b border-border px-3">
          <SidebarTrigger aria-label="Toggle navigation" />
        </header>
        {content}
      </SidebarInset>
    </SidebarProvider>
  )

  // Prompter navigation helpers (used while recording).
  const togglePause = useCallback(() => {
    if (listening) stop()
    else {
      reset()
      start()
    }
  }, [listening, stop, start, reset])

  const toggleRecordingPause = useCallback(() => {
    if (extensionActive) {
      void (extension.status === "paused" ? extension.resume() : extension.pause())
      return
    }
    if (recorder.paused) {
      recorder.togglePaused()
      if (prompterEnabled && supported) {
        reset()
        start()
      }
    } else {
      if (listening) stop()
      recorder.togglePaused()
    }
  }, [extensionActive, extension, recorder, prompterEnabled, supported, listening, reset, start, stop])

  const goPrevLine = useCallback(() => {
    const { words, lines } = scriptRef.current
    if (words.length === 0) return
    const clamped = Math.min(cursorRef.current, words.length - 1)
    const lineIndex = words[clamped]?.lineIndex ?? 0
    const target = lines[Math.max(0, lineIndex - 1)]?.startWord ?? 0
    setCursorBoth(target)
  }, [setCursorBoth])

  const goNextLine = useCallback(() => {
    const { words, lines } = scriptRef.current
    if (words.length === 0) return
    const clamped = Math.min(cursorRef.current, words.length - 1)
    const lineIndex = words[clamped]?.lineIndex ?? 0
    const target = lines[lineIndex + 1]?.startWord ?? words.length
    setCursorBoth(target)
  }, [setCursorBoth])

  const restart = useCallback(() => {
    reset()
    setCursorBoth(0)
  }, [reset, setCursorBoth])

  // Keyboard shortcuts while recording.
  useEffect(() => {
    if (mode !== "recording" || !prompterEnabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault()
        if (supported) togglePause()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        goPrevLine()
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        goNextLine()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mode, prompterEnabled, supported, togglePause, goPrevLine, goNextLine])

  if (mode === "dashboard") {
    return renderShell(
      <Dashboard
        onRecord={startNewRecording}
        onOpenVideo={openSavedVideo}
        initialVideos={initialVideos}
      />,
    )
  }

  if (mode === "viewing" && selectedVideo) {
    return renderShell(
      <VideoViewScreen
        video={selectedVideo}
        onBack={goToDashboard}
        onEdit={() => void editSavedVideo()}
      />,
    )
  }

  if (mode === "editing" && recording) {
    return renderShell(
      <EditorScreen
        recording={recording}
        initialLayout={layout}
        sourceVideo={selectedVideo}
        onReset={resetStudio}
        onSaved={(saved) => {
          cleanupRecording()
          if (saved) {
            setSelectedVideo(saved)
            setMode("viewing")
          } else {
            goToDashboard()
          }
        }}
      />,
    )
  }

  if (mode === "recording") {
    return renderShell(
      <RecordingScreen
        elapsed={extensionActive ? extension.elapsedMs / 1000 : recorder.elapsed}
        recordingPaused={extensionActive ? extension.status === "paused" : recorder.paused}
        onToggleRecordingPaused={toggleRecordingPause}
        cameraStream={recorder.cameraStream}
        cameraEnabled={cameraEnabled}
        prompterEnabled={prompterEnabled}
        onStop={stopRecording}
        script={script}
        cursor={cursor}
        fontSize={fontSize}
        listening={listening}
        micSupported={supported}
        onTogglePause={togglePause}
        onPrevLine={goPrevLine}
        onNextLine={goNextLine}
        onRestart={restart}
        pipOpen={pip.isOpen}
        pipContainer={pip.container}
      />,
    )
  }

  return (
    <>
      {renderShell(
        <SetupScreen
          screenStream={recorder.screenStream}
          cameraStream={recorder.cameraStream}
          screenBusy={recorder.status === "requesting"}
          onPickScreen={pickScreen}
          acquireCamera={recorder.acquireCamera}
          cameraEnabled={cameraEnabled}
          onCameraEnabled={setCameraEnabled}
          micEnabled={micEnabled}
          onMicEnabled={setMicEnabled}
          cameraId={cameraId}
          onCameraId={setCameraId}
          micId={micId}
          onMicId={setMicId}
          layout={layout}
          onLayout={setLayout}
          prompterEnabled={prompterEnabled}
          onPrompterEnabled={handlePrompterEnabled}
          notes={notes}
          onNotes={setNotes}
          fontSize={fontSize}
          onFontSize={setFontSize}
          micSupported={supported}
          extensionAvailable={extension.available}
          extensionVersion={extension.version}
          onStart={startRecording}
          onBack={goToDashboard}
          error={recorder.error}
        />,
      )}
    </>
  )
}
