# BB Live — Product and Implementation Specification

Status: Draft for implementation

Date: 2026-09-16

Audience: A new agent implementing a BB plugin from a clean checkout

Working name: BB Live

## Handoff directive

Build a BB plugin that gives the user one persistent, full-duplex voice channel into BB. The voice session is global to BB rather than owned by whichever thread happens to be visible. A single pinned **BB Operator** thread provides durable reasoning and coordination; project-specific threads remain the units that perform repository work.

Ship the in-app WebRTC experience end to end. Do not mark the work complete when the plugin is merely scaffolded, when audio connects without delegation, or when delegation works against mocks but not a real BB thread.

Before implementation:

1. Run `bb status --json` and inspect the target project, environment, and installed BB version.
2. Read the installed `bb-plugin-authoring` skill and current Plugin SDK declarations. Treat those types as the contract if this specification has drifted.
3. Review the current OpenAI GPT-Live session, WebRTC, sideband, prompting, and client-delegation documentation.
4. Scaffold with `bb plugin new bb-live` unless an existing plugin repository has been supplied.
5. Keep the OpenAI API key in a secret server-side plugin setting. Never expose it to the frontend, logs, thread metadata, or transcripts.

## Product thesis

BB Live is a conversational control plane inside BB. The user can begin a GPT-Live voice session from anywhere, navigate among projects and threads without dropping it, ask what needs attention, redirect active work, delegate new work, and hear verified results while BB continues operating underneath.

The voice session should feel like speaking with one capable operator who understands the whole BB workspace. It must not feel like opening a separate voice assistant inside every thread.

## Product principles

1. **One voice session, many threads.** The session belongs to BB. Threads are resources the operator focuses, queries, and coordinates.
2. **Conversation and execution are separate.** GPT-Live handles natural turn-taking, interruption, pacing, and speech. BB agents handle repository reasoning and execution.
3. **The plugin is the authority.** The voice model may propose intent, but the plugin resolves thread IDs, enforces policy, invokes BB APIs, and verifies outcomes.
4. **Durability lives in BB.** Work continues after a voice session ends. The next session reconstructs its briefing from current BB state and the Operator thread, not from an assumed surviving media connection.
5. **Speech is not proof.** BB Live never says an action succeeded until BB reports that it did.
6. **Consequential actions remain visible.** Merges, publishing, permission escalation, credential access, destructive operations, and other high-impact actions require BB's normal visual interaction or approval surface.
7. **No raw-audio retention by default.** Persist useful text and operational records, not microphone recordings.

## Goals

- Start or end a global GPT-Live voice session from any BB screen.
- Keep the voice session connected while the user navigates between projects and threads.
- Use the currently visible thread as initial focus without making it the owner of the session.
- Create or reuse exactly one visible, pinned BB Operator thread for durable coordination.
- Let the user ask for a global briefing based on real BB state.
- Let the user focus a thread, inspect its status, hear its latest result, send a follow-up, queue a request, steer active work, or stop a turn.
- Delegate ambiguous or multi-step coordination to the Operator thread.
- Return verified BB results to GPT-Live so it can communicate them naturally.
- Surface pending approvals without allowing the voice channel to bypass them.
- Recover cleanly from navigation, frontend remounts, transient reconnects, plugin reloads, and agent failures.

## Non-goals for the first release

- Telephone, SIP, PSTN, or other external calling. BB Live is an in-app GPT-Live voice experience.
- Replacing BB's native text composer.
- A separate voice model or voice session for every worker thread.
- Unattended approval of merges, publishing, destructive commands, secrets, or elevated permissions.
- Recording or storing raw audio.
- Semantic long-term memory beyond the Operator thread, plugin session records, and existing BB state.
- A new agent provider. This is a plugin that coordinates existing providers and threads.
- Hiding orchestration in invisible worker threads. The Operator thread is visible and auditable.

## User mental model

The user speaks with **BB**, not a specific agent. BB Live always has a current focus, which may be a project, a thread, or the global workspace. The user can change focus by navigating in BB or by speaking.

Examples:

- “What needs my attention?”
- “What finished since this morning?”
- “Focus the release thread.”
- “Read me the last failure.”
- “Tell that agent to preserve backward compatibility and continue.”
- “Queue full integration tests after its current turn.”
- “Stop the migration agent.”
- “Start a review in the API project and report back.”
- “Switch back to the auth thread.”

## Core concepts

### Voice session

One active GPT-Live session connected to one BB client. The session owns audio, transient conversational context, mute state, output-silence state, and the current focus.

### BB Operator thread

