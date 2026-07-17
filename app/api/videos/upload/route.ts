import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { type NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

/**
 * Issues a scoped client-upload token so the browser can stream recorded media
 * (screen/camera/mic tracks, thumbnails) straight to Blob — bypassing the
 * ~4.5MB serverless request-body limit that made server-proxied saves slow.
 * This is the Loom/Zoom-style path: upload the already-encoded originals as-is,
 * with no server round-trip and no re-encode.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Private store: files are streamed back through /api/file.
        const isThumb = pathname.startsWith("thumbnails/")
        return {
          access: "private",
          addRandomSuffix: true,
          allowedContentTypes: isThumb
            ? ["image/jpeg", "image/png", "image/webp"]
            : ["video/webm", "video/mp4", "audio/webm", "audio/mp4", "audio/ogg"],
          // Allow large recordings; browser uploads multipart automatically.
          maximumSizeInBytes: 2 * 1024 * 1024 * 1024,
        }
      },
      onUploadCompleted: async () => {
        // Metadata is persisted by the /api/videos route after all tracks upload.
      },
    })

    return NextResponse.json(jsonResponse)
  } catch (error) {
    console.error("[v0] upload token failed:", error)
    return NextResponse.json({ error: (error as Error)?.message ?? "Upload failed" }, { status: 400 })
  }
}
