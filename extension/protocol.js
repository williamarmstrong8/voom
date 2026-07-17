export const DEFAULT_STATE = Object.freeze({
  status: "idle",
  startedAt: null,
  pausedAt: null,
  elapsedMs: 0,
  cameraEnabled: true,
  micEnabled: true,
  teleprompterEnabled: false,
  script: "",
  fontSize: 24,
  cursor: 0,
  error: null,
})

export const MESSAGE = Object.freeze({
  START: "VOOM_START",
  PAUSE: "VOOM_PAUSE",
  RESUME: "VOOM_RESUME",
  STOP: "VOOM_STOP",
  RESTART: "VOOM_RESTART",
  UPDATE_PROMPTER: "VOOM_UPDATE_PROMPTER",
  GET_STATE: "VOOM_GET_STATE",
  STATE: "VOOM_STATE",
  RECORDING_READY: "VOOM_RECORDING_READY",
  OFFSCREEN_START: "VOOM_OFFSCREEN_START",
  OFFSCREEN_COMMAND: "VOOM_OFFSCREEN_COMMAND",
  OFFSCREEN_CHUNK: "VOOM_OFFSCREEN_CHUNK",
  OFFSCREEN_COMPLETE: "VOOM_OFFSCREEN_COMPLETE",
  PAGE_COMMAND: "VOOM_PAGE_COMMAND",
  PAGE_EVENT: "VOOM_PAGE_EVENT",
})

export function elapsedFor(state) {
  if (!state.startedAt) return state.elapsedMs || 0
  if (state.status === "paused") return state.elapsedMs || 0
  return Math.max(0, Date.now() - state.startedAt)
}
