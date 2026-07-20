"use client"

import { useEffect, useState } from "react"
import { Check, Download, ImageIcon, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const LOGOS = [
  { id: "v0-dark", label: "v0 · dark mark", src: "/brand/v0-logo-light.png", remove: "light" },
  { id: "v0-light", label: "v0 · light mark", src: "/brand/v0-logo-dark.webp", remove: "dark" },
] as const

const getLogo = (id: string) => LOGOS.find((logo) => logo.id === id)

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`
}

async function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

async function composeThumbnail(base: string, title: string, logos: string[]): Promise<Blob> {
  const canvas = document.createElement("canvas")
  canvas.width = 1920
  canvas.height = 1080
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas is unavailable")

  const artwork = await loadImage(base)
  ctx.drawImage(artwork, 0, 0, canvas.width, canvas.height)

  const cleanTitle = title.trim()
  if (cleanTitle) {
    ctx.font = "600 80px Geist, Arial, sans-serif"
    const words = cleanTitle.split(/\s+/)
    const lines: string[] = []
    let line = ""
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (ctx.measureText(candidate).width > 1320 && line) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    if (line) lines.push(line)
    const visibleLines = lines.slice(0, 2)
    const panelWidth = Math.min(1460, Math.max(...visibleLines.map((item) => ctx.measureText(item).width), 480) + 88)
    const panelHeight = visibleLines.length * 96 + 56
    const x = 58
    const y = canvas.height - panelHeight - 58
    ctx.fillStyle = "rgba(0,0,0,.82)"
    ctx.beginPath(); ctx.roundRect(x, y, panelWidth, panelHeight, 24); ctx.fill()
    ctx.fillStyle = "#fff"
    visibleLines.forEach((item, index) => ctx.fillText(item, x + 44, y + 94 + index * 96))
  }

  const selectedLogos = logos.flatMap((id) => {
    const logo = getLogo(id)
    return logo ? [logo] : []
  })
  const loaded = await Promise.allSettled(selectedLogos.map((logo) => loadImage(logo.src)))
  const marks = loaded.flatMap((result, index) => result.status === "fulfilled" ? [{ image: result.value, logo: selectedLogos[index] }] : [])
  if (marks.length) {
    const size = 220
    const gap = 22
    const width = marks.length * size + (marks.length - 1) * gap
    const x = canvas.width - width - 52
    const y = 46

    marks.forEach(({ image, logo }, index) => {
      const source = document.createElement("canvas")
      source.width = image.naturalWidth
      source.height = image.naturalHeight
      const sourceContext = source.getContext("2d", { willReadFrequently: true })
      if (!sourceContext) return
      sourceContext.drawImage(image, 0, 0)
      const pixels = sourceContext.getImageData(0, 0, source.width, source.height)
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        const red = pixels.data[offset]
        const green = pixels.data[offset + 1]
        const blue = pixels.data[offset + 2]
        const remove = logo.remove === "light" ? Math.min(red, green, blue) > 245 : Math.max(red, green, blue) < 10
        if (remove) pixels.data[offset + 3] = 0
      }
      sourceContext.putImageData(pixels, 0, 0)
      const px = x + index * (size + gap)
      ctx.drawImage(source, px, y, size, size)
    })
  }

  return await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create PNG")), "image/png"))
}

interface ThumbnailGeneratorProps {
  frame: string | null
  frameTime: number | null
  title: string
  onUse: (thumbnail: Blob) => void
}

export function ThumbnailGenerator({ frame, frameTime, title, onUse }: ThumbnailGeneratorProps) {
  const [overlayTitle, setOverlayTitle] = useState("")
  const [logos, setLogos] = useState<string[]>([])
  const [result, setResult] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [isComposing, setIsComposing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!frame) {
      setResult((current) => { if (current) URL.revokeObjectURL(current); return null })
      setBlob(null)
      return
    }
    setIsComposing(true)
    setError(null)
    composeThumbnail(frame, overlayTitle, logos)
      .then((nextBlob) => {
        if (cancelled) return
        setBlob(nextBlob)
        setResult((current) => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(nextBlob) })
      })
      .catch(() => { if (!cancelled) setError("The thumbnail preview could not be created.") })
      .finally(() => { if (!cancelled) setIsComposing(false) })
    return () => { cancelled = true }
  }, [frame, logos, overlayTitle])

  useEffect(() => () => { if (result) URL.revokeObjectURL(result) }, [result])

  const useAndDownload = () => {
    if (!blob || !result) return
    onUse(blob)
    const link = document.createElement("a")
    link.href = result
    link.download = `${title.trim() || "video"}-thumbnail.png`
    link.click()
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-semibold">Thumbnail</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Use the selected video frame, then add a title or product marks.</p>
      </div>

      <div className="relative aspect-video overflow-hidden rounded-md border border-border bg-secondary">
        {result ?? frame ? (
          <img src={result ?? frame ?? ""} alt="Thumbnail preview" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <ImageIcon className="size-6 text-muted-foreground" />
            <p className="text-xs font-medium">No frame selected</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">Move the playhead and select the frame above the timeline.</p>
          </div>
        )}
        {frame && frameTime !== null && !overlayTitle && logos.length === 0 && (
          <span className="absolute bottom-2 left-2 rounded-sm bg-black/75 px-2 py-1 text-[11px] font-medium text-white">Frame at {formatTime(frameTime)}</span>
        )}
        {isComposing && <div className="absolute inset-0 flex items-center justify-center bg-black/30"><Loader2 className="size-5 animate-spin text-white" /></div>}
      </div>

      <label className="flex flex-col gap-2 text-xs font-medium">
        Title <span className="font-normal text-muted-foreground">(optional)</span>
        <input value={overlayTitle} onChange={(event) => setOverlayTitle(event.target.value.slice(0, 80))} placeholder="Add a short title" className="h-10 rounded-sm border border-border bg-background px-3 text-sm font-normal outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground" />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium">Product marks <span className="font-normal text-muted-foreground">(optional)</span></span>
        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto pr-1">
          {LOGOS.map((logo) => {
            const active = logos.includes(logo.id)
            return (
              <button
                type="button"
                key={logo.id}
                onClick={() => setLogos((current) => active ? current.filter((item) => item !== logo.id) : [...current, logo.id].slice(-5))}
                className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors", active ? "border-foreground bg-foreground text-background" : "hover:bg-secondary")}
              >
                <span className={cn("flex size-6 items-center justify-center overflow-hidden rounded-full", logo.remove === "light" ? "bg-white" : "bg-black")}>
                  <img src={logo.src} alt="" className="size-6 object-cover" />
                </span>
                {active && <Check className="size-3" />}{logo.label}
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">Choose the black or white v0 mark for the best contrast.</p>
      </div>

      {error && <p role="alert" className="rounded-sm border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      <Button onClick={useAndDownload} disabled={!blob || isComposing} className="gap-2">
        {isComposing ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {frame ? "Use & download" : "Select a timeline frame first"}
      </Button>
    </div>
  )
}
