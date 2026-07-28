// PRD-005 §11.3 / §5.2 C-2, ADR-006 D-13 — PR 5 contract tests.
//
// Proves the migrated legacy callers agree with the canonical resolver
// (`resolveCompanyStatus` / `evaluateWizmatchOutreachGate`,
// src/modules/outreach/outreachGate.ts) rather than merely calling it: for
// the SAME canonical decision, every migrated caller's output must encode
// the same fact. Uses the predicate-capture `db.select().from().where()`
// mock idiom from wizmatchOutreachGateContract.test.ts / wizmatchPolicyService.test.ts
// (NOT the discard-the-`.where()` pattern in wizmatchOutreachGate.test.ts /
// wizmatchLinkage.test.ts — see docs/reviews/wizmatch-outbound-pr3-opus-review.md
// finding M-5/L-6, regressed here as H-7 and fixed in this file).
//
// D-31: the exact string `enforce` is the only mode that changes behaviour.
// Most describe blocks below force `enforce` so the "canonical wins" fold
// assertions are meaningful; a dedicated "shadow mode" block proves the
// opposite — that shadow leaves legacy behavioural output untouched while
// still attaching canonical display metadata.

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const state = vi.hoisted(() => ({
  policyRows: [] as any[],
  contactRows: [] as any[],
  suppressionRows: [] as any[],
  enrolmentRows: [] as any[],
  companyRows: [] as any[],
  duplicateRows: [] as any[],
  capturedWhere: new Map<unknown, unknown>(),
}));

vi.mock('../db', async () => {
  const actualSchema = await vi.importActual<typeof import('../db/schema')>('../db/schema');
  return {
    ...actualSchema,
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: (condition: unknown) => {
            state.capturedWhere.set(table, condition);
            if (table === actualSchema.wizmatchCompanyPolicies) return Promise.resolve(state.policyRows);
            if (table === actualSchema.contacts) return Promise.resolve(state.contactRows);
            if (table === actualSchema.wizmatchSuppressionList) return Promise.resolve(state.suppressionRows);
            if (table === actualSchema.wizmatchOutreachEnrolments) return Promise.resolve(state.enrolmentRows);
            if (table === actualSchema.wizmatchCompanies) return Promise.resolve(state.companyRows);
            if (table === actualSchema.wizmatchCompanyDuplicates) return Promise.resolve(state.duplicateRows);
            return Promise.resolve([]);
          },
        }),
      }),
    },
  };
});

import { resolveCompanyStatus } from '../modules/outreach/outreachGate';
import { wizmatchCompanyPolicies } from '../db/schema';
import {
  resolveCanonicalCompanyEligibility,
  applyCanonicalEligibilityToContactIntelligence,
  type CanonicalCompanyEligibility,
} from '../modules/outreach/legacyEligibilityAdapter';
import {
  scoreClientDiscoveryOpportunityWithPolicy,
  type ClientDiscoveryInput,
} from '../services/wizmatchClientDiscovery';
import {
  scoreRequirementPriorityWithPolicy,
  type RequirementPriorityInput,
} from '../services/wizmatchRequirementPriority';
import { qualifyCompanyForContactIntelligence } from '../services/wizmatchContactIntelligence';

/** Collects every literal SQL fragment out of a drizzle condition tree (H-7). */
function sqlFragments(node: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof node === 'string') return [node];
  if (node === null || typeof node !== 'object') return [];
  if (seen.has(node as object)) return [];
  seen.add(node as object);
  const out: string[] = [];
  for (const value of Object.values(node as Record<string, unknown>)) {
    out.push(...sqlFragments(value, seen));
  }
  return out;
}

function rootPolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'policy-root-1',
    companyId: 'company-1',
    scopeType: 'entire_company',
    scopeKey: 'entire_company',
    outreachEligibility: 'eligible',
    externalHiringPolicy: 'accepts_external_vendors',
    relationshipType: 'new_prospect',
    reasonCode: 'policy_accepts_external_vendors',
    blockClass: 'standard',
    isNonOverridable: false,
    isPermanent: false,
    evidenceKind: 'human_text',
    evidenceText: 'test',
    evidenceUrl: null,
    evidenceRef: null,
    source: 'human',
    actorUserId: null,
    supersededAt: null,
    ...overrides,
  };
}

