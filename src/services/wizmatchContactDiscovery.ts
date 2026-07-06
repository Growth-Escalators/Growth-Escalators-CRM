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

function iso(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function inCooldown(input: WizmatchContactDiscoveryInput, config: WizmatchContactDiscoveryConfig) {
  if ((input.paidRunsInCooldown ?? 0) >= config.maxPaidDiscoveryPerCompany) return true;
  const nextRefresh = input.nextRefreshAt ? new Date(input.nextRefreshAt) : null;
  return Boolean(nextRefresh && !Number.isNaN(nextRefresh.getTime()) && nextRefresh > new Date());
}

export function buildWizmatchContactDiscoveryPreview(
  input: WizmatchContactDiscoveryInput,
  config: WizmatchContactDiscoveryConfig = getWizmatchContactDiscoveryConfig(),
  costGuard: WizmatchCostGuardEvaluation | null = null,
): WizmatchContactDiscoveryPreview {
  const blockedReasons: string[] = [];
  const providerOrder = [
    'internal_crm_reuse',
    'company_metadata',
    'website_manual_pattern',
    'apollo',
    'snov',
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
    apollo: config.maxProviderCallsPerRun.apollo,
    snov: config.maxProviderCallsPerRun.snov,
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

  let rawCandidates: WizmatchProviderCandidate[] = [];
  try {
    providerCalls.apollo = 1;
    rawCandidates = await providers.apolloPeopleSearch({
      companyName: input.companyName,
      domain: input.companyDomain,
      targetRegion: input.targetRegion,
    });
  } catch (error) {
    errors.push(`apollo: ${error instanceof Error ? error.message : 'provider failed'}`);
  }

  if (rawCandidates.length === 0) {
    try {
      providerCalls.snov = 1;
      rawCandidates = await providers.snovDomainSearch({
        companyName: input.companyName,
        domain: input.companyDomain,
        targetRegion: input.targetRegion,
      });
    } catch (error) {
      errors.push(`snov: ${error instanceof Error ? error.message : 'provider failed'}`);
    }
  }

  if (rawCandidates.length === 0 && config.googleFallbackEnabled) {
    try {
      providerCalls.googleFallback = 1;
      rawCandidates = await providers.googleFallbackSearch({
        companyName: input.companyName,
        domain: input.companyDomain,
        targetRegion: input.targetRegion,
      });
    } catch (error) {
      errors.push(`google_fallback: ${error instanceof Error ? error.message : 'provider failed'}`);
    }
  }

  const candidates = await verifyCandidates(
    dedupe(rawCandidates)
      .sort((a, b) => b.rankingScore - a.rankingScore)
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
