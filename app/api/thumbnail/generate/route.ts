import { generateText } from "ai"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { summary?: string; frame?: string }
    const summary = body.summary?.trim()
    const frame = body.frame
    if (!summary || summary.length > 500 || !frame?.startsWith("data:image/")) {
      return NextResponse.json({ error: "Select a timeline frame and enter a short video summary." }, { status: 400 })
    }
    if (frame.length > 8_000_000) {
      return NextResponse.json({ error: "The selected frame is too large. Capture it again and retry." }, { status: 413 })
    }

    const separator = frame.indexOf(",")
    if (separator < 0) {
      return NextResponse.json({ error: "The selected frame could not be read. Capture it again." }, { status: 400 })
    }
    const frameBytes = Uint8Array.from(Buffer.from(frame.slice(separator + 1), "base64"))

    const result = await generateText({
      model: "google/gemini-3.1-flash-image",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Create one polished 16:9 YouTube/video thumbnail using the attached composed recording frame as the visual source. Topic: ${summary}. Minimal Vercel design language: crisp black, white and neutral gray, strong negative space, subtle grid or light geometry, premium developer-tool aesthetic, one clear focal point. Preserve the recognizable screen and presenter/camera subject matter from the source frame, including the exact camera overlay shape. Do not draw any logos, brand marks, watermarks, UI chrome, or unreadable text; exact logos will be added separately. Leave clean breathing room in the top-right for brand marks. Return an image.`,
            },
            { type: "image", image: frameBytes, mediaType: "image/jpeg" },
          ],
        },
      ],
      providerOptions: {
        google: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "16:9" },
        },
      },
    })

    const image = result.files.find((file) => file.mediaType.startsWith("image/"))
    if (!image) {
      return NextResponse.json({ error: "The image model returned no thumbnail. Try again." }, { status: 502 })
    }

    return NextResponse.json({ image: `data:${image.mediaType};base64,${image.base64}` })
  } catch (error) {
    console.error("[v0] thumbnail generation failed:", error)
    const message = error instanceof Error ? error.message : ""
    const missingCredentials = /credential|api.?key|oidc|unauthorized|authentication/i.test(message)
    return NextResponse.json(
      {
        error: missingCredentials
          ? "AI image generation is not configured for this preview. Add AI Gateway credentials and try again."
          : "The image model could not generate this thumbnail. Try the same frame again or choose another moment.",
      },
      { status: 500 },
    )
  }
}
