export type ClientDiscoveryRegion = 'india' | 'us';
export type ClientDiscoveryPriority = 'hot' | 'warm' | 'watch' | 'blocked';

export interface ClientDiscoveryInput {
  id: string;
  jobTitle: string;
  companyId?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  companyIndustry?: string | null;
  companyCountry?: string | null;
  isPrime?: boolean | null;
  primeMsaStatus?: string | null;
  h1bSponsorCount?: number | null;
  source?: string | null;
  location?: string | null;
  status?: string | null;
  signalScore?: number | null;
  daysOpen?: number | null;
  repostCount?: number | null;
  matchedCandidateCount?: number | null;
  activeSignalCount?: number | null;
  positiveReplyCount?: number | null;
  placementCount?: number | null;
  domainStatus?: string | null;
  suppressedCount?: number | null;
  activeDuplicateCount?: number | null;
}

export interface ClientDiscoveryResult {
  id: string;
  companyId: string | null;
  companyName: string;
  companyDomain: string | null;
  jobTitle: string;
  region: ClientDiscoveryRegion;
  source: string | null;
  status: string | null;
  score: number;
  priority: ClientDiscoveryPriority;
  matchedCandidateCount: number;
  componentScores: {
    itTechFit: number;
    signalStrength: number;
    regionPriority: number;
    candidateSupply: number;
    relationshipValue: number;
    safety: number;
  };
  reasons: string[];
  blockers: string[];
  nextAction: 'send_to_contact_intelligence' | 'manual_review' | 'watch' | 'blocked';
}

export const CLIENT_DISCOVERY_GUARDRAILS = {
  paidEnrichment: 'disabled_before_contact_qualification',
  sending: 'manual_review_only',
  sourceMode: 'existing_tables_first',
  scope: 'internal_it_tech_staffing_only',
} as const;

const INDIA_MARKERS = [
  'india',
  'bangalore',
  'bengaluru',
  'hyderabad',
  'pune',
  'chennai',
  'mumbai',
  'delhi',
  'gurgaon',
  'gurugram',
  'noida',
  'kolkata',
  'ahmedabad',
  'kochi',
  'coimbatore',
  'indore',
  'chandigarh',
  'jaipur',
];

const TECH_TERMS = [
  'software',
  'developer',
  'engineer',
  'frontend',
  'backend',
  'full stack',
  'devops',
  'cloud',
  'data',
  'java',
  'python',
  'react',
  'node',
  'qa',
  'automation',
  'security',
  'salesforce',
  'servicenow',
  'sap',
  'ai',
  'ml',
  'product',
  'platform',
  'technology',
  'it staffing',
  'gcc',
  'systems integrator',
];

const NON_TECH_TERMS = [
  'payroll',
  'attendance',
  'hrms',
  'warehouse',
  'driver',
  'hospitality',
  'retail',
  'nurse',
  'doctor',
  'construction',
  'blue collar',
];

function clamp(score: number, max = 100) {
  return Math.max(0, Math.min(max, Math.round(score)));
}

