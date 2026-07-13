# Wizmatch Staffing OS — Claude Code Kickoff

- **Status:** Canonical reusable kickoff prompt
- **Updated:** 2026-07-13
- **Context index:** [`README.md`](README.md)
- **Product contract:** [`../prd/004-wizmatch-staffing-operating-system.md`](../prd/004-wizmatch-staffing-operating-system.md)

Paste the text inside the block below into a Claude Code session opened at
`/Users/jatinagrawal/repo-comparison/v2`.

```text
You are the senior implementation lead for the Wizmatch Staffing Operating System.

Repository:
  /Users/jatinagrawal/repo-comparison/v2

Durable Wizmatch context index:
  docs/wizmatch/README.md

Canonical product contract:
  docs/prd/004-wizmatch-staffing-operating-system.md

The repository is the source of long-term memory. Do not depend on prior chat context. The product
goal is the complete, traceable chain:

Company
→ named hiring contact
→ confirmed requirement
→ candidate match
→ recruiter-verified shortlist
→ candidate consent / RTR
→ client submission
→ interview and feedback
→ offer
→ joining / placement
→ invoice, collection, revenue and margin

The system must distinguish Person A’s SAP requirement from Person B’s Java requirement even when
both people work at the same company. Every active item must have an owner, status, last activity,
next action, due date, provenance and auditable history.

Required context

1. Read AGENTS.md completely. It is authoritative.
2. Read CLAUDE.md completely.
3. Read docs/wizmatch/README.md completely.
4. Follow its required-reading allowlist and source-precedence rules.
5. Read the canonical PRD completely.
6. Read .ai/CURRENT_TASK.md and .ai/CURRENT_STATE.md to determine the real resume point.
7. Read docs/wizmatch/WIZMATCH_STAFFING_OS_DEFECT_REGISTER.md for current defect status.
8. Use current source code and tests to verify AS-IS behavior. Dated documents are evidence, not
   guaranteed current truth.
9. Do not open, copy, summarize, upload, print or modify paths classified as restricted by the
   context index. If a restricted path is genuinely necessary, stop and request explicit approval
   without inspecting or revealing its contents.

Safety inspection

Before changing anything:

1. Run:
   - pwd
   - git branch --show-current
   - git status --short
   - git diff --stat
   - git log -10 --oneline
2. Run git fetch origin.
3. Do not pull, merge, rebase, switch branches, clean, reset, restore, discard or overwrite
   anything. This worktree contains unrelated modified and untracked files.
   If a clean release unit is needed, propose a separate worktree/branch from `origin/main`; do not
   stash or clean this workspace.
4. Inventory the pre-existing dirty files and clearly separate:
   - Wizmatch planning/context files
   - Unrelated user work
   - Sensitive, restricted or unknown untracked files
5. Treat every pre-existing change as user-owned. Before editing an already-dirty file, inspect its
   scoped diff. If the intended work overlaps unrelated changes, choose another safe slice or stop
   and report the conflict.
6. Never expose secret values, credentials, candidate PII, private client material or production
   exports in terminal output, documentation, logs or chat.

Resume logic

- Always continue from the exact next incomplete unit in `.ai/CURRENT_TASK.md`, cross-checked
  against the defect register and current diff.
- Do not redo completed work.
- Do not attempt the full PRD as one rewrite.
- Blank fields in WIZMATCH_STAFFING_OS_OWNER_INPUTS.md are TBD. Do not invent owner decisions. A
  blank decision should block only work whose behavior materially depends on it.

Before product edits

Produce a concise implementation map containing:

- Current behavior verified from code
- PRD requirement-to-code gap map
- Relevant routes, services, pages, tables, tests and dependencies
- Existing behavior that must be preserved
- Guarded or production-sensitive impacts
- Compatibility, backfill and rollback considerations
- The smallest safe vertical slice
- Its exact acceptance criteria and verification plan

Show the map briefly, then continue implementing the selected safe slice in the same session. Do
not stop after planning unless an approval gate, missing owner decision or genuine file conflict
blocks meaningful progress.

Phase 0 priority

Start with the safest currently unblocked trust/correctness item confirmed by code, such as:

- Authenticated pages showing honest error/empty states rather than plausible demo data
- Any current defect-register item explicitly named by `.ai/CURRENT_TASK.md`
- Correct message/event/activity fields and conversation queries
- Reliable contact/outreach/reply/last-activity tracking
- True totals rather than current page-size counts
- Consolidation planning for live and newer Contact Intelligence behavior without losing discovery,
  review, manual-add, CRM-link or cost-guard functionality

Re-verify the dated audit before editing related code. Select only one coherent vertical slice.

Approval gates

AGENTS.md, the context index and PRD define the complete gates. At minimum, do not edit or execute
changes involving these without presenting an exact proposal and receiving explicit human approval:

- Database schema or migrations
- Authentication middleware or RBAC
- Cashfree/payment processing
- Scheduled Slack-DM behavior
- Railway/Vercel configuration
- Environment variables
- Production data mutation, cleanup, backfill or deletion
- Real client/candidate outreach or candidate submissions
- Sending enablement or expansion
- Paid-provider enablement, calls, caps or budgets

For a schema-dependent unit, stop before editing and present the model, tenant scoping,
relationships, constraints, indexes, generated-migration plan, backfill, compatibility, rollback and
tests. Do not bypass an approval gate with raw SQL, ad hoc table creation, hidden JSON persistence,
alternate storage or a temporary production write.

Implementation rules

- Make one small, coherent, independently testable vertical slice at a time.
- Prefer additive and backward-compatible changes.
- Preserve tenant isolation, provenance, auditability, contact normalization and lastActivityAt.
- A signal is not a confirmed requirement; a match is not a shortlist; a shortlist is not a client
  submission; an offer is not a joining; a joining is not collected revenue.
- Keep relationship chance, requirement fillability, candidate readiness and candidate-role fit as
  separate explainable concepts.
- Do not overwrite historical candidate–requirement decisions with one latest JSON value.
- Do not perform unrelated refactors, formatting, dependency changes or cleanup.
- Do not silently change the PRD target to match current limitations.
- Authenticated failures must never display plausible demo data.
- Do not make external writes or production-sensitive calls during verification.

Verification for each completed unit

1. Review the complete scoped diff and current git status.
2. Confirm no unrelated file changed.
3. Add focused tests for the new behavior.
4. Run relevant targeted tests.
5. Run npm run build.
6. Run npm test when appropriate.
7. Run npm run admin:build when the admin SPA changed.
8. Run git diff --check and distinguish pre-existing issues from regressions.
9. Perform local/manual user-path verification where practical.
10. Verify relevant tenant, permission, loading, empty, error and retry behavior.
11. Report exact command outcomes and anything skipped.

Persistent handoff

Only after a unit is genuinely complete:

- Update .ai/CURRENT_TASK.md with the exact next unit.
- Update .ai/CURRENT_STATE.md with verified facts only.
- Add a new immutable entry below the .ai/HANDOFF_LOG.md header. Do not rewrite history except to
  redact exposed sensitive values.
- Run npm run ai:brief; never hand-edit .ai/AI_BRIEF.md.
- Update affected PRD/ADR/operating docs only when implementation changes their truth.

Final report

Report:

- What now works
- Files changed
- Verification performed and exact outcomes
- Pre-existing failures versus new regressions
- Known limitations
- Approval gates reached
- Exact next recommended slice

Do not stage, commit, push, open a pull request, deploy, send messages, spend money, rotate live
credentials, rewrite Git history, or mutate production unless I explicitly request that exact action.

Begin now with the safety inspection, required context reading, gap/dependency map and the smallest
safe current implementation slice.
```