const TENANT_ID = 'tenant-1';
const COMPANY_ID = 'company-1';

const clientDiscoveryInput: ClientDiscoveryInput = {
  id: 'signal-1',
  jobTitle: 'Senior Java Developer',
  companyId: COMPANY_ID,
  companyName: 'Bengaluru Systems',
  companyIndustry: 'IT staffing',
  location: 'Bangalore, India',
  signalScore: 9,
  matchedCandidateCount: 4,
};

// H-13 fix: the old fixture scored 63/100 ('watch') before any policy
// applied, so the "caps a locally-hot result to watch" assertion below was
// vacuous — the REVIEW branch was never entered. This fixture is tuned to
// score >= 82 ('hot') on its own: urgency(20) + indiaFirst(15) +
// candidateCoverage(25, one ranked candidate >= 85) + contactReadiness(15,
// an approved contact) + requirementQuality(15, full skills/location/
// workMode/budget/status) + safety(10) + accountQuality(15, tier A) = 115,
// clamped to 100 -> 'hot'. Verified directly in the "fixture reaches hot"
// test below so a future scoring-weight change that silently drops this
// back under 82 fails loudly instead of making the cap test vacuous again.
const strongCandidateMatch = {
  id: 'candidate-1',
  name: 'Priya Sharma',
  skills: ['java', 'spring', 'python'],
  location: 'Bangalore, India',
  availabilityStatus: 'available',
  hasUsableContactChannel: true,
  resumeUrl: 'https://example.com/resume.pdf',
  linkedinUrl: 'https://linkedin.com/in/priya',
  isWizmatchCertified: true,
  priorPlacementCount: 2,
  rateHourly: 500,
  rateCurrency: 'INR',
  source: 'referral',
};

const requirementPriorityInput: RequirementPriorityInput = {
  id: 'req-1',
  title: 'Java Backend Developer',
  companyId: COMPANY_ID,
  companyName: 'Bengaluru Systems',
  requiredSkills: ['java', 'spring'],
  region: 'india',
  priority: 'urgent',
  status: 'sheet_ready',
  location: 'Bangalore, India',
  workMode: 'remote',
  budgetMax: 1000,
  contactApprovedCount: 1,
  companyTier: 'A',
  candidateMatches: [strongCandidateMatch as any],
};

function contactIntelligenceResult() {
  return qualifyCompanyForContactIntelligence({
    company: { id: COMPANY_ID, name: 'Bengaluru Systems', domain: 'bengaluru.example' },
    signal: { jobTitle: 'Senior Java Developer', keywords: ['java'], score: 9, daysOpen: 8 },
    candidateSupply: { matchedCandidateCount: 3 },
    relationships: { knownContactCount: 1 },
    safety: { domainStatus: 'healthy' },
    internalContacts: [],
  });
}

const ORIGINAL_MODE = process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
afterAll(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
  else process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE = ORIGINAL_MODE;
});

beforeEach(() => {
  // D-31: these describe blocks assert the fold actually overrides legacy
  // output, which — per D-31 — only happens under the exact string
  // `enforce`. The dedicated "shadow mode" block below overrides this back.
  process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE = 'enforce';
  state.policyRows = [rootPolicy()];
  state.contactRows = [];
  state.suppressionRows = [];
  state.enrolmentRows = [];
  state.companyRows = [];
  state.duplicateRows = [];
  state.capturedWhere = new Map();
});

it('fixture reaches hot (>=82) before any policy applies — guards H-13 from regressing silently', async () => {
  const { scoreRequirementPriority } = await import('../services/wizmatchRequirementPriority');
  const local = scoreRequirementPriority(requirementPriorityInput);
  expect(local.priority).toBe('hot');
  expect(local.score).toBeGreaterThanOrEqual(82);
});

