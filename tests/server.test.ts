import test from "node:test";
import assert from "node:assert/strict";
import {
  createFakePluginHost,
  makeThreadResponse,
  makeQueueEntry,
} from "@get-bb/plugin-sdk/testing";
import { setup } from "../server";
import type { Intent } from "../src/policy";
import type { LiveTransport } from "../src/live-transport";
const key = "sk-test-do-not-leak";
async function fixture(retention = 30) {
  const operator = makeThreadResponse({
    id: "operator",
    projectId: "personal",
    title: "BB Operator",
  });
  const target = makeThreadResponse({
    id: "worker",
    projectId: "project",
    title: "Release",
    status: "idle",
  });
  let onEvent: (event: Record<string, unknown>) => void = () => {};
  let closed = 0;
  const transportSettings: {
    voice?: string;
    model?: string;
    instructions?: string;
    context?: string;
  } = {};
  let intent: Intent = {
    action: "status",
    target: "Release",
    message: "status",
    uncertain: false,
  };
  const sent: Record<string, unknown>[] = [];
  const fake: LiveTransport = {
    async create(_key, _sdp, voice, _signal, instructions) {
      transportSettings.instructions = instructions;
      transportSettings.voice = voice;
      return { id: "live_123", sdp: "answer-sdp" };
    },
    async attach(_k, _id, event) {
      onEvent = event;
      return {
        send(event) {
          sent.push(event);
          if (event.type === "session.close")
            onEvent({ type: "session.closed" });
        },
        close() {
          closed++;
        },
      };
    },
    async classify(_key, model, context) {
      transportSettings.context = context;
      transportSettings.model = model;
      return intent;
    },
    async closeRemote() {},
  };
  const { bb, harness } = createFakePluginHost({
    pluginId: "bb-live",
    settings: { openaiApiKey: key, transcriptRetentionDays: retention },
    sdk: {
      plugins: {
        getSettings: async () => ({
          ok: true,
          schema: {},
          values: { transcriptRetentionDays: retention },
        }),
      },
      projects: {
        list: async () => [
          { id: "personal", name: "Personal", kind: "personal" },
          { id: "project", name: "Project", kind: "standard" },
        ],
        get: async ({ projectId }) => ({
          id: projectId,
          name: projectId === "personal" ? "Personal" : "Project",
          kind: projectId === "personal" ? "personal" : "standard",
        }),
      },
      threads: {
        list: async (args) =>
          args?.originPluginId
            ? []
            : [
                {
                  ...target,
                  hasPendingInteraction: false,
                  queuedWork: "none",
                  visibility: "visible",
                },
              ],
        spawn: async () => operator,
        get: async ({ threadId }) =>
          threadId === "operator" ? operator : target,
        pin: async () => operator,
        getPluginMetadata: async () => ({
          role: "bb-live-operator",
          schemaVersion: 1,
        }),
        output: async () => ({ output: "Tests passed " + key }),
        count: async () => ({ total: 2 }),
        queuedMessages: { list: async () => [] },
        interactions: { list: async () => [] },
        send: async () => ({ ok: true, delivery: "sent" }),
        stop: async () => ({ ok: true }),
      },
    },
  });
  const db = bb.storage.database();
  await setup(bb, fake);
  const call = async (method: string, input: unknown = null) => {
    return (await harness.behavior.callRpc(method, input)) as any;
  };
  const start = () =>
    call("start", {
      sdp: "offer-sdp-valid",
      threadId: "worker",
      projectId: "project",
    });
  async function event(action: Intent, id = "d1") {
    intent = action;
    onEvent({
      type: "session.input_transcript.delta",
      delta: action.message,
      start_ms: 0,
      end_ms: 100,
    });
    onEvent({
      type: "session.delegation.created",
      offset_ms: 110,
      delegation: { id, target: "client" },
    });
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    db,
    harness,
    call,
    start,
    event,
    sent,
    transportSettings,
    closed: () => closed,
    operator,
    target,
    onEvent: (event: Record<string, unknown>) => onEvent(event),
  };
}
test("singleton start, Operator reuse, authentication and secret-free state", async () => {
  const f = await fixture();
  try {
    const session = await f.start();
    assert.equal(session.focus.kind, "global");
    assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
    await assert.rejects(() =>
      f.call("start", {
        sdp: "offer-sdp-valid",
        threadId: null,
        projectId: null,
      }),
    );
    await assert.rejects(() =>
      f.call("snapshot", { id: session.id, token: "x".repeat(64) }),
    );
    await f.event({
      action: "output",
      target: "Release",
      message: "read output",
      uncertain: false,
    });
    const state = await f.call("snapshot", {
      id: session.id,
      token: session.token,
    });
    assert.ok(!JSON.stringify(state).includes(key));
    assert.ok(!JSON.stringify(f.sent).includes(key));
    await f.call("control", {
      id: session.id,
      token: session.token,
      command: "end",
    });
    await f.start();
    assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
  } finally {
    await f.harness.lifecycle.dispose();
  }
  assert.equal(f.closed(), 2);
});
test("unsafe and uncertain voice requests never dispatch", async () => {
  const f = await fixture();
  try {
    await f.start();
    await f.event({
      action: "send",
      target: "Release",
      message: "deploy it now",
      uncertain: false,
    });
    await f.event(
      {
        action: "send",
        target: "Release",
        message: "run tests",
        uncertain: true,
      },
      "d2",
    );
    assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
test("default follow-up uses start rather than auto; duplicate delegation is ignored", async () => {
  const f = await fixture();
  try {
    await f.start();
    await f.event({
      action: "send",
      target: "Release",
      message: "run integration tests",
      uncertain: false,
    });
    f.onEvent({
      type: "session.delegation.created",
      offset_ms: 110,
      delegation: { id: "d1", target: "client" },
    });
    await new Promise((r) => setTimeout(r, 20));
    const calls = f.harness.inspection.sdk.callsTo("threads.send");
    assert.equal(calls.length, 1);
    assert.ok(JSON.stringify(calls).includes('"mode":"start"'));
    assert.ok(JSON.stringify(calls).includes("accept-edits"));
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
test("explicit steer stays distinct from queue and never resends queued messages", async () => {
  const f = await fixture();
  try {
    f.harness.sdk.stub("threads.send", async () => ({
      ok: true,
      delivery: "queued",
      queuedMessage: makeQueueEntry({ id: "q1", threadId: "worker" }),
    }));
    await f.start();
    await f.event({
      action: "steer",
      target: "Release",
      message: "preserve compatibility",
      uncertain: false,
    });
    const calls = f.harness.inspection.sdk.callsTo("threads.send");
    assert.equal(calls.length, 1);
    assert.ok(JSON.stringify(calls).includes('"mode":"steer"'));
    assert.ok(f.sent.some((e) => String(e.content).includes("Queued")));
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
test("end is idempotent and does not stop BB work", async () => {
  const f = await fixture();
  try {
    const s = await f.start();
    await f.call("control", { id: s.id, token: s.token, command: "end" });
    assert.equal(f.closed(), 1);
    assert.equal(f.harness.inspection.sdk.callsTo("threads.stop").length, 0);
  } finally {
    await f.harness.lifecycle.dispose();
  }
  assert.equal(f.closed(), 1);
});

test("zero retention keeps operational records but no transcripts or result text", async () => {
  const f = await fixture(0);
  try {
    await f.start();
    await f.event({
      action: "output",
      target: "Release",
      message: "read output",
      uncertain: false,
    });
    assert.equal(
      (
        f.db
          .prepare("SELECT count(*) as n FROM voice_session_events")
          .get() as { n: number }
      ).n,
      0,
    );
    const records = f.db
      .prepare("SELECT verified_result FROM delegations")
      .all();
    assert.equal(records.length, 1);
    assert.equal(
      (records[0] as { verified_result: null }).verified_result,
      null,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
test("retention setting zero erases existing stored transcript text", async () => {
  const f = await fixture();
  try {
    await f.start();
    await f.event({
      action: "output",
      target: "Release",
      message: "read output",
      uncertain: false,
    });
    assert.ok(
      (
        f.db
          .prepare("SELECT count(*) as n FROM voice_session_events")
          .get() as { n: number }
      ).n > 0,
    );
    await f.call("savePreferences", { transcriptRetentionDays: 0 });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      (
        f.db
          .prepare("SELECT count(*) as n FROM voice_session_events")
          .get() as { n: number }
      ).n,
      0,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
test("archiving explicit focus clears it even while delegated work is tracked", async () => {
  const f = await fixture();
  try {
    const s = await f.start();
    await f.call("focus", {
      id: s.id,
      token: s.token,
      kind: "thread",
      target: "worker",
      explicit: true,
    });
    await f.event({
      action: "send",
      target: "Release",
      message: "run tests",
      uncertain: false,
    });
    await f.harness.behavior.emitThreadEvent("thread.archived", {
      thread: f.target,
    });
    const state = await f.call("snapshot", { id: s.id, token: s.token });
    assert.equal(state.focus.kind, "global");
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
test("Operator delegation sends a normalized request to the durable operator", async () => {
  const f = await fixture();
  try {
    await f.start();
    await f.event({
      action: "operator",
      target: null,
      message: "Compare release options across projects",
      uncertain: false,
    });
    const calls = f.harness.inspection.sdk.callsTo("threads.send");
    assert.equal(calls.length, 1);
    assert.ok(JSON.stringify(calls).includes("operator"));
    assert.ok(JSON.stringify(calls).includes("Compare release options"));
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("saved preferences drive voice, intent routing, and new Operator execution", async () => {
  const f = await fixture();
  let spawn: any;
  f.harness.sdk.stub("threads.spawn", async (args) => {
    spawn = args;
    return f.operator;
  });
  try {
    const saved = await f.call("savePreferences", {
      voice: "cedar",
      routerModel: "gpt-5.6-luna",
      operatorProvider: "codex",
      operatorModel: "gpt-5.6-terra",
      operatorReasoningLevel: "high",
      operatorServiceTier: "fast",
    });
    assert.equal(saved.spokenProgress, "important");
    assert.ok(!JSON.stringify(await f.call("preferences")).includes(key));
    await assert.rejects(f.call("savePreferences", { openaiApiKey: "bad" }));
    await f.start();
    assert.equal(f.transportSettings.voice, "cedar");
    assert.equal(spawn.providerId, "codex");
    assert.equal(spawn.model, "gpt-5.6-terra");
    assert.equal(spawn.reasoningLevel, "high");
    assert.equal(spawn.serviceTier, "fast");
    await f.event({
      action: "status",
      target: "Release",
      message: "status",
      uncertain: false,
    });
    assert.equal(f.transportSettings.model, "gpt-5.6-luna");
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("jev is reported unconfigured and off until a TypeSafe key exists", async () => {
  const f = await fixture();
  try {
    const before = await f.call("config");
    assert.deepEqual(before.jev, { configured: false, enabled: false });
    // The flag alone does not enable routing without a key.
    await f.call("savePreferences", { jevEnabled: true });
    assert.deepEqual((await f.call("config")).jev, {
      configured: false,
      enabled: false,
    });
    await assert.rejects(f.call("savePreferences", { typesafeApiKey: "bad" }));
    const status = JSON.parse(
      (await f.harness.behavior.runCli(["status"])).stdout ?? "",
    );
    assert.deepEqual(status.jev, { configured: false, enabled: false });
    assert.ok(!JSON.stringify(status).includes(key));
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("global discovery finds another project beyond the first page without sidebar focus", async () => {
  const f = await fixture();
  try {
    const rows = Array.from({ length: 201 }, (_, i) =>
      makeThreadResponse({
        id: `thr_${i}`,
        title: i === 200 ? "Design refresh" : `Work ${i}`,
        projectId: i === 200 ? "design" : "project",
        visibility: "visible",
      }),
    );
    f.harness.sdk.stub(
      "threads.list",
      async (
        args:
          | { originPluginId?: string; offset?: number; limit?: number }
          | undefined,
      ) =>
        args?.originPluginId
          ? []
          : rows.slice(
              args?.offset ?? 0,
              (args?.offset ?? 0) + (args?.limit ?? 200),
            ),
    );
    f.harness.sdk.stub("projects.list", async () => [
      { id: "personal", name: "Personal", kind: "personal" },
      { id: "project", name: "Project", kind: "standard" },
      { id: "design", name: "Design", kind: "standard" },
    ]);
    f.harness.sdk.stub("threads.get", async ({ threadId }) =>
      threadId === "thr_200" ? rows[200] : f.operator,
    );
    const session = await f.start();
    assert.equal(session.focus.kind, "global");
    assert.match(f.transportSettings.instructions!, /Design refresh/);
    const workspace = await f.call("workspace");
    assert.equal(workspace.threads.length, 201);
    assert.equal(workspace.truncated, false);
    await f.event({
      action: "output",
      target: "thr_200",
      message: "How is the design refresh going?",
      uncertain: false,
    });
    assert.match(f.transportSettings.context!, /Design refresh/);
    assert.ok(f.sent.some((e) => String(e.content).includes("Design refresh")));
    assert.ok(
      f.harness.inspection.sdk
        .callsTo("threads.output")
        .some((c) => JSON.stringify(c).includes("thr_200")),
    );
    const snapshot = await f.call("snapshot", {
      id: session.id,
      token: session.token,
    });
    assert.equal(snapshot.focus.kind, "global");
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("custom prompt reaches session creation; opening waits for session start and runs once", async () => {
  const f = await fixture();
  try {
    await f.call("savePreferences", {
      voicePrompt: "Speak warmly in short sentences.",
      opening: "Ready when you are.",
    });
    await f.start();
    assert.match(
      f.transportSettings.instructions!,
      /Speak warmly in short sentences/,
    );
    assert.match(
      f.transportSettings.instructions!,
      /Never narrate internal reasoning/,
    );
    assert.equal(
      f.sent.filter((e) => e.type === "session.instructions.append").length,
      0,
    );
    f.onEvent({ type: "session.started" });
    f.onEvent({ type: "session.started" });
    const openings = f.sent.filter(
      (e) => e.type === "session.instructions.append",
    );
    assert.equal(openings.length, 1);
    assert.match(String(openings[0].content), /Ready when you are/);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("blank opening leaves Live waiting for the user", async () => {
  const f = await fixture();
  try {
    await f.call("savePreferences", { opening: "" });
    await f.start();
    f.onEvent({ type: "session.started" });
    assert.equal(
      f.sent.filter((e) => e.type === "session.instructions.append").length,
      0,
    );
    assert.match(f.transportSettings.instructions!, /Wait for the user/);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("project briefings are scoped by name and contain no internal IDs", async () => {
  const f = await fixture();
  try {
    await f.start();
    await f.event({
      action: "briefing",
      target: "Project",
      message: "How is Project doing?",
      uncertain: false,
    });
    const commentary = f.sent
      .filter((e) => e.type === "session.commentary.append")
      .map((e) => e.content)
      .join(" ");
    assert.match(commentary, /Project: 1 open threads/);
    assert.doesNotMatch(commentary, /Personal:|worker|thr_/);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("thread IDs in agent output are replaced before reaching spoken commentary", async () => {
  const f = await fixture();
  try {
    f.harness.sdk.stub("threads.output", async () => ({
      output: "Finished thr_private123 in proj_private456.",
    }));
    await f.start();
    await f.event({
      action: "output",
      target: "Release",
      message: "Read the result",
      uncertain: false,
    });
    const commentary = f.sent
      .filter((e) => e.type === "session.commentary.append")
      .map((e) => e.content)
      .join(" ");
    assert.match(commentary, /Finished/);
    assert.doesNotMatch(commentary, /thr_private123|proj_private456/);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("thread capability questions answer without dispatching work", async () => {
  const f = await fixture();
  try {
    await f.start();
    await f.event({
      action: "capabilities",
      target: null,
      message: "Can I start a brand new thread directly from BB Live?",
      uncertain: false,
    });
    assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 1); // Operator initialization only
    assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
    assert.ok(
      f.sent.some((e) =>
        String(e.content).includes("create new threads in the right projects"),
      ),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("new voice task spawns once in the resolved project and tracks its real outcome", async () => {
  const f = await fixture();
  try {
    const session = await f.start();
    let worker = makeThreadResponse({
      id: "new-worker",
      projectId: "project",
      title: "Fix search",
      status: "pending",
    });
    f.harness.sdk.stub("projects.get", async () => ({
      id: "project",
      name: "Project",
      kind: "standard",
    }));
    f.harness.sdk.stub("threads.spawn", async () => worker);
    f.harness.sdk.stub("threads.get", async ({ threadId }) =>
      threadId === worker.id ? worker : f.operator,
    );
    await f.event({
      action: "spawn",
      target: "project",
      message: "Fix search\nPreserve keyboard navigation and verify it.",
      uncertain: false,
    });
    f.onEvent({
      type: "session.delegation.created",
      offset_ms: 110,
      delegation: { id: "d1", target: "client" },
    });
    const spawn = f.harness.inspection.sdk.callsTo("threads.spawn").at(-1)!;
    assert.ok(JSON.stringify(spawn).includes('"projectId":"project"'));
    assert.ok(
      JSON.stringify(spawn).includes(
        '"environment":{"type":"project-default"}',
      ),
    );
    assert.ok(JSON.stringify(spawn).includes('"visibility":"visible"'));
    assert.ok(
      JSON.stringify(spawn).includes('"permissionMode":"accept-edits"'),
    );
    assert.ok(JSON.stringify(spawn).includes("Preserve keyboard navigation"));
    assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 2);
    assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0); // spawn carries the prompt, never send twice
    assert.deepEqual(
      f.db
        .prepare("SELECT target_id,status FROM delegations WHERE id='d1'")
        .get(),
      { target_id: "new-worker", status: "working" },
    );
    await f.harness.behavior.emitThreadEvent("thread.idle", {
      thread: worker,
      lastAssistantText: null,
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(
      (
        f.db
          .prepare("SELECT status FROM delegations WHERE id='d1'")
          .get() as any
      ).status,
      "working",
    );
    worker = { ...worker, status: "idle", updatedAt: Date.now() + 1 };
    await f.harness.behavior.emitThreadEvent("thread.idle", {
      thread: worker,
      lastAssistantText: null,
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(
      (
        f.db
          .prepare("SELECT status FROM delegations WHERE id='d1'")
          .get() as any
      ).status,
      "completed",
    );
    const snapshot = await f.call("snapshot", {
      id: session.id,
      token: session.token,
    });
    assert.ok(
      snapshot.events.some(
        (e: any) => e.kind === "delegation" && e.threadId === worker.id,
      ),
    );
    assert.ok(
      f.sent.some((e) => String(e.content).includes("BB reports pending")),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("spawn needs an unambiguous project, task, and safe request", async () => {
  const f = await fixture();
  try {
    await f.start();
    for (const [i, intent] of [
      {
        action: "spawn",
        target: null,
        message: "Fix search",
        uncertain: false,
      },
      {
        action: "spawn",
        target: "missing-project",
        message: "Fix search",
        uncertain: false,
      },
      { action: "spawn", target: "project", message: "", uncertain: false },
      {
        action: "spawn",
        target: "project",
        message: "deploy the website",
        uncertain: false,
      },
      {
        action: "spawn",
        target: "project",
        message: "Fix search",
        uncertain: true,
      },
    ].entries())
      await f.event(intent as Intent, `blocked-${i}`);
    assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
    assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("this project resolves from explicit thread focus without using the Operator environment", async () => {
  const f = await fixture();
  try {
    const session = await f.start();
    await f.call("focus", {
      id: session.id,
      token: session.token,
      kind: "thread",
      target: "worker",
      explicit: true,
    });
    f.harness.sdk.stub("projects.get", async ({ projectId }) => ({
      id: projectId,
      name: "Project",
      kind: "standard",
    }));
    await f.event({
      action: "spawn",
      target: null,
      message: "Investigate search",
      uncertain: false,
    });
    const spawn = JSON.stringify(
      f.harness.inspection.sdk.callsTo("threads.spawn").at(-1),
    );
    assert.match(spawn, /"projectId":"project"/);
    assert.match(spawn, /"type":"project-default"/);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("ambiguous project names never create a thread", async () => {
  const f = await fixture();
  try {
    await f.start();
    f.harness.sdk.stub("projects.list", async () => [
      { id: "one", name: "Website", kind: "standard" },
      { id: "two", name: "Website", kind: "standard" },
    ]);
    await f.event({
      action: "spawn",
      target: "Website",
      message: "Fix search",
      uncertain: false,
    });
    assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
    assert.ok(f.sent.some((e) => String(e.content).includes("Which project")));
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("spawn failure is not retried or reported as success", async () => {
  const f = await fixture();
  try {
    await f.start();
    f.harness.sdk.stub("threads.spawn", async () => {
      throw new Error("network failure after accept");
    });
    await f.event({
      action: "spawn",
      target: "project",
      message: "Fix search",
      uncertain: false,
    });
    f.onEvent({
      type: "session.delegation.created",
      offset_ms: 110,
      delegation: { id: "d1", target: "client" },
    });
    assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 2);
    assert.equal(
      (
        f.db
          .prepare("SELECT status FROM delegations WHERE id='d1'")
          .get() as any
      ).status,
      "failed",
    );
    assert.ok(!f.sent.some((e) => String(e.content).includes("Created")));
    assert.ok(
      f.sent.some((e) =>
        String(e.content).includes("may already have been accepted"),
      ),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("a multi-project voice dump reaches the Operator with all tasks and a directory", async () => {
  const f = await fixture();
  try {
    await f.start();
    const message =
      "Continue the Release thread in Project with keyboard checks. Start a separate BB Live task to investigate voice routing, keeping the UI unchanged.";
    await f.event({
      action: "operator",
      target: null,
      message,
      uncertain: false,
    });
    const sends = f.harness.inspection.sdk.callsTo("threads.send");
    assert.equal(sends.length, 1);
    const dispatch = JSON.stringify(sends[0]);
    assert.ok(dispatch.includes(message));
    assert.ok(dispatch.includes("Workspace directory"));
    assert.ok(dispatch.includes("existing project threads"));
    assert.ok(dispatch.includes("bb thread spawn --project"));
    assert.ok(dispatch.includes('"threadId":"operator"'));
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("project-level follow-up investigates ownership instead of demanding thread selection", async () => {
  const f = await fixture();
  try {
    await f.start();
    await f.event({
      action: "send",
      target: "project",
      message: "Investigate search in Project",
      uncertain: false,
    });
    assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 1);
    assert.ok(
      JSON.stringify(
        f.harness.inspection.sdk.callsTo("threads.send")[0],
      ).includes('"threadId":"operator"'),
    );
    assert.ok(
      !f.sent.some((e) => String(e.content).includes("name or select")),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
