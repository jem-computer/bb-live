# BB Live

A global voice channel inside BB, with a persistent WebRTC connection, a trusted GPT-Live sideband, and one visible pinned BB Operator. Built against BB 0.43.1 / Plugin SDK 0.4.87.

## Install

Requires [BB](https://getbb.app) 0.43.1 or later with Plugin SDK 0.4.87 or later, Git, npm, and Node.js 22.19+ (22.x), 24.x, or 26.x. An OpenAI project with access to `gpt-live-1` and your chosen intent model is required; API usage is billed separately from BB agent providers. A TypeSafe API key is optional and only used when the experimental Jev routing toggle is on. The plugin uses experimental BB APIs and has been checked against BB 0.43.1.

```sh
bb plugin install https://github.com/jem-computer/bb-live
```

BB installs the dependencies and builds the plugin from source. Review its full-trust installation prompt. This URL tracks the default branch; use an explicit Git tag or commit for a fixed version. Check and apply updates with `bb plugin outdated` and `bb plugin update bb-live`.

For local development and release instructions, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Setup

Open **BB Live** in the sidebar. In its Settings page, enter an OpenAI project API key with access to `gpt-live-1` and the intent model. The key is a server-side secret setting; don't paste it into a thread or commit it. Voice defaults to `marin`; intent interpretation uses `gpt-5.6-terra`. Operator execution uses BB's defaults unless configured in Preferences. Turn off **Use BB defaults** to use BB's native provider/model/reasoning picker; these choices apply when an Operator is created, while an existing Operator is edited in its own thread.

Preferences includes voice, an editable voice prompt and opening words, spoken-progress and retention menus, plus an intent-model menu under Advanced with a custom model option. Voices marked ♪ offer public OpenAI speech samples, with no API call or microphone permission. Samples are available for Alloy, Ash, Coral, Echo, Sage and Shimmer; Live delivery can differ. Other voices remain selectable without a preview. Voice, prompt, and opening changes apply to the next session. Leave opening words blank to wait for you to speak.

Non-secret preferences persist in plugin KV and migrate once from the original configuration fields. The OpenAI key stays in BB's secret setting. Use the Preferences UI for non-secret changes; `bb plugin config` manages the API-key settings.

**Jev routing (experimental, off by default).** Advanced also has a Jev routing toggle. [Jev](https://typesafe.ai) is TypeSafe's decision model: it answers typed questions with calibrated probabilities and never generates text. When enabled, BB Live can use it to classify spoken requests before the intent model. It needs a second secret setting, the TypeSafe API key, set with `bb plugin config`; the toggle stays disabled until that key exists. The model (`jev-latest`) and base URL (`https://api.typesafe.ai/v1`) are preferences, so a gateway that speaks the same `systemone` request shape can be substituted. In this release the transport and settings are wired but the delegation path does not call Jev yet.

Open the sidebar footer microphone to start voice or manage a session. Status, mute, sound, stop-talking, and end controls stay in that footer panel; Transcript expands there too. Collapse the panel without ending voice, and the microphone icon keeps an active/attention indicator. You can also start from the BB Live page. Sessions start in All of BB, and navigating the sidebar does not change conversation focus. Ask about a project or thread by name without opening it first. The backend refreshes a workspace directory for every request, paging up to 2,000 open threads; deeper or historical discovery goes to the Operator. An explicitly selected or spoken focus resolves references like “this thread” while all projects remain accessible. The transcript panel can switch focus or open the Operator and pending BB interactions.

Describe the work naturally: Live sends follow-ups to existing threads, and an explicit request for a new thread with a task and project creates it directly using that project’s environment and execution defaults. A voice dump with several tasks, or work whose owner needs investigation, goes to the Operator to inspect conversations, reuse owners, and create visible project threads where needed. Asking whether Live can create threads only answers the capability question; it does not start work.

Mute controls the microphone. Silence controls playback. Hold to talk temporarily enables a muted microphone; desktop Space does the same outside editable and interactive controls. Stop talking interrupts speech; it does not stop an agent. End releases media and closes the sideband while BB work continues.

On iPhone, controls use at least 44-pixel targets, safe-area insets, 16-pixel select text, dynamic viewport height, and pointer cancellation. Returning to the background intentionally ends the voice connection; return to BB and tap Start voice. Background audio continuity is not claimed. A blocked Safari autoplay attempt exposes a Tap to enable sound button.

## Commands

- `bb bb-live status` shows safe configuration state and the last five session records.
- `bb bb-live operator` creates or reuses the visible pinned Operator without starting voice. Normal BB concurrency limits still apply.

## Data and trust boundaries

The frontend receives SDP and a random control capability, never the OpenAI or TypeSafe keys. That capability stays in memory and is required for session mutations and transcript reads. The Live data channel permits no frontend commands; only session lifecycle and errors are exposed. The sideband discards reflected audio. OpenAI session recording is disabled (`store: false`).

When Jev routing is enabled, TypeSafe receives the same bounded transcript window and workspace names/IDs that the intent model receives, plus a fixed list of options to decide between. It never receives audio, the OpenAI key, or thread output. Jev responses are schema-validated and an answer outside the offered options is rejected. Provider error bodies are replaced by bounded messages.

BB currently exposes no authenticated user/client identity in plugin RPC handlers. This release supports **one active session per BB installation**, under BB's own authenticated access boundary, not multi-user isolation. All BB actions use the SDK and preserve normal interaction handling. New dispatches explicitly use `accept-edits`. There is no voice endpoint that approves an interaction, merges, publishes, or accesses credentials. Consequential requests are redirected to visual BB review; the intent model is not an authorization boundary.

Transcripts remain in bounded memory and are persisted for 30 days by default. Set retention to zero to erase stored transcript/result text and stop new persistence. Session payloads are capped, each session retains at most 8,000 stored events, and minimal operational records expire after 90 days. Model/API errors are replaced by bounded messages; no request bodies, authorization headers, raw audio, or provider error bodies are logged.

Disconnects have a 45-second backend lease. Plugin reload interrupts sessions without replaying mutations; unresolved dispatch records become `unknown`. A session close acknowledgment is distinct from the spoken result, and ending voice never calls `threads.stop`.

## Implementation and validation

See [VERIFICATION.md](VERIFICATION.md) for tested behavior and remaining acceptance work. The implementation is wired to real BB SDK and OpenAI HTTP/WebSocket APIs. A generated-speech check verified direct project-thread creation, execution, and the returned result through the real voice connection. Multi-task handoff reached the Operator, whose current provider paused for normal command approval; completed Operator-to-project delegation, human conversational acceptance and physical iPhone audio remain unverified.

The first version tracks one outstanding ordinary voice request per target thread. A new steer may supersede the tracked running request; additional queued voice requests ask the user to use the native BB composer until the tracked request finishes. This conservative restriction avoids attributing another turn's result to the wrong delegation. Result reports identify BB's observed terminal state and label agent prose as an agent report rather than independent proof of repository correctness.

Official API contracts used: [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live), [server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live), [client delegation](https://developers.openai.com/api/docs/guides/live-delegation), and [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting).

## License

[MIT](LICENSE). Security reports: [SECURITY.md](SECURITY.md).
