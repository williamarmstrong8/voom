export type SegmentComposition = "screen-camera" | "camera-only"

export interface EditorSegment {
  id: string
  sourceStart: number
  sourceEnd: number
  /** Defaults to screen-camera for projects saved before composition modes existed. */
  composition?: SegmentComposition
}

export interface CaptionCue {
  id: string
  start: number
  end: number
  text: string
}

export interface TitleCard {
  id: string
  start: number
  end: number
  title: string
  subtitle: string
}

/**
 * A single step of a build guide, shown beside the demo while it plays. A step
 * becomes active at `start` (in project/edited-timeline seconds) and stays
 * visible until the next step's start — exactly one step shows at a time.
 * `body` holds Notion-style Markdown (headers, bullets, callouts, code blocks).
 */
export interface GuideStep {
  id: string
  start: number
  title: string
  body: string
}

/**
 * Resolve which guide step should be visible at a given project time. Steps are
 * sorted by start; the active one is the last step whose start is <= time. Before
 * the first step's start, nothing shows (returns null).
 */
export function activeGuideStep(steps: GuideStep[], projectTime: number): GuideStep | null {
  const sorted = [...steps].sort((a, b) => a.start - b.start)
  let active: GuideStep | null = null
  for (const step of sorted) {
    if (projectTime + 0.001 >= step.start) active = step
    else break
  }
  return active
}

export interface BrandKit {
  name: string
  primaryColor: string
  fontFamily: "geist" | "serif" | "mono"
  logoUrl: string | null
}

export const DEFAULT_BRAND_KIT: BrandKit = {
  name: "Voom default",
  primaryColor: "#ffffff",
  fontFamily: "geist",
  logoUrl: null,
}

export function projectDuration(segments: EditorSegment[]) {
  return segments.reduce((total, segment) => total + segment.sourceEnd - segment.sourceStart, 0)
}

export function projectToSourceTime(segments: EditorSegment[], projectTime: number) {
  let elapsed = 0
  for (const segment of segments) {
    const length = segment.sourceEnd - segment.sourceStart
    if (projectTime <= elapsed + length) {
      return segment.sourceStart + Math.max(0, projectTime - elapsed)
    }
    elapsed += length
  }
  return segments.at(-1)?.sourceEnd ?? 0
}

export function sourceToProjectTime(segments: EditorSegment[], sourceTime: number) {
  let elapsed = 0
  for (const segment of segments) {
    if (sourceTime >= segment.sourceStart && sourceTime <= segment.sourceEnd) {
      return elapsed + sourceTime - segment.sourceStart
    }
    elapsed += segment.sourceEnd - segment.sourceStart
  }
  return elapsed
}
