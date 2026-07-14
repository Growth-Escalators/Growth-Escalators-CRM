import {
  createDefaultWizmatchContactDiscoveryProviders,
  type WizmatchContactDiscoveryProviders,
  type WizmatchProviderCandidate,
} from './wizmatchContactDiscoveryProviders';
import type {
  CompanyIntelligenceStatus,
  CompanyQualificationTier,
  ContactCandidateStatus,
  ContactIntelligenceRegion,
  DiscoveryRunStatus,
} from './wizmatchContactIntelligence';
import {
  calculateWizmatchProviderCostCents,
  getWizmatchCostGuardConfig,
  type WizmatchCostGuardEvaluation,
  type WizmatchProviderCallCounts,
} from './wizmatchCostGuard';

export interface WizmatchContactDiscoveryConfig {
  paidDiscoveryEnabled: boolean;
  googleFallbackEnabled: boolean;
  // Apollo & Snov are kept in the codebase but OFF by default — Apollo needs a paid
  // plan for email reveal, Snov's free plan blocks the API. Flip on when paid.
  enableApollo: boolean;
  enableSnov: boolean;
  maxPaidDiscoveryPerCompany: number;
  maxContactCandidatesShown: number;
  rediscoveryCooldownDays: number;
  maxProviderCallsPerRun: {
    apollo: number;
    snov: number;
    reacher: number;
    googleFallback: number;
  };
}

export interface WizmatchContactDiscoveryInput {
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  targetRegion: ContactIntelligenceRegion;
  qualificationTier: CompanyQualificationTier;
  qualificationScore: number;
  companyStatus: CompanyIntelligenceStatus;
  reviewStatus?: string | null;
  hardBlocks?: string[];
  lastDiscoveredAt?: string | Date | null;
  nextRefreshAt?: string | Date | null;
  paidRunsInCooldown?: number;
}

export interface WizmatchContactDiscoveryPreview {
  companyId: string;
  eligible: boolean;
  status: 'preview_only' | 'ready_for_manual_paid_discovery' | 'paid_discovery_disabled' | 'blocked_by_cap';
  estimatedCostCents: number;
  providerOrder: string[];
  capStatus: {
    paidDiscoveryEnabled: boolean;
    googleFallbackEnabled: boolean;
    maxPaidDiscoveryPerCompany: number;
    paidRunsInCooldown: number;
    maxContactCandidatesShown: number;
    rediscoveryCooldownDays: number;
    cooldownUntil: string | null;
  };
  costGuard: WizmatchCostGuardEvaluation | null;
  blockedReasons: string[];
  notes: string[];
}

export interface WizmatchDiscoveryCandidate extends WizmatchProviderCandidate {
  status: ContactCandidateStatus;
}

export interface WizmatchContactDiscoveryRunResult {
  preview: WizmatchContactDiscoveryPreview;
  status: DiscoveryRunStatus;
  candidates: WizmatchDiscoveryCandidate[];
  providerCalls: Record<string, number>;
  costCents: number;
  errors: string[];
}

export interface WizmatchContactDiscoveryExecutionOptions {
  costGuardToken?: string | null;
}

