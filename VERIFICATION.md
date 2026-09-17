# BB Live verification — 2026-09-16

Implementation level: **real reads and writes, with direct voice-to-project-thread creation verified end to end; broader voice and Operator acceptance remains incomplete**. The repository is an installed BB plugin, not a standalone mockup. No MVP-complete claim is made.

## Implemented

- Managed sidebar-footer voice controls, headless app-wide session controller, responsive dashboard, transcript/details, explicit focus, native thread navigation, pending-interaction links.
- Server-owned `gpt-live-1` WebRTC creation and trusted sideband. Restricted browser data channel; separate structured intent-model request with bounded, schema-validated results.
- Pinned visible Personal Operator discovery, creation, reuse, unarchive, deletion recovery, and durable instructions.
- Real SDK reads for threads, status, output, queues and interactions; real send/start, queue-behind-active, steer and stop calls. Ambiguous planning requests are sent to the Operator.
- Delegation deduplication and durable states, queue dispatch/cancellation listeners, current-state/output verification, transcript accumulation and corrections-aware intent prompt.
- Secret settings, control capability, retention/pruning, no raw audio retention, disconnect lease and reload disposal.
- Independent input mute, output silence, keyboard/touch hold-to-talk, speech interruption, cancellation during microphone acquisition, autoplay recovery, compact layouts, safe areas, reduced motion, and mobile background teardown.

## Automated evidence

`npm run typecheck`, `npm test` (22 tests), `bb plugin types --check`, and `bb plugin build` pass against BB 0.43.1 / SDK 0.4.87. Dependency declarations are skipped during typecheck because happy-dom references a Node stream type absent from its installed Node declarations; application and test source still typecheck.

Tests cover ambiguous target matching, focus precedence, redaction, consequential-request gating, Operator singleton/reuse, private session controls, duplicate delegation, start versus steer/queue semantics, normalized Operator requests, independent microphone/output controls, editable Space behavior, blur release, late microphone permission, denial, media cleanup, retention-off/pruning, and archived-focus recovery.

Backend tests use BB's official fake host and a fake Live transport. Frontend media tests use happy-dom and a fake peer/microphone. These do not establish OpenAI API compatibility or audible quality.

## Live BB evidence

- Installed from a local development checkout; plugin reports running.
- Dashboard reads the actual BB projects/threads and counts, with no fixture workspace data.
- `bb bb-live operator` created a thread in the Personal project; a second call returned the same ID. BB reports a visible pinned root thread owned by `bb-live`.
- Operator initialization was queued behind the existing host concurrency limit. That limit was preserved.
- Browser checks at desktop width and 390 × 844 confirmed no horizontal overflow. The original floating bar passed touch-target checks; it has since been replaced by the sidebar footer described below.
- With a browser-local simulated media connection, microphone and speaker toggles were independent, routing to the Operator preserved the connection, and End stopped the microphone, closed the peer, and removed all audio elements. Browser test overrides were removed by reload. This was **not a GPT-Live call**.

## Settings upgrade

Implemented and verified in the installed plugin: native BB provider/model/reasoning picker; voice, progress, retention and intent-model dropdowns; custom intent-model entry; public sample playback for six voices; secret-free preference RPCs and KV persistence with one-time migration. API-key storage remains a native secret setting. Operator defaults apply only when creating an Operator.

Additional tests cover migration, credential exclusion, failure preservation, concurrent partial writes, validation, and the saved voice/intent/provider/model/reasoning/service-tier reaching their consumers. The existing retention test now exercises the new save RPC.

Browser checks at 1280px desktop, 390px and 320px mobile widths confirmed containment and 44px settings controls. Ash audio loaded and advanced during playback; Stop worked. Voice and native model selections survived page reload; progress and intent dropdown saves worked. Original preferences were restored. BB's native picker opens as a mobile sheet. Screenshots remain in the ignored local `artifacts/` directory because they contain workspace context. These are Chromium viewport checks, not physical iPhone Safari verification.

## Jev transport

A TypeSafe Jev transport (`src/jev-transport.ts`) wraps the `systemone` Choice primitive with an injectable fetch, request validation (2–255 options, bounded state), a 10-second timeout, schema-validated responses, rejection of answers outside the offered options, and bounded error messages that never include the key, request body, or provider body. A second secret setting holds the TypeSafe key; `jevEnabled`, `jevModel`, and `jevBaseUrl` are non-secret preferences, default off. The `config` RPC and `bb bb-live status` report whether the key is set and whether routing is enabled. Nothing in the delegation path calls Jev yet.

Tests cover request shape, base URL and model overrides, each documented error status, network failure and abort propagation, malformed and out-of-menu answers, pre-network validation, preference defaults and validation, and the config/status reporting. These use a mocked fetch and do not establish TypeSafe API compatibility.

## Remaining acceptance work

