"use client"

import { useCallback, useEffect, useState } from "react"

export interface DeviceOption {
  deviceId: string
  label: string
}

export interface UseMediaDevices {
  cameras: DeviceOption[]
  mics: DeviceOption[]
  /** Re-read the device list. Call after permission is granted to get labels. */
  refresh: () => Promise<void>
}

/**
 * Enumerates the available camera / microphone inputs. It intentionally does
 * NOT open its own media stream — the recorder owns the live camera/mic stream
 * (used for both the preview and the recording), so opening another here would
 * double-acquire the camera. Device labels stay hidden until permission is
 * granted, so call `refresh()` after the recorder acquires a stream.
 */
export function useMediaDevices(): UseMediaDevices {
  const [cameras, setCameras] = useState<DeviceOption[]>([])
  const [mics, setMics] = useState<DeviceOption[]>([])

  const refresh = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setCameras(
        devices
          .filter((d) => d.kind === "videoinput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Camera ${i + 1}`,
          })),
      )
      setMics(
        devices
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Microphone ${i + 1}`,
          })),
      )
    } catch {
      // Ignore — enumeration can fail before permission is granted.
    }
  }, [])

  useEffect(() => {
    void refresh()
    const handler = () => void refresh()
    navigator.mediaDevices.addEventListener("devicechange", handler)
    return () =>
      navigator.mediaDevices.removeEventListener("devicechange", handler)
  }, [refresh])

  return { cameras, mics, refresh }
}
