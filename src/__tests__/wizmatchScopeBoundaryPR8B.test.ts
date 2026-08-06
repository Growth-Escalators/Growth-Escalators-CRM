// PR 8B — scope-boundary regression guard. This branch's mandate is the
// Smartlead-free internal pilot only: PR 9 (Smartlead CSV adapter) and PR 10
// (reply ingestion) remain gated on the sanitised Smartlead fixtures (U-6,
// ADR-007 D-5) and must not start on the strength of this branch. Every prior
// PR review in this stack verified this by one-off grep; this test makes it
// mechanically checkable instead of re-verified by hand each time (the same
// reasoning as `wizmatchLegacyEligibilityGuard.test.ts` and
// `wizmatchCompanyBootstrapCoverage.test.ts` — a source-level contract test,
// not a behavioural one, because "a feature was never built" cannot be proven
// any other way).
//
// This is deliberately a source scan, not a behavioural test — there is no
// behaviour to exercise for code that must not exist. To avoid the class of
// vacuous guard this repo has hit repeatedly (PR 8/8A: a comment satisfying a
// regex, an identifier's own const satisfying a check), every pattern below
// is matched against comment-stripped source only, and the mutation control
// in this file's own test proves that stripping.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');
const SEARCH_ROOTS = [join(REPO_ROOT, 'src'), join(REPO_ROOT, 'scripts')];

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, acc);
    else if (entry.endsWith('.ts') || entry.endsWith('.js')) acc.push(full);
  }
  return acc;
}

