# SEO automation — system handoff

**Status: native, multi-tenant, multi-platform.** This document used to
describe an n8n-driven pipeline hardcoded to three clients
(`aarohaom.com`, `blackpandaenterprises.com`, `ageddentistry.org`). That
pipeline is gone. n8n is decommissioned; its workflow JSONs are kept purely
as history in
[`docs/archive/n8n-workflows-seo/`](../archive/n8n-workflows-seo/README.md).
The three named clients are **retired** — no longer active, no longer
re-seeded on boot, pending a data purge (see "Retired clients" below).

If you're debugging something broken, use
[`docs/seo/seo-debugger.md`](seo-debugger.md) instead — it has the cron
schedule, the API surface, and a troubleshooting playbook. This document is
for onboarding: what the system is today, how a new client/site actually
gets added, and the credential model.

## What the system is now

SEO is a per-tenant add-on, gated by the `seo` tenant feature
(`requireTenantFeature('seo')` on every `/api/seo*` route in
`src/index.ts`). A tenant with the feature registers one or more **sites**
in the `seo_sites` table (`src/services/seoSiteRegistry.ts`), each with a
`platform` of `git`, `wordpress`, or `shopify`. Publishing a change to any
registered site goes through a single approval-gated state machine
(`src/services/siteChangeService.ts`) — nothing reaches a client's live
website without a recorded human approval, enforced at three independent
layers. Crons (rank tracking, backlinks, content decay, drift detection,
PageSpeed, GSC pulls, digests) sweep every SEO-enabled tenant, not one
hardcoded tenant.

None of this is reachable end-to-end in production yet: the platform
adapters are gated behind `SITE_ADAPTER_ENABLED`, which defaults `false`.
See `seo-debugger.md` for what that means operationally.

## Retired clients

`aarohaom.com`, `blackpandaenterprises.com`, and `ageddentistry.org` were
the three hand-maintained clients this document used to be written for.
They are retired:

- `seedClientKnowledgeBase()` (`src/services/seoKnowledgeBase.ts`), which
  used to re-insert their brand/voice data into `client_knowledge_base` on
  every server boot, is now a no-op.
