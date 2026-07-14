# Wizmatch Staffing OS — Claude Code Kickoff

- **Status:** Canonical reusable release/resume prompt
- **Updated:** 2026-07-14
- **Context index:** [`README.md`](README.md)
- **Product contract:** [`../prd/004-wizmatch-staffing-operating-system.md`](../prd/004-wizmatch-staffing-operating-system.md)

Open Claude Code in `/Users/jatinagrawal/repo-comparison/v2-wizmatch-phase0-trust` and paste the
block below. Do not start this release task in the original dirty workspace.

```text
You are the senior release and implementation lead for the Wizmatch Staffing Operating System.

Working repository:
  /Users/jatinagrawal/repo-comparison/v2-wizmatch-phase0-trust

Expected branch:
  codex/wizmatch-phase0-trust

Preserved original dirty workspace — inspect only if explicitly required; never copy its unrelated
changes into this release:
  /Users/jatinagrawal/repo-comparison/v2

Durable context starts at:
  docs/wizmatch/README.md

Canonical product contract:
  docs/prd/004-wizmatch-staffing-operating-system.md

The complete local target is implemented:

Company → named hiring contact → requirement → candidate evidence/match → human shortlist → exact-
requirement consent/RTR → approved manual submission record → interview → offer revision → joining/
placement → existing invoice/payment linkage → collection and margin analytics.

Person A’s SAP requirement and Person B’s Java requirement at the same company must always remain
distinct. A signal is not a requirement; a score is not a shortlist; a shortlist is not a
submission; an offer is not a start; a placement is not an invoice; an invoice is not collection.

Mandatory startup

1. Read AGENTS.md and CLAUDE.md completely.
2. Read docs/wizmatch/README.md and follow its required-reading order and restricted-path rules.
3. Read .ai/CURRENT_TASK.md, .ai/CURRENT_STATE.md, the latest .ai/HANDOFF_LOG.md entry,
   docs/wizmatch/WIZMATCH_STAFFING_OS_DEFECT_REGISTER.md, ADR-004 and PRD 004.
4. Run pwd, git branch --show-current, git status --short, git diff --stat and git log -10 --oneline.
5. Run git fetch origin. Do not pull, merge, rebase, reset, clean, restore, switch worktrees or
   discard anything while files are dirty.
6. Confirm the existing scoped release commits, including:
   - 1997e31 feat(wizmatch): harden Phase 1 operations
   - a5ac3e8 feat(wizmatch): add Gate B candidate matching
   - 48b1a88 feat(wizmatch): complete Gate C delivery operations
   - 605d6cd fix(wizmatch): enforce delivery reference integrity
   - ef2112f fix(wizmatch): verify staging delivery economics
   - 9f4c0f4 fix(wizmatch): enforce staffing pilot access policy
7. Inspect the context-only diff. Review only files recorded in CURRENT_TASK. Never use git add .
   or git add -A.

Current release truth

- Phase 0, Gate A, Gate B and Gate C are implemented locally.
- Migrations 0025–0028 are additive. 0028_strong_cammi.sql passed a production-shaped scratch apply
  on top of the committed Gate B schema.
- The local verification baseline is: backend build green, 45 Vitest files / 360 tests green,
  admin build green and 16/16 mocked Chromium scenarios green.
- API and UI phase flags default off in production. Server flags are
  WIZMATCH_STAFFING_GATE_A/B/C_ENABLED; matching Vite build flags are
  VITE_WIZMATCH_STAFFING_GATE_A/B/C_ENABLED.
- Requirement and consent documents use private R2 references and short-lived signed access.
- Deterministic reminders create shared tasks only. They never message candidates or clients.
- Sending, outreach, automatic submission and paid discovery are not authorized by this prompt.
- Live Dice/TheirStack health is not proven. The System page reports observed database rows, while
  Dice CI secret presence remains externally unverifiable from the application.

Your first task

The release-integrity review, full fictional Gate A/B/C exercise, commercial-label repair and final
named-pilot access qualification are complete. Do not repeat them unless code or staging changed.
Resume at the first production gate:

1. Confirm the branch is clean, 0 behind `origin/main`, and includes `9f4c0f4` plus the latest
   context commit.
2. Re-read CURRENT_TASK/CURRENT_STATE and report any contradiction before an external action.
3. Confirm the approved live Wizmatch-admin credential rotation is recorded as complete; do not
   repeat it. The replacement is in macOS Keychain and must never be printed or copied to context.
4. Production read-only qualification is pre-authorized and already complete; do not repeat it
   unless production or branch state changes. Reads never authorize deletion.
5. Ask for approval for the exact production safety-variable bundle in CURRENT_TASK. Do not
   migrate, push, create users, activate gates or import data from this startup prompt alone.

Current infrastructure truth

- Railway has isolated `production` and `staging` environments. Staging contains `web-staging` and
  `Postgres-Bhky`; Gate A/B/C are on there with fictional data. No worker exists in either environment.
- Exact `9f4c0f4` is live on `web-staging` as deployment
  `54b9ff52-8fed-43eb-974c-bb2ddaab72f6` (`SUCCESS`). Its 15-check direct-API access matrix and
  read-only staffing-chain/economics reconciliation passed.
- Production `web` remains on `b05ac015eff8444edc217563fdb93ac5ef836639` from the latest read-only
  inspection. Recompute the branch position at startup rather than relying on a saved ahead count.
- Deployment documentation references `railway.worker.json`, but the file is absent in this clean
  worktree. Do not create or deploy a worker during the initial pilot.

Approval gates — stop immediately before each

The local implementation approval does not authorize any of the following. Obtain a separate,
explicit human “yes” immediately before each action:

- Apply a staging or production migration.
- Read or mutate production data, including the count-only preview.
- Set/change Railway, Vercel, GitHub Actions or Vite environment variables.
- Rotate the exposed credential or rewrite Git history.
- Push any branch; pushing main auto-deploys and needs approval for that exact push.
- Enable Gate A, B or C in production.
- Upload real JDs, RTRs, resumes or contracts.
- Call paid providers, enable sending/outreach, or send/submit a candidate.

When staging creation is explicitly approved

1. Create only an isolated `staging` environment and empty Postgres in the existing Railway project.
2. Do not deploy code or apply migrations under the creation approval.
3. Verify by read-back that staging has no production database reference/data, no worker, no phase
   flags, no sending and no paid-provider enablement.
4. Update the persistent handoff and stop for the separate migration approval.

When staging migration is explicitly approved

1. Verify actual Railway topology; do not assume web+worker or a single service.
2. Apply the complete migration journal to the empty staging database with the real deployment
   migrator and verify the journal.
3. Keep all phase flags off.
4. Stop for a separate application-deployment approval after journal verification.

When staging deployment is explicitly approved

1. Deploy this clean worktree directly to staging without pushing `main`; observe terminal `SUCCESS`.
2. Use fictional records only: Company A, Person A/SAP ABAP, Person B/Java and fictional candidates.
3. Exercise attribution, matching, consent, approval, manual sent-record, interview, offer, placement,
   invoice link and collection analytics; do not send anything.
4. Verify tenant isolation, role gates, outage behavior, mobile/desktop layout and application-code
   rollback while leaving additive schema intact.
5. Record exact evidence in CURRENT_STATE, CURRENT_TASK and HANDOFF_LOG; regenerate AI_BRIEF.

When production count-only access is explicitly approved

Run only:
  npm run wizmatch:staffing-backfill-preview

It is read-only. Do not create a write mode, infer historical contacts/owners, or update pilot rows
without a later, separate production-data approval and an explicit reviewed input list.

Persistent handoff after every completed unit

- Update .ai/CURRENT_TASK.md with one exact next step.
- Update .ai/CURRENT_STATE.md with verified facts only.
- Insert a new immutable entry near the top of .ai/HANDOFF_LOG.md.
- Run npm run ai:brief; never hand-edit .ai/AI_BRIEF.md.
- Update the defect register/ADR/owner inputs only when evidence changes their truth.

Final report format

- What is verified now
- Exact files changed
- Exact commands/results
- Pre-existing noise versus new regressions
- External checks skipped and why
- Approval gate reached
- One exact next action

Begin now with mandatory startup verification and report the production safety-variable approval
gate from CURRENT_TASK. Do not redo staging Gates A/B/C, credential rotation or unchanged
production reads, and do not perform a production write from this prompt alone.
```
