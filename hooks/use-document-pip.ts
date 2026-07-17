"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// Document Picture-in-Picture is not yet in the standard TS DOM lib.
interface DocumentPictureInPictureOptions {
  width?: number
  height?: number
  disallowReturnToOpener?: boolean
  preferInitialWindowPlacement?: boolean
}
interface DocumentPictureInPicture extends EventTarget {
  readonly window: Window | null
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>
}

function getPipApi(): DocumentPictureInPicture | null {
  if (typeof window === "undefined") return null
  return (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture })
    .documentPictureInPicture ?? null
}

/** Copy the opener's styles into the PiP window so Tailwind/theme applies. */
function cloneStyles(target: Window) {
  // Carry over the font/theme variables, but deliberately remove the opener's
  // bg-background utility: the floating window needs a transparent canvas so
  // the pill's translucent glass surface can composite over other windows.
  target.document.documentElement.className = document.documentElement.className
    .split(/\s+/)
    .filter((className) => className && className !== "bg-background")
    .join(" ")
  target.document.body.className = document.body.className

  for (const styleSheet of Array.from(document.styleSheets)) {
    try {
      const cssText = Array.from(styleSheet.cssRules)
        .map((rule) => rule.cssText)
        .join("")
      const style = target.document.createElement("style")
      style.textContent = cssText
      target.document.head.appendChild(style)
    } catch {
      // Cross-origin sheet: link it instead.
      if (styleSheet.href) {
        const link = target.document.createElement("link")
        link.rel = "stylesheet"
        link.type = styleSheet.type
        if (styleSheet.media.length) link.media = styleSheet.media.mediaText
        link.href = styleSheet.href
        target.document.head.appendChild(link)
      }
    }
  }
}

export interface UseDocumentPip {
  supported: boolean
  isOpen: boolean
  /** The PiP document body to portal content into (null when closed). */
  container: HTMLElement | null
  open: (options?: DocumentPictureInPictureOptions) => Promise<void>
  close: () => void
}

export function useDocumentPip(onClose?: () => void): UseDocumentPip {
  const [supported, setSupported] = useState(false)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const windowRef = useRef<Window | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    setSupported(getPipApi() !== null)
  }, [])

  const close = useCallback(() => {
    const win = windowRef.current
    if (win) {
      windowRef.current = null
      win.close()
    }
    setContainer(null)
  }, [])

  const open = useCallback(async (options?: DocumentPictureInPictureOptions) => {
    const api = getPipApi()
    if (!api) return
    if (windowRef.current) return

    const width = options?.width ?? 480
    const height = options?.height ?? 208

    const pipWindow = await api.requestWindow({
      width,
      height,
      disallowReturnToOpener: false,
      preferInitialWindowPlacement: false,
      ...options,
    })
    windowRef.current = pipWindow

    // Prefer the top center of the same display as the opener. Using the
    // opener's global screen coordinates preserves multi-monitor offsets,
    // unlike screen.availWidth alone (which incorrectly centers on display 1).
    // Chromium and the OS may still constrain Document PiP placement, so retry
    // after its native frame has finished initializing.
    const positionTopCenter = () => {
      if (pipWindow.closed) return
      try {
        const screenInfo = window.screen as Screen & {
          availLeft?: number
          availTop?: number
        }
        const displayLeft = screenInfo.availLeft ?? window.screenX
        const x = Math.round(displayLeft + (screenInfo.availWidth - width) / 2)
        const y = screenInfo.availTop ?? window.screenY
        pipWindow.resizeTo(width, height)
        pipWindow.moveTo(x, y)
      } catch {
        // Positioning not permitted — the window stays at the OS default spot.
      }
    }
    positionTopCenter()
    window.setTimeout(positionTopCenter, 80)
    window.setTimeout(positionTopCenter, 250)

    cloneStyles(pipWindow)
    pipWindow.document.title = "Voom recording controls"
    // The copied base stylesheet paints body with bg-background. Inline
    // important overrides keep the OS window canvas transparent; the pill
    // supplies the readable translucent surface itself.
    pipWindow.document.documentElement.style.setProperty(
      "background",
      "transparent",
      "important",
    )
    pipWindow.document.body.style.setProperty("background", "transparent", "important")
    pipWindow.document.body.style.margin = "0"
    pipWindow.document.body.style.overflow = "hidden"

    pipWindow.addEventListener("pagehide", () => {
      windowRef.current = null
      setContainer(null)
      onCloseRef.current?.()
    })

    setContainer(pipWindow.document.body)
  }, [])

  useEffect(() => {
    return () => {
      const win = windowRef.current
      windowRef.current = null
      if (win) {
        try {
          win.close()
        } catch {
          // ignore
        }
      }
    }
  }, [])

  return { supported, isOpen: container !== null, container, open, close }
}
