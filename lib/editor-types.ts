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

/** A step parsed from a pasted guide, before it gets an id and a start time. */
export interface ParsedGuideStep {
  title: string
  body: string
}

const CALLOUT_BLOCKQUOTE = /^\s*>\s?/
const CALLOUT_EMOJI = /^\s*\p{Extended_Pictographic}/u

/** True when a line begins a callout — either a Markdown blockquote or an emoji-led line. */
function isCalloutStart(line: string): boolean {
  return CALLOUT_BLOCKQUOTE.test(line) || CALLOUT_EMOJI.test(line)
}

/** Strip blockquote markers and a single leading emoji so the callout reads as a title. */
function calloutToTitle(lines: string[]): string {
  return lines
    .map((line) =>
      line
        .replace(CALLOUT_BLOCKQUOTE, "")
        .replace(/^\s*\p{Extended_Pictographic}\uFE0F?\s*/u, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" ")
    .trim()
}

function trimBlankEdges(lines: string[]): string {
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === "") start++
  while (end > start && lines[end - 1].trim() === "") end--
  return lines.slice(start, end).join("\n")
}

/**
 * Split a whole pasted build guide into steps, breaking on callouts. Each callout
 * line (a Markdown blockquote `>` or an emoji-led line) starts a new step whose
 * title is the callout text; every line beneath it — until the next callout —
 * becomes that step's Markdown body. Content before the first callout, if any,
 * becomes an "Introduction" step so nothing is lost.
 */
export function parseGuideMarkdown(markdown: string): ParsedGuideStep[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const steps: ParsedGuideStep[] = []
  const intro: string[] = []
  let current: { titleLines: string[]; bodyLines: string[] } | null = null

  const flush = () => {
    if (!current) return
    steps.push({
      title: calloutToTitle(current.titleLines) || "Untitled step",
      body: trimBlankEdges(current.bodyLines),
    })
    current = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isCalloutStart(line)) {
      flush()
      const titleLines: string[] = [line]
      // Blockquote callouts can span consecutive `>` lines — gather them all.
      if (CALLOUT_BLOCKQUOTE.test(line)) {
        while (i + 1 < lines.length && CALLOUT_BLOCKQUOTE.test(lines[i + 1])) {
          titleLines.push(lines[++i])
        }
      }
      current = { titleLines, bodyLines: [] }
    } else if (current) {
      current.bodyLines.push(line)
    } else {
      intro.push(line)
    }
  }
  flush()

  const introBody = trimBlankEdges(intro)
  if (introBody) steps.unshift({ title: "Introduction", body: introBody })

  return steps
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
