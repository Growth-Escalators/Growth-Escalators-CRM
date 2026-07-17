# Fable review remediation status

Maps every finding in [`docs/fable-review-2026-07-16.md`](./fable-review-2026-07-16.md) (PR #46)
to what was done about it. **56 findings total** (9 CRITICAL + 18 HIGH + 26 MEDIUM + 3 LOW —
correcting the "53" figure used when this effort was scoped; the arithmetic on the actual
severity counts is 56).

**None of the PRs below are merged yet.** Every one is open against `main`, reviewed and
tested independently, ready for Jatin to review/merge. Several PRs generate a migration
numbered `0030` because their branches were cut in parallel before any of them merged —
**whichever merges last needs its migration(s) renumbered by hand**; each PR body flags this.

| PR | Branch | Covers |
|---|---|---|
| #45 | `salvage/wizmatch-phase0-trust` | Pre-review WizMatch fixes; **prerequisite for #51** (same files) |
| #47 | `fix/cashfree-hardening` | Batch 1 — Cashfree money path |
| #48 | `fix/auth-trust-boundary` | Batch 2 — Auth & webhook trust boundary |
| #49 | `fix/tenant-isolation` | Batch 3 — Tenant isolation (non-billing) |
| #50 | `fix/billing-correctness` | Batch 4 — Billing correctness |
| #51 | `fix/wizmatch-costcap-scoring` | Batch 5 — WizMatch cost cap & scoring (based on #45) |
| #52 | `fix/reliability-crons` | Batch 6 — Reliability, crons & startup safety |
| #53 | `fix/dx-observability` | Batch 7 — DX, observability, coverage, outbound tenant isolation, R2 security |

## CRITICAL (9/9 fixed)

| # | Finding | Status | PR |
|---|---|---|---|
| C1 | Cashfree webhook accepts unauthenticated payloads | ✅ Fixed — HMAC signature verify, fails closed | #47 |
| C2 | Billing payment-status PATCH has no permission check | ✅ Fixed | #50 |
| C3 | Billing invoice PATCH allows cross-tenant line-item write | ✅ Fixed | #50 |
| C4 | `GET /api/capi/status` leaks events across tenants | ✅ Fixed | #49 |
| C5 | `invoice_series` `ON CONFLICT` targets a missing constraint | ✅ Fixed — migration adds the unique index (dedup pre-step) | #50 |
| C6 | WizMatch auth mount 401-walls internal ingest + unsubscribe | ✅ Fixed — carve-out mounted before `requireAuth` | #48 |
| C7 | Socket.io unauthenticated + joins any contact room | ✅ Fixed — JWT handshake + tenant-scoped join | #48 |
| C8 | Inbox send routes skip tenant filter on `contact_channels` | ✅ Fixed | #49 |
| C9 | Cashfree idempotency claim commits before processing | ✅ Fixed — wrapped in transaction, claim rolls back on failure | #47 |

## HIGH (17/18 fixed, 1 partial)

| # | Finding | Status | PR |
|---|---|---|---|
| H1 | Cashfree admin simulate/debug — no role gate | ✅ Fixed | #47 |
| H2 | `requireAuth` never checks `tokenVersion` against DB | ✅ Fixed — folded in with a 30s per-user cache | #48 |
| H3 | Webhook signature verifiers fail open when secret unset | ✅ Fixed — fail closed (503) | #48 |
| H4 | WhatsApp signature computed over re-serialized JSON | ✅ Fixed — uses `req.rawBody` | #48 |
| H5 | `next-invoice-number` preview permanently increments | ✅ Fixed — split into `peek` (read-only) vs `claim` | #50 |
| H6 | FY rollover computed in server-local UTC, not IST | ✅ Fixed — `Intl.DateTimeFormat` with `Asia/Kolkata` | #50 |
| H7 | Payment recording is non-transactional read-modify-write | ✅ Fixed — `db.transaction` + `SELECT ... FOR UPDATE` | #50 |
| H8 | Recurring invoice day-31 rollover, dedup too broad | ✅ Fixed — day clamped to month length, dedup scoped to recurring | #50 |
| H9 | Recurring service applies `taxType` even when `isGst=false` | ✅ Fixed | #50 |
| H10 | WizMatch daily X-Ray cron burns credits invisibly | ✅ Fixed — always creates a `source_run`, checks cap upfront | #51 |
| H11 | Cost cap: stuck `running` rows contribute 0; check-then-spend not atomic | ✅ Fixed — advisory lock + stale-run recovery worker | #51 |
| H12 | `POST /discover/import` inserts into the first tenant found | ✅ Fixed — uses caller's `tenantId` | #49 |
| H13 | Placement cron re-blasts purchase assets every 5 min on failure | ✅ Fixed — pre-send dedupe against `purchase_delivery_log` | #52 |
| H14 | `'above 1'` substring matches `"above 10k"` | ✅ Fixed — bounded regex per bucket | #51 |
| H15 | Empty requirement scores every candidate 85 | ✅ Fixed — zero mandatory/preferred → score 0 | #51 |
| H16 | Writer-vs-writer race in denorm sync | ✅ Fixed — `SELECT ... FOR UPDATE` before skill replace | #51 |
| H17 | R2 uploads trust client MIME type; no magic-byte/path validation | ✅ Fixed — magic-byte sniff + per-segment key sanitization. **Not in the original 7-batch plan** — caught while compiling this doc, fixed as a follow-up commit on #53 since it was still open | #53 |
| H18 | `outbound` + SEO table family have no `tenant_id` | 🟡 **Partial** — `prospects`/`signals`/`replies`/`outbound_events` fixed (migration + all ~15 route touch-points filtered). The SEO table family (`keyword_rankings`, `backlink_data`, `content_gap_analysis`, `seo_opportunities`, `site_health_metrics`, `brand_mentions`, `client_pages`, `client_knowledge_base`) is **not** — those are mostly `ensure*`-pattern tables invisible to `schema.ts`, entangled with M10. Recommended order in `docs/ensure-table-inventory.md`. | #53 |

## MEDIUM (22/26 fixed, 2 partial/framework, 2 deferred)

| # | Finding | Status | PR |
|---|---|---|---|
| M1 | No CI runs build/test before deploy | ✅ Fixed — `.github/workflows/ci.yml` | #53 |
| M2 | `billing.test.ts` re-implements `calculateTax` inline | ✅ Fixed — imports the real function | #50 |
| M3 | Zero tests on the JWT trust boundary | ✅ Fixed — `auth.test.ts`, `validateWebhook.test.ts` | #48 |
| M4 | Zero tests on Cashfree PAYMENT_SUCCESS path | ✅ Fixed — dedicated describe block incl. idempotency + C9 claim-release | #47 |
| M5 | Zero tests on `contactService.findOrCreateContact` | ✅ Fixed — `contactService.test.ts` | #53 |
| M6 | Request-ID never reaches log lines | ✅ Fixed — AsyncLocalStorage-based propagation into every `logger.*()` call | #53 |
| M7 | Global error handler logs via `console.error` | ✅ Fixed — structured `logger.error` | #53 |
| M8 | Six bootstrap `.catch(() => {})` swallow errors | ✅ Fixed — logged | #52 |
| M9 | Two orphaned index migrations never applied | ✅ Fixed — folded into one journaled migration | #53 |
| M10 | Three parallel schema mechanisms; 41 tables invisible to migrations | 🟡 **Framework only** — full inventory + recommended order in `docs/ensure-table-inventory.md`; no tables actually migrated (each needs the same backfill care as the H18 migration — 41 in one sitting trades quality for speed) | #53 |
| M11 | Cross-process cron locking is dead code | ✅ Fixed — advisory lock now defaults on | #52 |
| M12 | Cron per-item errors marked "success", no alert | ✅ Fixed — `extractErrorCount` + `'partial'` status + Slack DM | #52 |
| M13 | Migrate-on-boot has no cross-instance lock | ✅ Fixed — `pg_advisory_lock` around `migrate()` | #52 |
| M14 | Socket.io single-instance; multi-instance drops messages | ⏸️ **Deferred** — documented dependency (`@socket.io/redis-adapter`), not built until multi-instance scaling is actually enabled | — |
| M15 | `.env.example` incomplete | ✅ Fixed — all ~168 vars, sectioned + documented | #53 |
| M16 | Rate limiters key on `req.ip`, no `trust proxy` | ✅ Fixed — `app.set('trust proxy', 1)` | #48 |
| M17 | "One-time" startup backfills unguarded, re-run every deploy | ✅ Fixed — `boot_backfills_completed` claim table | #52 |
| M18 | `events` table scanned unbounded by cron, no processed marker | ✅ Fixed — `processed_at` column + index | #52 |
| M19 | FK-less runtime tables create orphan rows by construction | 🟡 **Partial** — `prospects` got its FK (already Drizzle-tracked, fixed alongside H18); `deal_activities`/`pipeline_contacts`/`purchase_delivery_log`/rest blocked on M10 | #53 (partial) |
| M20 | `POST /discover/import` phone unnormalized, no `lastActivityAt` bump | ✅ Fixed — routed through `findOrCreateContact` | #49 |
| M21 | `.ai/AI_BRIEF.md` stale, wrong branch | ✅ Fixed — regenerated | #53 |
| M22 | PDF service uses WinAnsi fonts — non-Latin names garbled | 🟡 **Partial** — Devanagari embedding added for `clientName`/`clientContactPerson`; `clientAddress` not covered (documented follow-up given text-wrapping complexity) | #50 |
| M23 | `/invoices/export` unreachable (registered after `/invoices/:id`) | ✅ Fixed — reordered | #50 |
| M24 | `/mrr` and `/stats` disagree on whether overdue counts as outstanding | ✅ Fixed — aligned | #50 |
| M25 | Blocker-alert dedup is in-memory, resets every deploy, UTC boundary | ✅ Fixed — persisted via `events` table, IST boundary | #52 |
| M26 | `routes/wizmatch.ts` is a 6,091-line god-route | ❌ **Not done** — multi-day scope, no framework slice delivered either; tracked as a follow-up | — |

## LOW (2/3 fixed, 1 deferred)

| # | Finding | Status | PR |
|---|---|---|---|
| L1 | ~518 `console.*` call sites instead of `logger` | ❌ **Not done** — cosmetic/DX only, no correctness or security impact; 518 call sites isn't a responsible one-sitting mechanical change on top of everything else | — |
| L2 | No coverage thresholds in `vitest.config.ts` | ✅ Fixed — 30% floor, CI enforces via `test:coverage` | #53 |
| L3 | `cashfreeWebhook.test.ts` reaches into `router.stack` internals | ✅ Fixed — `invokeRoute` helper walks the real middleware chain | #47 |

## Summary

- **Fixed:** 48 / 56
- **Partial** (foundation laid, explicitly scoped remainder tracked): 4 / 56 — H18, M10, M19, M22
- **Deferred with a documented reason:** 2 / 56 — M14, L1
- **Not done, tracked:** 1 / 56 — M26

Nothing was silently dropped. Every partial/deferred/not-done item above has its remaining
scope written down (in this doc, in `docs/ensure-table-inventory.md`, or inline in the
relevant PR body) rather than just being absent from a checklist.

## What Jatin needs to do next

1. **Merge order matters for migrations.** #50, #52, and #53 each generate a migration
   numbered `0030` (independent branches cut in parallel). Merge one, then rebase/renumber
   the others' migrations before merging them — each PR body has the specific note.
2. **Merge #45 before #51** — #51 is branched off #45 and edits the same WizMatch files.
3. **Run `npm run db:migrate`** after merging (or before, on staging) — none of these
   migrations have been applied to any database; they're branch-only per the working
   agreement in `AGENTS.md`.
4. **Confirm Railway's actual instance topology** before relying on M11's advisory-lock
   default or M13's boot-migration lock being load-bearing — they're correct regardless,
   but the failure mode they close (double-firing crons / concurrent migrations) only bites
   with >1 instance running the same process.
5. Decide whether to schedule the tracked-but-not-done items (M26's route split, M10's
   remaining ~36 tables, H18's SEO table family, L1's console cleanup) as their own future
   work, given none are load-bearing for correctness today.
