# ADR 001: AI Collaboration Workflow

Status: Accepted
Date: 2026-07-06
Scope: Repo workflow and planning discipline

## Context

Growth Escalators uses multiple AI coding tools on the same repository, especially Claude Code and Codex. Relying on one chat history makes handoffs brittle: a fresh agent can miss current task state, guardrails, dirty-worktree constraints, deployment assumptions, or the latest review decisions.

The repository now includes a persistent AI collaboration layer:

- `AGENTS.md` for universal agent instructions.
- `CLAUDE.md` for Claude-specific responsibilities.
- `.ai/CURRENT_TASK.md` for the active task.
- `.ai/CURRENT_STATE.md` for the last-known-good operating context.
- `.ai/HANDOFF_LOG.md` for append-only handoffs.
- `.ai/TOOL_ROLES.md` for Claude/Codex/ChatGPT responsibility split.
- `.ai/REVIEW_CHECKLIST.md` for change review.
- `.ai/AI_BRIEF.md`, generated with `npm run ai:brief`, for a local repo snapshot.
- `docs/prd/`, `docs/decisions/`, and `docs/reviews/` for durable product, architecture, and review artifacts.

Claude is normally the senior architect and final reviewer for risky paths. Codex normally executes well-scoped implementation and review tasks. When Claude is temporarily unavailable, Codex may act as implementation lead only when risky architecture decisions are planned and documented before code changes.

## Decision

Use the repository, not chat history, as the source of truth for AI collaboration.

All agents must:

- Read `AGENTS.md`, `.ai/CURRENT_TASK.md`, `.ai/CURRENT_STATE.md`, `.ai/TOOL_ROLES.md`, `.ai/REVIEW_CHECKLIST.md`, and `.ai/AI_BRIEF.md` at the start of substantial work.
- Check branch and dirty state before acting.
- Preserve unrelated user changes.
- Avoid destructive git operations unless explicitly instructed.
- Keep commits scoped to task-relevant files.
- Never push without explicit human confirmation.
- Record product intent as PRDs under `docs/prd/`.
- Record non-obvious architecture decisions as ADRs under `docs/decisions/`.
- Save notable reviews under `docs/reviews/`.
- Update `.ai/CURRENT_TASK.md`, `.ai/HANDOFF_LOG.md`, and `.ai/AI_BRIEF.md` when a coherent unit of work completes.

For risky work:

- Schema, migrations, auth/RBAC, money paths, deployment topology, and cross-cutting production behavior require explicit planning before edits.
- When Claude is unavailable, Codex can draft the PRD/ADR and implementation plan, but should not jump directly into risky code.
- Manual review remains required before merging risky implementation.

## Consequences

Positive:

- Fresh chats and different tools can rebuild context from the repo.
- Product planning survives beyond a single conversation.
- Review findings become durable.
- Dirty-worktree and no-auto-push rules reduce accidental damage.
- Claude, Codex, and ChatGPT can collaborate without duplicating effort.

Tradeoffs:

- Some context files must be maintained.
- `.ai/AI_BRIEF.md` is a generated snapshot and may always lag the final commit hash by one commit.
- Planning docs add a small up-front cost before implementation.

## Alternatives Considered

### Chat-history-only collaboration

Rejected. It is too easy for a new agent or fresh chat to miss important state.

### One large project README for all AI context

Rejected. It would waste context and mix active task state, durable rules, reviews, and architecture decisions in one file.

### Tool-specific instructions only

Rejected. Claude and Codex need shared repo-level rules, with tool-specific addenda layered on top.

## Follow-Up

Future risky builds, including Wizmatch Contact Intelligence, should start with a PRD and, where needed, a dedicated implementation ADR before schema/API/UI work.
