import { describe, expect, it, vi } from 'vitest';
import {
  buildWizmatchContactDiscoveryPreview,
  executeWizmatchContactDiscovery,
  getWizmatchContactDiscoveryConfig,
  type WizmatchContactDiscoveryInput,
} from '../services/wizmatchContactDiscovery';
import type { WizmatchContactDiscoveryProviders, WizmatchProviderCandidate } from '../services/wizmatchContactDiscoveryProviders';

function baseInput(overrides: Partial<WizmatchContactDiscoveryInput> = {}): WizmatchContactDiscoveryInput {
  return {
    companyId: 'company-1',
    companyName: 'Bengaluru Cloud Staffing',
    companyDomain: 'example.in',
    targetRegion: 'india',
    qualificationTier: 'A',
    qualificationScore: 91,
    companyStatus: 'qualified',
    reviewStatus: 'approved',
    paidRunsInCooldown: 0,
    ...overrides,
  };
}

function enabledConfig(overrides = {}) {
  return {
    ...getWizmatchContactDiscoveryConfig({
      WIZMATCH_PAID_DISCOVERY_ENABLED: 'true',
      WIZMATCH_GOOGLE_FALLBACK_ENABLED: 'true',
      // Paid providers explicitly enabled here so the legacy Apollo/Snov tests still exercise them;
      // the production default keeps both off (free-first).
      WIZMATCH_ENABLE_APOLLO: 'true',
      WIZMATCH_ENABLE_SNOV: 'true',
      WIZMATCH_MAX_PAID_DISCOVERY_PER_COMPANY: '1',
      WIZMATCH_DISCOVERY_COOLDOWN_DAYS: '30',
    } as NodeJS.ProcessEnv),
    ...overrides,
  };
}

function freeFirstConfig(overrides = {}) {
  // Production default: paid discovery gate open, but Apollo/Snov OFF.
  return {
    ...getWizmatchContactDiscoveryConfig({
      WIZMATCH_PAID_DISCOVERY_ENABLED: 'true',
      WIZMATCH_GOOGLE_FALLBACK_ENABLED: 'true',
      WIZMATCH_MAX_PAID_DISCOVERY_PER_COMPANY: '1',
      WIZMATCH_DISCOVERY_COOLDOWN_DAYS: '30',
    } as NodeJS.ProcessEnv),
    ...overrides,
  };
}

function providers(overrides: Partial<WizmatchContactDiscoveryProviders> = {}): WizmatchContactDiscoveryProviders {
  return {
    websitePatternSearch: vi.fn(async () => []),
    apolloPeopleSearch: vi.fn(async () => []),
    snovDomainSearch: vi.fn(async () => []),
    reacherVerify: vi.fn(async () => 'unknown' as const),
    googleFallbackSearch: vi.fn(async () => []),
    ...overrides,
  };
}

function candidate(overrides: Partial<WizmatchProviderCandidate>): WizmatchProviderCandidate {
  return {
    name: 'Demo Contact',
    title: 'Vendor Manager',
    email: 'demo@example.in',
    linkedinUrl: null,
    source: 'apollo',
    sourceUrl: null,
    deliverabilityStatus: 'unverified',
    confidenceScore: 6,
    rankingScore: 80,
    costCents: 10,
    reasons: ['fixture'],
    ...overrides,
  };
}