Real SDP exchange, intent-model access, direct thread creation and result injection were verified with generated speech in the routing check below. Audible full duplex/barge-in, broader sideband event ordering, all mutation modes, and actual iPhone Safari microphone/autoplay/network behavior remain unverified.

The Operator-to-project-worker flow is wired but has not executed through a completed live request. Its execution remains subject to BB's existing concurrency limit and provider approval controls. A real voice session ending while a delegated BB task continues, reload during real media, and live secret-leakage inspection remain pending.

## Deliberate first-release limits

- One active session per BB installation. The installed RPC contract does not expose per-user/client identity; a random session capability protects controls within BB's authenticated boundary.
- At most one ordinary tracked voice request per target. Steering can supersede tracked running work; use the native composer for additional concurrent queued work.
- A result means the BB thread reached the reported state. Agent prose is labeled as a report, not independent proof that repository acceptance criteria passed.
- A reload marks unresolved dispatches unknown and never replays them automatically. New sessions can reuse the Operator but do not restore a media connection.
- iPhone backgrounding ends voice. Background continuity and native iOS audio routing have not been implemented or claimed.
- Requires the managed sidebar-footer and app-overlay APIs in the declared BB/SDK minimum versions. The app-overlay slot owns only the session lifecycle and renders no UI.

A source search found no remaining scaffold todo APIs, mock production adapters, placeholder handlers, or legacy per-thread/Realtime voice paths. The source product spec is preserved in `PRODUCT-SPEC.md`.

## Open-source distribution checks — 2026-09-16

A clean source copy passed `npm ci`, typechecking, all 28 tests, SDK pin checks, and the plugin build on Node.js 22.22.2 with BB 0.43.1. A second clean copy installed only production dependencies (`npm ci --omit=dev --omit=optional`) and built both plugin bundles successfully. The public-SDK import test found no private BB imports. GitHub Actions repeats both build modes and scans the checkout plus all fetched Git history; hosted CI has not run yet.

Publication checks found no credentials: Gitleaks scanned the working directory and the public source snapshot; an independent pattern/manual review checked credential literals, private paths, workspace identifiers, dependency URLs, and ignored files; Gitleaks and a private-content check scanned the packed source and generated bundles. The only credential-like source values were deliberately fake test fixtures. Personal paths and identifiers were removed from this document. Local screenshots, logs, runtime databases, credentials, and build/dependency directories are excluded from Git; the npm package has an explicit file allowlist.

At audit time the local repository had no commits, no reflog entries, and no remote. Its sole unreachable Git object was an empty blob. There was no earlier commit history to scan. These checks cover the audited files, not subsequent edits or private BB runtime storage, and cannot guarantee the absence of every possible secret. Real voice and physical-device acceptance remain separate from distribution readiness.

## Workspace awareness and voice customization — 2026-09-16

Implemented for real reads and writes, built and reloaded in the installed plugin. Sessions now start in All of BB regardless of sidebar selection, and navigation no longer changes conversation focus. Startup supplies a bounded name-based workspace directory; every delegation refreshes up to 2,000 open threads in pages. Project briefings accept a project name/ID, and the router can use the Operator for deeper discovery. Explicit focus remains available.

Voice prompt and opening words are editable, validated, persisted preferences. Existing saved preferences acquire defaults without resetting their other choices. Blank opening means wait for the user. Nonblank opening is sent once after session.started; acknowledgment is tracked separately from speech. Default voice and Operator prompts use names and omit reasoning/routing narration. Known BB ID tokens in backend voice context are replaced with names or a neutral reference; internal action targets and visual links remain intact.

All 28 tests, typecheck, SDK pin check and plugin build pass. New regression cases cover another project's thread beyond the first 200 results, global start despite sidebar context, fresh router inventory, project briefing scope, custom instructions reaching session creation, delayed/deduplicated greeting, blank opening, and ID removal from agent output. Preference tests cover persisted prompts/opening and size bounds.

Live browser checks verified opening persistence across page reload, restored defaults, and no horizontal overflow at 390px. Screenshot: artifacts/prompt-settings-iphone.png. A real GPT-Live WebRTC session used generated silence instead of the user's microphone and muted output. It connected with All of BB focus, received Opening accepted, and produced the exact default greeting in the output transcript. The session was ended and the generated stream released. This verifies the startup/sideband/greeting path, not audible quality or natural multi-project conversation.

Jem also reported a successful real spoken session before this change. Remaining verification: conversational cross-project discovery, actual response style over multiple turns, full Operator-to-worker completion, and physical iPhone audio behavior.

## Sidebar footer controls — 2026-09-16

Implemented and browser-verified: the managed sidebar-footer disclosure owns status, start/cancel, mute, sound, stop-talking, end, hold-to-talk, attention links, errors, and an inline transcript/focus view. The app-overlay registration now renders only the headless controller. No fixed voice bar or floating transcript remains. A custom footer microphone marks active sessions and attention, including while collapsed.

