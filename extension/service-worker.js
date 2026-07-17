import { DEFAULT_STATE, MESSAGE } from "./protocol.js"

let state = { ...DEFAULT_STATE }
let recordingTabId = null
let commandInFlight = false

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL("offscreen.html")
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url],
  })
  if (contexts.length) return
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Record the selected browser tab with private Voom controls.",
  })
}

async function broadcast(message) {
  const tabs = await chrome.tabs.query({})
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id && /^https?:/.test(tab.url || ""))
      .map((tab) => chrome.tabs.sendMessage(tab.id, message)),
  )
}

async function publishState(patch = {}) {
  state = { ...state, ...patch }
  await chrome.storage.session.set({ voomState: state })
  await broadcast({ type: MESSAGE.STATE, state })
}

async function startRecording(sender, config = {}) {
  if (commandInFlight || state.status === "recording" || state.status === "paused") {
    return { ok: false, error: "A recording is already active." }
  }
  const tabId = sender.tab?.id
  if (!tabId) return { ok: false, error: "Open Voom in the tab you want to record." }

  commandInFlight = true
  try {
    await ensureOffscreenDocument()
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId })
    recordingTabId = tabId
    const startedAt = Date.now()
    await publishState({
      ...DEFAULT_STATE,
      ...config,
      status: "recording",
      startedAt,
      elapsedMs: 0,
      error: null,
    })
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE.OFFSCREEN_START,
      streamId,
      config,
      tabId,
    })
    if (!response?.ok) throw new Error(response?.error || "Recorder failed to start.")
    return { ok: true, state }
  } catch (error) {
    await publishState({ ...DEFAULT_STATE, error: error instanceof Error ? error.message : String(error) })
    return { ok: false, error: state.error }
  } finally {
    commandInFlight = false
  }
}

async function commandRecording(type) {
  if (commandInFlight) return { ok: false }
  if (!["recording", "paused"].includes(state.status)) return { ok: true, state }
  commandInFlight = true
  try {
    const elapsedMs = state.status === "recording" && state.startedAt
      ? Date.now() - state.startedAt
      : state.elapsedMs
    if (type === MESSAGE.PAUSE) {
      await chrome.runtime.sendMessage({ type: MESSAGE.OFFSCREEN_COMMAND, command: "pause" })
      await publishState({ status: "paused", elapsedMs, pausedAt: Date.now() })
    } else if (type === MESSAGE.RESUME) {
      await chrome.runtime.sendMessage({ type: MESSAGE.OFFSCREEN_COMMAND, command: "resume" })
      await publishState({ status: "recording", startedAt: Date.now() - elapsedMs, pausedAt: null })
    } else if (type === MESSAGE.STOP) {
      await publishState({ status: "stopping", elapsedMs })
      await chrome.runtime.sendMessage({ type: MESSAGE.OFFSCREEN_COMMAND, command: "stop" })
    }
    return { ok: true, state }
  } finally {
    commandInFlight = false
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === MESSAGE.START) {
    startRecording(sender, message.config).then(sendResponse)
    return true
  }
  if (message?.type === MESSAGE.RESTART) {
    publishState({ cursor: 0, currentLine: null, nextLine: null }).then(() => sendResponse({ ok: true, state }))
    return true
  }
  if (message?.type === MESSAGE.UPDATE_PROMPTER) {
    publishState({
      currentLine: message.config?.currentLine ?? null,
      nextLine: message.config?.nextLine ?? null,
    }).then(() => sendResponse({ ok: true, state }))
    return true
  }
  if ([MESSAGE.PAUSE, MESSAGE.RESUME, MESSAGE.STOP].includes(message?.type)) {
    commandRecording(message.type).then(sendResponse)
    return true
  }
  if (message?.type === MESSAGE.GET_STATE) {
    sendResponse({ ok: true, state })
    return false
  }
  if (message?.type === MESSAGE.OFFSCREEN_CHUNK) {
    if (recordingTabId) {
      chrome.tabs.sendMessage(recordingTabId, {
        type: MESSAGE.OFFSCREEN_CHUNK,
        transferId: message.transferId,
        index: message.index,
        totalChunks: message.totalChunks,
        chunk: message.chunk,
      }).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }))
      return true
    }
    sendResponse({ ok: false, error: "The recording tab is unavailable." })
    return false
  }
  if (message?.type === MESSAGE.OFFSCREEN_COMPLETE) {
    const completedState = { ...state, status: "complete" }
    broadcast({
      type: MESSAGE.RECORDING_READY,
      recording: message.recording,
      state: completedState,
      tabId: recordingTabId,
    }).finally(() => {
      recordingTabId = null
      publishState({ ...DEFAULT_STATE })
    })
    sendResponse({ ok: true })
    return false
  }
  return false
})

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!["recording", "paused", "stopping"].includes(state.status)) return
  try {
    await chrome.tabs.sendMessage(tabId, { type: MESSAGE.STATE, state })
  } catch {
    // Restricted browser pages cannot host content-script overlays.
  }
})

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.session.get("voomState")
  state = stored.voomState || { ...DEFAULT_STATE }
})
