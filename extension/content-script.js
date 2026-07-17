(() => {
  const HOST_ID = "__voom_private_overlay__"
  const BRIDGE_SOURCE = "voom-web-app"
  const EXTENSION_SOURCE = "voom-extension"
  const IDLE = { status: "idle", cameraEnabled: true, teleprompterEnabled: false, script: "", fontSize: 24 }
  let state = { ...IDLE }
  let cameraStream = null
  let tick = null
  let host = null
  const recordingTransfers = new Map()
  let shadow = null

  const icons = {
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14M17 5v14"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
    restart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7v5h5M5.5 17a8 8 0 1 0-.8-8"/></svg>',
    drag: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="6" r="1"/><circle cx="16" cy="6" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="18" r="1"/><circle cx="16" cy="18" r="1"/></svg>',
  }

  function css() {
    return `
      :host{all:initial;color-scheme:dark;--bg:#1f2023;--panel:#111113;--line:rgba(255,255,255,.14);--muted:#a1a1aa;--text:#fff;font-family:Geist,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      *{box-sizing:border-box} button{font:inherit}
      .layer{position:fixed;inset:0;z-index:2147483647;pointer-events:none}
      .controls,.prompter,.camera{pointer-events:auto;position:fixed;filter:drop-shadow(0 12px 28px rgba(0,0,0,.3))}
      .controls{left:24px;top:24px;width:58px;display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 6px 8px;border:1px solid var(--line);border-radius:29px;background:rgba(31,32,35,.96);backdrop-filter:blur(16px)}
      .drag{cursor:grab;color:var(--muted)}.drag:active{cursor:grabbing}
      .time{padding:3px 0 5px;color:var(--text);font-size:12px;font-weight:650;font-variant-numeric:tabular-nums}
      .icon{display:flex;width:38px;height:38px;align-items:center;justify-content:center;border:0;border-radius:50%;background:transparent;color:var(--text);cursor:pointer;transition:background .15s,transform .15s}.icon:hover{background:rgba(255,255,255,.1)}.icon:active{transform:scale(.94)}.icon.stop:hover{background:#e5484d}.icon svg,.drag svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.icon.stop svg{fill:currentColor;stroke:none;width:14px;height:14px}.divider{width:30px;height:1px;background:var(--line);margin:2px 0}
      .camera{right:24px;bottom:24px;width:184px;aspect-ratio:1;border:1px solid var(--line);border-radius:18px;overflow:hidden;background:#09090b}.camera video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}.camera.error{display:grid;place-items:center;padding:16px;color:var(--muted);font-size:12px;text-align:center}
      .prompter{left:50%;bottom:24px;transform:translateX(-50%);width:min(680px,calc(100vw - 64px));max-height:180px;overflow:hidden;border:1px solid var(--line);border-radius:16px;background:rgba(17,17,19,.94);padding:18px 22px;backdrop-filter:blur(20px)}.prompter p{margin:0;color:var(--text);font-size:var(--font-size);font-weight:600;line-height:1.42;text-wrap:balance}.prompter .next{margin-top:8px;color:var(--muted);font-size:calc(var(--font-size) * .72);font-weight:500}.prompter .eyebrow{display:block;margin-bottom:7px;color:var(--muted);font-size:10px;font-weight:650;letter-spacing:.12em;text-transform:uppercase}
      @media(max-width:640px){.controls{left:12px;top:12px}.camera{right:12px;bottom:12px;width:132px}.prompter{bottom:156px;width:calc(100vw - 24px)}}
    `
  }

  function ensureHost() {
    if (host?.isConnected) return
    host = document.createElement("div")
    host.id = HOST_ID
    host.setAttribute("data-voom-private-ui", "true")
    shadow = host.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = css()
    shadow.append(style)
    ;(document.documentElement || document).append(host)
  }

  function formatTime(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000))
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
  }

  function elapsed() {
    if (!state.startedAt || state.status === "paused") return state.elapsedMs || 0
    return Date.now() - state.startedAt
  }

  function scriptLines() {
    const words = String(state.script || "").trim().split(/\s+/).filter(Boolean)
    const lines = []
    let current = []
    let length = 0
    for (const word of words) {
      if (current.length && length + word.length + 1 > 52) {
        lines.push(current.join(" "))
        current = []
        length = 0
      }
      current.push(word)
      length += word.length + (current.length > 1 ? 1 : 0)
    }
    if (current.length) lines.push(current.join(" "))
    return lines
  }

  function currentLine() {
    if (state.currentLine) return state.currentLine
    return scriptLines()[0] || "Your script gets displayed here."
  }

  function nextLine() {
    if (state.nextLine) return state.nextLine
    return scriptLines()[1] || ""
  }

  function render() {
    ensureHost()
    shadow.querySelector(".layer")?.remove()
    if (!["recording", "paused", "stopping"].includes(state.status)) {
      stopCamera()
      return
    }
    const layer = document.createElement("div")
    layer.className = "layer"
    layer.innerHTML = `
      <section class="controls" aria-label="Voom recording controls">
        <span class="drag" title="Drag controls">${icons.drag}</span>
        <span class="time">${formatTime(elapsed())}</span>
        <button class="icon pause" type="button" aria-label="${state.status === "paused" ? "Resume" : "Pause"} recording">${state.status === "paused" ? icons.play : icons.pause}</button>
        <button class="icon restart" type="button" aria-label="Restart teleprompter">${icons.restart}</button>
        <span class="divider"></span>
        <button class="icon stop" type="button" aria-label="Stop recording">${icons.stop}</button>
      </section>
      ${state.cameraEnabled ? '<section class="camera" aria-label="Camera preview"><video autoplay muted playsinline></video></section>' : ""}
      ${state.teleprompterEnabled ? `<section class="prompter" style="--font-size:${Math.max(16, Math.min(48, state.fontSize || 24))}px"><span class="eyebrow">Teleprompter</span><p>${escapeHtml(currentLine())}</p>${nextLine() ? `<p class="next">${escapeHtml(nextLine())}</p>` : ""}</section>` : ""}
    `
    shadow.append(layer)
    layer.querySelector(".pause").addEventListener("click", () => send(state.status === "paused" ? "VOOM_RESUME" : "VOOM_PAUSE"))
    layer.querySelector(".stop").addEventListener("click", () => send("VOOM_STOP"))
    layer.querySelector(".restart").addEventListener("click", () => send("VOOM_RESTART"))
    makeDraggable(layer.querySelector(".controls"), layer.querySelector(".drag"), "controls")
    const camera = layer.querySelector(".camera")
    if (camera) {
      makeDraggable(camera, camera, "camera")
      attachCamera(camera)
    }
  }

  function escapeHtml(value) {
    const node = document.createElement("span")
    node.textContent = value
    return node.innerHTML
  }

  async function attachCamera(container) {
    try {
      if (!cameraStream) cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      const video = container.querySelector("video")
      if (video) video.srcObject = cameraStream
    } catch {
      container.classList.add("error")
      container.textContent = "Allow camera access for this site to show your preview."
    }
  }

  function stopCamera() {
    cameraStream?.getTracks().forEach((track) => track.stop())
    cameraStream = null
  }

  function makeDraggable(element, handle, key) {
    if (!element || !handle) return
    chrome.storage.local.get(`voomPosition:${key}`).then((stored) => {
      const position = stored[`voomPosition:${key}`]
      if (!position) return
      element.style.left = `${Math.min(position.x, innerWidth - element.offsetWidth - 8)}px`
      element.style.top = `${Math.min(position.y, innerHeight - element.offsetHeight - 8)}px`
      element.style.right = "auto"
      element.style.bottom = "auto"
    })
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest?.("button")) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const origin = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      handle.setPointerCapture(event.pointerId)
      const move = (next) => {
        const x = Math.max(8, Math.min(innerWidth - rect.width - 8, next.clientX - origin.x))
        const y = Math.max(8, Math.min(innerHeight - rect.height - 8, next.clientY - origin.y))
        Object.assign(element.style, { left: `${x}px`, top: `${y}px`, right: "auto", bottom: "auto" })
      }
      const up = () => {
        handle.removeEventListener("pointermove", move)
        const latest = element.getBoundingClientRect()
        chrome.storage.local.set({ [`voomPosition:${key}`]: { x: latest.left, y: latest.top } })
      }
      handle.addEventListener("pointermove", move)
      handle.addEventListener("pointerup", up, { once: true })
    })
  }

  function send(type, config) {
    return chrome.runtime.sendMessage({ type, config }).catch(() => null)
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "VOOM_STATE") {
      state = { ...state, ...message.state }
      render()
      window.postMessage({ source: EXTENSION_SOURCE, type: "VOOM_STATE", state }, location.origin)
    }
    if (message?.type === "VOOM_OFFSCREEN_CHUNK") {
      const transfer = recordingTransfers.get(message.transferId) || new Array(message.totalChunks)
      transfer[message.index] = message.chunk
      recordingTransfers.set(message.transferId, transfer)
    }
    if (message?.type === "VOOM_RECORDING_READY") {
      const transfer = recordingTransfers.get(message.recording?.transferId)
      if (!transfer || transfer.some((chunk) => typeof chunk !== "string")) return
      recordingTransfers.delete(message.recording.transferId)
      window.postMessage({
        source: EXTENSION_SOURCE,
        type: "VOOM_RECORDING_READY",
        recording: { ...message.recording, dataUrl: transfer.join("") },
      }, location.origin)
    }
  })

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.data?.source !== BRIDGE_SOURCE) return
    if (event.data.type === "VOOM_PING") {
      window.postMessage({ source: EXTENSION_SOURCE, type: "VOOM_PONG", version: chrome.runtime.getManifest().version }, location.origin)
      return
    }
    if (event.data.type === "VOOM_COMMAND") {
      const response = await send(event.data.command, event.data.config)
      window.postMessage({ source: EXTENSION_SOURCE, type: "VOOM_COMMAND_RESULT", requestId: event.data.requestId, response }, location.origin)
    }
  })

  send("VOOM_GET_STATE").then((response) => {
    if (response?.state) state = response.state
    render()
  })
  tick = window.setInterval(() => {
    if (state.status === "recording") render()
  }, 1000)
  window.addEventListener("pagehide", () => clearInterval(tick), { once: true })
})()
