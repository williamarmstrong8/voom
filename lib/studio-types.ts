// Shared types for the recording studio + editor.

export type StudioMode = "dashboard" | "setup" | "recording" | "viewing" | "editing"

/**
 * Persisted editor state for an editable project. Reopening a saved video
 * rehydrates from this, so camera shape/layout, trim, segments, captions, and
 * title cards all stay editable without ever re-encoding the originals.
 */
export interface EditorState {
  version: 1
  duration: number
  segments: { id: string; sourceStart: number; sourceEnd: number }[]
  camera: {
    visible: boolean
    layout: CameraLayout
  }
  captions: { id: string; start: number; end: number; text: string }[]
  titleCards: { id: string; start: number; end: number; title: string; subtitle: string }[]
  brandKit: {
    name: string
    primaryColor: string
    fontFamily: "geist" | "serif" | "mono"
    logoUrl: string | null
  }
  mimeTypes: { screen: string; camera: string | null; audio: string | null }
}

/** A saved video record returned from the library API. */
export interface SavedVideo {
  id: string
  title: string
  pathname: string
  url: string
  thumbnail_url: string | null
  duration_seconds: number
  size_bytes: number
  created_at: string
  /** 'project' rows are editable (raw tracks + editor_state); 'legacy' are flattened. */
  kind: "project" | "legacy"
  /** Serve URLs for the raw editable source tracks (project rows only). */
  screen_url: string | null
  camera_url: string | null
  audio_url: string | null
  /** Restored editor state for project rows. */
  editor_state: EditorState | null
}

/** A recorded media track (screen or camera) with its object URL and blob. */
export interface RecordedTrack {
  blob: Blob
  url: string
  mimeType: string
}

/** Everything produced by a single recording session. */
export interface RecordingResult {
  screen: RecordedTrack
  /** Camera is optional — the user can record screen only. */
  camera: RecordedTrack | null
  /** Audio-only microphone or shared-tab track used for transcription. */
  audio?: RecordedTrack | null
  /** Measured wall-clock duration of the recording, in seconds. */
  duration: number
}

/**
 * Camera overlay placement within the editor/export frame.
 *
 * Position is stored as the offset of the overlay's bottom-left corner from the
 * frame's bottom-left corner, expressed as a fraction of frame width/height so
 * it stays correct across preview and export resolutions.
 */
export interface CameraLayout {
  /** 0-1 fraction of frame width from the left edge to the overlay's left. */
  left: number
  /** 0-1 fraction of frame height from the bottom edge to the overlay's bottom. */
  bottom: number
  /** Overlay width as a 0-1 fraction of the frame width. */
  width: number
  /** Overlay shape: 16:9 rounded rectangle or a 1:1 square, circle, or triangle. */
  shape: "rounded" | "square" | "circle" | "triangle"
}

/** Inclusive trim window in seconds. */
export interface TrimRange {
  start: number
  end: number
}

export const DEFAULT_CAMERA_LAYOUT: CameraLayout = {
  // Equal visible pixel padding in a 16:9 frame: 4% of width = 7.11% of height.
  left: 0.04,
  bottom: 0.0711,
  width: 0.24,
  shape: "square",
}