A visible, pinned root thread in the Personal project. It has no repository responsibility. It receives durable coordination requests, reasons about ambiguous or multi-step work, and can coordinate child threads across projects.

The plugin creates it lazily and records its stable thread ID in plugin storage. If the thread is deleted, the next voice session creates a replacement. If it is archived, starting a session may unarchive it after telling the user in the UI.

Identify it with plugin metadata such as:

```json
{
  "role": "bb-live-operator",
  "schemaVersion": 1
}
```

Do not treat plugin metadata as an authorization boundary.

### Focus

The object the conversation currently refers to. Focus resolution order:

1. A thread explicitly named or selected during the voice session.
2. A thread explicitly opened by the user after the session began.
3. The thread visible when the session began.
4. A project explicitly named during the session.
5. Global BB state.

If two candidates are plausible, ask a short clarification instead of guessing.

### Delegation

A request from GPT-Live for backend work. The plugin combines the delegation ID with accumulated transcript context, current focus, authenticated client identity, and relevant BB state, then either executes a bounded BB operation directly or sends a task to the Operator thread.

## Primary user experience

### Global entry point

Add a BB Live control to a global BB surface. Prefer a managed sidebar-footer action or disclosure for the idle entry point and an `experimental_appOverlay` for the active-session control bar. Feature-detect experimental APIs and degrade cleanly if unavailable.

The idle control shows:

- Start voice session
- Configuration-needed state
- Connection or API error state

The active-session bar remains mounted across route changes and shows:

- Listening, speaking, thinking, delegated, reconnecting, or error state
- Current focus label
- Mute/unmute microphone
- Push-to-talk while muted
- Silence/unsilence BB Live output
- Open transcript/details
- End voice session

“Silence BB Live” stops audio playback without muting the microphone or cancelling BB work. “Stop talking” interrupts current speech. “Stop the task” acts on the focused BB turn only after resolving the intended target.

### Starting a voice session

From global BB:

1. The plugin ensures the Operator thread exists.
2. The user grants microphone permission.
3. The frontend creates a WebRTC offer.
4. The backend creates a GPT-Live session with client delegation and returns the SDP answer.
5. The voice session starts with global focus and a brief status-aware greeting.

From an existing thread:

1. The same global voice session starts.
2. That thread becomes initial focus.
3. The voice session remains global when the user navigates elsewhere.

If a composer action is added later, an existing draft may be offered as initial conversational context. Do not send draft text automatically without an explicit product decision and test coverage.

### During a voice session

- The user can interrupt BB Live naturally.
- Navigation updates candidate focus, but does not silently override an explicitly spoken focus while a delegated task is active.
- The transcript view distinguishes user speech, BB Live speech, delegated work, verified BB results, and pending approvals.
- Agent work continues independently of BB Live speech.
- Thread lifecycle changes may be summarized into the voice session when relevant; do not narrate every event.

### Ending a voice session

Ending a voice session must:

- Stop microphone capture and audio playback.
- Close the WebRTC peer connection, data channel, and backend sideband connection.
- Cancel session-specific timers and listeners.
- Preserve ongoing BB work.
- Write a bounded session record containing timestamps, focus changes, delegations, verified outcomes, and a concise summary.
- Never imply that ending the voice session stopped BB agents.

## Conversation architecture

Use GPT-Live for the conversational layer and **client delegation** for backend work.

```text
BB frontend
  microphone + WebRTC + audio output
          │
          ▼
GPT-Live session
  full-duplex conversation
          │ client delegation
          ▼
BB Live backend service
  transcript state + policy + BB SDK
          │
          ├── direct bounded BB operation
          │
          └── BB Operator thread
                  │
                  └── project-specific threads
```

Use a trusted backend sideband connection where supported so delegation handling, transcript accumulation, and result injection do not depend on an untrusted frontend. Restrict the frontend data channel to the minimum events needed for the media experience.

The OpenAI API key remains server-side. The frontend sends an SDP offer to a typed plugin RPC or authenticated local HTTP endpoint; the backend creates the Live session and returns only the SDP answer and safe session metadata.

Verify the exact OpenAI connection and sideband API against current official documentation during implementation.

## BB plugin architecture

### Manifest and settings

Required plugin settings:

- `openaiApiKey`: secret, required
- `voice`: non-secret, with a conservative default
- `operatorProvider`: optional provider ID
- `operatorModel`: optional model ID
- `operatorReasoningLevel`: optional
- `spokenProgress`: enum such as `quiet | important | verbose`, default `important`
- `transcriptRetentionDays`: integer, default 30; zero disables persisted session transcripts while retaining minimal operational records

