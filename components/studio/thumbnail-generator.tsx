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

async function composeThumbnail(base: string, logos: string[]): Promise<Blob> {
  const canvas = document.createElement("canvas")
  canvas.width = 1920
  canvas.height = 1080
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas is unavailable")

  const artwork = await loadImage(base)
  ctx.drawImage(artwork, 0, 0, canvas.width, canvas.height)

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

    marks.forEach(({ image }, index) => {
      const px = x + index * (size + gap)
      ctx.drawImage(image, px, y, size, size)
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
    composeThumbnail(frame, logos)
      .then((nextBlob) => {
        if (cancelled) return
        setBlob(nextBlob)
        setResult((current) => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(nextBlob) })
      })
      .catch(() => { if (!cancelled) setError("The thumbnail preview could not be created.") })
      .finally(() => { if (!cancelled) setIsComposing(false) })
    return () => { cancelled = true }
  }, [frame, logos])

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
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">The preview follows the current timeline frame. Scrub to choose another moment, then optionally add a product mark.</p>
      </div>

      <div className="relative aspect-video overflow-hidden rounded-md border border-border bg-secondary">
        {result ?? frame ? (
          <img src={result ?? frame ?? ""} alt="Thumbnail preview" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <ImageIcon className="size-6 text-muted-foreground" />
            <p className="text-xs font-medium">Loading current frame</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">The thumbnail preview will appear from the current playhead position.</p>
          </div>
        )}
        {frame && frameTime !== null && logos.length === 0 && (
          <span className="absolute bottom-2 left-2 rounded-sm bg-black/75 px-2 py-1 text-[11px] font-medium text-white">Frame at {formatTime(frameTime)}</span>
        )}
        {isComposing && <div className="absolute inset-0 flex items-center justify-center bg-black/30"><Loader2 className="size-5 animate-spin text-white" /></div>}
      </div>

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
