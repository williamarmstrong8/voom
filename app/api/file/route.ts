import { type NextRequest, NextResponse } from "next/server"
import { presignReadUrl } from "@/lib/blob-serve"

export const runtime = "nodejs"

/**
 * Serve a private Blob object by redirecting to a freshly presigned, CDN-backed
 * URL. The browser follows the 307 and fetches bytes DIRECTLY from the Blob CDN
 * — with range-request support (seeking) and edge caching — so this function
 * never streams the file itself. This is the fast download path: no bytes are
 * proxied through the serverless runtime, only a tiny signed redirect.
 *
 * Stable app URLs (`/api/file?pathname=…`) are stored in the DB; each request
 * mints a fresh signed URL, so links never go stale even though the underlying
 * CDN URLs expire.
 */
export async function GET(request: NextRequest) {
  const pathname = request.nextUrl.searchParams.get("pathname")
  const download = request.nextUrl.searchParams.get("download") === "1"

  if (!pathname) {
    return NextResponse.json({ error: "Missing pathname" }, { status: 400 })
  }

  try {
    const url = await presignReadUrl(pathname, { download })
    return new NextResponse(null, {
      status: 307,
      headers: {
        Location: url,
        // Briefly cache the redirect so rapid range/seek requests don't re-sign
        // every time, while staying far below the signed URL's lifetime.
        "Cache-Control": "private, max-age=30",
      },
    })
  } catch (error) {
    console.error("[v0] presign file failed:", error)
    return NextResponse.json({ error: "Failed to serve file" }, { status: 500 })
  }
}
