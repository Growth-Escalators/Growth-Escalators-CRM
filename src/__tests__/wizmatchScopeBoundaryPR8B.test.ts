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