- The nine places in the codebase that used to hardcode these three domains
  as a fallback list (including the old Co-Pilot's AI system prompt) no
  longer do — a tenant's site list now comes only from its own `seo_sites`
  registry.
- A data purge for their remaining rows is planned but gated on production
  database backups existing first (see `docs/go-live/OWNER_ACTION_LIST.md`
  §1 and §4) — it has not happened yet, so their historical data is still in
  the database.
- One legacy code path still targets `ageddentistry.org` specifically:
  `programmaticSeoService.publishToWordPress()` reads
  `WP_AGEDDENTISTRY_URL` / `WP_AGEDDENTISTRY_USER` /
  `WP_AGEDDENTISTRY_PASS` (or `WP_AGEDDENTISTRY_PASSWORD`) directly from
  `process.env` and is the only reader of those variables left. The three
  routes that trigger it (`POST /api/seo/generate-local-pages`,
  `/regenerate-pages`, `/publish-pending-pages`) are gated so a tenant can
  only invoke it if `ageddentistry.org`'s normalised domain is registered as
  one of *their own* `seo_sites` rows (`assertOwnsWordPressTarget()` in
  `src/routes/seo.ts`) — this stops a reseller's admin from accidentally
  drafting pages onto Growth Escalators' own WordPress site, but the
  publish target itself is still a single hardcoded domain, not
  per-tenant. The real fix is finishing the migration of this function onto
  the WordPress `SiteAdapter` (`src/modules/site/providers/wordpress.provider.ts`),
  which reads credentials only from the tenant-scoped store described below
  and has zero `process.env` reads by construction (enforced by a test that
  greps its own source).

## Onboarding a new client/site today

This is the current path — not environment variables, not a SQL insert into
a hardcoded client list:

1. **Register the site.** `POST /api/seo-sites` (admin-only,
   `src/routes/seoSites.ts` → `createSeoSite`,
   `src/services/seoSiteRegistry.ts`) with `label`, `domain`, `platform`
   (`git` | `wordpress` | `shopify`), and optionally `gscProperty`,
   `ga4PropertyId`, `riskProfile`, `requiredChecks`,
   `autoPublishAllowed`, `observationWindowDays`. `domain` is normalised
   (lowercase, scheme/`www.`/trailing-dot stripped) and must contain a dot
   — a bare project name is rejected.
2. **Store credentials, separately, encrypted.** Never in `seo_sites.adapter_config`
   — that column is plaintext jsonb and any key that looks secret-shaped
   (`/pass|secret|token|key|credential|auth/i`) is rejected with a 400 at
   the registry layer. Real credentials go through
   `PUT /api/tenant-integrations/:provider` (owner-only,
   `src/routes/tenantIntegrations.ts` → `upsertIntegrationCredentials`,
   `src/services/tenantIntegrationsService.ts`), body
   `{ credentials: {...}, metadata?: {...} }`. This encrypts and stores the
   payload in `tenant_integrations`; the route never echoes it back, and
   `GET` on the same resource returns only status/metadata, never the
   secret. Set `seo_sites.credential_provider` to the matching provider name
   so the adapter knows which integration row is this site's — it defaults
   to the platform name (`wordpress`, `shopify`) if unset, which is correct
   for a tenant with only one integration per platform.
3. **Propose, stage, verify, approve, publish.** A change to that site is a
   `site_changes` row (`POST /api/seo-changes`), which moves through
   `stage → verify → awaiting_approval → approve → publish` — see
   `seo-debugger.md`'s "invariant #2" for the full state machine and why
   `publish` always requires a recorded human approval.

There is deliberately no admin flow that skips straight to publishing —
every platform, including ones with `autoPublishAllowed` on the site
record, still goes through the same approval gate at the service layer.

## Environment variables

Names only — every value lives in Railway (`railway variables` /
the Railway dashboard, environment-scoped) or, for per-tenant site
credentials, in the encrypted `tenant_integrations` table via the route
above. Nobody should ever need to know a live value to work on this system;
if you find one in a file, treat it as compromised and report it (see
"Credential exposure history" below) rather than copying it anywhere,
including into a chat, a comment, or this document.

| Variable | What it gates | Where the real value lives |
|---|---|---|
| `SERPER_API_KEY` | Rank tracking, backlinks, content gap, competitor analysis, outreach directory scraping | Railway |
| `SITE_ADAPTER_ENABLED` | Whether any platform adapter (git/WordPress/Shopify) can run at all — defaults `false` | Railway (not a secret — `true`/`false`) |
| `SITE_PROVIDER` | `platform` (real adapters) or `mock` — see `seo-debugger.md` | Railway (not a secret) |
| `SEO_DIGEST_SLACK_ENABLED` | Whether the weekly Slack opportunity digest cron sends — defaults off | Railway (not a secret) |
| `AUTOMATED_EMAILS_ENABLED` | Gates the SEO weekly email cron among others | Railway (not a secret) |
| `SEO_MONTHLY_BUDGET_CENTS`, `SEO_DAILY_BUDGET_CENTS`, `SEO_MAX_SERPER_CALLS_PER_TENANT_DAY`, `SEO_MAX_SERPER_CALLS_PER_SITE_DAY`, `SEO_MAX_PAGESPEED_CALLS_PER_TENANT_DAY`, `SEO_MAX_GSC_CALLS_PER_TENANT_DAY`, `SEO_MAX_PUBLISHES_PER_SITE_DAY`, `SEO_SERPER_COST_CENTS`, `SEO_PAGESPEED_COST_CENTS`, `SEO_LLM_COST_CENTS` | Spend/cost guard caps (`src/services/seoCostGuard.ts`) — sane defaults if unset | Railway (not secrets — numeric config) |
| `SEO_SERPER_DAILY_CAP` | The **retired** global in-memory Serper cap (`checkAndIncrementSeoSerperCap`) — has zero live callers today, kept only because old comments still mention it | Railway, if it's even still set |
| `WP_AGEDDENTISTRY_URL`, `WP_AGEDDENTISTRY_USER`, `WP_AGEDDENTISTRY_PASS` / `WP_AGEDDENTISTRY_PASSWORD` | The one remaining legacy `process.env`-based WordPress publish path (see "Retired clients" above) | Railway — **see the exposure history immediately below before touching these** |
| `GOOGLE_PLACES_API_KEY` | Outreach lead discovery (`src/routes/discover.ts`, `src/routes/outreachLeads.ts`, worker cron) — **not SEO**, listed here only because of the exposure history below | Railway |
| `GOOGLE_SEO_OAUTH_REFRESH_TOKEN`, `GOOGLE_SEO_OAUTH_CLIENT_ID`, `GOOGLE_SEO_OAUTH_CLIENT_SECRET` | GSC pull (`seoSearchConsoleService.ts`) and GA4 pull (`seoAnalyticsService.ts`) OAuth — the **only** Google OAuth credential actually read anywhere in current `src/` for SEO. A **separate** client from `GCP_OAUTH_CLIENT_ID`/`SECRET` below. | Railway |

Not used by anything in current `src/` — do not assume these still gate
anything even though they still appear in Railway or old runbooks:
`GCP_NL_API_KEY` (the old n8n WordPress-publish workflow's entity-scoring
key), `GCP_OAUTH_CLIENT_ID` / `GCP_OAUTH_CLIENT_SECRET` (a legacy Google
OAuth client — confirmed via a full-repo grep to have zero code references;
**still leaked and still needs rotating per the exposure history below**,
its disuse doesn't reduce that), `WP_AAROHAOM_*`, `WP_BLACKPANDA_*` (the
legacy publish function now targets only `ageddentistry.org`),
`VALUESREP_API_KEY`/`VALUESERP_API_KEY`, `DATAFORSEO_LOGIN`/
`DATAFORSEO_PASSWORD`, `CLAUDE_API_KEY` as a SEO-workflow-specific var
(Anthropic calls in this codebase use the process-wide Claude client
config, not a SEO-scoped key). If you see any of these referenced in an
alert, dashboard, or runbook, treat the reference itself as stale.

## Credential exposure history — read before touching any WordPress or GCP variable above

**No credential value appears anywhere in this document, in its edit
history, or below — names and dates only.** This section exists so the next
person doesn't have to rediscover what already leaked.

An earlier version of this document (redacted 2026-07-19 and 2026-07-23)
had committed plaintext values for: the `WP_AAROHAOM_PASS`,
`WP_BLACKPANDA_PASS`, and `WP_AGEDDENTISTRY_PASS` WordPress application
passwords; `GCP_NL_API_KEY`; and a value under `GOOGLE_PLACES_API_KEY` that
was itself a mislabeled copy-paste of the `GCP_NL_API_KEY` value, not a real
Places API key. All of those values were removed from the working tree at
the time but **remain recoverable from git history**, and per AGENTS.md
credential hygiene, anything found in git history is treated as compromised
until rotated — removal from the working tree does not fix that on its own.

As of this writing, rotation is **not yet complete**. The live checklist and
current status live in `docs/go-live/OWNER_ACTION_LIST.md` §3 ("Rotate the
leaked credentials") and the detailed checklist it points to
(`SECRETS-ROTATION.md`, itself a restricted path — see
`docs/wizmatch/README.md`'s "restricted paths" list; do not open it as part
of routine handoff reading). Two corrections already recorded there, worth
repeating so they aren't relearned the hard way:

- **WordPress: update the Railway vars, do not delete them first.** The
  encrypted `tenant_integrations` store exists and is live, but
  `publishToWordPress()` still reads `process.env` directly (see "Retired
  clients" above) — deleting the vars before that function is migrated
  silently breaks WordPress publishing with no error.
- **There are two separate Google OAuth clients.** `GCP_OAUTH_CLIENT_SECRET`
  is the leaked one and needs rotating. `GOOGLE_SEO_OAUTH_*` is unrelated,
  was not found with a plaintext value in any sweep, and rotating it
  anyway would break the Search Console pull until a new refresh token is
  minted.

If you are about to touch any of the WordPress or GCP variables above,
read `docs/go-live/OWNER_ACTION_LIST.md` §3 first rather than assuming this
document's summary is still current — that file, not this one, is where
rotation status is tracked as it progresses.

## See also

- [`docs/seo/seo-debugger.md`](seo-debugger.md) — cron schedule, API
  surface, spend guard, and a troubleshooting playbook.
- [`docs/archive/n8n-workflows-seo/README.md`](../archive/n8n-workflows-seo/README.md)
  — the retired n8n workflows and what replaced each one.
- `.ai/HANDOFF_LOG.md`, entries titled "SEO Phase 1" through "SEO Phase 5" —
  the narrative of how the system got here, in order.