function includesAny(value: string, terms: string[]) {
  const lower = value.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function combinedText(input: ClientDiscoveryInput) {
  return [
    input.jobTitle,
    input.companyName,
    input.companyIndustry,
    input.companyCountry,
    input.location,
    input.source,
  ].filter(Boolean).join(' ');
}

export function detectClientDiscoveryRegion(input: ClientDiscoveryInput): ClientDiscoveryRegion {
  return includesAny(combinedText(input), INDIA_MARKERS) ? 'india' : 'us';
}

export function detectClientDiscoveryHardBlocks(input: ClientDiscoveryInput): string[] {
  const blocks: string[] = [];
  const roleRelevance = classifyWizmatchRoleRelevance({ title: input.jobTitle });
  if (roleRelevance === 'irrelevant' || includesAny(input.jobTitle, NON_TECH_TERMS)) blocks.push('non_tech_signal');
  if ((input.suppressedCount ?? 0) > 0) blocks.push('suppressed_domain');
  if (['paused', 'blacklisted'].includes(input.domainStatus ?? '')) blocks.push('unsafe_domain');
  if ((input.activeDuplicateCount ?? 0) > 0) blocks.push('active_outreach_duplicate');
  if (!input.companyId) blocks.push('missing_company');
  return blocks;
}

function priorityFor(score: number, blockers: string[]): ClientDiscoveryPriority {
  if (blockers.length > 0 || score < 40) return 'blocked';
  if (score >= 80) return 'hot';
  if (score >= 60) return 'warm';
  return 'watch';
}

function nextActionFor(priority: ClientDiscoveryPriority): ClientDiscoveryResult['nextAction'] {
  if (priority === 'hot' || priority === 'warm') return 'send_to_contact_intelligence';
  if (priority === 'watch') return 'watch';
  return 'blocked';
}

export function scoreClientDiscoveryOpportunity(input: ClientDiscoveryInput): ClientDiscoveryResult {
  const reasons: string[] = [];
  const blockers = detectClientDiscoveryHardBlocks(input);
  const text = combinedText(input);
  const roleRelevance = classifyWizmatchRoleRelevance({ title: input.jobTitle });
  const region = detectClientDiscoveryRegion(input);

  const itTechFit = (() => {
    if (blockers.includes('non_tech_signal')) return 0;
    let score = 0;
    if (roleRelevance === 'relevant') {
      score += 20;
      reasons.push('IT/Tech role evidence found in the job title.');
    } else {
      reasons.push('IT/Tech role evidence is missing; company vocabulary was not used as a substitute.');
    }
    const companyText = [input.companyIndustry, input.companyName].filter(Boolean).join(' ');
    if (/staff|vendor|consult|integrator|gcc|technology|software/i.test(companyText)) {
      score += 5;
      reasons.push('Company ecosystem fit is present as separate supporting evidence.');
    }
    return clamp(score, 25);
  })();

  const signalStrength = (() => {
    let score = 0;
    const signalScore = input.signalScore ?? 0;
    if (signalScore >= 8) {
      score += 9;
      reasons.push('Strong existing Wizmatch signal score.');
    } else if (signalScore >= 6) {
      score += 6;
      reasons.push('Usable existing Wizmatch signal score.');
    } else if (signalScore > 0) {
      score += 3;
    }
    if ((input.daysOpen ?? 999) <= 21) score += 4;
    else if ((input.daysOpen ?? 999) <= 45) score += 2;
    if ((input.activeSignalCount ?? 0) >= 3) {
      score += 4;
      reasons.push('Multiple active signals from this company.');
    } else if ((input.activeSignalCount ?? 0) >= 1) {
      score += 2;
    }
    if ((input.repostCount ?? 0) > 0) score += 3;
    return clamp(score, 20);
  })();

  const regionPriority = (() => {
    if (region === 'india') {
      reasons.push('India-first priority applies.');
      return 15;
    }
    if ((input.signalScore ?? 0) >= 8 || input.isPrime || (input.h1bSponsorCount ?? 0) > 0) {
      reasons.push('US opportunity retained because high-value evidence exists.');
      return 10;
    }
    return 5;
  })();

  const candidateSupply = (() => {
    const matched = input.matchedCandidateCount ?? 0;
    if (matched >= 3) {
      reasons.push('Strong matching candidate supply exists.');
      return 15;
    }
    if (matched >= 1) {
      reasons.push('Some matching candidate supply exists.');
      return 9;
    }
    return 0;
  })();

  const relationshipValue = (() => {
    let score = 0;
    if (input.isPrime || input.primeMsaStatus === 'signed') {
      score += 7;
      reasons.push('Prime/MSA relationship memory exists.');
    }
    if ((input.positiveReplyCount ?? 0) > 0) {
      score += 4;
      reasons.push('Prior positive reply history exists.');
    }
    if ((input.placementCount ?? 0) > 0) {
      score += 4;
      reasons.push('Prior placement relationship exists.');
    }
    return clamp(score, 15);
  })();

  const safety = (() => {
    if (blockers.includes('suppressed_domain') || blockers.includes('unsafe_domain')) return 0;
    let score = 7;
    if (!input.domainStatus || ['healthy', 'ok', 'active'].includes(input.domainStatus)) score += 3;
    return clamp(score, 10);
  })();

  for (const block of blockers) {
    if (block === 'non_tech_signal') reasons.push('Blocked: non-tech/HRMS/payroll/attendance language found.');
    if (block === 'suppressed_domain') reasons.push('Blocked: suppression history exists for this domain.');
    if (block === 'unsafe_domain') reasons.push(`Blocked: domain health is ${input.domainStatus}.`);
    if (block === 'active_outreach_duplicate') reasons.push('Blocked: company already has active outreach.');
    if (block === 'missing_company') reasons.push('Blocked: signal is not linked to a company record yet.');
  }

  const rawScore = itTechFit + signalStrength + regionPriority + candidateSupply + relationshipValue + safety;
  const score = blockers.length > 0 ? Math.min(clamp(rawScore), 39) : clamp(rawScore);
  const priority = priorityFor(score, blockers);

  return {
    id: input.id,
    companyId: input.companyId ?? null,
    companyName: input.companyName ?? 'Unknown company',
    companyDomain: input.companyDomain ?? null,
    jobTitle: input.jobTitle,
    region,
    source: input.source ?? null,
    status: input.status ?? null,
    score,
    priority,
    matchedCandidateCount: input.matchedCandidateCount ?? 0,
    componentScores: {
      itTechFit,
      signalStrength,
      regionPriority,
      candidateSupply,
      relationshipValue,
      safety,
    },
    reasons,
    blockers,
    nextAction: nextActionFor(priority),
  };
}

export function rankClientDiscoveryQueue(inputs: ClientDiscoveryInput[]): ClientDiscoveryResult[] {
  return inputs
    .map(scoreClientDiscoveryOpportunity)
    .sort((a, b) => b.score - a.score || b.matchedCandidateCount - a.matchedCandidateCount);
}

export function explainClientDiscoveryScore(result: ClientDiscoveryResult): string {
  if (result.priority === 'blocked') return `Blocked: ${result.blockers.join(', ') || 'score below threshold'}.`;
  return `${result.priority.toUpperCase()} ${result.score}/100: ${result.reasons.slice(0, 3).join(' ')}`;
}

export function selectCompaniesForContactIntelligence(results: ClientDiscoveryResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (!result.companyId || result.blockers.length > 0) return false;
    if (!['hot', 'warm'].includes(result.priority)) return false;
    if (seen.has(result.companyId)) return false;
    seen.add(result.companyId);
    return true;
  });
}
import { classifyWizmatchRoleRelevance } from './wizmatchRoleRelevance';
