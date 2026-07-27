# WizMatch Smartlead-free live-pilot go-live runbook

- **Status:** Runbook for the internal, Smartlead-free production pilot of the WizMatch Outbound
  Operating System (PR 1–8A). Does not itself authorise any production action — every gate below
  ends in an explicit human-approval placeholder.
- **Scope:** `ge/outbound-08a-live-pilot-hardening`, built on the code-ready `ge/outbound-08-outreach-adapter`
  stack.
- **Companion docs:** [`docs/wizmatch/WIZMATCH_SMARTLEAD_FREE_PILOT_CONFIG.md`](../wizmatch/WIZMATCH_SMARTLEAD_FREE_PILOT_CONFIG.md)
  (required flag values), [`docs/prd/005-wizmatch-outbound-operating-system.md`](../prd/005-wizmatch-outbound-operating-system.md)
  §21 (readiness report, G1–G4 gates), [`docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`](../handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md)
  (full PR-by-PR history).

## What this pilot is, and is not

This runbook covers the **internal preparation/decision pilot only**:
company policy, duplicate review, the Decision Workbench (including the new
Routed queue), free preparation, evidence/provenance, and readiness
reporting. It never sends, enrols, connects Smartlead, imports/exports a
Smartlead CSV, uses a provider credential, ingests a reply, uses paid
discovery, or promotes enforcement beyond shadow.

**PR 9 (Smartlead CSV adapter) and PR 10 (reply ingestion) are NOT required
for this pilot.** They remain gated on the sanitised Smartlead fixtures
(U-6, ADR-007 D-5) and are only required for the later, separate
provider-based outbound workflow. Nothing in this runbook depends on them.

## Gate structure

Four gates, each requiring an explicit named approval before the next
begins. No gate may be skipped or combined with another.

---

### G1 — Migration approval (apply `0037`)

**Precondition:** all PR 2–8 code-ready markers present (`npm run wizmatch:pilot-readiness`
confirms this mechanically), PR 8A hardening complete and independently reviewed.

Checklist:

- [ ] Production `information_schema` drift review — confirm the live schema matches what
  `0037_unknown_siren.sql` expects to find, using a read-only diff against a production
  snapshot (never a live write).
- [ ] Shared-index owner sign-off — the three additive `(tenant_id, id)` unique indexes on
  `users`, `contacts`, `contact_channels` are shared with the Growth tenant (ADR-006 D-14,
  U-7). Confirm the owner has approved the brief write-lock these indexes take during build.
- [ ] Production-sized lock measurement — time the index builds against a production-sized
  restore (not the live database) and confirm the duration is acceptable during a
  maintenance window.
- [ ] Backup/rollback verification — confirm a recent backup exists and that the rollback
  path (application-code revert; `0037`'s tables are left in place, never dropped, per
  ADR-004) is understood by whoever is on call.
- [ ] Explicit migration approval:

  ```
  APPROVED BY: ______________________   DATE: __________
  Migration 0037 applied to: ______________________ (environment)
  ```

**Do not** run any `db:migrate` command against production until every box above is checked
and the approval line is signed. This runbook contains no command that applies `0037`
automatically.

---

### G2 — Backfill approval

**Precondition:** G1 complete, `0037` applied and verified.

Checklist:

- [ ] Backfill dry run — `scripts/onboarding/wizmatch-policy-backfill.ts` run WITHOUT `--apply`
  against production data (dry run only). Review the emitted count and sample report.
- [ ] Result review — confirm the reported "missing root policy" count matches expectations
  (roughly the current company count; ADR-006's backfill proposal estimates ~131 companies
  at time of writing, an evidentiary anchor to sanity-check against, not a hard number).
- [ ] Explicit backfill-apply approval:

  ```
  APPROVED BY: ______________________   DATE: __________
  Backfill applied to: ______________________ (environment), dry-run count reviewed: ____
  ```

**Do not** run `wizmatch:policy-backfill -- --apply` until the approval line is signed. This
runbook contains no command that runs `--apply` automatically.

---

### G3 — Shadow-mode production deployment

**Precondition:** G1 and G2 complete.

Checklist:

- [ ] Confirm the deployed environment matches
  [`WIZMATCH_SMARTLEAD_FREE_PILOT_CONFIG.md`](../wizmatch/WIZMATCH_SMARTLEAD_FREE_PILOT_CONFIG.md)
  exactly: `WIZMATCH_POLICY_ENFORCEMENT_MODE=shadow` (or unset), `WIZMATCH_SENDING_ENABLED=false`,
  `AUTOMATED_EMAILS_ENABLED=false`, `WIZMATCH_AUTO_PREP_ENABLED=false`,
  `WIZMATCH_OUTREACH_ADAPTER_ENABLED=false`, no Smartlead credential present, no paid-discovery
  flag on.
