// PRD-005 §8.1 / §22.2 #16 — "EVERY insert path for wizmatch_companies writes
// the cold-start entire_company row in the same transaction."
//
// This is a source-level contract test rather than a behavioural one, because
// the criterion is a statement about *every* call site, and a per-call-site unit
// test can only ever prove the sites someone remembered to write a test for.
// The first implementation of #16 wired the two paths named in the PR
// description and silently missed a third (the ATS-board onboarding script),
// which no behavioural test could have caught. This test fails when a new
// company-insert path is added without a root-policy write.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');
const SEARCH_ROOTS = [join(REPO_ROOT, 'src'), join(REPO_ROOT, 'scripts')];

/** Every .ts file under the search roots, excluding this suite's own directory. */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, acc);
    else if (entry.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

const sourceFiles = SEARCH_ROOTS.flatMap((root) => collectSourceFiles(root));

/** Files that write a wizmatch_companies row, as (relative path, contents). */
const companyInsertFiles = sourceFiles
  .map((path) => ({ path: path.slice(REPO_ROOT.length + 1), text: readFileSync(path, 'utf8') }))
  .filter(({ text }) => /INSERT\s+INTO\s+wizmatch_companies/i.test(text));

describe('PRD-005 §22.2 #16 — every company-insert path bootstraps a root policy', () => {
  it('finds the company-insert paths it is meant to be checking', () => {
    // Guards against the regex silently matching nothing and the suite passing
    // vacuously. Three paths are known today: the sourcing upsert, the prospect
    // seeder, and the ATS-board onboarding script.
    expect(companyInsertFiles.length).toBeGreaterThanOrEqual(3);
  });

  it('every file that inserts a company also writes the cold-start root policy', () => {
    // Local-only dev seeders may write the root row with direct SQL. The contract
    // being protected is "no company row exists without a root policy row" — not
    // "the shared helper was called". scripts/dev/ deliberately seeds FOUR
    // DIFFERENT policy states (eligible, needs_review, blocked, competitor) so the
    // local UI can exercise every branch; the helper only writes the uniform
    // cold-start row, so calling it here would make the fixture strictly worse.
    // This stays narrow: scripts/dev/ never runs against production (its own
    // localhost guard aborts otherwise), it must still demonstrably insert into
    // wizmatch_company_policies, and the explicit path list below fails if any new
    // insert path appears anywhere in the tree.
    const writesRootPolicy = ({ path, text }: { path: string; text: string }) =>
      text.includes('insertWizmatchCompanyRootPolicy')
      || text.includes('wizmatchRootPolicyBootstrapCte')
      || (path.startsWith('scripts/dev/') && /INSERT\s+INTO\s+wizmatch_company_policies/i.test(text));

    const missing = companyInsertFiles.filter((f) => !writesRootPolicy(f)).map(({ path }) => path);

    // A company row that is observable without a policy row is a permanent L0
    // `policy_missing_root` deny that no re-run repairs.
    expect(missing).toEqual([]);
  });

  it('names the known paths explicitly, so a silent removal is also caught', () => {
    const paths = companyInsertFiles.map((f) => f.path).sort();
    expect(paths).toEqual([
      'scripts/dev/seed-local.ts',
      'scripts/onboarding/wizmatch-seed-ats-boards.ts',
      'src/services/wizmatchContactIntelligenceRepo.ts',
      'src/services/wizmatchSourcing.ts',
    ]);
  });
});