/** Strips // line comments and /* block comments *[/] so a comment alone can never satisfy a pattern below. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const sourceFiles = SEARCH_ROOTS.flatMap((root) => collectSourceFiles(root));
const filesWithStrippedText = sourceFiles.map((path) => ({
  path: path.slice(REPO_ROOT.length + 1),
  raw: readFileSync(path, 'utf8'),
  get stripped() {
    return stripComments(this.raw);
  },
}));

// The one legitimate, disclosed reference: a pre-existing Drizzle column
// DEFAULT literal (`schema.ts`) and this pilot's own readiness/config/test
// files, which must NAME these strings to detect and reject them. Everything
// else finding one of these identifiers is a real implementation, not prose.
const ALLOWED_FILES = new Set([
  'src/db/schema.ts',
  'src/services/wizmatchPilotReadiness.ts',
  'src/__tests__/wizmatchPilotReadiness.test.ts',
  'src/__tests__/wizmatchScopeBoundaryPR8B.test.ts',
]);

describe('PR 8B scope boundary — PR 9/10 must not have started', () => {
  it('no SmartleadProvider-class implementation identifier exists outside the allowed files', () => {
    const pattern = /\bSmartleadProvider\b|\bSmartleadCsvProvider\b|\bsmartleadExportBatch\b|\bsmartleadParseResults\b/;
    const offenders = filesWithStrippedText.filter(
      (f) => !ALLOWED_FILES.has(f.path) && pattern.test(f.stripped),
    );
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  // M-5 strengthening #2 — the literal 4-name list above only catches an
  // implementation that happens to be named exactly one of those identifiers.
  // A `SmartleadCsvAdapter`, `SmartleadExportClient`, or any other
  // Smartlead-prefixed class/function ending in a provider-ish suffix would
  // sail through it untouched. This is a SHAPE pattern instead of a name
  // list, scanned across the exact same file set the guard above already
  // scans (comment-stripped, same ALLOWED_FILES carve-out) — it widens
  // coverage without narrowing what was already scanned.
  //
  // `[A-Za-z0-9]*` (not `\w*`) deliberately EXCLUDES underscore between
  // "Smartlead" and the suffix, and the suffix words are matched
  // case-SENSITIVELY as capitalised — i.e. this matches identifier shapes
  // (`SmartleadCsvAdapter`, `smartleadExportBatch`), never the documented
  // `'smartlead_csv'` provider-NAME string literal (PRD-005 §16,
  // src/modules/outreach/providers/index.ts), which is expected, disclosed,
  // and already has its own dedicated guard in wizmatchOutreachProvider.test.ts.
  // Final independent review — the shape pattern above was case-flexible only
  // on the leading `S`, so every letter after it had to be lowercase
  // `martlead`. `SmartLeadCsvAdapter` — capitalising the second word of a
  // two-word compound, which is the MORE idiomatic PascalCase spelling and the
  // one this codebase uses everywhere else (`OutreachProvider`,
  // `CandidateAccess`) — evaded it entirely. Verified empirically by planting
  // each identifier below in `src/` and re-running this file: only the
  // all-lowercase spelling was caught; `SmartLeadCsvAdapter`,
  // `SmartLeadAdapter` and `smartLeadExporter` all passed green. Matching the
  // "smartlead" stem case-insensitively closes the whole spelling family at
  // once rather than enumerating variants.
  it('no Smartlead-prefixed provider/adapter/client-shaped identifier exists outside the allowed files', () => {
    const pattern = /\bsmartlead[A-Za-z0-9]*(?:Provider|Adapter|Client|Csv|CSV|Export|Import|Parser)[A-Za-z0-9]*\b/i;
    const offenders = filesWithStrippedText.filter(
      (f) => !ALLOWED_FILES.has(f.path) && pattern.test(f.stripped),
    );
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  // Control for the assertion above — proves the widened pattern actually
  // catches the spelling family that evaded the previous one, so this is a
  // real strengthening and not a regex that happens to match nothing.
  it('control — the identifier pattern catches every plausible Smartlead spelling, and no innocent one', () => {
    const pattern = /\bsmartlead[A-Za-z0-9]*(?:Provider|Adapter|Client|Csv|CSV|Export|Import|Parser)[A-Za-z0-9]*\b/i;
    for (const caught of [
      'SmartleadCsvAdapter', 'SmartLeadCsvAdapter', 'SmartLeadAdapter', 'smartLeadExporter',
      'SMARTLEADCSVADAPTER', 'SmartleadCSVAdapter', 'smartleadExportBatch', 'SmartLeadImportClient',
    ]) {
      expect(pattern.test(`export class ${caught} {}`), `should catch ${caught}`).toBe(true);
    }
    // Must NOT match the documented provider-NAME string literal, nor unrelated
    // identifiers that merely contain one of the suffix words.
    for (const innocent of ["const p = 'smartlead_csv';", 'class CsvExporter {}', 'function parseImportClient() {}']) {
      expect(pattern.test(innocent), `should not match ${innocent}`).toBe(false);
    }
  });

  // The structural half, and the one that does not depend on naming at all.
  // Both identifier scans above are keyed to the string "smartlead" appearing
  // in an identifier, so a fully generically-named adapter (e.g.
  // `CsvBulkOutreachAdapter`, verified to evade both scans) implemented OUTSIDE
  // `providers/` and merely REGISTERED here would be a complete PR 9 with no
  // alarm — the directory-membership assertion does not catch it either,
  // because `index.ts` is itself an allowed member and nothing stops it
  // importing from elsewhere. `KNOWN_PROVIDERS` is the actual chokepoint: no
  // provider can be constructed by `buildProvider` without an entry here, so
  // pinning this list to exactly `['mock']` detects PR 9 regardless of what
  // anything is named or where it lives.
  it('the outreach provider allow-list still contains ONLY the mock — no real provider is registered', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'src', 'modules', 'outreach', 'providers', 'index.ts'),
      'utf8',
    );
    const match = stripComments(source).match(/const KNOWN_PROVIDERS = \[([^\]]*)\]/);
    expect(match, 'KNOWN_PROVIDERS declaration not found in providers/index.ts').not.toBeNull();
    const names = match![1]
      .split(',')
      .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    expect(names).toEqual(['mock']);
  });

  // M-5 strengthening #1 — an allow-list of exact filenames only fails a file
  // named one of the identifiers scanned above. A real provider implementation
  // dropped into this directory under an unrelated name (e.g.
  // `csvExportAdapter.ts` with no "Smartlead" in its own identifiers, wired up
  // from elsewhere) would not be caught by either identifier scan. This
  // asserts DIRECTORY MEMBERSHIP itself: the provider directory may contain
  // ONLY the two files this PR ships, in total — any addition of any name
  // fails this test, whatever it is called or what it contains.
  it('the outreach provider directory contains ONLY the allowed provider-interface and mock files — no other file of any name', () => {
    const providersDir = join(REPO_ROOT, 'src', 'modules', 'outreach', 'providers');
    const entries = readdirSync(providersDir).sort();
    expect(entries).toEqual(['index.ts', 'mock.provider.ts', 'outreach-provider.interface.ts']);
  });

  it('no reply-ingestion/classification implementation identifier exists anywhere', () => {
    const pattern = /\bImapReplyClassifier\b|\bReplyClassifier\b|\bclassifyReplyEvent\b|\bimapReplyPoller\b/;
    const offenders = filesWithStrippedText.filter((f) => pattern.test(f.stripped));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  // M-5 strengthening #3 — the previous check only ever asked "does a file
  // literally named 0038* exist", which a migration named e.g.
  // `0039_something.sql` (skipping 0038 entirely) would evade while still
  // starting PR 9/10's schema work. This instead asserts the HIGHEST migration
  // number present is exactly 37 — the last number this branch's mandate
  // covers — so ANY migration numbered 38 or above fails it, regardless of
  // its name. Only the NUMBER matters here, not 0037's own content: another
  // lane in this same remediation session amends 0037_unknown_siren.sql's
  // CHECK constraint in place (same filename, same number), which this
  // assertion is intentionally blind to.
  // This began as a bare `max(prefix) === 37`. That number was a PROXY for this
  // file's actual mandate — "PR 9 (Smartlead CSV adapter) and PR 10 (reply
  // ingestion) must not have started" — chosen when 0037 happened to be the tip.
  //
  // 0038 (`users.is_active`, failure-matrix M-3, owner-approved 2026-07-30) is
  // authentication remediation with no relationship to PR 9/10, so it violates
  // the proxy while leaving the mandate untouched. Rather than bump the constant
  // to 38 — which erodes the guard a little every time, and would let genuine
  // PR 9/10 schema work in as 0039 with the same one-character edit — each
  // migration past 0037 must now be named in a reviewed allowlist AND be proven
  // not to create Smartlead/reply-ingestion surfaces. That is strictly stronger
  // than the original for anything added from here on.
  const MIGRATIONS_REVIEWED_AS_OUT_OF_PR9_10_SCOPE: Record<number, string> = {
    38: 'users.is_active — auth/offboarding column, failure-matrix M-3. Touches only the shared `users` table.',
    39: 'saved_views — admin-UI filter presets (name + URL query string), owner-approved 2026-08-01. '
      + 'Additive CREATE TABLE only; no ALTER of any existing table. Stores no outreach, sequence, '
      + 'reply or provider data — `query` is a URL query string for a list page, not a payload. '
      + 'Unrelated to PR 9/10 (Smartlead / reply ingestion).',
    40: 'users.is_platform_superadmin — platform-superadmin primitive (Phase-1 hardening, security '
      + 'audit 2026-08-03), owner-approved in that task\'s brief. `ADD COLUMN ... DEFAULT false NOT NULL` '
      + 'on the shared `users` table only; no new table, no outreach/sequence/reply/provider surface. '
      + 'Ships schema + a `requirePlatformSuperadmin` middleware + audit-logging capability, none of it '
      + 'wired into any route. Unrelated to PR 9/10 (Smartlead / reply ingestion).',
    41: 'tenant_branding — white-label admin-SPA branding (display name/logo/colors per tenant), '
      + 'part of the tenant-branding-whitelabel PR. Additive CREATE TABLE only; no ALTER of any '
      + 'existing table. Unrelated to PR 9/10 (Smartlead / reply ingestion).',
    42: 'tenant_integrations — Phase 3 white-label credential store (per-tenant SMTP/Meta/etc. '
      + 'credentials, AES-256-GCM encrypted), approved as part of the white-label reselling effort. '
      + 'Additive CREATE TABLE only; no ALTER of any existing table. `provider` is a generic '
      + "text column (e.g. 'email_smtp', 'meta') — this migration itself carries no Smartlead or "
      + 'reply-ingestion surface. Renumbered from 0040 to 0042 during merge — 0040/0041 were already '
      + 'claimed. The Meta OAuth connect-flow scaffolding '
      + '(src/services/metaOAuthService.ts, src/routes/integrations*.ts) reuses this same table '
      + '(provider=\'meta\') rather than adding its own migration. Unrelated to PR 9/10 '
      + '(Smartlead CSV adapter / reply ingestion).',
    43: 'plans + subscriptions — subscription-billing core (reselling this CRM to other agencies via a '
      + 'pluggable Cashfree/Razorpay gateway adapter). Additive CREATE TABLE only (two new tables); no '
      + 'ALTER of any existing table. Stores plan pricing/entitlements and a tenant\'s own billing/'
      + 'subscription state (status, provider, renewal date) — no outreach, sequence, reply, or '
      + 'Smartlead/reply-ingestion data of any kind. Renumbered from 0040 to 0043 during merge — '
      + '0040/0041/0042 were already claimed. Unrelated to PR 9/10 (Smartlead / reply ingestion).',
    44: 'tenant_branding legal/financial identity columns — reseller-readiness fix so a white-label '
      + 'tenant\'s own invoices/reports render its own legal name, registered address, tax ID, and bank '
      + 'details instead of Growth Escalators\' (owner-approved). Additive ADD COLUMN only (ten nullable '
      + 'text columns on the existing tenant_branding table); no ALTER of any other table, no new table. '
      + 'Carries no outreach, sequence, reply, or Smartlead/reply-ingestion data of any kind. Unrelated '
      + 'to PR 9/10 (Smartlead / reply ingestion).',
    45: 'roles / role_permissions / user_permission_overrides — foundation for tenant-customizable RBAC '
      + '(replacing the static, GE-shaped PERMISSION_MAP in src/middleware/rbac.ts over time). Additive '
      + 'CREATE TABLE only (three new tables) plus one nullable `users.role_id` ADD COLUMN with an FK to '
      + 'the new `roles` table — no ALTER/DROP of any existing column, no backfill in this migration. '
      + 'Not wired into any route or auth check by this PR; PERMISSION_MAP keeps gating every existing '
      + 'route exactly as today. Carries no outreach, sequence, reply, or Smartlead/reply-ingestion data '
      + 'of any kind. Unrelated to PR 9/10 (Smartlead / reply ingestion).',
    46: 'user_invites — invite-by-email replacement for the old print-a-temp-password-once flow (feat: '
      + 'email invites, seat limits, reassign-on-offboard). Additive CREATE TABLE only (one new table, '
      + 'FKs to the existing users/tenants tables); no ALTER of any existing table. Stores a hashed, '
      + 'single-use, time-limited invite token per user — no outreach, sequence, reply, or '
      + 'Smartlead/reply-ingestion data of any kind. Renumbered from 45 to 46 during merge — 45 was '
      + 'already claimed by the roles/role_permissions PR. Unrelated to PR 9/10 (Smartlead / reply '
      + 'ingestion).',
    // SEO platform phases 1-6. RENUMBERED 45-49 -> 47-51 during the merge with
    // main, which had independently claimed 45 (RBAC) and 46 (user_invites).
    // SQL bodies unchanged; only the file numbers and the journal moved.
    47: 'SEO tenant hardening (Phase 1 of the multi-tenant SEO platform work, owner-approved). '
      + 'Backfills + constrains `seo_content_calendar.tenant_id` (it previously defaulted to a sentinel '
      + 'UUID that is not a real `tenants` row, so every existing row pointed at a nonexistent tenant), '
      + 'adds three nullable approval columns to `client_pages`, adds a nullable `tenant_id` to '
      + '`seo_workflow_logs`, and DROPs the four unused `seo_looker_*` views (no consumer; they selected '
      + 'no tenant_id and were rebuildable via an unauthenticated route). Touches only SEO tables. '
      + 'Carries no outreach, sequence, reply, or provider data. Unrelated to PR 9/10 (Smartlead / '
      + 'reply ingestion).',
    48: 'seo_sites registry (Phase 2 of the multi-tenant SEO platform work, owner-approved). Creates '
      + 'the `seo_sites` table — the registry that replaces nine hardcoded client-domain arrays '
      + 'scattered across the SEO services — and adds a NULLABLE `site_id` FK to the nine existing SEO '
      + 'tables, then seeds the registry from the distinct (tenant_id, client_domain) pairs already '
      + 'present and backfills `site_id` from it. Fully additive: no SET NOT NULL, no unique index over '
      + 'pre-existing data, no DROP, and every statement is IF NOT EXISTS / duplicate_object-guarded '
      + 'because ensureSeoTables() drifts these tables at runtime. Seed and backfill join on BOTH '
      + 'tenant_id and a normalised domain, so two tenants working on the same domain each get their '
      + 'own row rather than being cross-linked — verified against a fixture before landing. Touches '
      + 'only SEO tables. Carries no outreach, sequence, reply, or provider data. Unrelated to PR 9/10 '
      + '(Smartlead / reply ingestion).',
    49: 'Drops seo_content_calendar\'s legacy 3-column unique index (client_domain, keyword, '
      + 'content_type) — the deferred half of migration 0045, which added the tenant-scoped 4-column '
      + 'index alongside it and kept the old one because in-flight code still named the 3-column '
      + 'ON CONFLICT target. Every writer now names the 4-column target (routes/seo.ts, '
      + 'seoContentDecayService, seoContentGapService; grep-verified zero 3-column targets remain), '
      + 'so the old index is dropped here. Not merely redundant: UNIQUE on those three columns with '
      + 'no tenant column made the combination GLOBALLY exclusive, so two tenants could not both hold '
      + 'a calendar entry for the same keyword on the same domain — the second write either '
      + "overwrote the first tenant's row or failed. A single DROP INDEX IF EXISTS; dropping an index "
      + 'never fails on data, and the 4-column index still enforces per-tenant uniqueness. Touches '
      + 'only SEO tables. Carries no outreach, sequence, reply, or provider data. Unrelated to PR 9/10 '
      + '(Smartlead / reply ingestion).',
    50: 'site_changes + seo_site_snapshots (Phase 3 of the multi-tenant SEO platform work, '
      + 'owner-approved). Two NEW tables: `site_changes` records one proposed edit to a live client '
      + 'website per row and is where the human-approval hard stop is enforced; `seo_site_snapshots` '
      + 'is the append-only drift record (extracted SEO elements plus a hash, never page HTML). '
      + 'Purely additive: no ALTER of an existing table, no DROP, no SET NOT NULL, no unique index '
      + 'over pre-existing rows. Carries the `site_changes_approved_requires_approver` CHECK — the '
      + 'database-level half of the invariant that nothing publishes to a live site without a '
      + 'recorded human approver and timestamp. Every statement is IF NOT EXISTS / '
      + 'duplicate_object-guarded, including the CHECK, which drizzle-kit emitted inline in CREATE '
      + 'TABLE where a pre-existing table would have skipped it. Touches only SEO tables. Carries no '
      + 'outreach, sequence, reply, or provider data. Unrelated to PR 9/10 (Smartlead / reply '
      + 'ingestion).',
    51: 'seo_api_usage spend ledger (Phase 4 of the multi-tenant SEO platform work, owner-approved). '
      + 'One NEW table recording one row per billable SEO API call (tenant_id, nullable site_id, '
      + 'provider, operation, calls, cost_cents) — the backing store seoCostGuard.ts has carried an '
      + 'explicit "INTENTIONALLY MISSING, needs a migration" note for since Phase 1. It replaces an '
      + 'in-memory process-lifetime global counter that reset on every deploy and let tenants starve '
      + "each other. Purely additive: no ALTER of an existing table, no DROP, no SET NOT NULL. NOTE: "
      + 'drizzle-kit additionally emitted a DROP + re-ADD of the site_changes_approved_requires_approver '
      + 'CHECK with byte-identical text (a snapshot artefact of 0048 having moved that constraint into '
      + 'its own duplicate_object-guarded DO block); BOTH statements were deleted by hand, so the '
      + 'human-approval hard stop is never dropped. Verified post-migration against local Postgres: the '
      + 'constraint is still present and still rejects an approved-status row with no approver. Touches '
      + 'only SEO tables. Carries no outreach, sequence, reply, or provider data. Unrelated to PR 9/10 '
      + '(Smartlead / reply ingestion).',
  };

  it('every migration past 0037 is in the reviewed out-of-scope allowlist', () => {
    const migrationsDir = join(REPO_ROOT, 'src', 'db', 'migrations');
    const beyond = readdirSync(migrationsDir)
      .filter((e) => e.endsWith('.sql'))
      .map((e) => ({ file: e, idx: parseInt(e.slice(0, 4), 10) }))
      .filter((m) => Number.isFinite(m.idx) && m.idx > 37);
    for (const { file, idx } of beyond) {
      expect(
        MIGRATIONS_REVIEWED_AS_OUT_OF_PR9_10_SCOPE[idx],
        `migration ${file} is past the PR 8B boundary and is not in the reviewed allowlist — if it is PR 9/PR 10 work it must not be on this branch; if it is unrelated, add it with a justification`,
      ).toBeTruthy();
    }
  });

  it('no migration past 0037 creates a Smartlead or reply-ingestion surface', () => {
    const migrationsDir = join(REPO_ROOT, 'src', 'db', 'migrations');
    // The mandate itself, asserted against SQL rather than against a file number.
    const forbidden = /smartlead|reply_(?:ingest|classification|message)|inbound_repl/i;
    const beyond = readdirSync(migrationsDir)
      .filter((e) => e.endsWith('.sql'))
      .filter((e) => {
        const idx = parseInt(e.slice(0, 4), 10);
        return Number.isFinite(idx) && idx > 37;
      });
    for (const file of beyond) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      // Comments are stripped first — this file's own convention, so a
      // rationale comment mentioning "Smartlead" cannot trip the guard.
      const bare = sql.replace(/--.*$/gm, '');
      expect(bare, `migration ${file} creates a Smartlead/reply-ingestion surface — PR 9/10 must not start on this branch`)
        .not.toMatch(forbidden);
    }
  });

  it('control — the allowlist guard actually fails for an unreviewed migration number', () => {
    // Mutation control, per this file's standing rule that a guard is assumed
    // vacuous until watched to fail. Proves the assertion above is load-bearing
    // rather than trivially satisfied by an empty `beyond` list.
    expect(MIGRATIONS_REVIEWED_AS_OUT_OF_PR9_10_SCOPE[9999]).toBeFalsy();
    expect(Object.keys(MIGRATIONS_REVIEWED_AS_OUT_OF_PR9_10_SCOPE)).toContain('38');
  });

  it('control — the comment-stripping actually strips comments (mutation-proof for this guard itself)', () => {
    const withComment = "// this file mentions SmartleadProvider only in a comment\nconst x = 1;";
    expect(stripComments(withComment)).not.toMatch(/SmartleadProvider/);
    const withBlockComment = "/* SmartleadProvider */ const y = 2;";
    expect(stripComments(withBlockComment)).not.toMatch(/SmartleadProvider/);
    // The identifier itself, uncommented, must still be detected — proves the
    // stripping isn't so aggressive it eats real code too.
    const real = 'class SmartleadProvider {}';
    expect(stripComments(real)).toMatch(/SmartleadProvider/);
  });
});