function boolEnv(value: string | undefined, defaultValue = false) {
  if (value == null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function intEnv(value: string | undefined, defaultValue: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : defaultValue;
}

export function getWizmatchContactDiscoveryConfig(env: NodeJS.ProcessEnv = process.env): WizmatchContactDiscoveryConfig {
  return {
    paidDiscoveryEnabled: boolEnv(env.WIZMATCH_PAID_DISCOVERY_ENABLED, false),
    googleFallbackEnabled: boolEnv(env.WIZMATCH_GOOGLE_FALLBACK_ENABLED, false),
    enableApollo: boolEnv(env.WIZMATCH_ENABLE_APOLLO, false),
    enableSnov: boolEnv(env.WIZMATCH_ENABLE_SNOV, false),
    maxPaidDiscoveryPerCompany: intEnv(env.WIZMATCH_MAX_PAID_DISCOVERY_PER_COMPANY, 1),
    maxContactCandidatesShown: intEnv(env.WIZMATCH_MAX_CONTACT_CANDIDATES_SHOWN, 3),
    rediscoveryCooldownDays: intEnv(env.WIZMATCH_DISCOVERY_COOLDOWN_DAYS, 30),
    maxProviderCallsPerRun: {
      apollo: 1,
      snov: 1,
      reacher: 3,
      googleFallback: 1,
    },
  };
}

export function isWizmatchXrayCandidateSourcingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const config = getWizmatchContactDiscoveryConfig(env);
  return config.paidDiscoveryEnabled && config.googleFallbackEnabled;
}

function iso(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Cooldown gates paid discovery *only* by real paid runs. `nextRefreshAt` is a
// snapshot-refresh scheduler set to NOW+30d by persistContactIntelligenceSnapshot
// on every qualification pass — using it here would lock every freshly-seeded
// company out of paid discovery for 30 days despite zero paid runs having happened.
function inCooldown(input: WizmatchContactDiscoveryInput, config: WizmatchContactDiscoveryConfig) {
  return (input.paidRunsInCooldown ?? 0) >= config.maxPaidDiscoveryPerCompany;
}

export function buildWizmatchContactDiscoveryPreview(
  input: WizmatchContactDiscoveryInput,
  config: WizmatchContactDiscoveryConfig = getWizmatchContactDiscoveryConfig(),
  costGuard: WizmatchCostGuardEvaluation | null = null,
): WizmatchContactDiscoveryPreview {
  const blockedReasons: string[] = [];
  const providerOrder = [
    'internal_crm_reuse',
    'website_manual_pattern',
    ...(config.enableApollo ? ['apollo'] : []),
    ...(config.enableSnov ? ['snov'] : []),
    'reacher_verification',
    ...(config.googleFallbackEnabled ? ['google_fallback'] : []),
  ];

  if (!config.paidDiscoveryEnabled) blockedReasons.push('Paid discovery is disabled by WIZMATCH_PAID_DISCOVERY_ENABLED.');
  if (!input.companyDomain) blockedReasons.push('Company has no usable domain for provider discovery.');
  if (['rejected', 'suppressed', 'cooldown'].includes(input.companyStatus)) blockedReasons.push(`Company status is ${input.companyStatus}.`);
  if ((input.hardBlocks || []).length > 0) blockedReasons.push(`Hard block(s): ${(input.hardBlocks || []).join(', ')}.`);
  if (input.qualificationTier === 'Reject' || input.qualificationTier === 'C') blockedReasons.push(`Tier ${input.qualificationTier} companies are not eligible for paid discovery.`);
  if (input.qualificationTier === 'B' && input.reviewStatus !== 'approved') blockedReasons.push('Tier B paid discovery requires manual company approval first.');
  if (inCooldown(input, config)) blockedReasons.push('Company is inside the rediscovery cooldown/cap window.');
  if (costGuard && !costGuard.allowed) blockedReasons.push(...costGuard.blockReasons);

  const eligible = blockedReasons.length === 0;
  const estimatedProviderCalls: WizmatchProviderCallCounts = {
    apollo: config.enableApollo ? config.maxProviderCallsPerRun.apollo : 0,
    snov: config.enableSnov ? config.maxProviderCallsPerRun.snov : 0,
    reacher: config.maxProviderCallsPerRun.reacher,
    googleFallback: config.googleFallbackEnabled ? config.maxProviderCallsPerRun.googleFallback : 0,
  };
  const estimatedCostCents = costGuard
    ? costGuard.estimatedCostCents
    : calculateWizmatchProviderCostCents(estimatedProviderCalls, getWizmatchCostGuardConfig());

  return {
    companyId: input.companyId,
    eligible,
    status: eligible
      ? 'ready_for_manual_paid_discovery'
      : config.paidDiscoveryEnabled
        ? 'blocked_by_cap'
        : 'paid_discovery_disabled',
    estimatedCostCents,
    providerOrder,
    capStatus: {
      paidDiscoveryEnabled: config.paidDiscoveryEnabled,
      googleFallbackEnabled: config.googleFallbackEnabled,
      maxPaidDiscoveryPerCompany: config.maxPaidDiscoveryPerCompany,
      paidRunsInCooldown: input.paidRunsInCooldown ?? 0,
      maxContactCandidatesShown: config.maxContactCandidatesShown,
      rediscoveryCooldownDays: config.rediscoveryCooldownDays,
      cooldownUntil: iso(input.nextRefreshAt),
    },
    costGuard,
    blockedReasons,
    notes: [
      'Preview does not call Apollo, Snov, Reacher, Google, or any paid provider.',
      'Discovery only creates reviewable contact candidates; it never sends outreach.',
      'Human review remains required before any contact can be used for outreach.',
    ],
  };
}

function dedupe(candidates: WizmatchProviderCandidate[]) {
  const seen = new Set<string>();
  const output: WizmatchProviderCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.email?.toLowerCase() || candidate.linkedinUrl?.toLowerCase() || `${candidate.name.toLowerCase()}::${candidate.title || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(candidate);
  }
  return output;
}

async function verifyCandidates(
  candidates: WizmatchProviderCandidate[],
  providers: WizmatchContactDiscoveryProviders,
  config: WizmatchContactDiscoveryConfig,
  providerCalls: Record<string, number>,
) {
  const verified: WizmatchDiscoveryCandidate[] = [];
  for (const candidate of candidates.slice(0, config.maxContactCandidatesShown)) {
    // The free website/pattern provider already verified + tiered its candidates
    // (and knows about catch-all / Google-Microsoft SMTP unreliability). Re-verifying
    // here would waste a probe and collapse that nuance, so pass it through as-is.
    if (candidate.raw?.verificationDone === true) {
      verified.push({
        ...candidate,
        status: candidate.deliverabilityStatus === 'invalid' ? 'stale' : 'needs_review',
      });
      continue;
    }

    let deliverabilityStatus = candidate.deliverabilityStatus;
    if (candidate.email && providerCalls.reacher < config.maxProviderCallsPerRun.reacher) {
      providerCalls.reacher += 1;
      const verification = await providers.reacherVerify(candidate.email);
      if (verification === 'verified') deliverabilityStatus = 'verified';
      if (verification === 'invalid') deliverabilityStatus = 'invalid';
    }
    verified.push({
      ...candidate,
      deliverabilityStatus,
      status: deliverabilityStatus === 'invalid' ? 'stale' : 'needs_review',
      confidenceScore: deliverabilityStatus === 'verified' ? Math.max(candidate.confidenceScore, 8) : candidate.confidenceScore,
      reasons: deliverabilityStatus === 'invalid'
        ? [...candidate.reasons, 'Reacher/email verification rejected this address.']
        : deliverabilityStatus === 'verified'
          ? [...candidate.reasons, 'Reacher/email verification accepted this address.']
          : candidate.reasons,
    });
  }
  return verified;
}

export async function executeWizmatchContactDiscovery(
  input: WizmatchContactDiscoveryInput,
  providers: WizmatchContactDiscoveryProviders = createDefaultWizmatchContactDiscoveryProviders(),
  config: WizmatchContactDiscoveryConfig = getWizmatchContactDiscoveryConfig(),
  options: WizmatchContactDiscoveryExecutionOptions = {},
): Promise<WizmatchContactDiscoveryRunResult> {
  const preview = buildWizmatchContactDiscoveryPreview(input, config);
  const providerCalls = { apollo: 0, snov: 0, reacher: 0, googleFallback: 0 };
  const errors: string[] = [];
  if (!preview.eligible || !input.companyDomain) {
    return { preview, status: 'blocked_by_cap', candidates: [], providerCalls, costCents: 0, errors };
  }
  if (!options.costGuardToken) {
    return {
      preview,
      status: 'blocked_by_cap',
      candidates: [],
      providerCalls,
      costCents: 0,
      errors: ['Cost guard token is required before provider discovery can run.'],
    };
  }

  const companyInput = {
    companyName: input.companyName,
    domain: input.companyDomain,
    targetRegion: input.targetRegion,
  };

  let rawCandidates: WizmatchProviderCandidate[] = [];

  // Rung 1 (FREE): scrape PUBLISHED emails from careers/contact pages, classified by team.
  try {
    rawCandidates = await providers.websitePatternSearch(companyInput);
  } catch (error) {
    errors.push(`website_manual_pattern: ${error instanceof Error ? error.message : 'provider failed'}`);
  }

  // Did the website give us a genuinely useful (role-relevant) contact? A generic
  // info@/hello@ does NOT count — we still want to find a named hiring person.
  const hasRoleRelevant = rawCandidates.some(
    (c) => typeof c.raw?.roleCategory === 'string' && c.raw.roleCategory !== 'generic',
  );

  // Rung 2 (~₹1): named-people search (Serper → Talent/HR/Hiring Mgr/Vendor → guess+verify).
  // Runs unless we already have a role-relevant published inbox, so a generic guess never
  // blocks us from finding the right person.
  if (config.googleFallbackEnabled && !hasRoleRelevant) {
    try {
      providerCalls.googleFallback = 1;
      const named = await providers.googleFallbackSearch(companyInput);
      rawCandidates = [...rawCandidates, ...named];
    } catch (error) {
      errors.push(`google_fallback: ${error instanceof Error ? error.message : 'provider failed'}`);
    }
  }

  // Rung 3 (PAID, off by default): Apollo. Only if nothing found at all. Gated by WIZMATCH_ENABLE_APOLLO.
  if (rawCandidates.length === 0 && config.enableApollo) {
    try {
      providerCalls.apollo = 1;
      rawCandidates = await providers.apolloPeopleSearch(companyInput);
    } catch (error) {
      errors.push(`apollo: ${error instanceof Error ? error.message : 'provider failed'}`);
    }
  }

  // Rung 4 (PAID, off by default): Snov. Only if still nothing. Gated by WIZMATCH_ENABLE_SNOV.
  if (rawCandidates.length === 0 && config.enableSnov) {
    try {
      providerCalls.snov = 1;
      rawCandidates = await providers.snovDomainSearch(companyInput);
    } catch (error) {
      errors.push(`snov: ${error instanceof Error ? error.message : 'provider failed'}`);
    }
  }

  // Rung 5 (FREE, last resort): generic mailbox guesses (info@/hello@) only if nothing else worked.
  if (rawCandidates.length === 0) {
    try {
      rawCandidates = await providers.genericGuessSearch(companyInput);
    } catch (error) {
      errors.push(`generic_guess: ${error instanceof Error ? error.message : 'provider failed'}`);
    }
  }

  const candidates = await verifyCandidates(
    dedupe(rawCandidates)
      .sort((a, b) => b.rankingScore - a.rankingScore) // named recruiter > careers@ > hr@ > generic
      .slice(0, config.maxContactCandidatesShown),
    providers,
    config,
    providerCalls,
  );
  const costCents = calculateWizmatchProviderCostCents(providerCalls);
  const usable = candidates.some((candidate) => candidate.status === 'needs_review');
  const status: DiscoveryRunStatus = usable ? 'succeeded' : candidates.length > 0 || errors.length > 0 ? 'partial' : 'failed';

  return { preview, status, candidates, providerCalls, costCents, errors };
}
