export interface EditorSegment {
  id: string
  sourceStart: number
  sourceEnd: number
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