describe('Wizmatch Contact Discovery Phase 3', () => {
  it('allows Tier A company discovery preview when paid discovery is enabled', () => {
    const preview = buildWizmatchContactDiscoveryPreview(baseInput(), enabledConfig());

    expect(preview.eligible).toBe(true);
    expect(preview.status).toBe('ready_for_manual_paid_discovery');
    expect(preview.providerOrder).toContain('apollo');
    expect(preview.providerOrder).toContain('google_fallback');
  });

  it('requires manual approval for Tier B paid discovery', () => {
    const preview = buildWizmatchContactDiscoveryPreview(baseInput({ qualificationTier: 'B', reviewStatus: 'needs_review' }), enabledConfig());

    expect(preview.eligible).toBe(false);
    expect(preview.blockedReasons.join(' ')).toContain('Tier B paid discovery requires manual company approval');
  });

  it('blocks Tier C, rejected, suppressed, cooldown, missing-domain, disabled, and cooldown states', () => {
    expect(buildWizmatchContactDiscoveryPreview(baseInput({ qualificationTier: 'C' }), enabledConfig()).eligible).toBe(false);
    expect(buildWizmatchContactDiscoveryPreview(baseInput({ companyStatus: 'rejected' }), enabledConfig()).eligible).toBe(false);
    expect(buildWizmatchContactDiscoveryPreview(baseInput({ companyStatus: 'suppressed' }), enabledConfig()).eligible).toBe(false);
    expect(buildWizmatchContactDiscoveryPreview(baseInput({ companyStatus: 'cooldown' }), enabledConfig()).eligible).toBe(false);
    expect(buildWizmatchContactDiscoveryPreview(baseInput({ companyDomain: null }), enabledConfig()).eligible).toBe(false);
    expect(buildWizmatchContactDiscoveryPreview(baseInput(), getWizmatchContactDiscoveryConfig({} as NodeJS.ProcessEnv)).status).toBe('paid_discovery_disabled');
    expect(buildWizmatchContactDiscoveryPreview(baseInput({ paidRunsInCooldown: 1 }), enabledConfig()).blockedReasons.join(' ')).toContain('cooldown');
  });

  it('does NOT block paid discovery just because nextRefreshAt is in the future (snapshot always sets it to NOW+30d)', () => {
    // Regression: a freshly-seeded company has nextRefreshAt = NOW+30d immediately
    // after persistContactIntelligenceSnapshot. Without this fix, that alone
    // marked the company as "in cooldown" and blocked paid discovery for 30 days
    // even though zero paid runs had happened.
    const futureRefresh = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const preview = buildWizmatchContactDiscoveryPreview(
      baseInput({ nextRefreshAt: futureRefresh, paidRunsInCooldown: 0 }),
      enabledConfig(),
    );
    expect(preview.eligible).toBe(true);
    expect(preview.blockedReasons.join(' ')).not.toContain('cooldown');
  });

  it('uses Apollo first and saves max 3 deduped candidates', async () => {
    const mockProviders = providers({
      apolloPeopleSearch: vi.fn(async () => [
        candidate({ name: 'Asha Rao', title: 'Head of Talent', email: 'asha@example.in', rankingScore: 93, reasons: ['apollo'] }),
        candidate({ name: 'Asha Rao', title: 'Head of Talent', email: 'asha@example.in', rankingScore: 92, reasons: ['duplicate'] }),
        candidate({ name: 'Ravi Mehta', title: 'Engineering Manager', email: 'ravi@example.in', rankingScore: 88, reasons: ['apollo'] }),
        candidate({ name: 'Nisha Jain', title: 'Vendor Manager', email: 'nisha@example.in', rankingScore: 86, reasons: ['apollo'] }),
        candidate({ name: 'Extra Person', title: 'Recruiter', email: 'extra@example.in', rankingScore: 80, reasons: ['apollo'] }),
      ]),
      reacherVerify: vi.fn(async () => 'verified' as const),
    });

    const result = await executeWizmatchContactDiscovery(baseInput(), mockProviders, enabledConfig(), { costGuardToken: 'guard-token' });

    expect(result.status).toBe('succeeded');
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0].deliverabilityStatus).toBe('verified');
    expect(mockProviders.snovDomainSearch).not.toHaveBeenCalled();
    expect(mockProviders.googleFallbackSearch).not.toHaveBeenCalled();
  });

  it('falls back from Apollo to Snov, then Google only after provider paths return no contacts', async () => {
    const mockProviders = providers({
      snovDomainSearch: vi.fn(async () => [
        candidate({ name: 'Snov Contact', source: 'snov', email: 'vendor@example.in', costCents: 5, reasons: ['snov'] }),
      ]),
    });
    const snovResult = await executeWizmatchContactDiscovery(baseInput(), mockProviders, enabledConfig(), { costGuardToken: 'guard-token' });
    expect(snovResult.candidates[0].source).toBe('snov');
    expect(mockProviders.googleFallbackSearch).not.toHaveBeenCalled();

    const googleProviders = providers({
      googleFallbackSearch: vi.fn(async () => [
        candidate({ name: 'LinkedIn Contact', title: 'Public profile match', email: null, linkedinUrl: 'https://linkedin.com/in/demo', source: 'google_fallback', sourceUrl: 'https://linkedin.com/in/demo', deliverabilityStatus: 'unknown', confidenceScore: 3, rankingScore: 58, costCents: 2, reasons: ['google'] }),
      ]),
    });
    const googleResult = await executeWizmatchContactDiscovery(baseInput(), googleProviders, enabledConfig(), { costGuardToken: 'guard-token' });
    expect(googleResult.candidates[0].source).toBe('google_fallback');
  });

  it('marks invalid Reacher emails stale and reports partial when no usable candidate remains', async () => {
    const mockProviders = providers({
      apolloPeopleSearch: vi.fn(async () => [
        candidate({ name: 'Bad Email', title: 'Recruiting Lead', email: 'bad@example.in', reasons: ['apollo'] }),
      ]),
      reacherVerify: vi.fn(async () => 'invalid' as const),
    });

    const result = await executeWizmatchContactDiscovery(baseInput(), mockProviders, enabledConfig(), { costGuardToken: 'guard-token' });

    expect(result.status).toBe('partial');
    expect(result.candidates[0].status).toBe('stale');
    expect(result.candidates[0].deliverabilityStatus).toBe('invalid');
  });

  it('turns provider errors into partial/failed discovery results instead of throwing', async () => {
    const mockProviders = providers({
      apolloPeopleSearch: vi.fn(async () => { throw new Error('apollo down'); }),
      snovDomainSearch: vi.fn(async () => { throw new Error('snov down'); }),
      googleFallbackSearch: vi.fn(async () => []),
    });

    const result = await executeWizmatchContactDiscovery(baseInput(), mockProviders, enabledConfig(), { costGuardToken: 'guard-token' });

    expect(result.status).toBe('partial');
    expect(result.errors.join(' ')).toContain('apollo down');
    expect(result.errors.join(' ')).toContain('snov down');
  });

  it('does not call providers without a cost guard token', async () => {
    const mockProviders = providers({
      apolloPeopleSearch: vi.fn(async () => [
        candidate({ name: 'Asha Rao', title: 'Head of Talent', email: 'asha@example.in' }),
      ]),
    });

    const result = await executeWizmatchContactDiscovery(baseInput(), mockProviders, enabledConfig());

    expect(result.status).toBe('blocked_by_cap');
    expect(result.errors.join(' ')).toContain('Cost guard token is required');
    expect(mockProviders.apolloPeopleSearch).not.toHaveBeenCalled();
  });

  it('runs the FREE website step first and short-circuits paid providers when it finds a contact', async () => {
    const mockProviders = providers({
      websitePatternSearch: vi.fn(async () => [
        candidate({
          name: 'Careers Team',
          title: 'Company inbox (careers)',
          email: 'careers@example.in',
          source: 'website_manual_pattern',
          deliverabilityStatus: 'unverified',
          confidenceScore: 8,
          rankingScore: 78,
          costCents: 0,
          reasons: ['Published role inbox scraped from the company website — safe to contact.'],
          raw: { confidenceTier: 'high', roleCategory: 'role_inbox', mxProvider: 'other', catchAll: false, verificationDone: true },
        }),
      ]),
    });

    const result = await executeWizmatchContactDiscovery(baseInput(), mockProviders, enabledConfig(), { costGuardToken: 'guard-token' });

    expect(result.status).toBe('succeeded');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].raw?.confidenceTier).toBe('high');
    // The website provider already tiered/verified it, so it is NOT re-verified via Reacher.
    expect(result.candidates[0].deliverabilityStatus).toBe('unverified');
    expect(mockProviders.apolloPeopleSearch).not.toHaveBeenCalled();
    expect(mockProviders.snovDomainSearch).not.toHaveBeenCalled();
    expect(mockProviders.reacherVerify).not.toHaveBeenCalled();
    expect(result.costCents).toBe(0);
  });

  it('does NOT call Apollo or Snov when they are disabled (free-first production default)', async () => {
    const mockProviders = providers(); // website returns [] by default
    const result = await executeWizmatchContactDiscovery(baseInput(), mockProviders, freeFirstConfig(), { costGuardToken: 'guard-token' });

    expect(mockProviders.websitePatternSearch).toHaveBeenCalledTimes(1);
    expect(mockProviders.apolloPeopleSearch).not.toHaveBeenCalled();
    expect(mockProviders.snovDomainSearch).not.toHaveBeenCalled();
    // Serper fallback IS enabled in the free-first default, so it is allowed to run.
    expect(mockProviders.googleFallbackSearch).toHaveBeenCalledTimes(1);
  });

  it('preview provider order is free-first and omits disabled paid providers', () => {
    const freeFirst = buildWizmatchContactDiscoveryPreview(baseInput(), freeFirstConfig());
    expect(freeFirst.providerOrder[0]).toBe('internal_crm_reuse');
    expect(freeFirst.providerOrder).toContain('website_manual_pattern');
    expect(freeFirst.providerOrder).not.toContain('apollo');
    expect(freeFirst.providerOrder).not.toContain('snov');
    expect(freeFirst.providerOrder).toContain('google_fallback');
  });
});
