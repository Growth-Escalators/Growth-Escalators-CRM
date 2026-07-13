# CURRENT_TASK.md

## Active task

**Wizmatch Staffing OS — all three planned local implementation phases and the release-integrity
review are complete and verified on
`codex/wizmatch-phase0-trust` in `/Users/jatinagrawal/repo-comparison/v2-wizmatch-phase0-trust`.
The exact next task is separately approved Railway staging creation, followed by separately approved
staging deployment and migration application.**

Nothing from this branch has been pushed, deployed, migrated, sent, spent, written to production,
or used to rotate a credential. The original dirty workspace at
`/Users/jatinagrawal/repo-comparison/v2` remains untouched.

### Local commits already created

- `1997e31 feat(wizmatch): harden Phase 1 operations`
- `a5ac3e8 feat(wizmatch): add Gate B candidate matching`
- `48b1a88 feat(wizmatch): complete Gate C delivery operations`
- `605d6cd fix(wizmatch): enforce delivery reference integrity`
- This context update is the only current working unit; inspect `git status` and the latest log
  before continuing.

### What is implemented locally

- Phase 0 trust/hardening: honest outage states, development-only demo routes, private signed
  requirement documents, signal deduplication, true totals, tenant-aware parsing and safe AI limits.
- Gate A: company/contact relationships, person-specific requirement attribution, assignments,
  SLA/next action, task links, timelines, My Work and Company/Contact/Requirement 360.
- Gate B: canonical skills/aliases, requirement and candidate evidence, immutable match snapshots,
  explainable deterministic matching and persistent shortlist/watch/reject decisions.
- Gate C: exact-requirement consent/RTR, private consent documents, submissions/recipients/history,
  interviews, offer revisions, traceable placements, permanent/contract economics, invoice links,
  adjustments, delivery analytics and production-off phase flags.
- Safe automation: feature-gated deterministic shared tasks for overdue requirement SLAs,
  submission follow-ups and stale candidate availability. It never sends outreach or submissions.

### Verified evidence

- Additive migrations `0025`–`0028`; `0028_strong_cammi.sql` contains no destructive SQL.
- Production-shaped scratch migration applied `0028` on top of the committed Gate B schema and
  verified all nine Gate C tables, traceability columns and journal advancement.
- `npm run build` passed.
- `npm test` passed: 43 files / 349 tests.
- `npm run admin:build` passed.
- Local mocked Chromium passed 16/16, including Person A/SAP versus Person B/Java and the delivery
  chain through placement. No live provider, R2, send, payment or production call was made.
- `git diff --check` must be rerun immediately before the Gate C commit/release handoff.

### Exact next sequence — do not skip approvals

1. Obtain explicit approval to create an isolated Railway `staging` environment and empty Postgres
   instance. Current Railway has production only (`web` + Postgres), with no worker.
2. Obtain separate approval for staging deployment and migration application. Apply schema first and smoke fictional
   Company A / Person A SAP / Person B Java plus one fictional candidate delivery chain.
3. Run `npm run wizmatch:staffing-backfill-preview` against production only after read-only access is
   approved. It is count-only and never writes.
4. Obtain a separate explicit approval for each production migration, production-data write,
   environment/feature-flag change, credential rotation, and push to `main`.
5. After schema verification, push the reviewed application only with explicit approval, then enable
   Gate A for the Wizmatch pilot. Gate B and C remain off until their separate pilot checks pass.
6. Re-verify live Dice/TheirStack counts and configuration. Current code reports observed rows but
   cannot inspect the Dice GitHub Actions secret.

Canonical context starts at `docs/wizmatch/README.md`. The reusable Claude prompt is
`docs/wizmatch/WIZMATCH_STAFFING_OS_CLAUDE_CODE_KICKOFF.md`.

### Remaining external/human gates

- Live credential rotation and any Git-history remediation.
- Staging and production migration application.
- Production count-only preview and any later pilot backfill.
- Railway/Vite feature flags and actual Railway topology verification.
- Push/deployment and authenticated production smoke.
- Team names, SLAs, commercial policy, pilot records and candidate/client data.
- Sending, outreach, paid providers and automatic submissions remain disabled and separately gated.
