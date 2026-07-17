"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// Minimal typings for the Web Speech API (not in standard TS lib DOM).
interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  item(index: number): { transcript: string; confidence: number }
  [index: number]: { transcript: string; confidence: number }
}
interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string
  readonly message: string
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export interface SpeechTranscriptUpdate {
  /** Stable results that the browser will no longer revise. */
  finalTranscript: string
  /** Current replaceable hypothesis; may change or shrink on every event. */
  interimTranscript: string
}

export interface UseSpeechRecognitionOptions {
  lang?: string
  /** Called with stable and replaceable speech results kept separate. */
  onTranscript?: (update: SpeechTranscriptUpdate) => void
}

export interface UseSpeechRecognition {
  supported: boolean
  listening: boolean
  error: string | null
  start: () => void
  stop: () => void
  reset: () => void
}

export function useSpeechRecognition({
  lang = "en-US",
  onTranscript,
}: UseSpeechRecognitionOptions): UseSpeechRecognition {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const finalTranscriptRef = useRef("")
  const wantListeningRef = useRef(false)
  const onTranscriptRef = useRef(onTranscript)

  useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null)
  }, [])

  const reset = useCallback(() => {
    finalTranscriptRef.current = ""
  }, [])

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      setError("Speech recognition is not supported in this browser.")
      return
    }
    if (recognitionRef.current) return

    const recognition = new Ctor()
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ""
        if (result.isFinal) {
          finalTranscriptRef.current += text + " "
        } else {
          interim += text + " "
        }
      }
      onTranscriptRef.current?.({
        finalTranscript: finalTranscriptRef.current,
        interimTranscript: interim,
      })
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech" || event.error === "aborted") return
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access was blocked. Allow mic access to enable auto-scroll.")
        wantListeningRef.current = false
      } else {
        setError(`Speech recognition error: ${event.error}`)
      }
    }

    recognition.onend = () => {
      // Chrome stops periodically; restart if the user still wants to listen.
      if (wantListeningRef.current && recognitionRef.current) {
        try {
          recognitionRef.current.start()
          return
        } catch {
          // fall through to stopped state
        }
      }
      setListening(false)
    }

    recognitionRef.current = recognition
    wantListeningRef.current = true
    setError(null)
    try {
      recognition.start()
      setListening(true)
    } catch {
      // start() throws if already started — ignore.
    }
  }, [lang])

  const stop = useCallback(() => {
    wantListeningRef.current = false
    const recognition = recognitionRef.current
    recognitionRef.current = null
    setListening(false)
    if (recognition) {
      recognition.onend = null
      try {
        recognition.stop()
      } catch {
        // ignore
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      wantListeningRef.current = false
      const recognition = recognitionRef.current
      recognitionRef.current = null
      if (recognition) {
        recognition.onend = null
        try {
          recognition.abort()
        } catch {
          // ignore
        }
      }
    }
  }, [])

  return { supported, listening, error, start, stop, reset }
}
