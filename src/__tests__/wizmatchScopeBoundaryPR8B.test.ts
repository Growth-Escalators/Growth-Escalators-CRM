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
  it('no Smartlead-prefixed provider/adapter/client-shaped identifier exists outside the allowed files', () => {
    const pattern = /\b[Ss]martlead[A-Za-z0-9]*(?:Provider|Adapter|Client|Csv|Export|Import|Parser)[A-Za-z0-9]*\b/;
    const offenders = filesWithStrippedText.filter(
      (f) => !ALLOWED_FILES.has(f.path) && pattern.test(f.stripped),
    );
    expect(offenders.map((f) => f.path)).toEqual([]);
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
  it('no migration numbered higher than 0037 exists', () => {
    const migrationsDir = join(REPO_ROOT, 'src', 'db', 'migrations');
    const prefixes = readdirSync(migrationsDir)
      .filter((e) => e.endsWith('.sql'))
      .map((e) => parseInt(e.slice(0, 4), 10))
      .filter((n) => Number.isFinite(n));
    expect(Math.max(...prefixes)).toBe(37);
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
