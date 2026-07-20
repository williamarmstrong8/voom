import { generateImage } from "ai"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { summary?: string; frame?: string }
    const summary = body.summary?.trim()
    if (!summary || summary.length > 500 || !body.frame?.startsWith("data:image/")) {
      return NextResponse.json({ error: "Choose a frame and enter a summary." }, { status: 400 })
    }

    const result = await generateImage({
      model: "google/gemini-3.1-flash-image-preview",
      prompt: {
        text: `Create a polished 16:9 YouTube/video thumbnail using the attached recording frame as the visual source. Topic: ${summary}. Minimal Vercel design language: crisp black, white and neutral gray, strong negative space, subtle grid or light geometry, premium developer-tool aesthetic, one clear focal point. Preserve recognizable screen/camera subject matter. Do not draw any logos, brand marks, watermarks, UI chrome, or unreadable text; exact logos will be added separately. Leave clean breathing room in the top-right for brand marks.`,
        images: [body.frame],
      },
      aspectRatio: "16:9",
      n: 1,
    })

    return NextResponse.json({
      image: `data:${result.image.mediaType};base64,${result.image.base64}`,
    })
  } catch (error) {
    console.error("[v0] thumbnail generation failed:", error)
    return NextResponse.json({ error: "Thumbnail generation failed. Try again." }, { status: 500 })
  }
}
