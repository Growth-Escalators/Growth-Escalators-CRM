# Wizmatch Documentation Index

- **Status:** Canonical documentation entry point
- **Updated:** 2026-07-13
- **Scope:** Wizmatch product, operations, implementation, and AI-agent routing

Use this file as the first Wizmatch-specific document in a Claude Code, Codex, or human engineering
session. It identifies the one canonical file for each purpose and prevents copies from drifting.

## Staffing Operating System: start here

| Purpose | Canonical file | Update rule |
|---|---|---|
| Claude Code startup prompt | [`WIZMATCH_STAFFING_OS_CLAUDE_CODE_KICKOFF.md`](WIZMATCH_STAFFING_OS_CLAUDE_CODE_KICKOFF.md) | Change only when startup, safety, verification, or handoff rules change. |
| Product target and future vision | [`../prd/004-wizmatch-staffing-operating-system.md`](../prd/004-wizmatch-staffing-operating-system.md) | One canonical PRD. Never copy it to the repository root. |
| Owner-controlled business decisions | [`WIZMATCH_STAFFING_OS_OWNER_INPUTS.md`](WIZMATCH_STAFFING_OS_OWNER_INPUTS.md) | The human owner fills decisions; an agent must not invent them. |
| Current execution focus | [`../../.ai/CURRENT_TASK.md`](../../.ai/CURRENT_TASK.md) | Update when the active implementation unit changes. |
| Last-known-good state | [`../../.ai/CURRENT_STATE.md`](../../.ai/CURRENT_STATE.md) | Verified facts only. |
| Defect/remediation status | [`WIZMATCH_STAFFING_OS_DEFECT_REGISTER.md`](WIZMATCH_STAFFING_OS_DEFECT_REGISTER.md) | Current defect status; update after verification or deployment. |
| Completed-unit history | [`../../.ai/HANDOFF_LOG.md`](../../.ai/HANDOFF_LOG.md) | Existing entries are immutable except security redaction; insert newest entries below the header. |
| Generated repository snapshot | [`../../.ai/AI_BRIEF.md`](../../.ai/AI_BRIEF.md) | Run `npm run ai:brief`; never hand-edit. |
| Live client-funnel evidence | [`../reviews/wizmatch-client-funnel-audit-2026-07-12.md`](../reviews/wizmatch-client-funnel-audit-2026-07-12.md) | Dated evidence; re-verify before editing affected code. |

## Required startup reading order

For the staffing-operating-system implementation, read only this initial allowlist before planning:

1. [`../../AGENTS.md`](../../AGENTS.md)
2. [`../../CLAUDE.md`](../../CLAUDE.md) when using Claude Code
3. This index
4. [`WIZMATCH_STAFFING_OS_CLAUDE_CODE_KICKOFF.md`](WIZMATCH_STAFFING_OS_CLAUDE_CODE_KICKOFF.md)
5. [`../prd/004-wizmatch-staffing-operating-system.md`](../prd/004-wizmatch-staffing-operating-system.md)
6. [`../../.ai/CURRENT_TASK.md`](../../.ai/CURRENT_TASK.md)
7. [`../../.ai/CURRENT_STATE.md`](../../.ai/CURRENT_STATE.md)
8. [`../../.ai/REVIEW_CHECKLIST.md`](../../.ai/REVIEW_CHECKLIST.md)
9. [`../../.ai/TOOL_ROLES.md`](../../.ai/TOOL_ROLES.md)
10. [`../../.ai/HANDOFF_LOG.md`](../../.ai/HANDOFF_LOG.md) — recent relevant entries
11. [`WIZMATCH_STAFFING_OS_DEFECT_REGISTER.md`](WIZMATCH_STAFFING_OS_DEFECT_REGISTER.md)
12. [`../reviews/wizmatch-client-funnel-audit-2026-07-12.md`](../reviews/wizmatch-client-funnel-audit-2026-07-12.md)
13. [`DATAFLOW.md`](DATAFLOW.md)
14. [`../PRODUCT_SYSTEM_BRIEF.md`](../PRODUCT_SYSTEM_BRIEF.md)
15. [`../ARCHITECTURE.md`](../ARCHITECTURE.md), [`../DATABASE.md`](../DATABASE.md),
    [`../CONVENTIONS.md`](../CONVENTIONS.md), and [`../SECURITY.md`](../SECURITY.md)
16. Current source files and tests for the selected vertical slice

`WIZMATCH_STAFFING_OS_OWNER_INPUTS.md` is required only when a blank owner decision materially affects
the selected implementation unit. Missing owner input must not block an unrelated Phase 0 repair.

## Source precedence

When files disagree:

1. **SAFETY:** `AGENTS.md` and the latest explicit human approval always govern what may be changed
   or executed.
