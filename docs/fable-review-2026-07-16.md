# Fable code review — 2026-07-16

**Target:** `growth-escalators-backend-v2` / `Growth-Escalators-CRM`, branch `salvage/wizmatch-phase0-trust` (= `origin/main` + the 7-commit salvage PR #45).
**Reviewers:** 4 parallel Fable agents — Security, Architecture, Correctness (money & scoring), Testability/Observability/DX.
**Consolidated by:** Claude Code (Opus 4.7).

## Reading order

The findings are grouped by **severity and blast radius**, not by which agent surfaced them. Where multiple agents flagged the same issue independently, that's noted — those are the strongest signals.

- **CRITICAL** — actively losing money, leaking cross-tenant data, or exploitable by an unauthenticated attacker. Fix this week.
- **HIGH** — silent bugs that corrupt data, drift schema, or spam customers. Fix this month.
- **MEDIUM** — reliability, observability, and coverage gaps. Fold into the next 1-2 sprints.
- **LOW / cleanup** — refactor and hygiene.

Every finding cites `file:line`. Anything marked ✅ was verified by direct re-read of the cited line before this doc was written. Anything marked 🔬 is quoted from the Fable output and needs a spot-check before you act on it — Fable can be right on the pattern and wrong on the specific line number.

---

## CRITICAL — fix this week

### C1. `POST /api/cashfree/webhook` accepts unauthenticated payloads ✅
- `src/routes/cashfree.ts:106` (mounted `src/index.ts:209`)
- **Confirmed by 3 agents independently** (security, correctness, architecture).
- The handler passes `req.body` straight to `processCashfreeEvent` — no HMAC, no signature check. The route comment explicitly names "Cashfree directly (legacy / fallback)" as a supported caller.
- **Exploit** (any anonymous attacker): POST a forged `PAYMENT_SUCCESS_WEBHOOK` with an invented `cf_payment_id` and attacker-chosen `customer_email`/`customer_id`. Idempotency dedupes on the attacker-supplied ID, so each new value is accepted fresh. The system then:
  1. Creates a fake `paid_707` deal (or whatever `order_amount` is set to)
  2. Fires a Meta CAPI Purchase event — **poisons ad optimization + conversion data**
  3. Sends a Slack revenue alert
  4. Sends WhatsApp template + Brevo email to the attacker-chosen recipient from your sender
  5. Within 5 minutes, the placement cron delivers the paid product PDFs to the attacker
- **Fix path:** verify Cashfree's `x-webhook-signature` header against `CASHFREE_WEBHOOK_SECRET` using timing-safe compare BEFORE any processing. If the "Vercel edge relay pre-verified" path is real, add a shared secret between relay and this endpoint and reject direct callers.

### C2. `PATCH /api/billing/invoices/:id/payment-status` has no permission check ✅
- `src/routes/billing.ts:557-569`
- **Confirmed by correctness agent.** Every other billing route uses `getPerms` gating; this one skips it.
- **Exploit** (any authenticated tenant user, even viewer/staff): call `PATCH /api/billing/invoices/<id>/payment-status {"status":"paid","amountPaid":0}` → invoice flips to `paid`, `paid_at=NOW()`, PDF renders "PAID · TAX RECEIPT", overdue cron stops chasing it. No `payments` row is written, so the invoice status and payments-ledger silently diverge. `amount_due` is not clamped and can go negative.
- **Fix path:** add `getPerms(req, 'billingMarkPaid')` (or the equivalent) at the top of the handler.

### C3. `PATCH /api/billing/invoices/:id` allows cross-tenant WRITE of line items 🔬
- `src/routes/billing.ts:316,357-361` (also `:232` for POST /invoices)
- **Confirmed by correctness agent.** The `existing` fetch at line 316 has no tenant filter, and the line-item DELETE/INSERT at 358-359 keys only on `invoiceId`, then the tenant-scoped UPDATE at 365 runs after.
- **Exploit** (any authenticated tenant B user): PATCH tenant A's invoice UUID with `lineItemsData`. Line items get rewritten to B's before line 365 returns "invoice not found" — tenant A's money document is silently altered.
- **Fix path:** move the tenant-scoped SELECT to the top and abort before any writes if the invoice isn't in the caller's tenant. Same pattern needs to be applied to `POST /invoices` line 232 fetching billing client without tenant filter.

### C4. `GET /api/capi/status` leaks CAPI events across all tenants ✅
- `src/routes/capi.ts:17-22`
- **Confirmed by security agent.** Line 15 reads `tenantId` — never used in the WHERE. Filter is only `like(events.eventType, 'capi_%')`.
- **Exploit** (any authenticated tenant B user): call `GET /api/capi/status` → receive the last 10 CAPI events of every tenant including `contactId` and full `payload` (order values, event IDs).
- **Fix path:** add `and(eq(events.tenantId, tenantId), like(events.eventType, 'capi_%'))` to the WHERE.

### C5. `invoice_series` `ON CONFLICT` targets a unique constraint that doesn't exist in migrations ✅
- `src/services/invoiceNumberService.ts:20` (target constraint absent from `src/db/schema.ts:680-688` and `src/db/migrations/0005_certain_mephisto.sql:42-51`)
- **Confirmed by correctness agent.**
- **Failure scenarios**:
  1. If prod has an untracked hand-added index: silent migration drift — a DB restore from migrations produces a schema that 500s on every invoice creation.
  2. If prod also lacks the index (worst case): every invoice creation 500s today; recurring drafts silently fail nightly.
  3. With no unique constraint even if `ON CONFLICT` is dropped: two concurrent invoice creations both read `last_number=X` and both write `X+1` → **duplicate GST serial numbers on real legal documents** (CGST Rule 46(b) violation).
- **Fix path:** add a Drizzle migration `CREATE UNIQUE INDEX invoice_series_tenant_type_fy_uniq ON invoice_series (tenant_id, series_type, financial_year);` and generate the schema.ts equivalent. Verify against prod first — the index may already exist by hand.

### C6. Wizmatch auth mount 401-walls the internal ingest lane AND the CAN-SPAM unsubscribe lane ✅
- `src/index.ts:285-292`
- **Confirmed by architecture agent.** The first `app.use('/api/wizmatch', ...requireAuth..., wizmatchStaffingRouter)` runs `requireAuth` for every `/api/wizmatch/*` request BEFORE the second mount's `WIZMATCH_INTERNAL_POST`/`WIZMATCH_PUBLIC_GET` carve-outs can execute. Express middleware chains through matching mounts in order; requireAuth 401s and never calls next(), so the carve-outs are unreachable dead code for any request without a valid JWT.
- **Concrete failure:** GitHub Actions Dice/Naukri scrapers (`.github/workflows/wizmatch-dice.yml:156`, `wizmatch-jobspy.yml:166`) send only `x-internal-secret` → 401 → **zero new job signals reach `wizmatch_job_signals`** and the workflows `process.exit(1)`. Every recipient clicking the HMAC unsubscribe link at `wizmatch.ts:4462` gets a 401 JSON blob instead of being unsubscribed — the exact CAN-SPAM risk the code comment warned about. **This is on `main` today, not just the salvage branch.**
- **Fix path:** either (a) restructure to a single mount with the carve-out logic inside the auth middleware, or (b) move the carve-out check into `requireAuth` as an exception check, or (c) mount the internal ingest routes and the public unsubscribe route on a separate path prefix that bypasses the auth mount entirely.

### C7. Socket.io accepts unauthenticated connections AND joins any caller-supplied contact room ✅
- `src/index.ts:457-471`
- **Confirmed by architecture agent.** `io.on('connection')` has no `io.use()` auth handshake. `join_contact` calls `socket.join('contact:' + contactId)` with zero verification that the connecting user has any right to read that contact's messages.
- **Exploit:** any client that can reach `wss://api.growthescalators.com/socket.io` (non-browser clients ignore the CORS origin allowlist) connects with no JWT, emits `join_contact` with any contact UUID (harvested from a shared link, log line, or another tenant's export), and receives a live stream of that contact's WhatsApp messages via `emitNewMessage`.
- **Fix path:** add `io.use((socket, next) => verifyJwtOnHandshake(socket).then(next).catch(next))` and change `join_contact` to check that `contactId`'s tenant matches `socket.user.tenantId` before joining.

### C8. Inbox send routes skip the tenant filter on `contact_channels` 🔬
- `src/routes/inbox.ts:105` (also `:164`)
- **Confirmed by architecture agent.**
- **Exploit** (any authenticated tenant B user): POST `/api/inbox/conversations/<tenant-A-contact-uuid>/send` — the WhatsApp channel lookup resolves by `(contactId, channelType)` only, so tenant A's phone number is returned, a real WhatsApp message is sent to tenant A's customer from the shared sender, and the message row is written under tenant B (so tenant A's inbox never shows it).
- **Fix path:** add `AND tenant_id = $requester_tenant_id` to both channel-lookup queries. Reject the send if no matching channel is found in the caller's tenant.

### C9. Cashfree webhook idempotency happens BEFORE processing (not in a transaction) — silent revenue loss on mid-flight failure 🔬
- `src/services/cashfreeEventProcessor.ts:109-116`
- **Confirmed by correctness agent.** The `processed_events` INSERT is separate from and precedes the actual work.
- **Failure:** Cashfree delivers PAYMENT_SUCCESS for `cf_payment_id=12345`. Claim row inserts. Then `findOrCreateContact` throws (DB blip, transient). Route returns 500. Cashfree retries. Retry sees the claim and skips as "already processed." **The paying customer never gets a contact, deal, CAPI event, delivery email/WhatsApp, or pipeline placement — silent revenue loss with no compensating retry path.**
- **Fix path:** either (a) wrap the whole processor in a transaction so the idempotency claim rolls back on any error, or (b) move the claim INSERT to happen at the end of successful processing (harder — allows a retry-storm window), or (c) add a `status` column to `processed_events` and only skip on `status='completed'`.

---

## HIGH — fix this month

### H1. Cashfree "admin" simulate/debug endpoints have no role gate 🔬
- `src/index.ts:210` (mounts `cashfreeAdminRouter` behind `requireStrictAuth` only, no role check)
- Any authenticated non-viewer user of any role passes and can POST `/api/cashfree/simulate-webhook` to inject fake purchases, or GET `/debug-orders` to read tenant-unfiltered contacts/deals/payments.
- **Fix path:** add `requireRole('admin')` to the mount.

### H2. `requireAuth` never checks `tokenVersion` against the DB — force-logout / password reset is broken on most CRM routes ✅
- `src/middleware/auth.ts:42`
- `requireAuth` only asserts the claim is *present* in the JWT. The DB comparison lives in `requireStrictAuth`, mounted on only 3 routes (`/api/cashfree` admin, `/api/billing`, `/api/permissions`).
- **Failure:** an employee's JWT leaks (7-day expiry). Admin bumps `token_version` to revoke sessions. The stolen token still authenticates ~40 CRM routes for up to 7 more days. "Force logout" silently does nothing for contacts, deals, inbox, tasks, reports, ads, intelligence, wizmatch.
- **Fix path:** either fold the DB check into `requireAuth` (accept the extra query per request, or cache token_version per-user for N seconds) or shorten the JWT lifetime.

### H3. Webhook signature verifiers fail OPEN when the secret env var is unset 🔬
- `src/routes/webhooks.ts:18`, `src/middleware/validateWebhook.ts:24-28`
- Missing/malformed signatures correctly 403, but a missing SECRET makes the route accept anything. No boot-time env-var enforcement — `src/config/env.ts` only tracks DB/Redis URLs.
- **Fix path:** fail closed when the secret is unset. Add mandatory-secret validation at boot.

### H4. WhatsApp inbound signature computed over re-serialized JSON, not the raw body 🔬
- `src/middleware/validateWebhook.ts:39`
- The `/meta-leads` handler correctly uses `req.rawBody`; the WhatsApp handler HMACs `JSON.stringify(req.body)` which rarely reproduces Meta's exact bytes.
- **Failure:** operators who DO set `META_APP_SECRET` see all real Meta signatures fail (because re-serialized bytes don't match), so they leave it unset, which routes to the fail-open branch (H3), which is effectively unauthenticated.
- **Fix path:** use `req.rawBody` here too, matching the `/meta-leads` pattern.

### H5. `GET /api/billing/next-invoice-number` (preview!) permanently increments the series 🔬
- `src/routes/billing.ts:984-997`
- Preview endpoint calls `getNextInvoiceNumber` which mutates state. Every form open/refresh burns a serial number.
- **Failure:** user opens "new invoice" form, form fetches next number, shows `GE/GST/2025-26/007`. Then saves → creation calls `getNextInvoiceNumber` again → actual invoice numbered `008`. Compliance problem: CGST Rule 46(b) requires consecutive serials; the series accumulates permanent gaps.
- **Fix path:** either (a) split into read-only `peek()` and write `claim()` functions, or (b) claim the number on form open and hold in a "reserved" state, releasing on cancel.

### H6. FY rollover computed from server-local UTC — 5.5-hour late boundary 🔬
- `src/services/invoiceNumberService.ts:4-10`
- Railway server is UTC. Indian FY boundary is IST.
- **Failure:** invoice created 2026-04-01 00:01 IST (= 2026-03-31 18:31 UTC): `month` is still 3 → FY returned is `2025-26`, so the invoice lands in the wrong FY series. All invoices between 00:00–05:30 IST on April 1 → wrong FY, wrong period on GST filings. And the same day contains invoices from both series after 05:30 IST.
- **Fix path:** convert `now` to IST before extracting month/year (e.g. using `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'`).

### H7. Payment recording is non-transactional read-modify-write of `amountPaid` 🔬
- `src/routes/billing.ts:517-546`
- **Failure:** invoice ₹50,000; two staff record ₹25,000 tranches simultaneously. Both read `amountPaid=0`, both compute `newAmountPaid=25000_00`, last write wins → invoice shows ₹25,000 paid / ₹25,000 due / `partially_paid` while the payments table holds ₹50,000. Fully-paid client gets dunned.
- **Fix path:** wrap in a transaction with `SELECT ... FOR UPDATE` on the invoice row, or better: recompute `amountPaid` from `SUM(payments)` after each insert rather than storing it as a derived denorm.

### H8. Recurring invoice cron: day-31 rolls to next month, "already invoiced" check is too broad 🔬
- `src/services/recurringInvoiceService.ts:64` and `:47-55`
- Two bugs in the same cron:
  1. `new Date(y, m, client.invoiceDayOfMonth)` — day 31 in April becomes May 1. The dedup then scans April only → any re-run drafts again → **duplicate May-1-dated drafts every April cron re-run**. Then May's cron sees the May-1 draft and skips May entirely → the retainer for May is never billed.
  2. The "already invoiced this month" check matches ANY invoice (manual one-offs, cancelled ones) — not just recurring drafts. Raise a ₹20K setup fee for a ₹75K retainer client on June 3 → June cron sees an existing June invoice → silently skips the retainer.
- **Fix path:** for #1, clamp the day to `min(day, daysInMonth)` and re-check the drafted-date range for dedup. For #2, filter by `metadata->>'source' = 'recurring_cron'` or add an `is_recurring` column.

### H9. Recurring service applies `taxType` even when `isGst=false` 🔬
- `src/services/recurringInvoiceService.ts:62`
- Stale `taxType` on a non-GST client produces an invoice that charges 18% GST anyway.
- **Fix path:** conditionally clear or default `taxType` when `isGst=false`.

### H10. Wizmatch daily X-Ray cron burns 3 credits/day invisibly to the cost cap 🔬
- `src/worker.ts:1496-1499` calls `runXrayScrape(3)` with no `requirementId`
- `runXrayScrape` only writes a `wizmatch_source_runs` row when `context.requirementId` is truthy. So the cron path never appears in `getSearchApiRunUsage` — ~90 credits/month invisible.
- **The salvage PR did not close this gap** — my fix (`03bb92a`) only helps runs that ARE recorded.
- **Fix path:** always create a source_run row (with `requirement_id: null` and `provider: 'xray'`) so the cron's credit use is counted; then the cost cap actually gates all callers.

### H11. Wizmatch cost cap: runs stuck in `status='running'` (crash between spend and finish) contribute 0 to usage; check-then-spend not atomic 🔬
- `src/services/wizmatchSearchApi.ts:128-137` + `src/services/wizmatchSourcing.ts:459-471`
- **Failure (a):** process crashes/redeploys between `searchPublicWeb()` and `finishSourceRun()` → row stuck at `status='running'` with `quota_consumed=0` forever → monthly count undercounts by 1 per crash.
- **Failure (b):** two recruiters click "research POC" simultaneously at usage 4/5 → both pass `assertSearchApiAllowance` → 6/5 spent. `withWizmatchSourceLock` exists but is unused on the POC/xray paths.
- **Fix path:** (a) startup cleanup that flips stale `running` runs to `failed` with best-guess `quota_consumed=1`; (b) wrap the check-and-spend in an advisory lock (`withWizmatchSourceLock` already available).

### H12. `POST /discover/import` inserts into the FIRST tenant regardless of caller 🔬
- `src/routes/discover.ts:466-471` — `db.select().from(tenants).limit(1)` with comment "use the first tenant for now"
- Cross-tenant write: leads from tenant B's import go to tenant A. Phone channel stored unnormalized (violates the load-bearing `(channel_type, channel_value)` dedup invariant), `lastActivityAt` never set.
- **Fix path:** use `req.user.tenantId` (the current authenticated tenant). Normalize the phone via `contactService.normalizeChannelValue` before insert.

### H13. Placement cron re-blasts purchase assets every 5 minutes when placement fails 🔬
- `src/worker.ts:588-610`, `src/services/assetDeliveryService.ts:22`
- 5-min cron sends `deliverPurchaseAssets` "regardless of pipeline placement." No pre-send dedupe check. Sends WhatsApp+email FIRST, writes `purchase_delivery_log` AFTER.
- **Failure:** a pipeline is deactivated or a stage rename makes `placePipelineContact` return `success:false` → contact never enters `pipeline_contacts` → same buyer receives the full 3-message WhatsApp sequence PLUS email every 5 minutes (288×/day) until someone notices.
- **Fix path:** check `purchase_delivery_log` BEFORE sending. Add a "delivery already attempted within N hours" guard.

### H14. Lead qualification `'above 1'` substring matches `"above 10k"` — junk leads scored HOT 🔬
- `src/services/qualificationService.ts:45-50`
- `.includes('above 1')` matches "above 10k", "above 15k", etc. Awards 40 pts (top bucket) instead of 10 (low bucket). Booking answer `{ ad_spend: "Above 10k", decision_maker: "yes" }` → 40+30 = 70 → tier `hot` (threshold ≥70) for a client who should be `warm` at best.
- **Fix path:** use exact matches or regex with word boundaries (e.g. `/^above 1 ?(lakh|lac)\b/i`). Add snapshot tests for each ad_spend bucket.

### H15. Empty requirement scores every candidate 85 🔬
- `src/services/wizmatchMatchingDomain.ts:61-62, 67-76`
- Zero-skill requirement → mandatory + preferred scores both return their max (50 + 15 = 65 baseline) so every candidate scores 85.
- **Failure:** recruiter calls `replaceRequirementSkills([])` (clearing to redo them) → `recalculateRequirement` runs → all ≤500 candidates get 85 with no blockers → the match workbench shows hundreds of "excellent" matches until skills are re-added.
- **Fix path:** guard the scoring functions: if `mandatorySkills.length === 0`, return `mandatoryScore=0` (or throw), same for preferred.

### H16. Salvage denorm-sync closes the reader race but not the writer-vs-writer race 🔬
- `src/services/wizmatchMatchingDomain.ts:139-164, 166-190`
- Two users editing the same requirement concurrently under READ COMMITTED: T2's DELETE uses a snapshot that can't see T1's just-committed inserts → the join table ends as the UNION of T1's and T2's edits (or duplicates if `(requirement_id, skill_id)` isn't unique), and the denorm rebuild faithfully denormalizes the corrupted union.
- **Fix path:** add `SELECT ... FOR UPDATE` on the requirement row at the top of the transaction (or use `withWizmatchSourceLock`-style advisory lock keyed on requirement_id).

### H17. R2 uploads trust client-supplied MIME type; no content/magic-byte validation 🔬
- `src/utils/r2.ts:33-38`, callers include `src/routes/social.ts:19-22,364`
- multer `fileFilter` gates on `file.mimetype` (attacker-controlled). Object keys for private uploads embed unsanitized `originalname` before `uploadPrivateToR2` normalizes it — `..` and `/` survive the regex.
- **Fix path:** validate against actual file bytes (magic-byte sniff, e.g. `file-type` npm package). Sanitize object key path-segments strictly (allowlist).

### H18. `outbound` + entire SEO table family have no `tenant_id` at all ✅
- `src/db/schema.ts:1056` and the SEO family beyond
- Tables: `prospects`, `signals`, `replies`, `outbound_events`, plus `keyword_rankings`, `backlink_data`, `content_gap_analysis`, `seo_opportunities`, `site_health_metrics`, `brand_mentions`, `client_pages`, `client_knowledge_base`.
- The moment a second real tenant exists, any authenticated admin/team_lead reads and mutates the first tenant's outbound + SEO data (routes are role-gated but not tenant-gated).
- **Fix path:** add `tenant_id` columns via migration, backfill from the first tenant, add filters to every reader/writer.

---

## MEDIUM — fold in over the next 1-2 sprints

### M1. No CI runs `npm run build` or `npm test` before auto-deploy to main 🔬
- `.github/workflows/` has only 2 manually-dispatched scraper jobs. Push to main = straight to Railway prod without any gate.
- **Fix path:** add a `.github/workflows/ci.yml` that runs `npm ci && npm run build && npm test` on every push and PR. Block merge on failure.

### M2. `billing.test.ts` re-implements `calculateTax` inline instead of importing the real function 🔬
- `src/__tests__/billing.test.ts:8`
- The tests exercise a frozen copy of the tax logic. Real `calculateTax` in `recurringInvoiceService.ts` isn't exported. All 485 tests can stay green while the actual GST math breaks.
- **Fix path:** `export function calculateTax(...)` from the service and import it in the test.

### M3. Zero tests on the JWT trust boundary 🔬
- `src/middleware/auth.ts`: `requireAuth`, `optionalAuth`, `requireStrictAuth`, viewer read-only guard, tokenVersion fail-closed on DB error — all untested.
- **Fix path:** add `src/__tests__/auth.test.ts` covering each middleware with valid/invalid/expired/revoked tokens and each role.

### M4. Zero tests on the Cashfree PAYMENT_SUCCESS processing path 🔬
- `src/services/cashfreeEventProcessor.ts` (392 lines). `cashfreeWebhook.test.ts` only exercises non-success events.
- **Fix path:** integration test that mocks Cashfree body + DB, asserts contact + deal + CAPI event + delivery.

### M5. Zero tests on `contactService.findOrCreateContact` (the #1 load-bearing invariant) 🔬
- `src/services/contactService.ts`. Only its `normalizeChannelValue`/`normalizeChannel` helpers are covered.
- **Fix path:** test the actual function against both channel normalization and `lastActivityAt` bump requirements.

### M6. Request-ID exists in middleware but never reaches log lines 🔬
- `src/index.ts:156` generates and echoes it; morgan uses stock 'combined' without it; no `logger.child({requestId})` per-request.
- **Failure:** 3 AM prod incident — pino error line has no requestId, no path, no user; impossible to correlate to a customer.
- **Fix path:** use `pino-http` or AsyncLocalStorage to attach requestId to every logger call within a request scope.

### M7. Global Express error handler logs via `console.error` (unstructured) 🔬
- `src/index.ts:421`
- Level-based Railway log filtering never sees actual 500s because they're plain text.
- **Fix path:** replace with `logger.error({ err, requestId })`.

### M8. Six startup schema-bootstrap `.catch(() => {})` swallows errors 🔬
- `src/worker.ts:69-74`
- `ensureEnrichmentColumns`, `ensureOutreachAlertColumns`, `ensureSelfHealingColumns`, etc. — a failed bootstrap leaves zero log evidence.
- **Fix path:** replace with `.catch(err => logger.error({ err }, '[worker] ensure* failed'))`.

### M9. Two orphaned index migrations never applied by the migrator 🔬
- `src/db/migrations/0001_add_missing_indexes.sql`, `0004_indexes.sql` — absent from `_journal.json`
- The migrator iterates only journal entries, so `messages(tenant_id)`, `messages(contact_id, sent_at DESC)`, `contacts(tenant_id, status)`, etc. are applied nowhere automatically.
- **Failure:** on a fresh env / DB restore, inbox `GET /api/inbox/conversations` runs two full-table scans over `messages` per page — degrades linearly with WhatsApp volume.
- **Fix path:** fold both into a new journaled migration (or explicit journal entries), verify prod already has them, then squash.

### M10. Three parallel schema management mechanisms; 41 tables invisible to migrations 🔬
- `src/index.ts:474-534` (26 `ensure*()` hooks), `src/index.ts:507-525` (raw `ALTER TABLE`/`CREATE TABLE`), `src/worker.ts:1247` (`CREATE TABLE` INSIDE a cron).
- Tables `pipeline_contacts`, `outreach_leads`, `funnel_configs`, `purchase_delivery_log`, `growth_os_clients`, `expenses`, `team_payroll`, 34 more — exist nowhere in `schema.ts` or migrations.
- **Failure:** fresh env boots green while routes 500 on missing tables; concurrent instance boots run the same `ALTER TABLE ... ADD COLUMN` and can deadlock; drizzle-kit diffs against a schema.ts that describes only 2/3 of reality.
- **Fix path:** systematically walk each `ensure*` hook and either (a) add the table to `schema.ts` + emit a migration, or (b) document why it's runtime-created (e.g. per-tenant partition tables). Long-term goal: schema.ts is the source of truth.

### M11. Cross-process cron locking is dead code — every cron double-fires with >1 instance 🔬
- `src/worker.ts:107` — `safeCron(name, fn, useAdvisoryLock = false)`; zero of ~25 schedules pass `true`.
- **Failure:** Railway rolling deploy or scale-to-2 → every cron fires N times: duplicate overdue-invoice Slack alerts, duplicate placement asset delivery, etc.
- **Fix path:** flip the default to `true`, or explicitly opt-in each schedule.

### M12. Cron per-item errors marked "success" in `cron_job_logs`, no alert 🔬
- `src/worker.ts:174` (scoring cron example)
- Per-item errors inside loops are `console.error`'d only; the cron reports success. Pipeline can stall silently.
- **Fix path:** track per-item error count and demote the cron to `partial` or `failed` status if any items errored.

### M13. Migrate-on-boot has no cross-instance lock; migrations can silently skip 🔬
- `src/scripts/migrate.ts:14` — drizzle 0.45's migrator takes no advisory lock; overlapping deploys apply the same migration twice; a back-dated merged migration is silently skipped forever.
- **Fix path:** wrap the migrate call in a `pg_advisory_lock(<constant>)`.

### M14. Socket.io is single-instance; multi-instance mode silently drops real-time messages 🔬
- `src/index.ts:441`
- No Redis adapter. Rooms and emits live in one process's memory. Scale to 2 → WhatsApp webhook on instance A → operators on instance B see stale inbox.
- **Fix path:** add `@socket.io/redis-adapter` when scaling; document the dependency.

### M15. `.env.example` is incomplete 🔬
- 47 keys present but omits `JWT_SECRET`, `SLACK_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `META_ADS_TOKEN`, `META_PIXEL_ID`, `HUNTER/SNOVIO/SALESHANDY` keys, `UPSTASH_REDIS_*`, `PURELYMAIL_PASS_1..6` — the exact vars `worker.ts:37-56` warns about at boot.
- **Fix path:** enumerate every `process.env.X` and mirror to `.env.example` with placeholder values + inline docs.

### M16. Rate limiters key on `req.ip` with no `trust proxy` 🔬
- `src/index.ts:166-194` — no `app.set('trust proxy', …)` anywhere. Behind Railway's proxy, `express-rate-limit` buckets on the proxy IP instead of the real client.
- **Failure:** either all clients collapse into one bucket (one noisy client throttles everyone; login brute-force lockout affects all users) or the real attacker IP is never isolated.
- **Fix path:** `app.set('trust proxy', 1)` (or the specific proxy count).

### M17. "One-time" startup backfills mutate production data on every deploy, unguarded 🔬
- `src/index.ts:539` — 20s/15s/10s after every boot, unlocked timers backfill `slo_purchase` events, rewrite orphan `deals.pipeline_id`, run PageSpeed, generate programmatic SEO pages (auto-publishing to WordPress).
- **Failure:** two instances during rolling deploy run backfill concurrently; double-place contacts; surprise PageSpeed API spend at each deploy; WordPress auto-publish at boot.
- **Fix path:** guard with a `SELECT 1 FROM boot_backfills_completed WHERE name=$1` idempotency table. Or move to explicit CLI scripts.

### M18. `events` table used as unbounded junk drawer with cron scans over untyped payloads 🔬
- `src/worker.ts:564-575`
- 13 services write `events`. The 5-min placement cron rescans `event_type='slo_purchase'` joined against `pipeline_contacts` (no FK to events/contacts) forever, no processed-marker on the event.
- **Fix path:** add a `processed_at` column to events, filter cron by `processed_at IS NULL`, and stamp after processing.

### M19. FK-less runtime tables create orphan rows by construction 🔬
- `src/index.ts:511-522` — `deal_activities`, `contact_notes` (schema.ts:479), 41 `ensure*` tables (`pipeline_contacts`, `purchase_delivery_log`, `outreach_leads`) reference contacts/deals/tenants with no constraints.
- **Fix path:** add proper FKs via migrations. If cascade-delete is undesired, add `ON DELETE SET NULL` or `ON DELETE RESTRICT` explicitly.

### M20. `POST /discover/import` phone channel unnormalized, `lastActivityAt` not set 🔬
- (Related to C8 above but for the outbound side of discover.)
- **Fix path:** call `contactService.findOrCreateContact` instead of raw inserts.

### M21. `.ai/AI_BRIEF.md` is stale — refers to the wrong branch 🔬
- Snapshot was regenerated today but on branch `feat/wizmatch-search-preview` (not `salvage/wizmatch-phase0-trust`), and says "455 Vitest" not "485."
- **Fix path:** rerun `npm run ai:brief` on the current branch.

### M22. PDF service uses WinAnsi fonts — non-Latin client names render as garbage on tax invoices 🔬
- `src/services/pdfService.ts:83, 136-137, 161-171`
- Devanagari, Tamil, etc. render as blank/garbage glyphs on legal GST documents.
- **Fix path:** embed a Unicode font (e.g. Noto Sans) via `doc.registerFont` and use it for name/address fields.

### M23. `/api/billing/invoices/export` is unreachable — registered AFTER `/invoices/:id` 🔬
- `src/routes/billing.ts:191` vs `:944`. "export" is parsed as a UUID and 500s.
- **Fix path:** move the specific `/export` route above the parametric `/:id` route.

### M24. `/mrr`'s `outstandingThisMonth` excludes overdue invoices, `/stats` includes them 🔬
- `src/routes/billing.ts:829`
- The moment the overdue cron flips an invoice's status to `overdue`, its balance disappears from the MRR dashboard.
- **Fix path:** align the two calculations. Include overdue in outstanding.

### M25. Blocker-alert dedup is in-memory Map keyed by `taskId + UTC date` — resets on every deploy 🔬
- `src/services/blockerAlertService.ts:76-86, 138-141`
- Day boundary is UTC (flips at 05:30 IST). No persistent suppression. Acknowledged-but-open blocker re-alerts every day forever.
- **Fix path:** persist dedup state in a `blocker_alert_state` table keyed on `(task_id, alerted_on_date_ist)`.

### M26. `routes/wizmatch.ts` is a 6,091-line god-route bypassing its own domain layer 🔬
- 121 direct `pool.query`/`db.` calls, 30 service imports, 31 tables touched. Imports from other route files (`./outbound`, `./wizmatchStaffing`).
- The clean Wizmatch domain services (staffing/delivery/matching) exist but this route bypasses their transactions and stage machine.
- **Fix path:** long-term refactor to move raw-SQL handlers into the domain services. Short-term: at least identify handlers that mutate `wizmatch_requirements/candidates/tasks` via raw SQL and route them through `wizmatchStaffingService`.

---

## LOW / cleanup

- **L1.** 518 `console.*` call sites remain in `src/` (worker.ts: 162, index.ts: 53). Pino is imported by 106 files but the two hottest boot/cron files were skipped. Adds noise to Railway log tailing.
- **L2.** `vitest.config.ts` has no coverage thresholds; distribution is lopsided (34/56 test files are wizmatch*). Money/auth/contact core carries almost none.
- **L3.** `cashfreeWebhook.test.ts` reaches into `router.stack` internals — breaks on any Express version bump.

---

## Cross-agent overlap (highest-signal findings)

| Finding | Security | Correctness | Architecture | Testability |
|---|:-:|:-:|:-:|:-:|
| C1: Cashfree webhook unauth | ✅ | ✅ | ✅ | — |
| C2: PATCH payment-status no perms | — | ✅ | — | — |
| C4: /capi/status cross-tenant | ✅ | — | — | — |
| C5: invoice_series unique missing | — | ✅ | — | — |
| C6: Wizmatch mount order | — | — | ✅ | — |
| C7: Socket.io no auth | — | — | ✅ | — |
| C8: Inbox send cross-tenant | — | — | ✅ | — |
| C9: Cashfree idempotency race | — | ✅ | ✅ | — |
| H2: tokenVersion not checked | ✅ | — | — | ✅ |
| H10-11: SearchAPI gaps (my salvage) | — | ✅ | — | — |

Anything flagged by 2+ agents independently should be the FIRST bucket of fixes.

---

## Process observations

- **Cron infrastructure is much better than the March report thought.** ~40 crons live in `src/worker.ts` wrapped in `safeCron` (try/catch, in-process overlap guard, `cron_job_logs` persistence, Slack DM on failure). The remaining gaps are: cross-process lock unused (M11), per-item errors marked success (M12), and 6 silent `.catch(() => {})` bootstrap swallows (M8).
- **Test framework and structured logger both exist** — 90% of the March report's Section 6 is done. The remaining 10% is real: no CI gate before deploy (M1), fake billing tests (M2), zero coverage on the trust boundary (M3), and request-ID never reaches log lines (M6).
- **The one big architectural drift risk** is the 3-way schema truth split (Drizzle migrations, `ensure*` boot hooks, inline DDL) with 41 tables invisible to migrations (M10). Every future refactor and every `db:generate` interacts with this.

---

## Verification methodology

- ✅ items were re-read at the cited line during consolidation. Findings match the code.
- 🔬 items are quoted from the Fable output — Fable's aim is usually right but line numbers can drift. Verify each 🔬 finding by opening the file at the cited line before you act.
- Nothing in this doc was modified in the working tree. If any finding is acted on, it goes through its own PR with tests.

## Suggested action ordering

**This week (CRITICAL):**
1. C1 — Cashfree webhook signature verification (prevents attacker-driven fake purchases + Meta ad-data poisoning + free product delivery)
2. C6 — Fix Wizmatch mount order (restores signal ingest + CAN-SPAM unsubscribe)
3. C2 + C3 + C4 — Add missing tenant filters + permission gates on billing / capi
4. C7 — Socket.io auth handshake + tenant-scoped `join_contact`
5. C5 — Add the missing invoice_series unique constraint via migration
6. C8 — Tenant filter on inbox send routes
7. C9 — Wrap Cashfree processor in a transaction (or move idempotency claim to end-of-success)

**This month (HIGH):**
8. H1, H2, H3, H4, H5, H6, H7, H8, H10, H11, H13, H14, H15, H16, H17, H18 — per the sections above.

**Next 1-2 sprints (MEDIUM):**
9. M1 (CI gate — unblocks everything else), M2 (fix billing tests), M3-M5 (trust-boundary + real-money-path test coverage), M6 (request-ID → logger), then the rest.

**Recommended cadence:** one focused PR per CRITICAL finding (max 3 per week), grouped HIGH fixes by area (billing correctness batch, tenant-isolation batch, cost-cap batch), and one dedicated engineer for the M10 schema drift cleanup because it will keep costing you until it's done.
