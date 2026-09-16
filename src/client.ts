import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract, SessionAuth, LiveEvent } from "./contract";
import type { Focus } from "./policy";
// Module ownership keeps media independent of routed panels and their remounts.
type Rpc = PluginRpcClient<typeof rpcContract>;
type State = {
  status:
    | "idle"
    | "ending"
    | "connecting"
    | "listening"
    | "speaking"
    | "delegated"
    | "reconnecting"
    | "error";
  configured: boolean | null;
  busy: boolean;
  muted: boolean;
  silenced: boolean;
  ptt: boolean;
  details: boolean;
  error: string | null;
  notice: string | null;
  focus: Focus;
  events: LiveEvent[];
  pending: { id: string; threadId: string; title: string }[];
  auth: SessionAuth | null;
  operatorId: string | null;
  audioBlocked: boolean;
  startedAt: number | null;
};
const initial: State = {
  status: "idle",
  configured: null,
  busy: false,
  muted: false,
  silenced: false,
  ptt: false,
  details: false,
  error: null,
  notice: null,
  focus: { kind: "global", id: null, label: "All of BB", explicit: false },
  events: [],
  pending: [],
  auth: null,
  operatorId: null,
  audioBlocked: false,
  startedAt: null,
};
let state: State = { ...initial };
const listeners = new Set<() => void>();
let rpc: Rpc,
  peer: RTCPeerConnection | null = null,
  stream: MediaStream | null = null,
  audio: HTMLAudioElement | null = null,
  channel: RTCDataChannel | null = null,
  poll: ReturnType<typeof setInterval> | null = null,
  heartbeat: ReturnType<typeof setInterval> | null = null,
  disconnect: ReturnType<typeof setTimeout> | null = null,
  speechTimer: ReturnType<typeof setTimeout> | null = null,
  startTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0,
  lastSequence = 0,
  polling = false,
  lastOpen: string | null = null,
  navigate: (id: string) => void = () => {};
