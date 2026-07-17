import { transcribe } from "ai"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const media = form.get("media")
    if (!(media instanceof Blob) || media.size === 0) {
      return NextResponse.json({ error: "A recording is required" }, { status: 400 })
    }
    if (media.size > 100 * 1024 * 1024) {
      return NextResponse.json({ error: "Recording must be smaller than 100 MB" }, { status: 413 })
    }

    const result = await transcribe({
      model: "openai/gpt-4o-mini-transcribe",
      audio: new Uint8Array(await media.arrayBuffer()),
    })

    const segments = result.segments.length
      ? result.segments.map((segment, index) => ({
          id: `caption-${index}-${Math.round(segment.startSecond * 1000)}`,
          start: segment.startSecond,
          end: segment.endSecond,
          text: segment.text.trim(),
        }))
      : [{
          id: "caption-0",
          start: 0,
          end: result.durationInSeconds ?? 4,
          text: result.text.trim(),
        }]

    return NextResponse.json({ captions: segments.filter((segment) => segment.text) })
  } catch (error) {
    console.error("[v0] caption transcription failed:", error)
    return NextResponse.json({ error: "Could not generate captions" }, { status: 500 })
  }
}
