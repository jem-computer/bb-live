---
name: bb-live
description: Inspect BB Live voice configuration, recent sessions, or the persistent BB Operator. Use when the user asks about BB Live status or its Operator.
---

# BB Live

Run `bb bb-live status` for configured/not-configured state, current focus, and recent session records. The command never returns credentials or transcripts.

Run `bb bb-live operator` only when the user wants the Operator available; it creates or reuses exactly one visible pinned root thread in Personal. This may queue initialization behind BB concurrency limits. Never claim the Operator has run merely because its thread exists.

To talk, open BB Live in BB's sidebar and use Start voice. Configure the OpenAI API key in the plugin's secret setting, never through a thread message. The API key needs GPT-Live and intent-model access. Provider/model/reasoning settings govern only Operator creation; existing threads retain their BB configuration.

The plugin settings page has Preferences: voice, editable voice prompt and opening words, spoken progress, transcript retention, and an Advanced intent model menu. Turn off Use BB defaults to reveal BB's native provider/model/reasoning picker. These non-secret preferences live in plugin KV; the old generic fields migrate once. Do not use `bb plugin config` for those removed fields. Sample buttons play public OpenAI recordings for six voices; they do not initiate a voice session or call the API. Not every voice has a sample.

Voice starts in All of BB; sidebar navigation does not change conversation focus. Name a project or thread to query it, or explicitly focus it in Live. The voice model gets a bounded project/thread directory at connection time; the router refreshes the workspace for every request, paging up to 2,000 open threads. Deeper discovery goes to the Operator. Internal IDs stay in tools and visual links rather than spoken replies. Prompt and opening changes apply to the next voice session. Leave opening words blank to wait for the user; otherwise the opening is requested once after session.started.

Voice is global, and ending it does not stop agent work. On iPhone the voice connection ends when the page backgrounds. Return and start another session. This release permits one voice session per installation and one outstanding ordinary voice request per target; steer can supersede tracked work. Use native BB thread controls for additional queued requests.

Never approve consequential actions from a voice transcript. Direct the user to the owning BB thread and its visual interaction. Do not read secrets, raw logs, or large diffs aloud. Observed terminal status and agent prose are not independent proof that implementation acceptance criteria passed.

Live supports new project threads as well as existing-thread follow-ups. Ask for a new thread with a concrete task and project to create it directly with project defaults; a multi-task voice dump goes to the Operator to inspect ownership, reuse existing threads, and create visible project-specific children where needed. Capability questions never start task work. Direct creation is tracked through BB status/output, with duplicate delegation events ignored. Explicit machine, worktree, branch or execution preferences go through the Operator.