Do not store secrets in plugin metadata, BB thread messages, frontend state, or SQLite.

### Backend responsibilities

The backend should provide:

- A long-lived voice-session manager service with one active session per authenticated BB user/client for the first release.
- Typed RPC for session creation, status, focus changes, mute-independent control commands, and termination.
- WebRTC session creation against `gpt-live-1`.
- A sideband connection for transcripts, delegations, result injection, and interruption control where the current API supports it.
- Operator-thread discovery, creation, pinning, and recovery.
- BB state queries through `bb.sdk`.
- Thread lifecycle listeners for active, idle, failed, archived, deleted, queued-message, and pending-interaction events.
- Plugin SQLite storage for session and delegation records.
- Bounded logs with secrets and transcript content redacted by default.
- Complete cleanup on plugin reload, disable, client disconnect, and session end.

### Frontend responsibilities

The frontend should provide:

- Global start-voice entry point.
- App-wide active-session overlay.
- Microphone permission and capture.
- WebRTC peer connection and remote audio playback.
- Independent microphone mute and output silence.
- Push-to-talk while muted, using Space only when focus is not in an editable control.
- Transcript/details panel.
- Focus display and explicit focus selection.
- Connection recovery UI.
- Visual pending-approval affordance that navigates to the owning BB interaction.
- Accessible labels and keyboard operation for all controls.

### Durable storage

Suggested tables:

```text
operator_state
  singleton_key
  operator_thread_id
  schema_version
  updated_at

voice_sessions
  id
  openai_session_id
  started_at
  ended_at
  initial_thread_id
  final_focus_kind
  final_focus_id
  status
  summary

voice_session_events
  id
  voice_session_id
  sequence
  timestamp
  kind
  payload_json

delegations
  id
  voice_session_id
  openai_delegation_id
  target_kind
  target_id
  requested_at
  completed_at
  status
  verified_result
```

Store normalized transcript text only when retention is enabled. Do not store raw audio. Bound individual payload sizes and prune expired records on a background schedule.

## Direct operations versus Operator delegation

The plugin should execute a request directly when intent is explicit, the operation is bounded, and no repository reasoning is required.

Direct operations include:

- List or count active, idle, failed, or attention-requiring threads.
- Read a thread’s title, status, latest output, queue state, or pending interaction summary.
- Change conversational focus.
- Open or reveal a thread in BB.
- Send a clearly specified follow-up to a known thread.
- Queue or steer a known thread when the user explicitly chose the mode.
- Stop a known active turn after target confirmation.

Delegate to the Operator thread when the request:

- Is ambiguous about how work should be divided.
- Spans projects or several threads.
- Requires comparing results, planning, prioritization, or follow-up monitoring.
- Requires choosing a provider, model, environment, or execution strategy.
- Asks to create new implementation or review work without fully specifying the target.
- Needs a durable decision trail.

The Operator may coordinate project-specific threads but should not perform repository edits in its Personal workspace.

## Dispatch semantics

BB Live must distinguish among:

- **Send/start:** start a new turn when the target is idle.
- **Queue:** allow the current turn to finish before delivering the instruction.
- **Steer:** inject a critical correction into the active turn.
- **Stop:** terminate the active turn while preserving the thread and workspace.

If the user says “tell it…” while a thread is active and urgency is unclear, default to queue. Use steer for phrases such as “stop, change direction,” “before it continues,” or an explicit “steer.” State the chosen behavior briefly.

Do not resend a message merely because BB reports that it was queued.

## Permission and confirmation policy

Classify proposed operations before execution:

| Class | Examples | Voice behavior |
|---|---|---|
| Read-only | Status, output, thread search, queue inspection | Execute immediately |
| Reversible coordination | Focus, open thread, queue message, create ordinary thread | Execute when target and intent are clear; summarize result |
| Interruptive | Steer active work, stop a turn, archive | Confirm target when ambiguity or material lost work is possible |
| Consequential external | Merge PR, publish, deploy, send external message | Require BB visual approval |
| Sensitive or elevated | Secrets, credentials, permission escalation, destructive filesystem action | Require BB visual approval; never accept voice-only authorization |

The in-app session inherits BB's authenticated user and client context, but that identity does not bypass BB's existing permission modes or interaction approvals.

## Live-model prompt contract

The GPT-Live system prompt should establish these rules:

- You are the spoken interface to BB, not the coding worker.
- Keep spoken replies concise unless the user asks for detail.
- Delegate whenever current BB state, repository reasoning, or an action is needed.
- Never invent thread state or claim an operation succeeded before receiving a verified result.
- Distinguish stopping speech from stopping backend work.
- Ask a short clarification when project or thread focus is ambiguous.
- Treat transcripts as fallible: corrections and later statements override earlier fragments.
- Do not read secrets, raw logs, long diffs, or large structured payloads aloud.
- Tell the user when visual approval is waiting in BB.
- Respect user requests about pace, verbosity, and speaking style.

