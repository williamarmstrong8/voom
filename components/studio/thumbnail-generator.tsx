"use client"

import { useMemo, useState } from "react"
import { Check, Download, ImageIcon, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const LOGOS = [
  ["vercel", "Vercel"], ["nextjs", "Next.js"], ["v0", "v0"], ["vercel-blob", "Vercel Blob"],
  ["turborepo", "Turborepo"], ["swr", "SWR"], ["react", "React"], ["typescript", "TypeScript"],
  ["tailwindcss", "Tailwind CSS"], ["shadcn-ui", "shadcn/ui"], ["prisma", "Prisma"], ["neon", "Neon"],
  ["stripe", "Stripe"], ["figma", "Figma"], ["github", "GitHub"], ["supabase", "Supabase"],
] as const

const logoUrl = (slug: string) => `https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/${slug}/default.svg`

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
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas is unavailable")
  const artwork = await loadImage(base)
  ctx.drawImage(artwork, 0, 0, canvas.width, canvas.height)
  const loaded = (await Promise.allSettled(logos.map((slug) => loadImage(logoUrl(slug)))))
    .flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
  if (loaded.length) {
    const size = 54
    const gap = 14
    const width = loaded.length * size + (loaded.length - 1) * gap + 32
    const x = canvas.width - width - 34
    ctx.fillStyle = "rgba(0,0,0,.78)"
    ctx.beginPath()
    ctx.roundRect(x, 30, width, size + 28, 16)
    ctx.fill()
    loaded.forEach((image, index) => {
      const px = x + 16 + index * (size + gap)
      ctx.fillStyle = "white"
      ctx.beginPath()
      ctx.roundRect(px, 44, size, size, 10)
      ctx.fill()
      ctx.drawImage(image, px + 8, 52, size - 16, size - 16)
    })
  }
  return await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create PNG")), "image/png"))
}

interface ThumbnailGeneratorProps {
  frames: string[]
  title: string
  onUse: (thumbnail: Blob) => void
}

export function ThumbnailGenerator({ frames, title, onUse }: ThumbnailGeneratorProps) {
  const choices = useMemo(() => frames.filter(Boolean).slice(0, 8), [frames])
  const [frame, setFrame] = useState(choices[0] ?? "")
  const [summary, setSummary] = useState("")
  const [logos, setLogos] = useState<string[]>([])
  const [result, setResult] = useState<string | null>(null)
  const [phase, setPhase] = useState<"idle" | "generating" | "ready" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const generate = async () => {
    if (!frame || !summary.trim()) return
    setPhase("generating")
    setError(null)
    try {
      const response = await fetch("/api/thumbnail/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frame, summary }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Generation failed")
      const blob = await composeThumbnail(data.image, logos)
      setResult(URL.createObjectURL(blob))
      setPhase("ready")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Generation failed")
      setPhase("error")
    }
  }

  const useAndDownload = async () => {
    if (!result) return
    const blob = await (await fetch(result)).blob()
    onUse(blob)
    const link = document.createElement("a")
    link.href = result
    link.download = `${title.trim() || "video"}-thumbnail.png`
    link.click()
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-semibold">AI thumbnail</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Turn a recording frame into a minimal Vercel-themed cover.</p>
      </div>
      {result ? <img src={result} alt="Generated thumbnail preview" className="aspect-video w-full rounded-md border object-cover" /> : <div className="flex aspect-video items-center justify-center rounded-md border bg-secondary"><ImageIcon className="size-6 text-muted-foreground" /></div>}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium">Choose a frame</span>
        <div className="grid grid-cols-4 gap-2">
          {choices.map((src, index) => <button type="button" key={src + index} onClick={() => setFrame(src)} className={cn("relative aspect-video overflow-hidden rounded-sm border-2", frame === src ? "border-foreground" : "border-transparent")}><img src={src} alt={`Video frame ${index + 1}`} className="h-full w-full object-cover" />{frame === src && <Check className="absolute right-1 top-1 size-3 rounded-full bg-black p-0.5 text-white" />}</button>)}
        </div>
      </div>
      <label className="flex flex-col gap-2 text-xs font-medium">What is this video about?<textarea value={summary} onChange={(event) => setSummary(event.target.value.slice(0, 500))} placeholder="A fast walkthrough of deploying an AI app with Next.js..." rows={4} className="resize-none rounded-sm border border-border bg-background px-3 py-2 text-sm font-normal outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground" /></label>
      <div className="flex flex-col gap-2"><span className="text-xs font-medium">Brand marks <span className="font-normal text-muted-foreground">(optional)</span></span><div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">{LOGOS.map(([slug, label]) => { const active = logos.includes(slug); return <button type="button" key={slug} onClick={() => setLogos((current) => active ? current.filter((item) => item !== slug) : [...current, slug].slice(-5))} className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", active ? "border-foreground bg-foreground text-background" : "hover:bg-secondary")}>{label}</button> })}</div><p className="text-[11px] text-muted-foreground">Choose up to 5. Official marks are overlaid exactly after generation.</p></div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {result ? <div className="flex gap-2"><Button onClick={useAndDownload} className="flex-1 gap-2"><Download className="size-4" />Use & download</Button><Button variant="secondary" onClick={generate} disabled={phase === "generating"}>Regenerate</Button></div> : <Button onClick={generate} disabled={!frame || !summary.trim() || phase === "generating"} className="gap-2">{phase === "generating" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{phase === "generating" ? "Generating…" : "Generate thumbnail"}</Button>}
    </div>
  )
}