describe('H-7: the mock captures the where() predicate, not discards it', () => {
  it('resolveCanonicalCompanyEligibility queries wizmatchCompanyPolicies with a real predicate', async () => {
    await resolveCanonicalCompanyEligibility(TENANT_ID, COMPANY_ID);
    const condition = state.capturedWhere.get(wizmatchCompanyPolicies);
    expect(condition).toBeDefined();
    // A real predicate references the tenant/company columns by name; the
    // broken idiom this replaces called `where()` with no argument at all,
    // so `condition` would be `undefined` and this assertion would fail.
    expect(sqlFragments(condition).length).toBeGreaterThan(0);
  });

  // The assertion above only proves "not the no-argument idiom" — the
  // 2026-07-26 re-review showed that deleting `isNull(supersededAt)` or either
  // `eq()` from policyResolver.ts still leaves `sqlFragments(...).length > 0`
  // true, so H-7's stated guarantee ("tenant scoping, company_id,
  // isNull(supersededAt) are no longer untested") was not actually delivered.
  // These name the three columns individually, so dropping any ONE of them
  // fails here.
  it('the captured predicate names tenant_id, company_id AND superseded_at individually (H-7, for real)', async () => {
    await resolveCanonicalCompanyEligibility(TENANT_ID, COMPANY_ID);
    const fragments = sqlFragments(state.capturedWhere.get(wizmatchCompanyPolicies));
    const joined = fragments.join(' ');
    expect(joined).toContain('tenant_id');
    expect(joined).toContain('company_id');
    expect(joined).toContain('superseded_at');
    expect(joined).toContain('is null');
  });
});

describe('canonical resolver agreement — missing root policy (L0 deny)', () => {
  beforeEach(() => {
    state.policyRows = [];
  });

  it('resolveCompanyStatus denies with policy_missing_root', async () => {
    const status = await resolveCompanyStatus(TENANT_ID, COMPANY_ID);
    expect(status.decision).toBe('deny');
    expect(status.reasonCode).toBe('policy_missing_root');
    expect(status.actsOnDecision).toBe(true);
  });

  it('client discovery agrees: forces blocked with a policy_ blocker and a blocked nextAction (H-4)', async () => {
    const result = await scoreClientDiscoveryOpportunityWithPolicy(TENANT_ID, clientDiscoveryInput);
    expect(result.priority).toBe('blocked');
    expect(result.blockers).toContain('policy_policy_missing_root');
    expect(result.nextAction).toBe('blocked');
    expect(result.canonicalDecision).toBe('deny');
  });

  it('requirement priority agrees: forces blocked with a policy_ blocker and a blocked nextAction (H-4)', async () => {
    const result = await scoreRequirementPriorityWithPolicy(TENANT_ID, requirementPriorityInput);
    expect(result.priority).toBe('blocked');
    expect(result.blockers).toContain('policy_policy_missing_root');
    expect(result.nextAction).toBe('blocked');
  });

  it('contact intelligence agrees: forces discovery_blocked with a policy_ hard block', async () => {
    const canonical = await resolveCanonicalCompanyEligibility(TENANT_ID, COMPANY_ID);
    const result = applyCanonicalEligibilityToContactIntelligence(contactIntelligenceResult(), canonical);
    expect(result.companyStatus).toBe('discovery_blocked');
    expect(result.hardBlocks).toContain('policy_policy_missing_root');
  });
});

