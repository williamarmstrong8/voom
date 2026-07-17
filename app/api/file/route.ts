import { get } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

// Streams a private Blob file (video or thumbnail) to the browser. Private blob
// URLs aren't publicly accessible, so saved recordings are served through here.
export async function GET(request: NextRequest) {
  const pathname = request.nextUrl.searchParams.get("pathname")
  if (!pathname) {
    return NextResponse.json({ error: "Missing pathname" }, { status: 400 })
  }

  try {
    const result = await get(pathname, {
      access: "private",
      ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
    })

    if (!result) {
      return new NextResponse("Not found", { status: 404 })
    }

    if (result.statusCode === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: result.blob.etag,
          "Cache-Control": "private, no-cache",
        },
      })
    }

    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType,
        ETag: result.blob.etag,
        "Cache-Control": "private, no-cache",
        "Accept-Ranges": "bytes",
      },
    })
  } catch (error) {
    console.error("[v0] serve file failed:", error)
    return NextResponse.json({ error: "Failed to serve file" }, { status: 500 })
  }
}
