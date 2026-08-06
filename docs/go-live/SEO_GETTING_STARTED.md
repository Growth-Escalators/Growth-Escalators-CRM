# SEO platform — how to start using it

**Written 2026-08-06.** Day-1 guide: from "it's deployed" to "it's working for a
client". For day-2 operations (every cron, every env var, every block code,
diagnosis recipes) see [`SEO_OPERATIONS.md`](./SEO_OPERATIONS.md).

Order matters here. Each step is safe on its own and reversible; step 5 is the
only one that can touch a client's live website, and it is deliberately last.

---

## What you actually have

A multi-tenant SEO service inside the CRM. Three things it does that the old
single-property setup could not:

1. **Runs for many tenants and many sites.** Sites live in a `seo_sites`
   registry instead of hardcoded domain lists, so onboarding a client is a form,
   not a deploy.
2. **Catches drift** — a page that changed on a live site with no approved
   change behind it. This is the thing worth selling: an agency's recurring
   failure isn't "we didn't do the work", it's "we did the work, something
   silently undid it, and nobody noticed for three months."
3. **Publishes only behind a recorded human approval**, on git, WordPress and
   Shopify sites alike.

## What is switched off right now

Nothing publishes and nothing spends until you turn it on. Current state:

| Thing | State | Turned on by |
|---|---|---|
| Publishing adapters | **off** | `SITE_ADAPTER_ENABLED=true` + `SITE_PROVIDER` |
| SEO for a tenant | on for GE only | that tenant's `settings.features.seo` |
| Cost caps | enforced, at defaults | `SEO_*` env vars (see step 6) |
| Job drainer | off unless set | `JOB_DRAINER_ENABLED=true` |

The three sites already in `seo_sites` were backfilled from the data that was
already there. They are registered, not yet configured — step 2 is where you
finish them.

---

## Step 1 — confirm the tenant has the SEO feature

Everything under `/api/seo*` is behind `requireTenantFeature('seo')`. A tenant
without it gets a 403 and no SEO nav entry, which is the correct behaviour and
also the most common "why is the page blank" cause.

The flag resolves from `tenants.plan` (via per-plan defaults) unless that
tenant's `settings.features` overrides it. `agency_internal` — GE's own plan —
defaults `seo: true`. `reseller_pilot` defaults it **off**, so a reseller you
want to sell this to needs the override set explicitly:

```sql
-- read first
SELECT id, slug, plan, settings->'features' AS features FROM tenants WHERE slug = '<slug>';

-- then enable
UPDATE tenants
   SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{features,seo}', 'true')
 WHERE slug = '<slug>';
```

⚠️ **Before enabling a SECOND tenant, read this.** Until Phase 2 landed,
`resolveDefaultSeoTenantId()` threw whenever two active tenants had the SEO
feature — deliberately, so it could never guess which tenant owned a row. Every
SEO cron went through it. Enabling the add-on for a second tenant would have
killed every SEO cron for **every** tenant, GE's own included. The crons now
sweep per tenant and this is fixed, and `seoCronTenantSweep.test.ts` holds it
fixed. Mentioned because if you ever see that "refusing to guess which one owns
this data" error, this is what it means and it is not a database problem.

## Step 2 — register and configure the sites

`GET /api/seo-sites` lists them. `POST` and `PATCH` require admin.

Per site, the fields that actually change behaviour:

| Field | Why it matters |
|---|---|
| `domain` | Unique per tenant; the key everything joins on |
| `platform` | `git` \| `wordpress` \| `shopify` — selects the adapter and its capabilities |
| `gscProperty` | **No Search Console pull happens without this.** The site is skipped and logged |
| `ga4PropertyId` | Same, for the GA4 pull |
| `status` | Only `active` sites are swept |
| `autoPublishAllowed` | Defaults **false**. Leave it false |

A site with no `gscProperty` isn't an error — it is skipped with a log line. If
you are wondering why a site has no data, check this first.

## Step 3 — connect Search Console and GA4

Auth uses the `GOOGLE_SEO_OAUTH_*` credentials (a separate OAuth client from
`GCP_OAUTH_*` — do not conflate them; rotating the wrong one breaks the weekly
pull until the refresh token is re-minted). A service-account path via
`GOOGLE_SA_KEY_JSON` / `GOOGLE_SA_KEY_PATH` also works.

If no auth is configured at all, the pull fails once for the whole process
rather than once per site — by design, since every site would fail identically.

## Step 4 — let it run read-only for a week

This is the part to be patient about. In read-only mode the platform still does
everything valuable except publish:

- **Mondays** — `SEO GSC Pull` (02:45 UTC) then `SEO GA4 Pull` (03:15 UTC). They
  write different columns of the same weekly row and are deliberately 30 minutes
  apart so a GA4 failure cannot lose GSC data.