describe('canonical resolver agreement — non-overridable entire-company block (L1 deny)', () => {
  beforeEach(() => {
    state.policyRows = [rootPolicy({
      outreachEligibility: 'blocked',
      isNonOverridable: true,
      blockClass: 'compliance',
      reasonCode: 'company_removal_request',
    })];
  });

  it('resolveCompanyStatus denies with the company-removal reason code', async () => {
    const status = await resolveCompanyStatus(TENANT_ID, COMPANY_ID);
    expect(status.decision).toBe('deny');
    expect(status.reasonCode).toBe('company_removal_request');
  });

  it('client discovery agrees even though local scoring would allow', async () => {
    const result = await scoreClientDiscoveryOpportunityWithPolicy(TENANT_ID, clientDiscoveryInput);
    expect(result.priority).toBe('blocked');
    expect(result.blockers).toContain('policy_company_removal_request');
    expect(result.nextAction).toBe('blocked');
  });

  it('requirement priority agrees even though local scoring would allow', async () => {
    const result = await scoreRequirementPriorityWithPolicy(TENANT_ID, requirementPriorityInput);
    expect(result.priority).toBe('blocked');
    expect(result.blockers).toContain('policy_company_removal_request');
    expect(result.nextAction).toBe('blocked');
  });

  it('contact intelligence agrees even though local scoring would allow', async () => {
    const canonical = await resolveCanonicalCompanyEligibility(TENANT_ID, COMPANY_ID);
    const result = applyCanonicalEligibilityToContactIntelligence(contactIntelligenceResult(), canonical);
    expect(result.companyStatus).toBe('discovery_blocked');
    expect(result.hardBlocks).toContain('policy_company_removal_request');
  });
});

describe('canonical resolver agreement — needs_review (REVIEW) never lets local scoring promote past watch', () => {
  beforeEach(() => {
    state.policyRows = [rootPolicy({ outreachEligibility: 'needs_review' })];
  });

  it('resolveCompanyStatus returns review', async () => {
    const status = await resolveCompanyStatus(TENANT_ID, COMPANY_ID);
    expect(status.decision).toBe('review');
  });

  it('client discovery caps a locally-hot result to watch', async () => {
    const result = await scoreClientDiscoveryOpportunityWithPolicy(TENANT_ID, clientDiscoveryInput);
    expect(['hot', 'warm']).not.toContain(result.priority);
    expect(result.priority).toBe('watch');
  });

  // H-13 fix: requirementPriorityInput now genuinely scores 'hot' (see the
  // "fixture reaches hot" guard test above), so this cap is exercised for
  // real. Also asserts H-4: nextAction moves in lockstep with priority.
  it('requirement priority caps a genuinely-hot result to watch, folding nextAction too (H-4/H-13)', async () => {
    const result = await scoreRequirementPriorityWithPolicy(TENANT_ID, requirementPriorityInput);
    expect(['hot', 'warm']).not.toContain(result.priority);
    expect(result.priority).toBe('watch');
    expect(result.nextAction).toBe('watch');
    expect(result.canonicalDecision).toBe('review');
  });

  it('contact intelligence downgrades a qualified status to needs_review (H-3: the real value statusForTier produces)', () => {
    const canonical: CanonicalCompanyEligibility = {
      tenantId: TENANT_ID,
      companyId: COMPANY_ID,
      decision: 'review',
      reasonCode: 'policy_review_required',
      blockerCode: null,
      enforcementMode: 'enforce',
      actsOnDecision: true,
    };
    const result = applyCanonicalEligibilityToContactIntelligence(
      { ...contactIntelligenceResult(), companyStatus: 'qualified', hardBlocks: [] },
      canonical,
    );
    expect(result.companyStatus).toBe('needs_review');
  });

  it('does NOT downgrade ready_for_discovery — that value is dead per H-3, qualified is the real one', () => {
    const canonical: CanonicalCompanyEligibility = {
      tenantId: TENANT_ID,
      companyId: COMPANY_ID,
      decision: 'review',
      reasonCode: 'policy_review_required',
      blockerCode: null,
      enforcementMode: 'enforce',
      actsOnDecision: true,
    };
    const result = applyCanonicalEligibilityToContactIntelligence(
      { ...contactIntelligenceResult(), companyStatus: 'ready_for_discovery', hardBlocks: [] },
      canonical,
    );
    expect(result.companyStatus).toBe('ready_for_discovery');
  });
});

