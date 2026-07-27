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

  it('no reply-ingestion/classification implementation identifier exists anywhere', () => {
    const pattern = /\bImapReplyClassifier\b|\bReplyClassifier\b|\bclassifyReplyEvent\b|\bimapReplyPoller\b/;
    const offenders = filesWithStrippedText.filter((f) => pattern.test(f.stripped));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('no migration 0038 exists', () => {
    const migrationsDir = join(REPO_ROOT, 'src', 'db', 'migrations');
    const entries = readdirSync(migrationsDir).filter((e) => e.endsWith('.sql'));
    const has0038 = entries.some((e) => e.startsWith('0038'));
    expect(has0038).toBe(false);
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
