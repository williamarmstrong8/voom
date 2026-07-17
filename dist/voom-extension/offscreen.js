import { MESSAGE } from "./protocol.js"

let recorder = null
let stream = null
let chunks = []
let startedAt = 0
let sourceStreams = []
let audioContext = null

function preferredMimeType() {
  return [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type)) || ""
}

async function startRecording(message) {
  if (recorder && recorder.state !== "inactive") return { ok: false, error: "Recorder is busy." }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: message.streamId,
        },
      },
      video: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: message.streamId,
        },
      },
    })
    sourceStreams = [stream]
    if (message.config?.micEnabled) {
      try {
        const microphone = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        sourceStreams.push(microphone)
      } catch {
        // A tab-only recording can continue if microphone permission is denied.
      }
    }
    if (sourceStreams.some((source) => source.getAudioTracks().length)) {
      audioContext = new AudioContext()
      const destination = audioContext.createMediaStreamDestination()
      for (const source of sourceStreams) {
        if (!source.getAudioTracks().length) continue
        audioContext.createMediaStreamSource(source).connect(destination)
      }
      stream = new MediaStream([
        ...stream.getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ])
    }
    const mimeType = preferredMimeType()
    chunks = []
    startedAt = Date.now()
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: recorder?.mimeType || "video/webm" })
      const dataUrl = await blobToDataUrl(blob)
      const durationMs = Date.now() - startedAt
      stream?.getTracks().forEach((track) => track.stop())
      sourceStreams.forEach((source) => source.getTracks().forEach((track) => track.stop()))
      sourceStreams = []
      await audioContext?.close()
      audioContext = null
      stream = null
      recorder = null
      chunks = []
      const transferId = crypto.randomUUID()
      const chunkSize = 2 * 1024 * 1024
      const totalChunks = Math.ceil(dataUrl.length / chunkSize)
      for (let index = 0; index < totalChunks; index += 1) {
        await chrome.runtime.sendMessage({
          type: MESSAGE.OFFSCREEN_CHUNK,
          transferId,
          index,
          totalChunks,
          chunk: dataUrl.slice(index * chunkSize, (index + 1) * chunkSize),
        })
      }
      await chrome.runtime.sendMessage({
        type: MESSAGE.OFFSCREEN_COMPLETE,
        recording: {
          transferId,
          totalChunks,
          mimeType: blob.type,
          size: blob.size,
          durationMs,
          createdAt: new Date().toISOString(),
        },
      })
    }
    recorder.start(1000)
    return { ok: true }
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop())
    sourceStreams.forEach((source) => source.getTracks().forEach((track) => track.stop()))
    sourceStreams = []
    await audioContext?.close()
    audioContext = null
    stream = null
    recorder = null
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(blob)
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MESSAGE.OFFSCREEN_START) {
    startRecording(message).then(sendResponse)
    return true
  }
  if (message?.type === MESSAGE.OFFSCREEN_COMMAND) {
    if (!recorder) {
      sendResponse({ ok: false, error: "No active recording." })
      return false
    }
    if (message.command === "pause" && recorder.state === "recording") recorder.pause()
    if (message.command === "resume" && recorder.state === "paused") recorder.resume()
    if (message.command === "stop" && recorder.state !== "inactive") recorder.stop()
    sendResponse({ ok: true })
    return false
  }
  return false
})
