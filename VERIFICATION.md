# BB Live verification — 2026-09-16

Implementation level: **wired for real reads and writes; not end-to-end verified with GPT-Live**. The repository is an installed BB plugin, not a standalone mockup. No MVP-complete claim is made.

## Implemented

- Global sidebar voice entry, app overlay, responsive dashboard, transcript/details, explicit focus, native thread navigation, pending-interaction links.
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
- Browser checks at desktop width and 390 × 844 confirmed no horizontal overflow. The active six-control iPhone bar had targets at least 49 pixels tall and 56 pixels wide.
- With a browser-local simulated media connection, microphone and speaker toggles were independent, routing to the Operator preserved the connection, and End stopped the microphone, closed the peer, and removed all audio elements. Browser test overrides were removed by reload. This was **not a GPT-Live call**.

## Settings upgrade

Implemented and verified in the installed plugin: native BB provider/model/reasoning picker; voice, progress, retention and intent-model dropdowns; custom intent-model entry; public sample playback for six voices; secret-free preference RPCs and KV persistence with one-time migration. API-key storage remains a native secret setting. Operator defaults apply only when creating an Operator.

Additional tests cover migration, credential exclusion, failure preservation, concurrent partial writes, validation, and the saved voice/intent/provider/model/reasoning/service-tier reaching their consumers. The existing retention test now exercises the new save RPC.

Browser checks at 1280px desktop, 390px and 320px mobile widths confirmed containment and 44px settings controls. Ash audio loaded and advanced during playback; Stop worked. Voice and native model selections survived page reload; progress and intent dropdown saves worked. Original preferences were restored. BB's native picker opens as a mobile sheet. Screenshots remain in the ignored local `artifacts/` directory because they contain workspace context. These are Chromium viewport checks, not physical iPhone Safari verification.

## Remaining acceptance work

Real SDP exchange, sideband event ordering, intent-model access, audible full duplex/barge-in, spoken direct reads and mutations, result injection, and actual iPhone Safari microphone/autoplay/network behavior remain unverified.

The Operator-to-project-worker flow is wired but has not executed through a completed live request. Its initialization remains subject to BB's existing concurrency limit. A real voice session ending while a delegated BB task continues, reload during real media, and live secret-leakage inspection remain pending.

## Deliberate first-release limits

- One active session per BB installation. The installed RPC contract does not expose per-user/client identity; a random session capability protects controls within BB's authenticated boundary.
- At most one ordinary tracked voice request per target. Steering can supersede tracked running work; use the native composer for additional concurrent queued work.
- A result means the BB thread reached the reported state. Agent prose is labeled as a report, not independent proof that repository acceptance criteria passed.
- A reload marks unresolved dispatches unknown and never replays them automatically. New sessions can reuse the Operator but do not restore a media connection.
- iPhone backgrounding ends voice. Background continuity and native iOS audio routing have not been implemented or claimed.
- The global overlay is feature-detected. Hosts without it get page-local controls that end on unmount.

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