## Operator-thread prompt contract

Configure the Operator thread with durable instructions similar to:

> You are the BB Operator. Coordinate work across BB projects and threads. You do not edit repositories in this Personal workspace. Inspect current BB state before answering. Prefer existing project threads when they already own the work. When creating or messaging a thread, identify the concrete objective, constraints, deliverable, and validation. Report stable thread IDs and verified outcomes. Never claim completion from a scaffold, a narrow test, or an agent’s prose alone; inspect status, output, and relevant diffs or validation evidence.

Do not place raw partial transcript deltas in the Operator thread. Send a normalized request containing the relevant recent conversational context, explicit focus, corrections, and desired outcome.

## Result handling

Every delegation should move through explicit states:

```text
received -> resolving -> dispatched -> working -> completed | failed | cancelled
```

When work completes:

1. Read the authoritative BB state and the latest thread output.
2. Confirm the expected thread or interaction actually reached the reported state.
3. Reduce the result to the facts useful in speech.
4. Append the result to GPT-Live commentary using the original delegation ID.
5. Keep detailed diffs, logs, and structured data in BB; offer to open them rather than reading them aloud.

For long work, BB Live may provide sparse progress updates. Avoid narrating tool calls or every lifecycle event.

## Failure behavior

- **Microphone denied:** Explain how to enable it; keep BB otherwise usable.
- **OpenAI configuration missing:** Show a settings link; do not expose whether a particular secret value exists beyond configured/not configured.
- **Live session creation fails:** Return to idle with a bounded, secret-free error.
- **WebRTC disconnects:** Attempt a bounded reconnect only when supported; otherwise end cleanly and explain that BB work continues.
- **Plugin reload:** Close media and sideband resources. Preserve durable session records and ongoing BB threads.
- **Focused thread deleted or archived:** Clear focus and ask the user to choose another target. Do not silently recreate worker threads.
- **Operator thread deleted:** Recreate it lazily and record replacement.
- **Delegated thread fails:** Report the failure accurately and offer retry or inspection.
- **Pending BB interaction:** Announce it once, display a visible approval affordance, and wait. Do not repeatedly speak reminders.
- **Transcript uncertainty:** Ask for confirmation before mutation when names, identifiers, or negation may have been mistranscribed.

## MVP scope

The first shippable release includes:

1. Plugin scaffold, manifest, secret settings, and build pipeline.
2. Global voice entry point and persistent active-session overlay.
3. WebRTC audio connection to `gpt-live-1`.
4. Independent mute, push-to-talk, output silence, interrupt speech, and hang-up controls.
5. Client delegation handled by the plugin backend.
6. Lazy creation and reuse of one pinned Operator thread.
7. Focus on the visible thread at session start and explicit focus switching.
8. Read-only global briefing and focused-thread status/output.
9. Sending, queueing, steering, and stopping against an explicitly resolved thread.
10. One ambiguous multi-step request delegated through the Operator thread into a project thread.
11. Verified result returned to the live conversation.
12. Transcript/details UI and bounded durable session record.
13. Pending-interaction announcement and navigation without voice approval.
14. Cleanup and failure handling for session end, navigation, disconnect, and plugin reload.

## Acceptance criteria

The MVP is complete only when all of the following are demonstrated against a live BB installation:

- Starting a voice session from a global screen creates or reuses exactly one pinned Operator thread.
- Starting from an existing thread sets initial focus to that thread.
- Navigating to another project or thread does not drop the voice session.
- The user can interrupt BB Live while it speaks.
- Microphone mute does not silence BB Live output.
- Output silence does not mute the microphone or cancel backend work.
- Push-to-talk works while muted and does not steal Space from an editable control.
- “What needs my attention?” is answered from current BB state, with no invented threads or statuses.
- The user can focus a thread by an unambiguous spoken name.
- A follow-up to an idle thread starts a turn.
- A follow-up to an active thread can be deliberately queued or steered, and BB Live reports which occurred.
- Stopping a turn stops the correct thread and leaves its workspace intact.
- An ambiguous coordination request reaches the Operator thread and results in a correctly targeted project thread or a clarification.
- Completed delegated work produces a verified spoken result associated with the correct delegation.
- A pending consequential approval is shown in BB and is not approved through voice alone.
- Ending the voice session releases microphone, WebRTC, audio, sockets, timers, and plugin listeners while delegated BB work continues.
- Reloading or disabling the plugin leaves no active media capture or orphaned network connection.
- No API key, authorization header, secret setting, or raw audio appears in frontend state, logs, plugin metadata, or thread transcripts.
- The plugin passes typecheck, `bb plugin types --check`, focused tests, and `bb plugin build`.