describe('canonical resolver agreement — allow never overrides a local hard block', () => {
  it('a canonical allow does not clear the client-discovery non_tech_signal blocker', async () => {
    const status = await resolveCompanyStatus(TENANT_ID, COMPANY_ID);
    expect(status.decision).toBe('allow');
    const result = await scoreClientDiscoveryOpportunityWithPolicy(TENANT_ID, {
      ...clientDiscoveryInput,
      jobTitle: 'Payroll Executive',
      companyIndustry: 'HRMS payroll attendance',
    });
    expect(result.priority).toBe('blocked');
    expect(result.blockers).toContain('non_tech_signal');
    expect(result.blockers).not.toContain('policy_policy_accepts_external_vendors');
  });
});

describe('H-2 regression — a null companyId fails closed, not open', () => {
  it('requirement priority with no companyId is forced blocked, never silently allowed through', async () => {
    // Stated rather than inherited from the file-level beforeEach: this
    // assertion is only correct under `enforce`. Its shadow-mode counterpart
    // (RESIDUAL-C1, below) asserts the opposite, and the pair is the point.
    process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE = 'enforce';
    const result = await scoreRequirementPriorityWithPolicy(TENANT_ID, { ...requirementPriorityInput, companyId: null });
    expect(result.priority).toBe('blocked');
    expect(result.blockers).toContain('missing_company');
    expect(result.nextAction).toBe('blocked');
  });
});

// D-31 — shadow mode must be a true no-op: legacy behavioural output is
// preserved exactly as the pre-PR-5 scorer computed it, even on a canonical
// deny, while the canonical decision is still attached for display. This is
// the regression test for C-1 (PR 5 blocked in shadow mode).
describe('D-31 shadow mode preserves legacy behavioural output (C-1 regression)', () => {
  beforeEach(() => {
    process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE = 'shadow';
  });

  it('resolveCompanyStatus reports actsOnDecision=false for a deny in shadow', async () => {
    state.policyRows = [];
    const status = await resolveCompanyStatus(TENANT_ID, COMPANY_ID);
    expect(status.decision).toBe('deny');
    expect(status.enforcementMode).toBe('shadow');
    expect(status.actsOnDecision).toBe(false);
  });

  it('client discovery keeps its local hot/warm bucket on a canonical deny, but still attaches canonical metadata', async () => {
    state.policyRows = []; // L0 missing-root deny
    const result = await scoreClientDiscoveryOpportunityWithPolicy(TENANT_ID, clientDiscoveryInput);
    // Legacy output unchanged: the local scorer alone determines priority.
    expect(result.priority).not.toBe('blocked');
    expect(result.blockers).not.toContain('policy_policy_missing_root');
    // Canonical metadata is still computed and displayable (D-31).
    expect(result.canonicalDecision).toBe('deny');
    expect(result.canonicalBlockerCode).toBe('policy_policy_missing_root');
  });

  it('requirement priority review-plan input is not force-blocked by policy in shadow (C-1: the 409 must not fire)', async () => {
    state.policyRows = []; // L0 missing-root deny
    const result = await scoreRequirementPriorityWithPolicy(TENANT_ID, requirementPriorityInput);
    expect(result.priority).not.toBe('blocked');
    expect(result.canonicalDecision).toBe('deny');
  });

  // RESIDUAL-C1 (2026-07-26 independent re-review): H-2's first fix forced
  // `blocked`/`nextAction: 'blocked'` on a null companyId UNCONDITIONALLY,
  // never consulting the mode — so a masked-client requirement
  // (`wizmatch_requirements.company_id IS NULL`) 409'd on
  // `POST /requirement-priority/:id/review-plan` while the shipped default
  // mode is `shadow`. That is C-1's defect class through the one path that
  // never reaches `resolveCompanyStatus`/`actsOnDecision`.
  it('a null companyId does NOT force blocked in shadow, but is still reported (RESIDUAL-C1)', async () => {
    const result = await scoreRequirementPriorityWithPolicy(TENANT_ID, {
      ...requirementPriorityInput,
      companyId: null,
    });
    expect(result.priority).not.toBe('blocked');
    expect(result.nextAction).not.toBe('blocked');
    expect(result.blockers).not.toContain('missing_company');
    // Visible without being behavioural — D-31.
    expect(result.canonicalDecision).toBe('deny');
    expect(result.canonicalReasonCode).toBe('missing_company');
  });

  it('the queue fold applies the same null-companyId rule in shadow (RESIDUAL-C1, plural path)', async () => {
    const { rankRequirementPriorityQueueWithPolicy } = await import('../services/wizmatchRequirementPriority');
    const [result] = await rankRequirementPriorityQueueWithPolicy(TENANT_ID, [
      { ...requirementPriorityInput, companyId: null },
    ]);
    expect(result.priority).not.toBe('blocked');
    expect(result.canonicalReasonCode).toBe('missing_company');
  });

  it('an every-other-value-is-shadow spelling variant behaves identically to shadow (§16 rule 3)', async () => {
    process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE = 'Enforce'; // wrong case — must be treated as shadow
    state.policyRows = [];
    const status = await resolveCompanyStatus(TENANT_ID, COMPANY_ID);
    expect(status.enforcementMode).toBe('shadow');
    expect(status.actsOnDecision).toBe(false);
  });
});