- [ ] Run `npm run wizmatch:pilot-readiness -- --production` against the deployment's actual
  environment (or an identical local `.env` copy) and confirm exit code 0 / no `DANGER` findings.
  **The `--production` flag is required for this step.** A copied `.env` does not carry
  `NODE_ENV=production`, so it is the flag that turns the runtime assertion itself — asserted
  production target vs. actual `NODE_ENV` — into a blocking failure. Every roster finding is now
  unconditional: an absent, empty, malformed, or all-users roster is a DANGER with or without the
  flag, because the staffing gate fails closed in every runtime.
- [ ] Deploy in shadow. This repo auto-deploys on push to `main` — pushing is itself a
  production-sensitive action requiring its own explicit confirmation, separate from this
  runbook's gates.
- [ ] **`NODE_ENV=production` confirmed on the deployed service.** The pilot roster gate no longer
  depends on this — `resolveStaffingAccess` fails closed in every runtime — but `NODE_ENV` still
  selects production-only Express behaviour (error-response verbosity, secure cookie flags), and
  nothing in this repo records that the variable is set at runtime (Nixpacks' documented
  `NODE_ENV=production` applies to the *build* phase, which says nothing about the running
  container). Check the Railway service variables directly;
  `npm run wizmatch:pilot-readiness -- --production` reports a DANGER when the asserted target and
  the actual `NODE_ENV` disagree, but it can only see the environment it is run in.
- [ ] Pilot roster validation — confirm `WIZMATCH_STAFFING_PILOT_USER_IDS` is set to exactly the
  intended pilot members (**not** the all-users override, which the readiness command reports as
  a dangerous open deployment), and that a non-pilot account is rejected end to end (one manual
  check: log in as a non-roster account, confirm `/today/queues` and `/companies/:id/policy` both
  403).
- [ ] Health/readiness validation — confirm the deployed process starts cleanly, the existing
  health-check endpoint reports healthy, and no error-rate spike appears in the first
  observation window.
- [ ] Queue and policy smoke tests — as a pilot member, confirm: `GET /api/wizmatch/today/queues`
  returns all five queues (Ready to Contact / Needs Review / Routed / Replies Needing Action /
  Paused or Blocked) without error; a single company policy write (e.g. `set_review_date`) round
  trips correctly; a non-overridable company still shows no override affordance.
- [ ] Observation review — after a defined observation window (owner to set the duration),
  review the shadow "would-block" signal and the readiness report's "companies missing an
  effective policy" metric before considering G4.

  ```
  APPROVED BY: ______________________   DATE: __________
  Deployed to: ______________________ (environment), observation window: __________
  ```

---

### G4 — Future enforce approval

**Not part of this pilot.** Promotion from `shadow` to `enforce` is an explicit, separate owner
decision (PRD-005 §21.2, §16) made only after G3's observation window shows the readiness
report's hard preconditions are met (zero companies missing an effective policy, among others).
Nothing in this runbook authorises that flip; it is recorded here only so the full gate
sequence is visible in one place.

```
G4 — NOT APPROVED. Do not set WIZMATCH_POLICY_ENFORCEMENT_MODE=enforce on the strength
of this document alone.
```

---

## Read-only verification at any point

```bash
npm run wizmatch:pilot-readiness                 # assess as-is
npm run wizmatch:pilot-readiness -- --production # assert a production target (required at G3)
```

Checks (without touching any database, network, or provider): code-ready markers through
PR 8, enforcement mode, sending/automated-email/preparation/adapter flags, Smartlead credential
presence including known aliases such as `SL_API_KEY` (name only, never the value), paid-discovery
flags, provider selection, pilot roster configuration and id format, migration/backfill status (reported, never changed), and dangerous contradictory
combinations. Exits non-zero on any dangerous finding.

It loads `.env` before reading the environment, so running it against a copied production `.env`
assesses that file's values and not the empty shell environment. What it **cannot** do is reach
into Railway: it only ever sees the environment of the machine it runs on, so "run it against the
deployment's actual environment" means exactly that — run it where those values are present, or
against a faithful copy. It also cannot tell whether `0037` has been applied to any database.

## Safety reminders

- Do not apply migration `0037`, run the backfill with `--apply`, promote enforcement, enable
  sending, enable the outreach adapter, enable paid discovery, or connect Smartlead on the
  strength of this document alone — every one of those requires the specific signed approval
  line in its own gate above.
- Never rewrite this runbook to bypass a gate "just this once." If a gate turns out to be
  wrong, fix the runbook in its own reviewed change, not in the moment of going live.
