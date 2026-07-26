// PRD-005 §5.2 C-2 / §11.3, ADR-006 D-13 — guard against a sixth independent
// eligibility computation. PRD-005 found eligibility re-derived in five
// places that disagreed with one another; PR 5 migrates the company-scoped
// ones onto the canonical resolver (src/modules/outreach/outreachGate.ts).
// This is a source-level contract test, not a behavioural one — a per-file
// unit test can only prove the files someone remembered to write a test for,
// and a new "hot|warm|watch|blocked"-style computation is exactly the defect
// PRD-005 §5.2 C-2 already found once. This test fails the moment a new file
// declares that literal union without an accompanying, disclosed reason.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');
const SEARCH_ROOTS = [join(REPO_ROOT, 'src')];

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

// The exact literal union PRD-005 §5.2 C-2 identifies as the shape of the
// disagreement: "four independent hot|warm|watch|blocked enums". Any file
// declaring this exact union is either one of the known, disclosed sites
// below, or a new sixth computation this test must catch.
const PRIORITY_UNION_PATTERN = /'hot'\s*\|\s*'warm'\s*\|\s*'watch'\s*\|\s*'blocked'/;

const priorityUnionFiles = sourceFiles
  .map((path) => ({ path: path.slice(REPO_ROOT.length + 1), text: readFileSync(path, 'utf8') }))
  .filter(({ text }) => PRIORITY_UNION_PATTERN.test(text));

// Every known site, with why it's allowed to exist and what it must do.
const ALLOWED_SITES: Record<string, string> = {
  // The adapter itself — generic over the shape, not a computation.
  'src/modules/outreach/legacyEligibilityAdapter.ts':
    'the canonical adapter module; declares the shape generically to fold canonical decisions in, computes nothing itself',
  // Company-scoped: migrated in PR 5, must import the adapter.
  'src/services/wizmatchClientDiscovery.ts': 'migrated in PR 5 — must call the canonical adapter',
  'src/services/wizmatchCommandCenter.ts': 'migrated in PR 5 — must call the canonical adapter',
  'src/services/wizmatchRequirementPriority.ts': 'migrated in PR 5 — must call the canonical adapter',
  // Not company-scoped by construction (PRD-005 §11.3 scope note, see file
  // header): the top-level CandidateIntelligenceInput a candidate is not 1:1
  // with one company, and evaluateWizmatchOutreachGate requires a companyId
  // that input structurally lacks. CandidateRequirementInput (a per-match
  // input, not the top-level one) does carry a companyId, but
  // CandidateRequirementMatch has no blockers[] field for the shared fold to
  // write into — an open, disclosed gap (H-6), not a silent one; see the
  // file header for the full, corrected scope note.
  'src/services/wizmatchCandidateIntelligence.ts':
    'scores a candidate, not a company — the top-level input structurally lacks a companyId; see the file header for the corrected scope note (H-6)',
  // Pre-existing display-bucket re-derivation from already-migrated upstream
  // qualificationTier values (not an independent DB read of its own) — known
  // and disclosed here, not fixed in PR 5 per its "no unrelated work" scope.
  'src/services/wizmatchReviewWorkbench.ts':
    'pure display-bucket re-derivation of already-migrated upstream values (qualificationTier -> hot/warm/watch), not an independent eligibility computation of its own — a candidate for tightening in a future PR, recorded rather than silently left',
};

describe('PRD-005 §5.2 C-2 — no sixth independent eligibility computation', () => {
  it('finds the priority-union sites it is meant to be checking', () => {
    // Guards against the regex silently matching nothing and this suite
    // passing vacuously.
    expect(priorityUnionFiles.length).toBeGreaterThanOrEqual(Object.keys(ALLOWED_SITES).length);
  });

  it('every site declaring the hot|warm|watch|blocked union is a known, disclosed site', () => {
    const unknown = priorityUnionFiles.map((f) => f.path).filter((path) => !(path in ALLOWED_SITES));
    // A new match here means a sixth independent eligibility computation was
    // just added. It must either migrate onto
    // src/modules/outreach/legacyEligibilityAdapter.ts (if company-scoped) or
    // be added to ALLOWED_SITES above with a stated, reviewed reason why not
    // — never silently pass.
    expect(unknown).toEqual([]);
  });

  it('every known site still exists (a silent removal is also a contract change)', () => {
    const found = new Set(priorityUnionFiles.map((f) => f.path));
    const missing = Object.keys(ALLOWED_SITES).filter((path) => !found.has(path));
    expect(missing).toEqual([]);
  });

  it('the three company-scoped, migrated files import the canonical adapter', () => {
    const migrated = [
      'src/services/wizmatchClientDiscovery.ts',
      'src/services/wizmatchCommandCenter.ts',
      'src/services/wizmatchRequirementPriority.ts',
    ];
    const missingImport = priorityUnionFiles
      .filter(({ path }) => migrated.includes(path))
      .filter(({ text }) => !text.includes('legacyEligibilityAdapter'))
      .map(({ path }) => path);
    expect(missingImport).toEqual([]);
  });

  it('wizmatchContactIntelligenceRepo.ts folds the canonical decision into hardBlocks/companyStatus', () => {
    // This file uses a 9-value companyStatus + hardBlocks[] shape, not the
    // 4-value priority union, so it is not caught by the regex above — assert
    // its migration directly instead.
    const path = join(REPO_ROOT, 'src/services/wizmatchContactIntelligenceRepo.ts');
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('applyCanonicalEligibilityToContactIntelligence');
    // ADR-006 D-13: the persisted legacy status column must never override a
    // freshly computed status — this is the "grain collapse" this test locks
    // shut. If this string reappears, D-13 has regressed.
    expect(text).not.toContain("persisted.company.status || item.companyStatus");
  });
});
