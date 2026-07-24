import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { VideoViewScreen } from "@/components/studio/video-view-screen"
import { getVideo } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const video = await getVideo(id).catch(() => null)
  if (!video) return { title: "Demo not found · Voom" }
  return {
    title: `${video.title} · Voom`,
    description: "A demo walkthrough shared from Voom.",
  }
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const video = await getVideo(id).catch(() => null)
  if (!video) notFound()

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5 lg:px-8">
        <span className="text-copy-13 font-semibold tracking-tight">Voom</span>
        <span className="text-copy-13 text-muted-foreground">Shared demo</span>
      </header>
      <VideoViewScreen video={video} variant="share" />
    </div>
  )
}
