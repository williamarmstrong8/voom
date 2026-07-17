"use client"

import { useCallback, useRef, useState } from "react"

// Loaded lazily so the ~30MB wasm core is only fetched when the user exports.
const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd"

export interface UseFfmpeg {
  ready: boolean
  loading: boolean
  progress: number
  transcodeToMp4: (input: Blob, onLog?: (msg: string) => void) => Promise<Blob>
}

export function useFfmpeg(): UseFfmpeg {
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  // Keep the FFmpeg instance across calls.
  const ffmpegRef = useRef<import("@ffmpeg/ffmpeg").FFmpeg | null>(null)

  const load = useCallback(async () => {
    if (ffmpegRef.current) return ffmpegRef.current
    setLoading(true)
    const { FFmpeg } = await import("@ffmpeg/ffmpeg")
    const { toBlobURL } = await import("@ffmpeg/util")
    const ffmpeg = new FFmpeg()
    ffmpeg.on("progress", ({ progress: p }) => {
      setProgress(Math.max(0, Math.min(1, p)))
    })
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    })
    ffmpegRef.current = ffmpeg
    setReady(true)
    setLoading(false)
    return ffmpeg
  }, [])

  const transcodeToMp4 = useCallback(
    async (input: Blob, onLog?: (msg: string) => void): Promise<Blob> => {
      const ffmpeg = await load()
      const { fetchFile } = await import("@ffmpeg/util")
      if (onLog) {
        ffmpeg.on("log", ({ message }) => onLog(message))
      }
      setProgress(0)
      await ffmpeg.writeFile("input.webm", await fetchFile(input))
      // Re-encode to widely compatible H.264 + AAC in an MP4 container.
      await ffmpeg.exec([
        "-i",
        "input.webm",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "output.mp4",
      ])
      const data = await ffmpeg.readFile("output.mp4")
      const uint8 = data as Uint8Array
      // Copy into a fresh ArrayBuffer to satisfy strict BlobPart typing.
      const buffer = new Uint8Array(uint8.byteLength)
      buffer.set(uint8)
      return new Blob([buffer], { type: "video/mp4" })
    },
    [load],
  )

  return { ready, loading, progress, transcodeToMp4 }
}