## Test plan

### Unit tests

- Focus resolution and ambiguity.
- Spoken-intent normalization.
- Direct-operation versus Operator-delegation routing.
- Queue versus steer policy.
- Permission classification.
- Transcript correction handling.
- Result reduction and secret redaction.
- Voice-session state machine and cleanup idempotency.
- Storage retention and pruning.

### Backend integration tests

- Operator discovery, creation, pinning, deletion recovery, and metadata validation.
- Thread list/status/output queries.
- Send, queue, steer, stop, and interaction lookup.
- Lifecycle-event correlation to the correct voice session and delegation.
- Plugin reload/dispose closes sideband resources and listeners.
- OpenAI failures return bounded, secret-free errors.

Use a fake Live transport for deterministic automated tests, but do not claim full completion from fake transport coverage.

### Frontend tests

- Global entry point and active overlay survive navigation.
- Microphone permission states.
- Independent input mute and output silence.
- Push-to-talk keyboard behavior around editable controls.
- Transcript rendering and current-focus changes.
- Reconnect and terminal error states.
- Pending-approval navigation.
- Keyboard accessibility and compact viewport behavior.

### Live verification

- Real WebRTC session with microphone and speaker.
- Natural interruption in both directions.
- At least one direct BB read, one BB mutation, and one Operator delegation.
- Voice-session end while delegated work continues.
- Plugin reload during or immediately after a voice session.
- Inspection of logs and browser state for secret leakage.

## Delivery phases after MVP

### Phase 2: Continuity and mobile ergonomics

- Restore relevant context into a new voice session without pretending the old media connection survived.
- Better briefing summaries and attention ranking.
- Mobile BB layout and background/resume behavior.
- Optional notifications when delegated work completes after the voice session ends.

### Phase 3: Richer orchestration

- Voice-driven thread and project switching with stronger ambiguity handling.
- User-configurable briefings, completion summaries, and interruption policy.
- Better handoff between global focus and direct conversation about one worker thread.
- Spend visibility and configurable session-duration limits.
- Optional saved voice and conversation-style preferences.

### Phase 4: Multi-user and team operation

- Per-user Operator threads or explicitly shared operators.
- Speaker identity and authorization scopes.
- Team-aware project visibility.
- Audit events and administrative controls.

## Metrics

Capture metrics without retaining raw audio:

- Voice-session connection success rate and time to connected.
- Delegation success and failure rate.
- Time from delegation to dispatch and verified result.
- Rate of clarification before mutation.
- Incorrect-target incidents.
- User interruptions handled without disconnect.
- Voice sessions ending with BB work still running.
- OpenAI voice minutes and backend-agent usage shown separately.

## Open product questions

- Should navigation automatically change focus after an explicit spoken focus, or only propose the new focus?
- How much normalized conversation should appear in the Operator thread versus plugin-owned session history?
- Should ordinary thread creation require a spoken confirmation, or only target disambiguation?
- Should the Operator use the user’s default provider/model or a dedicated low-latency configuration?
- Should one user be allowed multiple simultaneous voice sessions from different clients?
- What is the retention default for normalized transcripts and session summaries?
- Is “BB Live” the shipping name or only the working concept?

These questions should not block the MVP defaults stated in this document unless the installed BB or OpenAI APIs make them unsafe or impossible.

## External references

- OpenAI, GPT-Live getting started: https://developers.openai.com/api/docs/guides/live
- OpenAI, delegation and tools: https://developers.openai.com/api/docs/guides/live-delegation
- OpenAI, GPT-Live-1 model: https://developers.openai.com/api/docs/models/gpt-live-1
- OpenAI, Live session creation: https://developers.openai.com/api/reference/typescript/resources/live/methods/create
- Devin voice-mode interaction reference: https://docs.devin.ai/work-with-devin/voice-mode

## Final implementation check

Before declaring the feature ready for review, re-read this specification and report separately:

- What is fully implemented end to end.
- What is scaffolded or partially wired.
- What automated tests cover.
- What was verified against a real GPT-Live session and a live BB installation.
- What remains unverified.
- Any old or alternate paths that contradict the global-session architecture.

Do not describe mobile continuity, richer orchestration, or multi-user operation as implemented unless those phases were explicitly built and verified.
