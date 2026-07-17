import { gateway, transcribe } from "ai"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 60

type TimedText = { text: string; startSecond: number; endSecond: number }

function chunkTimedText(segment: TimedText): TimedText[] {
  const words = segment.text.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return []

  const duration = Math.max(0.25, segment.endSecond - segment.startSecond)
  const chunks: string[][] = []
  let current: string[] = []

  for (const word of words) {
    const candidate = [...current, word].join(" ")
    const endsPhrase = /[.!?;:]$/.test(word)
    if (current.length && (candidate.length > 46 || current.length >= 8)) {
      chunks.push(current)
      current = [word]
    } else {
      current.push(word)
    }
    if (endsPhrase && current.length >= 3) {
      chunks.push(current)
      current = []
    }
  }
  if (current.length) chunks.push(current)

  let consumedWords = 0
  return chunks.map((chunk) => {
    const startSecond = segment.startSecond + duration * (consumedWords / words.length)
    consumedWords += chunk.length
    const endSecond = segment.startSecond + duration * (consumedWords / words.length)
    return { text: chunk.join(" "), startSecond, endSecond }
  })
}

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const candidates = form.getAll("media").filter((value): value is File => value instanceof File && value.size > 0)
    if (!candidates.length) {
      return NextResponse.json({ error: "A recording is required" }, { status: 400 })
    }

    const model = gateway.transcriptionModel("openai/gpt-4o-mini-transcribe")
    let result: Awaited<ReturnType<typeof transcribe>> | null = null
    let lastError: unknown = null

    for (const media of candidates) {
      if (media.size > 25 * 1024 * 1024) continue
      try {
        result = await transcribe({
          model,
          audio: new Uint8Array(await media.arrayBuffer()),
        })
        if (result.text.trim()) break
      } catch (error) {
        lastError = error
      }
    }

    if (!result?.text.trim()) {
      if (candidates.every((media) => media.size > 25 * 1024 * 1024)) {
        return NextResponse.json({ error: "This recording is too large to caption. Try a recording under 30 seconds." }, { status: 413 })
      }
      throw lastError ?? new Error("No speech was found in the recording audio")
    }

    const timedSource: TimedText[] = result.segments.length
      ? result.segments
      : [{
          text: result.text.trim(),
          startSecond: 0,
          endSecond: result.durationInSeconds ?? Math.max(4, result.text.trim().split(/\s+/).length / 2.5),
        }]

    const captions = timedSource.flatMap(chunkTimedText).map((segment, index) => ({
      id: `caption-${index}-${Math.round(segment.startSecond * 1000)}`,
      start: segment.startSecond,
      end: segment.endSecond,
      text: segment.text,
    }))

    return NextResponse.json({ captions })
  } catch (error) {
    console.error("[v0] caption transcription failed:", error)
    const message = error instanceof Error ? error.message : ""
    const userMessage = /audio|media|format|decode|transcript/i.test(message)
      ? "The recording audio could not be transcribed. Try recording again with microphone or tab audio enabled."
      : "Captioning is temporarily unavailable. Please try again."
    return NextResponse.json({ error: userMessage }, { status: 502 })
  }
}
