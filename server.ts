import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract, type SessionAuth, type LiveEvent } from "./src/contract";
import {
  GLOBAL,
  chooseFocus,
  resolveTarget,
  isWorking,
  redact,
  requiresVisual,
  OPERATOR_PROMPT,
  LIVE_PROMPT,
  type Focus,
} from "./src/policy";
import {
  transport,
  type LiveTransport,
  type LiveSocket,
} from "./src/live-transport";
import { createPreferences } from "./src/preferences";
export { rpcContract };
type Delegation = {
  id: string;
  sessionId: string;
  target: string | null;
  queueId: string | null;
  state: string;
  operator: boolean;
  requestedAt: number;
};
type Session = {
  id: string;
  token: string;
  remoteId: string | null;
  key: string;
  socket: LiveSocket | null;
  focus: Focus;
  operatorId: string;
  status: string;
  events: LiveEvent[];
  sequence: number;
  heartbeat: number;
  abort: AbortController;
  chain: Promise<void>;
  seen: Set<string>;
  transcripts: { role: string; text: string; start: number; end: number }[];
  pending: { id: string; threadId: string; title: string }[];
  openThreadId: string | null;
  retention: number;
  closedAck?: () => void;
  finalized?: boolean;
  started?: boolean;
  opening: string;
  names: Map<string, string>;
  openingEventId?: string;
  endPromise?: Promise<void>;
};
export async function setup(bb: BbPluginApi, live: LiveTransport = transport) {
  const preferences = await createPreferences(bb);
  const secrets = bb.settings.define({
    openaiApiKey: { type: "string", label: "OpenAI API key", secret: true },
  });
  const settings = {
    get: async () => ({ ...preferences.get(), ...(await secrets.get()) }),
  };
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE operator_state (singleton_key TEXT PRIMARY KEY, operator_thread_id TEXT NOT NULL, schema_version INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE voice_sessions (id TEXT PRIMARY KEY, openai_session_id TEXT, started_at INTEGER NOT NULL, ended_at INTEGER, focus_json TEXT NOT NULL, status TEXT NOT NULL, summary TEXT)`,
    `CREATE TABLE voice_session_events (session_id TEXT NOT NULL, sequence INTEGER NOT NULL, timestamp INTEGER NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(session_id,sequence))`,
    `CREATE TABLE delegations (id TEXT NOT NULL, session_id TEXT NOT NULL, target_id TEXT, queue_id TEXT, status TEXT NOT NULL, requested_at INTEGER NOT NULL, completed_at INTEGER, verified_result TEXT, operator INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(session_id,id))`,
  ]);
  db.prepare(
    "UPDATE voice_sessions SET status='interrupted',ended_at=? WHERE ended_at IS NULL",
  ).run(Date.now());
  // Dispatches interrupted by reload are never replayed automatically.
  db.prepare(
    "UPDATE delegations SET status='unknown' WHERE status IN ('received','resolving','dispatched','working')",
  ).run();
  let active: Session | null = null,
    disposed = false,
    operatorPromise: Promise<string> | null = null;
  const delegations = new Map<string, Delegation>();
  const clean = (text: string, s?: Session) =>
    redact(text, s ? [s.key] : []).slice(0, 6000);
  function emit(
    s: Session,
    kind: string,
    text: string,
    threadId: string | null = null,
  ) {
    const event = {
      sequence: ++s.sequence,
      at: Date.now(),
      kind,
      text: clean(text, s),
      threadId,
    };
    s.events.push(event);
    if (s.events.length > 160) s.events.shift();
    if (s.retention > 0) {
      db.prepare("INSERT INTO voice_session_events VALUES (?,?,?,?,?)").run(
        s.id,
        event.sequence,
        event.at,
        kind,
        JSON.stringify(event),
      );
      if (event.sequence % 100 === 0)
        db.prepare(
          "DELETE FROM voice_session_events WHERE session_id=? AND sequence<?",
        ).run(s.id, event.sequence - 8000);
    }
  }
  function append(
    s: Session,
    text: string,
    id: string | null = null,
    kind = "commentary",
  ) {
    s.socket?.send({
      type: `session.${kind}.append`,
      event_id: randomUUID(),
      delegation_id: id,
      content: clean(text, s)
        .replace(
          /\b(?:thr|proj|env|host|live)_[a-zA-Z0-9_-]+\b/g,
          (id) => s.names.get(id) ?? "the referenced item",
        )
        .slice(0, 6000),
    });
  }
  function authorized(auth: SessionAuth) {
    if (
      !active ||
      auth.id !== active.id ||
      auth.token.length !== active.token.length ||
      !timingSafeEqual(Buffer.from(auth.token), Buffer.from(active.token))
    )
      throw new Error("This voice session has ended. Start a new session.");
    return active;
  }
  async function listWorkspaceThreads() {
    const rows = [];
    for (let offset = 0; offset < 2000; offset += 200) {
      const page = await bb.sdk.threads.list({
        archived: false,
        includeHidden: false,
        limit: 200,
        offset,
      });
      rows.push(...page);
      if (page.length < 200) break;
    }
    return rows;
  }
  function greet(s: Session) {
    if (
      !s.started ||
      !s.socket ||
      !s.opening ||
      s.openingEventId ||
      s.abort.signal.aborted
    )
      return;
    s.openingEventId = randomUUID();
    s.socket.send({
      type: "session.instructions.append",
      event_id: s.openingEventId,
      delegation_id: null,
      content: `Greet immediately without waiting for the user, in English unless the voice prompt specifies another language. Say these opening words, then pause and listen: ${JSON.stringify(s.opening)}. Keep the existing session instructions.`,
    });
  }
  async function workspace() {
    const [rows, projects] = await Promise.all([
      listWorkspaceThreads(),
      bb.sdk.projects.list({ includePersonal: true }),
    ]);
    return {
      threads: rows
        .filter((t) => t.visibility === "visible" && !t.deletedAt)
        .map((t) => ({
          id: t.id,
          title: t.title ?? t.titleFallback ?? "Untitled thread",
          projectId: t.projectId,
          status: t.hasPendingInteraction ? "needs attention" : t.status,
          queued: t.queuedWork === "none" ? 0 : 1,
        })),
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      truncated: rows.length === 2000,
    };
  }
  async function focusFor(
    kind: Focus["kind"],
    target: string | null,
    explicit: boolean,
  ): Promise<Focus> {
    if (kind === "global") return { ...GLOBAL, explicit };
    if (!target) throw new Error("Choose a focus first.");
    if (kind === "project") {
      const p = await bb.sdk.projects.get({ projectId: target });
      return { kind, id: p.id, label: p.name, explicit };
    }
    const t = await bb.sdk.threads.get({ threadId: target });
    if (t.archivedAt || t.deletedAt)
      throw new Error("That thread is no longer available.");
    return {
      kind,
      id: t.id,
      label: t.title ?? t.titleFallback ?? "Untitled thread",
      explicit,
    };
  }
  function setFocus(s: Session, next: Focus) {
    s.focus = chooseFocus(
      s.focus,
      next,
      [...delegations.values()].some(
        (d) =>
          d.sessionId === s.id &&
          ["working", "dispatched", "resolving"].includes(d.state),
      ),
    );
    db.prepare("UPDATE voice_sessions SET focus_json=? WHERE id=?").run(
      JSON.stringify(s.focus),
      s.id,
    );
    emit(
      s,
      "focus",
      s.focus.label,
      s.focus.kind === "thread" ? s.focus.id : null,
    );
    append(
      s,
      `Current conversation focus: ${s.focus.label}. All projects remain accessible.`,
      null,
      "thinking",
    );
    return s.focus;
  }
  async function ensureOperator(s?: Session): Promise<string> {
    if (operatorPromise) return operatorPromise;
    operatorPromise = (async () => {
      const stored = db
        .prepare(
          "SELECT operator_thread_id FROM operator_state WHERE singleton_key=?",
        )
        .get("operator") as { operator_thread_id: string } | undefined;
      const candidates = stored
        ? [stored.operator_thread_id]
        : [
            ...(await bb.sdk.threads.list({
              originPluginId: bb.pluginId,
              includeHidden: false,
              limit: 200,
              archived: false,
            })),
            ...(await bb.sdk.threads.list({
              originPluginId: bb.pluginId,
              includeHidden: false,
              limit: 200,
              archived: true,
            })),
          ].map((t) => t.id);
      for (const id of candidates) {
        let t;
        try {
          t = await bb.sdk.threads.get({ threadId: id });
        } catch (error) {
          if ((error as { status?: number }).status === 404) continue;
          // SDK adapters need not expose an HTTP status. Confirm absence through
          // successful authoritative lists before replacing a missing Operator.
          const [open, archived] = await Promise.all([
            bb.sdk.threads.list({
              originPluginId: bb.pluginId,
              archived: false,
              limit: 200,
            }),
            bb.sdk.threads.list({
              originPluginId: bb.pluginId,
              archived: true,
              limit: 200,
            }),
          ]);
          if (
            open.length < 200 &&
            archived.length < 200 &&
            ![...open, ...archived].some((t) => t.id === id)
          )
            continue;
          throw error;
        }
        if (t.deletedAt) continue;
        const metadata = await bb.sdk.threads.getPluginMetadata({
          threadId: id,
        });
        const project = await bb.sdk.projects.get({ projectId: t.projectId });
        if (
          metadata.role !== "bb-live-operator" ||
          metadata.schemaVersion !== 1 ||
          project.kind !== "personal" ||
          t.parentThreadId
        )
          continue;
        if (t.archivedAt) {
          if (s) emit(s, "notice", "Reopening your BB Operator thread.", id);
          await bb.sdk.threads.unarchive({ threadId: id });
        }
        await bb.sdk.threads.pin({ threadId: id });
        db.prepare(
          "INSERT OR REPLACE INTO operator_state VALUES (?,?,1,?)",
        ).run("operator", id, Date.now());
        return id;
      }
      const project = (
        await bb.sdk.projects.list({ includePersonal: true })
      ).find((p) => p.kind === "personal");
      if (!project) throw new Error("BB Personal project is unavailable.");
      const config = await settings.get();
      const thread = await bb.sdk.threads.spawn({
        projectId: project.id,
        environment: { type: "host", workspace: { type: "personal" } },
        title: "BB Operator",
        visibility: "visible",
        permissionMode: "accept-edits",
        ...(config.operatorProvider
          ? { providerId: config.operatorProvider }
          : {}),
        ...(config.operatorModel ? { model: config.operatorModel } : {}),
        ...(config.operatorReasoningLevel !== "default"
          ? {
              reasoningLevel: config.operatorReasoningLevel as Exclude<
                typeof config.operatorReasoningLevel,
                "default"
              >,
            }
          : {}),
        ...(config.operatorServiceTier !== "default"
          ? { serviceTier: config.operatorServiceTier }
          : {}),
        pluginMetadata: { role: "bb-live-operator", schemaVersion: 1 },
        prompt:
          OPERATOR_PROMPT +
          "\nInitialize as the visible BB Operator. Acknowledge readiness briefly, then wait for a coordination request. Do not start other work.",
      });
      // Persist before pin so retrying a partial failure cannot create a duplicate.
      db.prepare("INSERT OR REPLACE INTO operator_state VALUES (?,?,1,?)").run(
        "operator",
        thread.id,
        Date.now(),
      );
      await bb.sdk.threads.pin({ threadId: thread.id });
      return thread.id;
    })();
    try {
      return await operatorPromise;
    } finally {
      operatorPromise = null;
    }
  }
  bb.agents.configure((ctx) => ({
    tools: [],
    skills: [],
    ...(ctx.project.kind === "personal" &&
    ctx.pluginMetadata.role === "bb-live-operator"
      ? { instructions: OPERATOR_PROMPT }
      : {}),
  }));
  function update(d: Delegation, state: string, result?: string) {
    d.state = state;
    db.prepare(
      "UPDATE delegations SET target_id=?,queue_id=?,status=?,completed_at=?,verified_result=?,operator=? WHERE session_id=? AND id=?",
    ).run(
      d.target,
      d.queueId,
      state,
      ["completed", "failed", "cancelled"].includes(state) ? Date.now() : null,
      result ?? null,
      d.operator ? 1 : 0,
      d.sessionId,
      d.id,
    );
  }
  function result(
    s: Session,
    d: Delegation,
    text: string,
    state = "completed",
  ) {
    text = clean(text, s);
    update(d, state, s.retention > 0 ? text : undefined);
    emit(s, state === "failed" ? "failure" : "result", text, d.target);
    if (s.status !== "ended") append(s, text, d.id);
  }
  async function end(s: Session, reason: string) {
    if (s.endPromise) return s.endPromise;
    s.endPromise = Promise.resolve().then(async () => {
      s.status = "ending";
      s.abort.abort();
      emit(s, "notice", reason + " BB work continues.");
      if (s.socket) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 1500);
          s.closedAck = () => {
            s.finalized = true;
            clearTimeout(timer);
            resolve();
          };
          s.socket!.send({ type: "session.close" });
        });
        s.socket.close();
        s.socket = null;
      }
      if (s.remoteId && !s.finalized)
        await live.closeRemote(s.key, s.remoteId).catch(() => {});
      s.status = "ended";
      db.prepare(
        "UPDATE voice_sessions SET ended_at=?,status=?,focus_json=?,summary=? WHERE id=?",
      ).run(
        Date.now(),
        reason,
        JSON.stringify(s.focus),
        `${s.finalized ? "Finalized" : "Final usage unconfirmed"}; ${s.sequence} events; ${[...delegations.values()].filter((d) => d.sessionId === s.id && d.state === "working").length} tasks continue.`,
        s.id,
      );
      s.key = "";
      s.transcripts = [];
      if (active === s) active = null;
    });
    return s.endPromise;
  }
  async function delegate(s: Session, id: string, offset: number) {
    if (s.seen.has(id) || s.abort.signal.aborted) return;
    s.seen.add(id);
    const d: Delegation = {
      id,
      sessionId: s.id,
      target: null,
      queueId: null,
      state: "received",
      operator: false,
      requestedAt: Date.now(),
    };
    delegations.set(`${s.id}:${id}`, d);
    db.prepare(
      "INSERT INTO delegations (id,session_id,status,requested_at) VALUES (?,?,?,?)",
    ).run(id, s.id, d.state, d.requestedAt);
    // Freeze context at delegation time, rather than including later utterances in an earlier request.
    const requestFocus = { ...s.focus };
    const transcript = s.transcripts
      .filter((t) => t.start <= offset)
      .slice(-24)
      .map((t) => `${t.role}: ${t.text}`)
      .join("\n");
    s.chain = s.chain.then(async () => {
      if (s.abort.signal.aborted) {
        update(d, "cancelled");
        return;
      }
      try {
        update(d, "resolving");
        const config = await settings.get();
        const world = await workspace();
        for (const p of world.projects) s.names.set(p.id, p.name);
        for (const t of world.threads) s.names.set(t.id, t.title);
        const intent = await live.classify(
          s.key,
          config.routerModel,
          JSON.stringify({
            conversation: transcript,
            focus: requestFocus,
            workspace: world,
          }),
          s.abort.signal,
        );
        if (s.abort.signal.aborted) {
          update(d, "cancelled");
          return;
        }
        if (intent.uncertain || intent.action === "clarify") {
          result(
            s,
            d,
            intent.message || "Which thread and action did you mean?",
          );
          return;
        }
        if (intent.action === "visual" || requiresVisual(intent.message)) {
          result(
            s,
            d,
            "This request needs visual review in BB. Open the relevant thread and use its normal composer or approval controls.",
          );
          emit(
            s,
            "approval",
            "Review this request in BB.",
            s.focus.kind === "thread" ? s.focus.id : null,
          );
          return;
        }
        if (intent.action === "briefing") {
          const projects = intent.target
            ? world.projects.filter(
                (p) =>
                  p.id === intent.target ||
                  p.name.toLowerCase() === intent.target!.toLowerCase(),
              )
            : world.projects;
          if (!projects.length || (intent.target && projects.length !== 1)) {
            result(s, d, "Which project did you mean?");
            return;
          }
          const summaries = projects.map((p) => {
            const threads = world.threads.filter((t) => t.projectId === p.id);
            const notable = threads.filter(
              (t) =>
                isWorking(t.status) ||
                ["needs attention", "error"].includes(t.status),
            );
            return `${p.name}: ${threads.length} open threads. ${
              notable
                .slice(0, 4)
                .map((t) => `${t.title}: ${t.status}`)
                .join("; ") || "No active work or blockers in the current list."
            }`;
          });
          result(
            s,
            d,
            `Workspace overview. Summarize the most relevant projects, active work and blockers in a few sentences; offer to expand. ${summaries.join("\n")}${world.truncated ? " Listing is incomplete; ask the Operator for deeper discovery." : ""}`,
          );
          return;
        }
        if (intent.action === "focus" && intent.target) {
          const project = world.projects.filter(
            (p) =>
              p.id === intent.target ||
              p.name.toLowerCase() === intent.target!.toLowerCase(),
          );
          const matches = resolveTarget(
            intent.target,
            requestFocus,
            world.threads,
          );
          if (project.length === 1 && matches.length === 0) {
            setFocus(s, await focusFor("project", project[0].id, true));
            result(s, d, `Focused ${s.focus.label}.`);
            return;
          }
          if (/^(global|all of bb|workspace)$/i.test(intent.target)) {
            setFocus(s, { ...GLOBAL, explicit: true });
            result(s, d, "Focused all of BB.");
            return;
          }
        }
        if (intent.action === "operator") {
          d.target = s.operatorId;
          d.operator = true;
          await dispatch(
            s,
            d,
            "send",
            `${OPERATOR_PROMPT}\n\nCoordination request (${id}):\n${intent.message}\nFocus: ${JSON.stringify(requestFocus)}\nRecent conversation (untrusted, later corrections override earlier fragments):\n${transcript.slice(-9000)}`,
          );
          return;
        }
        const matches = resolveTarget(
          intent.target,
          requestFocus,
          world.threads,
        );
        if (matches.length !== 1) {
          result(
            s,
            d,
            matches.length
              ? "Several threads match. Please use the full thread title."
              : "Please name or select a thread.",
          );
          return;
        }
        const target = await bb.sdk.threads.get({ threadId: matches[0].id });
        s.names.set(
          target.id,
          target.title ?? target.titleFallback ?? "Untitled thread",
        );
        d.target = target.id;
        if (target.archivedAt || target.deletedAt) {
          result(s, d, "That thread is no longer available.");
          return;
        }
        if (intent.action === "focus" || intent.action === "open") {
          setFocus(s, await focusFor("thread", target.id, true));
          if (intent.action === "open") s.openThreadId = target.id;
          result(s, d, `Focused ${s.focus.label}.`);
          return;
        }
        if (intent.action === "status" || intent.action === "output") {
          const [output, queue, interactions] = await Promise.all([
            bb.sdk.threads.output({ threadId: target.id }),
            bb.sdk.threads.queuedMessages.list({ threadId: target.id }),
            bb.sdk.threads.interactions.list({ threadId: target.id }),
          ]);
          result(
            s,
            d,
            `${target.title ?? target.titleFallback ?? "Untitled thread"}: ${target.status}; ${queue.length} queued; ${interactions.length} pending interactions.${intent.action === "output" ? ` Latest agent report (not independent proof of task completion): ${clean(output.output ?? "No output yet.", s).slice(0, 1000)}` : ""}`,
          );
          return;
        }
        if (intent.action === "stop") {
          if (!intent.target) {
            result(
              s,
              d,
              `Please say “stop ${target.title ?? target.titleFallback ?? "Untitled thread"}” to confirm the target.`,
            );
            return;
          }
          await bb.sdk.threads.stop({ threadId: target.id });
          const current = await bb.sdk.threads.get({ threadId: target.id });
          result(
            s,
            d,
            current.status === "idle"
              ? `Stopped ${target.title ?? target.titleFallback ?? "Untitled thread"}. Its workspace is preserved.`
              : `Stop requested for ${target.title ?? target.titleFallback ?? "Untitled thread"}; current state is ${current.status}.`,
          );
          return;
        }
        await dispatch(s, d, intent.action, intent.message);
      } catch {
        if (s.abort.signal.aborted) update(d, "cancelled");
        else
          result(
            s,
            d,
            "The request could not be verified. Inspect the thread before trying again; the action may already have been accepted.",
            "failed",
          );
      }
    });
    await s.chain;
  }
  async function dispatch(
    s: Session,
    d: Delegation,
    mode: string,
    message: string,
  ) {
    if (!d.target) throw new Error("Missing target");
    if (
      mode !== "steer" &&
      [...delegations.values()].some(
        (other) =>
          other !== d &&
          other.target === d.target &&
          ["working", "dispatched"].includes(other.state),
      )
    ) {
      result(
        s,
        d,
        "A voice request is already being tracked for this thread. Use its BB composer to change that work, or wait for its result.",
      );
      return;
    }
    const thread = await bb.sdk.threads.get({ threadId: d.target });
    if (thread.archivedAt || thread.deletedAt)
      throw new Error("Unavailable target");
    if (mode === "steer")
      for (const prior of delegations.values())
        if (
          prior !== d &&
          prior.target === d.target &&
          prior.state === "working"
        )
          update(prior, "cancelled");
    const input = [{ type: "text" as const, text: message, mentions: [] }];
    update(d, "dispatched");
    // start queues behind an active turn; auto may join the turn, so never use it for a default follow-up.
    const sent = await bb.sdk.threads.send({
      threadId: d.target,
      input,
      mode: mode === "steer" ? "steer" : "start",
      permissionMode: "accept-edits",
    });
    if (sent.delivery === "queued") {
      d.queueId = sent.queuedMessage.id;
      update(d, "dispatched");
      emit(
        s,
        "delegation",
        `Queued for ${thread.title ?? thread.titleFallback ?? "Untitled thread"}.`,
        d.target,
      );
      if ((await settings.get()).spokenProgress !== "quiet")
        append(
          s,
          `Queued the instruction for ${thread.title ?? thread.titleFallback ?? "Untitled thread"}; it has not executed yet.`,
          d.id,
        );
    } else {
      update(d, "working");
      emit(
        s,
        "delegation",
        `${mode === "steer" ? "Steered" : "Sent to"} ${thread.title ?? thread.titleFallback ?? "Untitled thread"}.`,
        d.target,
      );
      if ((await settings.get()).spokenProgress !== "quiet")
        append(
          s,
          `${mode === "steer" ? "Steered" : "Sent to"} ${thread.title ?? thread.titleFallback ?? "Untitled thread"}. Work is not complete yet.`,
          d.id,
        );
    }
  }
  async function onEvent(s: Session, event: Record<string, unknown>) {
    if (event.type === "session.started") {
      s.started = true;
      greet(s);
      return;
    }
    if (
      event.type === "session.instructions.appended" &&
      event.client_event_id === s.openingEventId
    ) {
      emit(s, "notice", "Opening accepted.");
      return;
    }
    if (event.type === "session.closed") {
      s.closedAck?.();
      if (s.status !== "ending" && s.status !== "ended")
        void end(s, "Voice connection ended");
      return;
    }
    if (s.abort.signal.aborted) return;
    if (event.type === "error") {
      emit(
        s,
        "failure",
        "Live reported an error. End the session and check API access if it persists.",
      );
      return;
    }
    if (
      event.type === "session.input_transcript.delta" ||
      event.type === "session.output_transcript.delta"
    ) {
      if (typeof event.delta !== "string") return;
      const role =
        event.type === "session.input_transcript.delta" ? "user" : "BB";
      const text = clean(event.delta, s);
      const start = typeof event.start_ms === "number" ? event.start_ms : 0;
      const finish = typeof event.end_ms === "number" ? event.end_ms : start;
      const prev = s.transcripts.at(-1);
      if (
        prev &&
        prev.role === role &&
        start - prev.end < 1800 &&
        prev.text.length < 4000
      ) {
        prev.text += text;
        prev.end = finish;
      } else s.transcripts.push({ role, text, start, end: finish });
      if (s.transcripts.length > 80) s.transcripts.shift();
      emit(s, role === "user" ? "user" : "speech", text);
    }
    if (event.type === "session.delegation.created") {
      const parsed = z
        .object({
          delegation: z.object({ id: z.string(), target: z.literal("client") }),
          offset_ms: z.number(),
        })
        .safeParse(event);
      if (parsed.success)
        await delegate(s, parsed.data.delegation.id, parsed.data.offset_ms);
    }
  }
  bb.rpc.register(rpcContract, {
    preferences: async () => preferences.get(),
    savePreferences: async (patch) => {
      const next = await preferences.update(patch);
      if (active) active.retention = next.transcriptRetentionDays;
      await prune();
      return next;
    },
    operatorDefaults: async () => {
      const providers = await bb.sdk.providers.list();
      const provider = providers.find((p) => p.available);
      if (!provider)
        throw new Error(
          "No agent provider is available on your primary machine.",
        );
      const catalog = await bb.sdk.providers.models({
        providerId: provider.id,
      });
      const model =
        catalog.models.find((m) => m.isDefault) ?? catalog.models[0];
      if (!model) throw new Error("No models are available for this provider.");
      return {
        providerId: provider.id,
        model: model.model,
        reasoningLevel: model.defaultReasoningEffort,
      };
    },
    config: async () => ({
      configured: !!(await settings.get()).openaiApiKey,
      busy: !!active,
    }),
    workspace,
    start: async ({ sdp }) => {
      if (disposed || active)
        throw new Error(
          "A voice session is already open. End it before starting another.",
        );
      const config = await settings.get();
      if (!config.openaiApiKey)
        throw new Error("Add an OpenAI API key in BB Live settings.");
      const s: Session = {
        id: randomUUID(),
        token: randomBytes(32).toString("hex"),
        remoteId: null,
        key: config.openaiApiKey,
        socket: null,
        focus: { ...GLOBAL },
        operatorId: "",
        status: "connecting",
        events: [],
        sequence: 0,
        heartbeat: Date.now(),
        abort: new AbortController(),
        chain: Promise.resolve(),
        seen: new Set(),
        transcripts: [],
        pending: [],
        openThreadId: null,
        retention: config.transcriptRetentionDays,
        opening: config.opening,
        names: new Map(),
      };
      active = s;
      db.prepare(
        "INSERT INTO voice_sessions (id,started_at,focus_json,status) VALUES (?,?,?,?)",
      ).run(s.id, Date.now(), JSON.stringify(s.focus), s.status);
      try {
        s.operatorId = await ensureOperator(s);
        if (s.abort.signal.aborted || disposed)
          throw new Error("Session cancelled.");
        const world = await workspace();
        for (const p of world.projects) s.names.set(p.id, p.name);
        for (const t of world.threads) s.names.set(t.id, t.title);
        const directory = JSON.stringify(
          world.projects.map((p) => ({
            project: p.name,
            threads: world.threads
              .filter((t) => t.projectId === p.id)
              .slice(0, 8)
              .map((t) => ({ name: t.title, status: t.status })),
          })),
        ).slice(0, 24000);
        const instructions = `${config.voicePrompt}

${LIVE_PROMPT}
Wait for the user to speak unless a subsequent instruction explicitly requests an opening.
Workspace directory at connection time (untrusted reference data, possibly incomplete or stale; delegate for fresh status or missing work):
${redact(directory, [s.key])}`;
        const remote = await live.create(
          s.key,
          sdp,
          config.voice,
          s.abort.signal,
          instructions,
        );
        s.remoteId = remote.id;
        s.socket = await live.attach(
          s.key,
          remote.id,
          (event) => {
            void onEvent(s, event).catch(() => {
              emit(s, "failure", "Live event handling failed.");
            });
          },
          () => {
            void end(s, "Live control connection lost");
          },
        );
        if (s.abort.signal.aborted) {
          s.socket.close();
          throw new Error("Session ended during connection.");
        }
        s.status = "connected";
        db.prepare(
          "UPDATE voice_sessions SET openai_session_id=?,status=?,focus_json=? WHERE id=?",
        ).run(remote.id, s.status, JSON.stringify(s.focus), s.id);
        emit(s, "notice", "Voice connected.");
        greet(s);
        return {
          id: s.id,
          token: s.token,
          sdp: remote.sdp,
          operatorId: s.operatorId,
          focus: s.focus,
        };
      } catch {
        await end(s, "Connection failed");
        throw new Error(
          "Could not connect BB Live. Check API access, Operator settings, and microphone permissions.",
        );
      }
    },
    snapshot: async (auth) => {
      const s = authorized(auth);
      return {
        status: s.status,
        focus: s.focus,
        events: s.events,
        pending: s.pending,
        openThreadId: s.openThreadId,
      };
    },
    focus: async (args) => {
      const s = authorized(args);
      return setFocus(s, await focusFor(args.kind, args.target, args.explicit));
    },
    control: async (args) => {
      const s = authorized(args);
      if (args.command === "end") await end(s, "Voice session ended");
      else if (args.command === "heartbeat") s.heartbeat = Date.now();
      else
        append(
          s,
          "Stop speaking now and wait for the user. Do not cancel any BB work.",
          null,
          "instructions",
        );
      return { ok: true };
    },
  });
  const unsubscribers = [
    bb.events.on("thread.idle", () => {
      void reconcile().catch(() => {});
    }),
    bb.events.on("thread.failed", () => {
      void reconcile().catch(() => {});
    }),
    bb.events.on("thread.active", async ({ thread }) => {
      if (
        active &&
        (await settings.get()).spokenProgress === "verbose" &&
        [...delegations.values()].some(
          (d) => d.target === thread.id && d.sessionId === active?.id,
        )
      )
        append(
          active,
          `${thread.title ?? thread.titleFallback ?? "Untitled thread"} is now running.`,
        );
    }),
    bb.events.on("message.dispatched", ({ entry }) => {
      for (const d of delegations.values())
        if (d.queueId === entry.id && d.state === "dispatched")
          update(d, "working");
    }),
    bb.events.on("message.cancelled", ({ entry }) => {
      for (const d of delegations.values())
        if (d.queueId === entry.id) {
          update(d, "cancelled");
          if (active?.id === d.sessionId)
            result(active, d, "The queued request was cancelled.", "cancelled");
        }
    }),
    bb.events.on("interaction.pending", ({ thread, interaction }) => {
      const s = active;
      if (!s || s.pending.some((x) => x.id === interaction.id)) return;
      if (
        s.focus.id !== thread.id &&
        ![...delegations.values()].some(
          (d) => d.target === thread.id && d.sessionId === s.id,
        )
      )
        return;
      s.pending.push({
        id: interaction.id,
        threadId: thread.id,
        title:
          "Review in " +
          (thread.title ?? thread.titleFallback ?? "Untitled thread"),
      });
      emit(s, "approval", "A visual interaction is waiting in BB.", thread.id);
      append(
        s,
        `A visual interaction is waiting in ${thread.title ?? thread.titleFallback ?? "Untitled thread"}. Open BB to review it.`,
      );
    }),
    ...(["thread.archived", "thread.deleted"] as const).map((name) =>
      bb.events.on(name, ({ thread }) => {
        if (active?.focus.id === thread.id) {
          active.focus = { ...GLOBAL };
          setFocus(active, { ...GLOBAL });
          emit(
            active,
            "notice",
            "Focused thread is unavailable. Choose another focus.",
          );
        }
        for (const d of delegations.values())
          if (
            d.target === thread.id &&
            ["working", "dispatched"].includes(d.state)
          ) {
            update(d, "cancelled");
            if (active?.id === d.sessionId)
              result(
                active,
                d,
                "The target thread became unavailable.",
                "cancelled",
              );
          }
      }),
    ),
  ];
  let reconciliation: Promise<void> | null = null;
  function reconcile() {
    if (reconciliation) return reconciliation;
    reconciliation = reconcileOnce().finally(() => {
      reconciliation = null;
    });
    return reconciliation;
  }
  async function reconcileOnce() {
    if (disposed) return;
    for (const [key, d] of delegations)
      if (
        ["completed", "failed", "cancelled"].includes(d.state) &&
        Date.now() - d.requestedAt > 3600000
      )
        delegations.delete(key);
    const s = active;
    if (s && Date.now() - s.heartbeat > 45000) {
      await end(s, "Client disconnected");
      return;
    }
    for (const d of delegations.values()) {
      if (d.state !== "working" || !d.target) continue;
      try {
        const thread = await bb.sdk.threads.get({ threadId: d.target });
        if (isWorking(thread.status) || thread.updatedAt < d.requestedAt)
          continue;
        if (d.operator) {
          const children = await bb.sdk.threads.list({
            parentThreadId: d.target,
            limit: 200,
          });
          if (children.some((c) => isWorking(c.status))) continue;
        }
        const output = await bb.sdk.threads.output({ threadId: d.target });
        const text = `${thread.title ?? thread.titleFallback ?? "Untitled thread"} is ${thread.status}. Latest agent report (task validation is in the thread): ${clean(output.output ?? "No final output was provided.", s ?? undefined).slice(0, 1000)}`;
        if (s?.id === d.sessionId)
          result(
            s,
            d,
            text,
            thread.status === "error" ? "failed" : "completed",
          );
        else update(d, thread.status === "error" ? "failed" : "completed");
      } catch {
        /* A transient SDK failure must not invent a completed result. */
      }
    }
    if (s) {
      const targets = new Set([
        ...(s.focus.kind === "thread" && s.focus.id ? [s.focus.id] : []),
        ...[...delegations.values()]
          .filter(
            (d) =>
              d.sessionId === s.id &&
              ["working", "dispatched"].includes(d.state),
          )
          .map((d) => d.target)
          .filter((id): id is string => !!id),
      ]);
      for (const threadId of targets) {
        try {
          for (const interaction of await bb.sdk.threads.interactions.list({
            threadId,
          })) {
            if (!s.pending.some((p) => p.id === interaction.id)) {
              s.pending.push({
                id: interaction.id,
                threadId,
                title: "Review in BB",
              });
              emit(
                s,
                "approval",
                "A visual interaction is waiting in BB.",
                threadId,
              );
              append(
                s,
                "A visual interaction is waiting in BB. Open the thread to review it.",
              );
            }
          }
        } catch {}
      }
      s.pending = s.pending.slice(-20);
      for (const p of [...s.pending]) {
        try {
          const rows = await bb.sdk.threads.interactions.list({
            threadId: p.threadId,
          });
          if (!rows.some((x) => x.id === p.id))
            s.pending = s.pending.filter((x) => x.id !== p.id);
        } catch {}
      }
    }
  }
  let polling = false;
  const timer = setInterval(() => {
    if (!polling) {
      polling = true;
      void reconcile()
        .catch(() => {})
        .finally(() => {
          polling = false;
        });
    }
  }, 3000);
  const prune = async () => {
    const days = (await settings.get()).transcriptRetentionDays;
    const cutoff = Date.now() - days * 86400000;
    if (days === 0) {
      db.prepare("DELETE FROM voice_session_events").run();
      db.prepare("UPDATE delegations SET verified_result=NULL").run();
    }
    db.prepare("DELETE FROM voice_session_events WHERE timestamp<?").run(
      cutoff,
    );
    db.prepare(
      "UPDATE delegations SET verified_result=NULL WHERE requested_at<?",
    ).run(cutoff);
    db.prepare("DELETE FROM voice_sessions WHERE ended_at<?").run(
      Date.now() - 90 * 86400000,
    );
    db.prepare("DELETE FROM delegations WHERE requested_at<?").run(
      Date.now() - 90 * 86400000,
    );
  };
  await prune();
  bb.background.schedule("retention", "0 * * * *", prune);
  secrets.onChange((next) => {
    if (active) {
      if (next.openaiApiKey !== active.key)
        void end(active, "API configuration changed");
    }
    void prune();
  });
  bb.cli.register({
    name: "bb-live",
    summary: "Inspect BB Live status",
    commands: [
      {
        name: "operator",
        summary: "Create or reuse the pinned BB Operator",
        usage: "bb bb-live operator",
      },
      {
        name: "status",
        summary: "Show configuration and recent session records",
        usage: "bb bb-live status",
      },
    ],
    async run(argv) {
      if (argv[0] === "operator") {
        const id = await ensureOperator();
        return { exitCode: 0, stdout: JSON.stringify({ operatorId: id }) };
      }
      if (argv[0] && argv[0] !== "status")
        return { exitCode: 1, stderr: "Usage: bb bb-live status | operator" };
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          configured: !!(await settings.get()).openaiApiKey,
          active: active
            ? { id: active.id, status: active.status, focus: active.focus }
            : null,
          sessions: db
            .prepare(
              "SELECT id,started_at,ended_at,status,summary FROM voice_sessions ORDER BY started_at DESC LIMIT 5",
            )
            .all(),
        }),
      };
    },
  });
  bb.onDispose(async () => {
    disposed = true;
    clearInterval(timer);
    if (active) {
      const s = active;
      await end(s, "Plugin unloaded");
      await s.chain;
    }
    if (reconciliation) await reconciliation;
  });
}
export default setup;