// PRD-005 PR 6, M-2 fix — `wizmatchCommandCenter.ts`'s `requirements` array
// was one of two arrays this file's own guard test (wizmatchLegacyEligibilityGuard.test.ts)
// allowlisted as "not migrated yet" — its fetcher didn't even select
// `company_id`, so there was nothing to fold against. This proves the fold
// now genuinely runs end to end: `buildWizmatchCommandCenter` -> the same
// `applyCanonicalEligibilityToPriorityResults` every other migrated caller
// uses -> the real (DB-mocked, not re-implemented) `resolveCompanyStatus`.
describe('M-2 fix — wizmatchCommandCenter.ts requirements are folded through the canonical resolver', () => {
  it('a non-overridable company-removal block forces a requirement to blocked, even though local scoring would score it hot', async () => {
    state.policyRows = [rootPolicy({
      outreachEligibility: 'blocked',
      isNonOverridable: true,
      blockClass: 'compliance',
      reasonCode: 'company_removal_request',
    })];
    const { buildWizmatchCommandCenter, scoreRequirement } = await import('../services/wizmatchCommandCenter');
    const commandCenterRequirement = {
      id: requirementPriorityInput.id,
      companyId: COMPANY_ID,
      title: requirementPriorityInput.title,
      region: requirementPriorityInput.region,
      priority: requirementPriorityInput.priority,
      positions: 3,
      requiredSkills: requirementPriorityInput.requiredSkills,
      status: requirementPriorityInput.status,
      budgetMax: requirementPriorityInput.budgetMax,
    };
    // Guards against a vacuous fixture (same discipline as H-13 above) —
    // proves the fold below is actually exercising the DENY branch, not
    // finding the requirement already 'blocked' by local scoring alone.
    const local = scoreRequirement(commandCenterRequirement);
    expect(local.priority).toBe('hot');

    const result = await buildWizmatchCommandCenter({
      tenantId: TENANT_ID,
      metrics: {
        activeSignals: 0, prioritySignals: 0, availableCandidates: 0, openRequirements: 1,
        reviewReadyCompanies: 0, blockedCompanies: 0, activePlacements: 0, pausedDomains: 0, suppressedContacts: 0,
      },
      contactIntelligence: [],
      signals: [],
      candidates: [],
      requirements: [commandCenterRequirement],
    });

    const folded = result.requirements.find((r) => r.id === requirementPriorityInput.id);
    expect(folded).toBeDefined();
    expect(folded!.priority).toBe('blocked');
    expect(folded!.blockers).toContain('policy_company_removal_request');
    expect((folded as unknown as { canonicalDecision: string }).canonicalDecision).toBe('deny');
  });

  // PR 6 review: this previously asserted the OPPOSITE — that a null-companyId
  // requirement came back with no canonical fields at all. That locked in a
  // fail-OPEN: the Command Center's fetcher LEFT JOINs companies, so a
  // masked-client requirement (`company_id IS NULL`) reached the response as an
  // unqualified `hot`, while the sibling caller
  // (`wizmatchRequirementPriority.ts`'s `withMissingCompanyBlocker`) answered
  // `deny`/`missing_company` for the identical row. Same row, two surfaces,
  // contradictory answers. H-2 in the adapter's own module header requires the
  // fail-closed reading, so the fold now applies it — display-only in shadow,
  // behavioural under `enforce`, per D-31.
  it('a requirement with no companyId fails CLOSED with missing_company metadata, not silently unqualified', async () => {
    state.policyRows = [rootPolicy({ outreachEligibility: 'blocked', isNonOverridable: true, blockClass: 'compliance', reasonCode: 'company_removal_request' })];
    const { buildWizmatchCommandCenter } = await import('../services/wizmatchCommandCenter');
    const result = await buildWizmatchCommandCenter({
      tenantId: TENANT_ID,
      metrics: {
        activeSignals: 0, prioritySignals: 0, availableCandidates: 0, openRequirements: 1,
        reviewReadyCompanies: 0, blockedCompanies: 0, activePlacements: 0, pausedDomains: 0, suppressedContacts: 0,
      },
      contactIntelligence: [],
      signals: [],
      candidates: [],
      requirements: [{
        id: 'masked-req-1',
        companyId: null,
        title: 'Masked client role',
        region: 'india',
        priority: 'urgent',
        positions: 2,
        requiredSkills: ['java'],
        status: 'sheet_ready',
        budgetMax: 100000,
      }],
    });
    const folded = result.requirements.find((r) => r.id === 'masked-req-1') as unknown as {
      canonicalDecision?: string;
      canonicalReasonCode?: string;
      canonicalBlockerCode?: string;
      priority: string;
      blockers: string[];
    };
    expect(folded.canonicalDecision).toBe('deny');
    expect(folded.canonicalReasonCode).toBe('missing_company');
    expect(folded.canonicalBlockerCode).toBe('policy_missing_company');
    // This describe's beforeEach sets `enforce`, so the fold is behavioural here.
    expect(folded.blockers).toContain('missing_company');
    expect(folded.priority).toBe('blocked');
  });

  // D-31 / RESIDUAL-C1: the metadata is always attached, but in SHADOW the fold
  // must not touch the legacy behavioural output — the same rule the singular
  // requirement-priority path already holds.
  it('in shadow, the null-companyId fold is visible but NOT behavioural', async () => {
    const previousMode = process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
    process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE = 'shadow';
    try {
      state.policyRows = [rootPolicy({ outreachEligibility: 'eligible' })];
      const { buildWizmatchCommandCenter } = await import('../services/wizmatchCommandCenter');
      const result = await buildWizmatchCommandCenter({
        tenantId: TENANT_ID,
        metrics: {
          activeSignals: 0, prioritySignals: 0, availableCandidates: 0, openRequirements: 1,
          reviewReadyCompanies: 0, blockedCompanies: 0, activePlacements: 0, pausedDomains: 0, suppressedContacts: 0,
        },
        contactIntelligence: [],
        signals: [],
        candidates: [],
        requirements: [{
          id: 'masked-req-2',
          companyId: null,
          title: 'Masked client role',
          region: 'india',
          priority: 'urgent',
          positions: 2,
          requiredSkills: ['java'],
          status: 'sheet_ready',
          budgetMax: 100000,
        }],
      });
      const folded = result.requirements.find((r) => r.id === 'masked-req-2') as unknown as {
        canonicalDecision?: string;
        blockers: string[];
      };
      // Visible...
      expect(folded.canonicalDecision).toBe('deny');
      // ...but the legacy behavioural output is untouched.
      expect(folded.blockers).not.toContain('missing_company');
    } finally {
      if (previousMode === undefined) delete process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
      else process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE = previousMode;
    }
  });
});
