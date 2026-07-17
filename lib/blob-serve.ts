import "server-only"
import { issueSignedToken, presignUrl } from "@vercel/blob"

// How long a presigned read URL stays valid. The browser fetches bytes directly
// from the Blob CDN within this window (with range + cache support), so nothing
// is proxied through our function.
const READ_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Mint a direct, CDN-backed URL for a private Blob object. This is the fast path
 * for serving recordings: the returned URL points straight at the Blob CDN
 * (`*.private.blob.vercel-storage.com`), supports HTTP range requests for
 * seeking, and is cacheable — no byte streaming through a serverless function.
 */
export async function presignReadUrl(
  pathname: string,
  { download = false }: { download?: boolean } = {},
): Promise<string> {
  const validUntil = Date.now() + READ_TTL_MS
  const token = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil,
  })
  const { presignedUrl } = await presignUrl(
    { clientSigningToken: token.clientSigningToken, delegationToken: token.delegationToken },
    { operation: "get", pathname, access: "private", validUntil },
  )
  // `download=1` triggers an attachment content-disposition at the CDN. It is
  // not part of the signed payload, so appending it is safe.
  return download ? `${presignedUrl}&download=1` : presignedUrl
}