- **Daily 02:00 UTC** — `SEO Drift Sweep`. Snapshots each page's SEO elements,
  compares against the last snapshot, and only classifies when the hash changed.
- **Thursdays 05:00 UTC** — `SEO Weekly Email`.

After the first Monday, you should see rows in `seo_weekly_metrics`,
`keyword_rankings` and `seo_page_metrics`. After the first night, rows in
`seo_site_snapshots`.

```sql
SELECT s.domain, count(*) AS snapshots, max(sn.fetched_at) AS last_seen
  FROM seo_site_snapshots sn JOIN seo_sites s ON s.id = sn.site_id
 GROUP BY 1 ORDER BY 1;
```

**The first sweep alerts on nothing.** It has no previous snapshot to compare
against, so it just records a baseline. Drift detection starts on night two.
This is expected and is not a broken cron.

## Step 5 — turn on publishing (the gated one)

Only do this once step 4 has produced sensible data for a week, and note that
**WordPress publishing is blocked on credential rotation** — the old app
passwords are in the exposure list. See
[`OWNER_ACTION_LIST.md`](./OWNER_ACTION_LIST.md).

```
SITE_ADAPTER_ENABLED=true
SITE_PROVIDER=git          # or wordpress | shopify
```

Then the loop, per change:

1. A change is proposed — `POST /api/seo-changes`
2. Staged on the provider — `/stage`
3. Verified — `/verify`
4. It waits at `awaiting_approval`, in the queue at **`/seo/approvals`** in the
   admin UI
5. A human approves — `/approve` — or rejects with a captured reason
6. Only then can it publish — `/publish`

**Approve is deliberately not a bulk action.** Bulk-approve is precisely what
the hard stop exists to prevent, so it isn't in the UI and shouldn't be added.

The hard stop is enforced three times over, independently: a database CHECK
constraint, `publishApprovedChange()` being the sole caller of the provider's
publish method, and each adapter re-checking before its first network call. A
test walks `src/` and fails the build if a second caller of
`provider.publishChange()` ever appears.

Git sites don't publish from the server at all — they produce a reviewable diff
and hand off (`handoff_required`), because deploy keys to client repos in the
API container is too large a blast radius and Railway's filesystem is ephemeral.

## Step 6 — set the cost caps before selling it

Per-tenant and per-site, backed by the `seo_api_usage` ledger — not an in-memory
counter that resets on deploy, which is what it replaced.

| Env var | Default | Caps |
|---|---|---|
| `SEO_MONTHLY_BUDGET_CENTS` | 200000 | Whole-tenant monthly spend |
| `SEO_DAILY_BUDGET_CENTS` | 20000 | Whole-tenant daily spend |
| `SEO_MAX_SERPER_CALLS_PER_TENANT_DAY` | 50 | Paid SERP calls, tenant/day |
| `SEO_MAX_SERPER_CALLS_PER_SITE_DAY` | 20 | Paid SERP calls, site/day |
| `SEO_MAX_PAGESPEED_CALLS_PER_TENANT_DAY` | 100 | Free, but rate-limited upstream |
| `SEO_MAX_GSC_CALLS_PER_TENANT_DAY` | 200 | Free API, quota protection |
| `SEO_MAX_GA4_CALLS_PER_TENANT_DAY` | 200 | Free API, quota protection |
| `SEO_MAX_PUBLISHES_PER_SITE_DAY` | 3 | Blast-radius limit, not a cost one |

A blocked call returns 429 with a specific code (`site_daily_serper_cap_exhausted`
and friends), never a generic failure.

Per-plan overrides read from `plans.limits` jsonb, so
`{"seoSites": 1, "seoPublishesPerSiteDay": 3}` makes a per-site add-on
enforceable **with no new billing code**.

---

## If nothing seems to be happening

In this order — the first two account for most of it:

1. **Does the tenant have `settings.features.seo`?** No flag, no routes, no nav.
2. **Does the site have a `gscProperty` and `status = 'active'`?** Silently
   skipped otherwise, with a log line.
3. **Is it before the first Monday / first night?** The pulls are weekly and the
   sweep needs two nights to say anything.
4. **Is a cost guard blocking?** Look for `blockCode` in the logs.
5. **Is `SITE_ADAPTER_ENABLED` still false?** Then nothing publishes, correctly.

`.claude/agents/seo-debugger.md` is a subagent that knows this system and can
walk it for you.

## Known gaps, stated plainly

- **Drift alerts go to one Slack channel**, not per-tenant destinations. Fine for
  GE; a reseller would see GE's channel or nothing. Needs per-tenant routing
  before a second tenant goes live on drift.
- **One `CREDENTIAL_ENCRYPTION_KEY`** protects every reseller's stored client
  credentials. Acceptable for a pilot, but say so in the contract.
- **Shared learning priors across tenants** need explicit disclosure in a
  reseller contract, plus the opt-out toggle.
- **WordPress publishing is blocked** until the leaked app passwords are rotated.