const patch = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
};
export const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const snapshot = () => state;
export function configure(client: Rpc, go: (id: string) => void) {
  rpc = client;
  navigate = go;
}
export async function refreshConfig() {
  try {
    patch(await rpc.call("config"));
  } catch {
    patch({ error: "Cannot reach BB. Check your connection." });
  }
}
function release() {
  if (poll) clearInterval(poll);
  if (heartbeat) clearInterval(heartbeat);
  if (disconnect) clearTimeout(disconnect);
  if (speechTimer) clearTimeout(speechTimer);
  if (startTimer) clearTimeout(startTimer);
  poll = heartbeat = null;
  disconnect = speechTimer = startTimer = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  channel?.close();
  channel = null;
  if (peer) {
    peer.onconnectionstatechange = null;
    peer.close();
    peer = null;
  }
  if (audio) {
    audio.pause();
    audio.srcObject = null;
    audio.remove();
    audio = null;
  }
}
export async function end(notice = "Voice ended. Your BB work continues.") {
  ++generation;
  const auth = state.auth;
  stream?.getTracks().forEach((t) => t.stop());
  audio?.pause();
  patch({
    auth: null,
    status: auth ? "ending" : "idle",
    ptt: false,
    notice,
    startedAt: null,
    audioBlocked: false,
    busy: false,
  });
  if (auth)
    await rpc.call("control", { ...auth, command: "end" }).catch(() => {});
  release();
  if (state.status === "ending") patch({ status: "idle" });
}
function failure(text: string) {
  void end(text).then(() => patch({ status: "error", error: text }));
}
async function iceReady(connection: RTCPeerConnection) {
  if (connection.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      connection.removeEventListener("icegatheringstatechange", change);
      resolve();
    };
    const change = () => {
      if (connection.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(() => {
      connection.removeEventListener("icegatheringstatechange", change);
      reject(new Error("Could not negotiate the audio connection."));
    }, 10000);
    connection.addEventListener("icegatheringstatechange", change);
  });
}
export async function start(threadId: string | null, projectId: string | null) {
  if (state.auth || !["idle", "error"].includes(state.status)) return;
  const run = ++generation;
  patch({
    status: "connecting",
    error: null,
    notice: null,
    events: [],
    pending: [],
    muted: false,
    silenced: false,
    ptt: false,
    details: false,
  });
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error("Microphone access requires BB over HTTPS.");
    // Create and prime the element synchronously in the tap gesture for Safari playback.
    audio = document.createElement("audio");
    audio.autoplay = true;
    audio.setAttribute("playsinline", "");
    document.body.append(audio);
    void audio.play().catch(() => {});
    const capture = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    if (run !== generation) {
      capture.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = capture;
    const connection = new RTCPeerConnection();
    peer = connection;
    for (const track of capture.getTracks()) {
      connection.addTrack(track, capture);
      track.onended = () => {
        if (run === generation)
          failure("Microphone stopped. Tap Start voice to reconnect.");
      };
    }
    connection.ontrack = (event) => {
      if (!audio) return;
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().catch(() => patch({ audioBlocked: true }));
    };
    channel = connection.createDataChannel("oai-events");
    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "session.started") {
          if (startTimer) clearTimeout(startTimer);
          patch({ status: "listening" });
        }
        if (data.type === "session.closed")
          void end("Voice connection ended. Your BB work continues.");
        if (data.type === "error")
          patch({ error: "The voice connection reported an error." });
      } catch {}
    };
    connection.onconnectionstatechange = () => {
      if (run !== generation) return;
      if (connection.connectionState === "connected") {
        if (disconnect) clearTimeout(disconnect);
        patch({ status: "listening" });
      }
      if (connection.connectionState === "disconnected") {
        patch({ status: "reconnecting" });
        disconnect = setTimeout(
          () =>
            failure(
              "Voice disconnected. Tap Start voice to reconnect; your BB work continues.",
            ),
          10000,
        );
      }
      if (connection.connectionState === "failed")
        failure(
          "Voice disconnected. Tap Start voice to reconnect; your BB work continues.",
        );
    };
    await connection.setLocalDescription(await connection.createOffer());
    await iceReady(connection);
    if (run !== generation) return;
    const result = await rpc.call("start", {
      sdp: connection.localDescription!.sdp,
      threadId,
      projectId,
    });
    if (run !== generation) {
      await rpc.call("control", {
        id: result.id,
        token: result.token,
        command: "end",
      });
      return;
    }
    const auth = { id: result.id, token: result.token };
    patch({
      auth,
      operatorId: result.operatorId,
      focus: result.focus,
      startedAt: Date.now(),
    });
    await connection.setRemoteDescription({ type: "answer", sdp: result.sdp });
    startTimer = setTimeout(() => {
      if (state.status === "connecting")
        failure("Voice did not connect. Tap Start voice to try again.");
    }, 20000);
    lastSequence = 0;
    lastOpen = null;
    poll = setInterval(() => {
      void refresh();
    }, 1500);
    heartbeat = setInterval(() => {
      void rpc
        .call("control", { ...auth, command: "heartbeat" })
        .catch(() => failure("BB connection lost. Your BB work continues."));
    }, 10000);
    await refresh();
  } catch (error) {
    if (run !== generation) return;
    const name = (error as Error).name;
    failure(
      name === "NotAllowedError"
        ? "Microphone access is blocked. Allow the microphone in your browser’s site settings, then try again."
        : name === "NotFoundError"
          ? "No microphone was found. Connect one and try again."
          : (error as Error).message || "Could not start voice.",
    );
  }
}
async function refresh() {
  if (!state.auth || polling) return;
  polling = true;
  try {
    const auth = state.auth;
    const value = await rpc.call("snapshot", auth);
    if (state.auth?.id !== auth.id) return;
    patch({ focus: value.focus, events: value.events, pending: value.pending });
    const recent = value.events.filter((e) => e.sequence > lastSequence);
    lastSequence = value.events.at(-1)?.sequence ?? lastSequence;
    if (recent.some((e) => e.kind === "speech")) {
      patch({ status: "speaking" });
      if (speechTimer) clearTimeout(speechTimer);
      speechTimer = setTimeout(() => {
        if (state.auth) patch({ status: "listening" });
      }, 1800);
    } else if (recent.some((e) => e.kind === "delegation"))
      patch({ status: "delegated" });
    if (value.openThreadId && value.openThreadId !== lastOpen) {
      lastOpen = value.openThreadId;
      navigate(value.openThreadId);
    }
  } catch {
    if (state.auth)
      failure(
        "The voice session ended or BB reloaded. Your BB work continues.",
      );
  } finally {
    polling = false;
  }
}
export function mute() {
  const muted = !state.muted;
  patch({ muted, ptt: false });
  stream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
}
export function pushToTalk(down: boolean) {
  if (!state.auth || !state.muted) return;
  patch({ ptt: down });
  stream?.getAudioTracks().forEach((t) => (t.enabled = down));
}
export function silence() {
  const silenced = !state.silenced;
  patch({ silenced });
  if (audio) audio.muted = silenced;
}
export function play() {
  void audio?.play().then(
    () => patch({ audioBlocked: false }),
    () => patch({ audioBlocked: true }),
  );
}
export function dismissError() {
  patch({ error: null, status: "idle" });
}
export function details(value?: boolean) {
  patch({ details: value ?? !state.details });
}
export async function interrupt() {
  if (state.auth)
    try {
      await rpc.call("control", { ...state.auth, command: "interrupt" });
    } catch {
      patch({
        error: "Could not interrupt speech. Use Silence to stop playback.",
      });
    }
}
export async function focus(
  kind: Focus["kind"],
  target: string | null,
  explicit = true,
) {
  if (state.auth)
    try {
      const next = await rpc.call("focus", {
        ...state.auth,
        kind,
        target,
        explicit,
      });
      patch({ focus: next });
    } catch {
      patch({ error: "That focus is unavailable. Choose another thread." });
    }
}
export function attachLifecycle() {
  const keydown = (event: KeyboardEvent) => {
    const target = event.target as Element | null;
    if (
      event.code === "Space" &&
      !event.repeat &&
      state.muted &&
      state.auth &&
      !(
        target instanceof Element &&
        target.closest(
          'input,textarea,select,button,[contenteditable],[role="textbox"]',
        )
      )
    ) {
      event.preventDefault();
      pushToTalk(true);
    }
  };
  const keyup = (event: KeyboardEvent) => {
    if (event.code === "Space" && state.ptt) {
      event.preventDefault();
      pushToTalk(false);
    }
  };
  const blur = () => pushToTalk(false);
  const pagehide = () => {
    void end();
  };
  const visibility = () => {
    pushToTalk(false);
    if (
      document.hidden &&
      matchMedia("(pointer: coarse)").matches &&
      (state.auth || state.status === "connecting")
    )
      void end(
        "Voice paused while BB was in the background. Tap Start voice to resume.",
      );
  };
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", blur);
  window.addEventListener("pagehide", pagehide);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    window.removeEventListener("blur", blur);
    window.removeEventListener("pagehide", pagehide);
    document.removeEventListener("visibilitychange", visibility);
    void end("BB Live reloaded. Your work continues.");
  };
}
