import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import * as client from "../src/client";
const window = new Window({ url: "https://bb.example" });
Object.assign(globalThis, {
  window,
  document: window.document,
  Element: window.Element,
  matchMedia: () => ({ matches: false }),
  MediaStream: class {
    constructor(public tracks: unknown[] = []) {}
  },
});
Object.defineProperty(window, "isSecureContext", { value: true });
const tracks: { enabled: boolean; stopped: boolean; stop: () => void }[] = [];
let capture: Promise<unknown> | null = null;
const media = {
  getUserMedia: async () => {
    if (capture) return capture;
    const track = {
      enabled: true,
      stopped: false,
      stop() {
        this.stopped = true;
      },
    };
    tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  },
};
Object.defineProperty(globalThis, "navigator", {
  value: { mediaDevices: media },
  configurable: true,
});
class Peer {
  static all: Peer[] = [];
  iceGatheringState = "complete";
  connectionState = "new";
  localDescription = { sdp: "a-valid-sdp-offer" };
  closed = false;
  ontrack: ((event: any) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor() {
    Peer.all.push(this);
  }
  addTrack() {}
  createDataChannel() {
    return { close() {}, onmessage: null };
  }
  async createOffer() {
    return { type: "offer", sdp: "a-valid-sdp-offer" };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {
    this.connectionState = "connected";
    this.onconnectionstatechange?.();
  }
  close() {
    this.closed = true;
  }
  addEventListener() {}
  removeEventListener() {}
}
Object.assign(globalThis, { RTCPeerConnection: Peer });
const calls: { method: string; value: any }[] = [];
let created = 0;
const rpc = {
  async call(method: string, value: any) {
    calls.push({ method, value });
    if (method === "config") return { configured: true, busy: false };
    if (method === "start")
      return {
        id: `s${++created}`,
        token: "token",
        sdp: "answer",
        operatorId: "operator",
        focus: {
          kind: "global",
          id: null,
          label: "All of BB",
          explicit: false,
        },
      };
    if (method === "snapshot")
      return {
        status: "connected",
        focus: client.snapshot().focus,
        events: [],
        pending: [],
        openThreadId: null,
      };
    return { ok: true };
  },
};
beforeEach(async () => {
  capture = null;
  client.configure(rpc as any, () => {});
  await client.end();
  calls.length = 0;
  tracks.length = 0;
  Peer.all = [];
  await client.refreshConfig();
});
afterEach(async () => {
  await client.end();
});
test("microphone mute and output silence operate independently", async () => {
  await client.start(null, null);
  client.mute();
  assert.equal(tracks[0].enabled, false);
  assert.equal(client.snapshot().silenced, false);
  client.silence();
  assert.equal(tracks[0].enabled, false);
  assert.equal(client.snapshot().silenced, true);
  client.pushToTalk(true);
  assert.equal(tracks[0].enabled, true);
  assert.equal(client.snapshot().silenced, true);
  client.pushToTalk(false);
  assert.equal(tracks[0].enabled, false);
  client.mute();
  assert.equal(tracks[0].enabled, true);
  assert.equal(client.snapshot().silenced, true);
});
test("Space respects editable fields and release on blur remutes", async () => {
  await client.start(null, null);
  client.mute();
  const detach = client.attachLifecycle();
  const input = window.document.createElement("input");
  window.document.body.append(input);
  input.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      code: "Space",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(tracks[0].enabled, false);
  window.dispatchEvent(
    new window.KeyboardEvent("keydown", { code: "Space", cancelable: true }),
  );
  assert.equal(tracks[0].enabled, true);
  window.dispatchEvent(new window.Event("blur"));
  assert.equal(tracks[0].enabled, false);
  detach();
  input.remove();
});
test("ending closes peer, releases mic and clears audio elements", async () => {
  await client.start(null, null);
  await client.end();
  assert.ok(tracks[0].stopped);
  assert.ok(Peer.all[0].closed);
  assert.equal(window.document.querySelectorAll("audio").length, 0);
  assert.equal(client.snapshot().auth, null);
  assert.equal(
    calls.filter((c) => c.method === "control" && c.value.command === "end")
      .length,
    1,
  );
});
test("cancelling before microphone permission resolves stops late capture", async () => {
  let resolve!: (v: unknown) => void;
  capture = new Promise((r) => (resolve = r));
  const starting = client.start(null, null);
  await client.end();
  let stopped = false;
  resolve({
    getTracks: () => [
      {
        stop() {
          stopped = true;
        },
      },
    ],
  });
  await starting;
  assert.ok(stopped);
  assert.equal(calls.filter((c) => c.method === "start").length, 0);
  assert.equal(client.snapshot().auth, null);
});
test("permission denial provides recovery without capturing media", async () => {
  capture = Promise.reject(
    Object.assign(new Error("permission"), { name: "NotAllowedError" }),
  );
  await client.start(null, null);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(client.snapshot().status, "error");
  assert.match(client.snapshot().error!, /site settings/);
  assert.equal(window.document.querySelectorAll("audio").length, 0);
});
