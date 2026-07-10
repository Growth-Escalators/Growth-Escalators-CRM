---
name: ge-ai-context-update
description: Use after completing a unit of work to update the chat-independent context layer so the next agent or a fresh chat can resume cold. Triggers include "update the context", "log the handoff", "we're done with this — record it", "refresh the brief", "close out this task", or the end of any completed change. Skips: mid-task notes, trivial doc typo fixes, work that's still WIP with nothing stable to record.
---

# Updating the AI context layer

This repo keeps a **persistent, chat-independent context layer** in `.ai/` so any agent — or a fresh
chat — can rebuild full working context from the repo alone. Skipping the update means the next
session starts blind. Reference: [`AGENTS.md`](../../../AGENTS.md) "Where context lives".

## What to update after a completed unit of work
1. **`.ai/HANDOFF_LOG.md`** (append-only) — add an entry: what changed, why, what was touched,
   any follow-ups. Never rewrite history; append.
2. **`.ai/CURRENT_TASK.md`** — if the active focus changed, update it to the new one-in-flight task.
3. **`.ai/CURRENT_STATE.md`** — update last-known-good: what now works, what's in progress, known
   issues. Keep it honest (if tests failed, say so).
4. **`.ai/AI_BRIEF.md`** — regenerate with `npm run ai:brief` (never hand-edit; it's generated from
   local repo facts).

## When
- After any commit/PR that finishes a coherent unit — not mid-stream.
- Right after a data mutation (`ge-prod-data-mutation`) or a go-live step
  (`wizmatch-go-live-sending`), so the audit trail is captured.

## Never
- Never hand-edit `AI_BRIEF.md` (run `npm run ai:brief`).
- Never rewrite past `HANDOFF_LOG.md` entries — append only.
- Never leave `CURRENT_STATE.md` claiming green when something's broken.