The original 28 tests, typecheck, SDK pin check, and build passed after the UI change. In the installed BB app, browser-only fake media/RPC responses verified independent mute/silence, hold-to-talk release on collapse, no end call on collapse, connection survival across thread navigation and mobile sidebar remounts, transcript Escape dismissal, speech interruption, and exactly one end call with stopped tracks/closed peer/no audio elements. Desktop and 390 × 844 footer panels had no horizontal overflow; mobile primary controls were at least 61 × 49 pixels and hold-to-talk was 44 pixels tall. Permission denial stayed inside the footer with retry available. Browser overrides were removed by reload. This check did not open a microphone or call OpenAI; physical iPhone Safari remains unverified.

## Voice routing and new threads — 2026-09-16

Fixed the observed capability refusal: the recorded session had turned “Can I start a brand new thread directly from BB Live?” into a clarification, then answered “Not yet.” Live and the intent router now explicitly advertise thread creation; capability questions do not create work. Added a typed `spawn` intent that resolves a project against live BB state, uses its environment/execution defaults with `accept-edits`, creates a visible thread with the task in the initial prompt, persists its delegation, and tracks actual status/output. Duplicate delegation events never resend or respawn. Missing/ambiguous projects and empty tasks ask a focused question.

Multi-topic dumps and uncertain ownership route the full request and workspace directory to the Operator, with explicit instructions to inspect conversations, reuse owners, and create project-specific children as needed. Project-level follow-ups no longer fail by demanding manual thread selection. This path is implemented, but completed multi-project dispatch is not yet verified: the installed Operator provider requested normal command approval during discovery.

All 36 tests, typecheck, SDK pin validation and plugin build passed. Eight new server regressions cover capability-only requests, project/default-environment creation, real-state outcome tracking, duplicate events, explicit focus, missing/ambiguous projects, unsafe requests, uncertain spawn failures, multi-topic handoff, and project-level discovery. A subsequent build briefly hit host disk exhaustion; rerunning the build succeeded. No build was reloaded during the user's voice session.

Live browser verification used generated speech through a synthetic audio stream, the real WebRTC/GPT-Live connection, the configured intent model and real BB SDK writes. The capability question received “Yep” without task creation. An explicit read-only task created a real visible thread in `bb-live`, using the project's configured worktree, which read `package.json` and returned `bb-plugin-bb-live`; the result reached the voice transcript. A second spoken request preserved both tasks (an existing-thread follow-up and new work in `bb-project-page`) in the Operator handoff. The Operator paused at a command approval before dispatch; that read-only test turn was stopped and its interaction cleared. The voice test ended, media tracks and browser were closed, and `active: null` was verified so the user could start Live. No real microphone was captured.

Remaining: completed Operator-to-existing/new-thread routing under the user's chosen provider and normal approval controls, physical iPhone audio, and human conversational acceptance. No unattended cross-project completion claim is made.

## BBL-8 — delegation latency telemetry (2026-09-17)

Implemented through the production transport, server, SQLite record, authenticated snapshot, transcript renderer, and status CLI. An additive migration adds versioned numeric `metrics_json` and a session/request-time index; existing records remain uninstrumented. The router itself is unchanged. `bb bb-live status [--last 1-1000] [--session ID]` provides stage p50/p95, sample/outcome counts, answering-model groups, and token/API-reported-USD summaries. The first four classifier reports are bounded (additional reports invalidate usage totals); no prompt, transcript or output text enters telemetry. Operational expiry remains 90 days and zero transcript retention preserves metrics.

Automated coverage exercises real temporary SQLite storage and production RPC/CLI handlers with the SDK fake host: successful read/local results, dispatch acceptance, queued work, duplicate events, classify failures with reported usage, cancellation before dispatch, serialization wait, explicit result-speech correlation, missing timestamps, no-text retention, expiry, reload persistence, legacy samples, CLI bounds, nearest-rank quantiles, Jev/Terra/both aggregation, secret/text projection, and mocked Responses parsing. Generated `artifacts/BBL-8-synthetic-status.json` runs the production status handler against two synthetic sessions and demonstrates comparable model groups; those numbers are test fixtures, not measured model performance.

Live timestamps use transcript proxies because [Live transcript fragments](https://developers.openai.com/api/docs/guides/live-conversations#transcript-deltas) have no authoritative turn-end event. Only an output transcript explicitly correlated by `client_event_id` to the final result append records result speech; acknowledgments and unrelated output do not qualify. This is not proof of playback. Missing correlation or reported cost remains null. Real provider correlation frequency, audible playback and production baseline collection remain unverified; this task did not install/reload the user's plugin, open a microphone, call a model, or change credentials/endpoints.