2. **AS-IS:** current code/tests and freshly verified environment evidence define present behavior.
   Dated audits/dataflow documents are evidence to re-check, not implementation authority.
3. **TARGET:** approved owner inputs, PRD 004, and accepted ADRs define the desired product. Audit
   fix suggestions do not automatically become approved designs.
4. **EXECUTION:** `.ai/CURRENT_TASK.md` defines the exact current slice; `CURRENT_STATE`, the defect
   register, and immutable handoffs explain verified progress and what comes next.

Do not silently change the product target to match a current limitation. Record the gap. Likewise,
do not trust a dated operational claim without re-verifying it before a production-sensitive action.

Never place credentials, candidate/client PII, private JDs, contracts, production payloads, or
environment values in any context file. Record only the action and non-sensitive outcome.

## Phase-gated supporting documents

Read these only when the selected implementation unit needs them:

- [`CLIENT_FUNNEL_TEST_PLAN.md`](CLIENT_FUNNEL_TEST_PLAN.md) — client-funnel QA
- [`../reviews/wizmatch-cost-leakage-audit-2026-07-09.md`](../reviews/wizmatch-cost-leakage-audit-2026-07-09.md) — paid-provider/cost work
- [`DEMAND-SOURCING-PLAN.md`](DEMAND-SOURCING-PLAN.md) — demand sourcing
- [`GO-LIVE-PLAYBOOK.md`](GO-LIVE-PLAYBOOK.md) — approved go-live work only
- `docs/wizmatch-daily-operations.md` — operator workflow
- `docs/wizmatch-operational-readiness.md` — readiness/migration checks
- `docs/DEPLOYMENT.md` and `docs/WIZMATCH_DEPLOYMENT_GUIDE.md` — deployment work only
- Prior PRDs under `docs/prd/` and ADRs under `docs/decisions/` — when tracing earlier decisions

Phase-gated does not mean pre-approved. The guardrails in `AGENTS.md` still apply.

## Restricted paths: do not inspect by default

Do not open, copy, summarize, upload, print, or modify these paths during normal handoff/startup:

- `.env`, `.env.*`, and environment-specific files
- `SECRETS-ROTATION.md`
- `scripts/meta-app-review/REVIEWER_CREDENTIALS.md`
- `docs/wizmatch/OPERATOR-GUIDE.md`
- `.claude/settings.local.json`, `.claude/memory.db`, `.codex/config.toml`
- `.claude-flow/**` and `.swarm/**`
- Named user/seed scripts such as `src/scripts/addSneha.ts`, `src/scripts/seedKratika.ts`, and
  `src/scripts/seedUsers.ts`
- `src/scripts/sample-import.csv`
- `n8n-workflows/**/*.json`
- `docs/_archive/DEPLOY_N8N_RAILWAY.md`
- `docs/seo/state/**`
- Production exports, database dumps, resumes, candidate CSVs, private JDs, contracts, or other PII

If a selected unit genuinely requires a restricted path, stop and request explicit approval without
first inspecting or revealing its contents. Secret presence may be checked only through approved
presence-only tooling; never print values.

## Naming rules

- PRDs live only in `docs/prd/` and have a unique numeric prefix, for example
  `004-wizmatch-staffing-operating-system.md`.
- Dated audits live only in `docs/reviews/` and include `YYYY-MM-DD`.
- Architecture decisions live only in `docs/decisions/` and use `ADR-NNN-...`.
- Wizmatch Claude handoffs use the `WIZMATCH_STAFFING_OS_...` prefix in `docs/wizmatch/`.
- Phase plans should include the PRD and phase, for example `004-phase-00-trust-correctness.md`.
- Never create root-level copies of canonical product documents. Link to the canonical path.
- Do not create another “master”, “final”, “latest”, or “v2” copy. Update the canonical document or
  create a properly numbered/date-stamped artifact.

## Context-update loop

After a coherent implementation unit is genuinely complete:

1. Update `.ai/CURRENT_TASK.md` with the exact next unit.
2. Update `.ai/CURRENT_STATE.md` with verified facts only.
3. Add a new immutable entry immediately below the `.ai/HANDOFF_LOG.md` header; do not rewrite
   historical entries except to redact exposed sensitive values.
4. Run `npm run ai:brief`; never hand-edit `.ai/AI_BRIEF.md`.
5. Update PRD/ADR/operating documentation only when the completed work changes their truth.

Do not mark an entire phase complete when only one slice is implemented.

## Source-control note

The repository may contain unrelated modified and untracked work. Always inspect `git status` before
editing. Never use `git add -A`, `git add .`, destructive cleanup, hard reset, or blanket restore.
Stage by explicit path only when the human asks for a commit. A file that exists locally is not
available in a fresh clone until it is reviewed and committed.
