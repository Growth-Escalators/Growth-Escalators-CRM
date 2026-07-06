export type ContactIntelligenceRegion = 'india' | 'us';
export type CompanyQualificationTier = 'A' | 'B' | 'C' | 'Reject';
export type CompanyIntelligenceStatus =
  | 'new'
  | 'qualified'
  | 'needs_review'
  | 'ready_for_discovery'
  | 'discovery_blocked'
  | 'discovered'
  | 'rejected'
  | 'suppressed'
  | 'cooldown';
export type ContactCandidateStatus =
  | 'new'
  | 'needs_review'
  | 'approved'
  | 'rejected'
  | 'do_not_contact'
  | 'linked_to_crm'
  | 'stale';
export type DiscoveryRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'skipped'
  | 'blocked_by_cap';
export type ContactIntelligenceReviewAction =
  | 'approve_company'
  | 'reject_company'
  | 'watchlist_company'
  | 'request_internal_reuse'
  | 'request_paid_discovery'
  | 'approve_contact'
  | 'reject_contact'
  | 'mark_do_not_contact';
export type ContactIntelligenceReviewEntity = 'company' | 'contact_candidate' | 'discovery_run';

export const CONTACT_INTELLIGENCE_PHASE1_CAPS = {
  paidDiscoveryEnabled: false,
  maxPaidDiscoveryPerCompany: 0,
  maxContactCandidatesShown: 3,
  rediscoveryCooldownDays: 30,
} as const;

export interface InternalContactCandidateInput {
  id: string;
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  verified?: boolean | null;
  doNotContact?: boolean | null;
  source?: string | null;
  relationshipSignals?: string[];
}

export interface ContactCandidateRecommendation {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  source: string;
  status: ContactCandidateStatus;
  rankingScore: number;
  relationshipScore: number;
  confidenceScore: number;
  reasons: string[];
}

export interface ContactIntelligenceInput {
  company: {
    id: string;
    name: string;
    domain?: string | null;
    country?: string | null;
    industry?: string | null;
    isPrime?: boolean | null;
    primeMsaStatus?: string | null;
    h1bSponsorCount?: number | null;
  };
  signal?: {
    id?: string | null;
    jobTitle?: string | null;
    keywords?: string[] | null;
    location?: string | null;
    source?: string | null;
    score?: number | null;
    daysOpen?: number | null;
    status?: string | null;
  } | null;
  candidateSupply?: {
    matchedCandidateCount?: number | null;
    availableCandidateCount?: number | null;
  } | null;
  relationships?: {
    knownContactCount?: number | null;
    positiveReplyCount?: number | null;
    placementCount?: number | null;
    negativeReplyCount?: number | null;
    isPrime?: boolean | null;
    hasSignedMsa?: boolean | null;
  } | null;
  safety?: {
    suppressedCount?: number | null;
    hasDoNotContact?: boolean | null;
    domainStatus?: string | null;
    activeDuplicateCount?: number | null;
    inCooldown?: boolean | null;
  } | null;
  internalContacts?: InternalContactCandidateInput[];
}

export interface ContactIntelligenceResult {
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  targetRegion: ContactIntelligenceRegion;
  qualificationTier: CompanyQualificationTier;
  qualificationScore: number;
  companyStatus: CompanyIntelligenceStatus;
  discoveryRunStatus: DiscoveryRunStatus;
  componentScores: {
    itTechFit: number;
    signalQuality: number;
    regionPriority: number;
    candidateSupply: number;
    relationshipValue: number;
    safetyAndDeliverability: number;
  };
  hardBlocks: string[];
  reasons: string[];
  costControls: typeof CONTACT_INTELLIGENCE_PHASE1_CAPS;
  contactCandidates: ContactCandidateRecommendation[];
}

export interface ContactIntelligenceReviewActionInput {
  entity: ContactIntelligenceReviewEntity;
  action: ContactIntelligenceReviewAction;
  currentCompanyStatus?: CompanyIntelligenceStatus;
  currentContactStatus?: ContactCandidateStatus;
  currentDiscoveryStatus?: DiscoveryRunStatus;
}

export interface ContactIntelligenceReviewActionResult {
  allowed: boolean;
  action: ContactIntelligenceReviewAction;
  entity: ContactIntelligenceReviewEntity;
  nextCompanyStatus?: CompanyIntelligenceStatus;
  nextContactStatus?: ContactCandidateStatus;
  nextDiscoveryStatus?: DiscoveryRunStatus;
  requiresManualApproval: boolean;
  reasons: string[];
}

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
  'full stack',
  'frontend',
  'backend',
  'devops',
  'cloud',
  'data',
  'python',
  'java',
  'react',
  'node',
  'qa',
  'automation',
  'cyber',
  'security',
  'sap',
  'salesforce',
  'servicenow',
  'ai',
  'machine learning',
  'ml',
  'erp',
  'platform',
  'product',
];

const NON_TECH_TERMS = [
  'payroll',
  'attendance',
  'hrms',
  'blue collar',
  'retail',
  'hospitality',
  'construction',
  'warehouse',
  'driver',
  'nurse',
  'doctor',
];

const DECISION_MAKER_TERMS = [
  'hiring',
  'talent',
  'recruit',
  'vendor',
  'procurement',
  'delivery',
  'engineering',
  'technology',
  'cto',
  'cio',
  'director',
  'manager',
  'lead',
  'head',
  'partner',
  'staffing',
  'resource',
];

function clamp(score: number, max: number) {
  return Math.max(0, Math.min(max, Math.round(score)));
}

function textIncludesAny(value: string, terms: string[]) {
  const lower = value.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

export function detectContactIntelligenceRegion(input: ContactIntelligenceInput): ContactIntelligenceRegion {
  const values = [
    input.company.country,
    input.company.industry,
    input.signal?.location,
    input.signal?.source,
  ].filter(Boolean).join(' ');
  return textIncludesAny(values, INDIA_MARKERS) ? 'india' : 'us';
}

function tierForScore(score: number, hardBlocks: string[]): CompanyQualificationTier {
  if (hardBlocks.some((block) => ['non_tech', 'suppressed', 'do_not_contact'].includes(block))) {
    return 'Reject';
  }
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'Reject';
}

function statusForTier(tier: CompanyQualificationTier, hardBlocks: string[]): CompanyIntelligenceStatus {
  if (hardBlocks.includes('suppressed') || hardBlocks.includes('do_not_contact')) return 'suppressed';
  if (hardBlocks.includes('cooldown') || hardBlocks.includes('active_duplicate')) return 'cooldown';
  if (tier === 'Reject') return 'rejected';
  return 'qualified';
}

function discoveryStatusFor(companyStatus: CompanyIntelligenceStatus, contactCount: number): DiscoveryRunStatus {
  if (companyStatus === 'rejected' || companyStatus === 'suppressed' || companyStatus === 'cooldown') {
    return 'skipped';
  }
  if (!CONTACT_INTELLIGENCE_PHASE1_CAPS.paidDiscoveryEnabled) {
    return contactCount > 0 ? 'succeeded' : 'blocked_by_cap';
  }
  return contactCount > 0 ? 'succeeded' : 'partial';
}

function scoreItTechFit(input: ContactIntelligenceInput, reasons: string[], hardBlocks: string[]) {
  const combined = [
    input.company.name,
    input.company.industry,
    input.signal?.jobTitle,
    ...(input.signal?.keywords ?? []),
  ].filter(Boolean).join(' ');

  if (textIncludesAny(combined, NON_TECH_TERMS)) {
    hardBlocks.push('non_tech');
    reasons.push('Rejected: non-tech/HRMS/payroll/attendance signal detected.');
    return 0;
  }

  let score = 6;
  if (textIncludesAny(combined, TECH_TERMS)) {
    score += 14;
    reasons.push('Strong IT/Tech role or skills detected.');
  }
  if (/staff|talent|consult|vendor|systems integrator|gcc|technology|software/i.test(combined)) {
    score += 5;
    reasons.push('Company/signal fits IT staffing or technology ecosystem.');
  }
  return clamp(score, 25);
}

function scoreSignalQuality(input: ContactIntelligenceInput, reasons: string[]) {
  let score = 0;
  const signalScore = input.signal?.score ?? 0;
  const daysOpen = input.signal?.daysOpen ?? 0;
  if (signalScore >= 8) {
    score += 9;
    reasons.push('High existing Wizmatch signal score.');
  } else if (signalScore >= 6) {
    score += 6;
    reasons.push('Useful existing Wizmatch signal score.');
  } else if (signalScore > 0) {
    score += 3;
  }
  if (input.signal?.jobTitle) score += 4;
  if ((input.signal?.keywords?.length ?? 0) > 0) score += 3;
  if (daysOpen <= 30) score += 4;
  else if (daysOpen <= 60) score += 2;
  return clamp(score, 20);
}

function scoreRegionPriority(region: ContactIntelligenceRegion, input: ContactIntelligenceInput, reasons: string[]) {
  if (region === 'india') {
    reasons.push('India-first priority applies.');
    return 15;
  }
  const h1bSponsorCount = input.company.h1bSponsorCount ?? 0;
  const signalScore = input.signal?.score ?? 0;
  if (h1bSponsorCount >= 5 || signalScore >= 8 || input.company.isPrime) {
    reasons.push('US signal allowed because it has high-value evidence.');
    return 10;
  }
  reasons.push('US signal is selective priority, below India-first weight.');
  return 5;
}

function scoreCandidateSupply(input: ContactIntelligenceInput, reasons: string[]) {
  const matched = input.candidateSupply?.matchedCandidateCount ?? 0;
  const available = input.candidateSupply?.availableCandidateCount ?? 0;
  const total = Math.max(matched, available);
  if (total >= 3) {
    reasons.push('Strong candidate supply is available.');
    return 15;
  }
  if (total >= 1) {
    reasons.push('Some matching candidate supply is available.');
    return 10;
  }
  reasons.push('No matching candidate supply found yet.');
  return 2;
}

function scoreRelationshipValue(input: ContactIntelligenceInput, reasons: string[]) {
  const rel = input.relationships;
  let score = 0;
  if (rel?.isPrime || input.company.isPrime) {
    score += 5;
    reasons.push('Prime company relationship exists.');
  }
  if (rel?.hasSignedMsa || input.company.primeMsaStatus === 'signed') {
    score += 4;
    reasons.push('Signed MSA or strong account relationship exists.');
  }
  if ((rel?.positiveReplyCount ?? 0) > 0) {
    score += 3;
    reasons.push('Prior positive reply found.');
  }
  if ((rel?.placementCount ?? 0) > 0) {
    score += 3;
    reasons.push('Prior placement history found.');
  }
  if ((rel?.knownContactCount ?? 0) > 0) {
    score += 3;
    reasons.push('Reusable internal CRM contacts found.');
  }
  if ((rel?.negativeReplyCount ?? 0) > 0) {
    score -= 4;
    reasons.push('Negative reply history lowers relationship score.');
  }
  return clamp(score, 15);
}

function scoreSafety(input: ContactIntelligenceInput, reasons: string[], hardBlocks: string[]) {
  let score = 10;
  const safety = input.safety;

  if ((safety?.suppressedCount ?? 0) > 0) {
    hardBlocks.push('suppressed');
    reasons.push('Suppression record blocks outreach.');
    return 0;
  }
  if (safety?.hasDoNotContact) {
    hardBlocks.push('do_not_contact');
    reasons.push('Do-not-contact blocks outreach.');
    return 0;
  }
  if (safety?.domainStatus && ['paused', 'blacklisted'].includes(safety.domainStatus)) {
    hardBlocks.push('unsafe_domain');
    score -= 8;
    reasons.push(`Domain health is ${safety.domainStatus}.`);
  }
  if ((safety?.activeDuplicateCount ?? 0) > 0) {
    hardBlocks.push('active_duplicate');
    score -= 5;
    reasons.push('Active duplicate outreach path exists.');
  }
  if (safety?.inCooldown) {
    hardBlocks.push('cooldown');
    score -= 5;
    reasons.push('Company is in cooldown.');
  }
  return clamp(score, 10);
}

function scoreContactCandidate(
  contact: InternalContactCandidateInput,
  input: ContactIntelligenceInput,
  tier: CompanyQualificationTier,
  region: ContactIntelligenceRegion,
): ContactCandidateRecommendation {
  const reasons: string[] = [];
  const title = contact.title ?? null;
  const titleText = title ?? '';
  let roleFit = 8;
  if (textIncludesAny(titleText, DECISION_MAKER_TERMS)) {
    roleFit = 30;
    reasons.push('Decision-maker title fit.');
  } else if (titleText) {
    roleFit = 16;
    reasons.push('Person-level contact, title needs review.');
  } else {
    reasons.push('Missing title; manual review required.');
  }

  const companyQualification = tier === 'A' ? 20 : tier === 'B' ? 14 : tier === 'C' ? 8 : 0;
  const signalRelevance = textIncludesAny([titleText, input.signal?.jobTitle ?? ''].join(' '), TECH_TERMS)
    ? 15
    : 8;
  const regionFit = region === 'india' ? 10 : 7;
  const relationshipScore = Math.min(15, (contact.relationshipSignals?.length ?? 0) * 5);
  if (relationshipScore > 0) reasons.push('Existing relationship signal found.');

  let confidenceScore = 2;
  if (contact.email) confidenceScore += 4;
  if (contact.verified) confidenceScore += 4;
  if (contact.doNotContact) {
    confidenceScore = 0;
    reasons.push('Do-not-contact flag applies.');
  } else if (contact.verified) {
    reasons.push('Verified internal channel.');
  }

  const rankingScore = clamp(
    roleFit + companyQualification + signalRelevance + regionFit + relationshipScore + confidenceScore,
    100,
  );

  return {
    id: contact.id,
    name: contact.name,
    title,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    linkedinUrl: contact.linkedinUrl ?? null,
    source: contact.source ?? 'internal_crm',
    status: contact.doNotContact ? 'do_not_contact' : 'needs_review',
    rankingScore,
    relationshipScore,
    confidenceScore,
    reasons,
  };
}

export function qualifyCompanyForContactIntelligence(
  input: ContactIntelligenceInput,
): ContactIntelligenceResult {
  const reasons: string[] = [];
  const hardBlocks: string[] = [];
  const targetRegion = detectContactIntelligenceRegion(input);

  const componentScores = {
    itTechFit: scoreItTechFit(input, reasons, hardBlocks),
    signalQuality: scoreSignalQuality(input, reasons),
    regionPriority: scoreRegionPriority(targetRegion, input, reasons),
    candidateSupply: scoreCandidateSupply(input, reasons),
    relationshipValue: scoreRelationshipValue(input, reasons),
    safetyAndDeliverability: scoreSafety(input, reasons, hardBlocks),
  };

  const qualificationScore = clamp(
    Object.values(componentScores).reduce((sum, value) => sum + value, 0),
    100,
  );
  const qualificationTier = tierForScore(qualificationScore, hardBlocks);
  const companyStatus = statusForTier(qualificationTier, hardBlocks);
  const contactCandidates = (input.internalContacts ?? [])
    .map((contact) => scoreContactCandidate(contact, input, qualificationTier, targetRegion))
    .filter((contact) => contact.status !== 'do_not_contact')
    .sort((a, b) => b.rankingScore - a.rankingScore)
    .slice(0, CONTACT_INTELLIGENCE_PHASE1_CAPS.maxContactCandidatesShown);

  return {
    companyId: input.company.id,
    companyName: input.company.name,
    companyDomain: input.company.domain ?? null,
    targetRegion,
    qualificationTier,
    qualificationScore,
    companyStatus,
    discoveryRunStatus: discoveryStatusFor(companyStatus, contactCandidates.length),
    componentScores,
    hardBlocks,
    reasons,
    costControls: CONTACT_INTELLIGENCE_PHASE1_CAPS,
    contactCandidates,
  };
}

export function assertPhase1CostCaps(requestedPaidRuns: number): DiscoveryRunStatus {
  if (!CONTACT_INTELLIGENCE_PHASE1_CAPS.paidDiscoveryEnabled) return 'blocked_by_cap';
  if (requestedPaidRuns > CONTACT_INTELLIGENCE_PHASE1_CAPS.maxPaidDiscoveryPerCompany) {
    return 'blocked_by_cap';
  }
  return 'queued';
}

export function resolveContactIntelligenceReviewAction(
  input: ContactIntelligenceReviewActionInput,
): ContactIntelligenceReviewActionResult {
  const reasons: string[] = [];
  const result: ContactIntelligenceReviewActionResult = {
    allowed: true,
    action: input.action,
    entity: input.entity,
    requiresManualApproval: true,
    reasons,
  };

  if (input.action === 'request_paid_discovery') {
    reasons.push('Paid discovery remains blocked because Phase 1/2 caps set max paid discovery per company to 0.');
    return {
      ...result,
      allowed: false,
      nextCompanyStatus: 'discovery_blocked',
      nextDiscoveryStatus: assertPhase1CostCaps(1),
    };
  }

  if (input.entity === 'company') {
    if (input.action === 'approve_company') {
      reasons.push('Company approved for internal reuse/manual contact review only; no outreach is sent.');
      return { ...result, nextCompanyStatus: 'discovery_blocked' };
    }
    if (input.action === 'reject_company') {
      reasons.push('Company rejected by reviewer.');
      return { ...result, nextCompanyStatus: 'rejected', nextDiscoveryStatus: 'skipped' };
    }
    if (input.action === 'watchlist_company') {
      reasons.push('Company remains in manual review/watchlist.');
      return { ...result, nextCompanyStatus: 'needs_review' };
    }
    if (input.action === 'request_internal_reuse') {
      reasons.push('Internal CRM reuse can run at zero cost.');
      return { ...result, nextCompanyStatus: 'discovered', nextDiscoveryStatus: 'queued' };
    }
  }

  if (input.entity === 'contact_candidate') {
    if (input.action === 'approve_contact') {
      reasons.push('Contact candidate approved for the next manual outreach-preparation step only.');
      return { ...result, nextContactStatus: 'approved' };
    }
    if (input.action === 'reject_contact') {
      reasons.push('Contact candidate rejected by reviewer.');
      return { ...result, nextContactStatus: 'rejected' };
    }
    if (input.action === 'mark_do_not_contact') {
      reasons.push('Contact candidate marked do-not-contact and must not enter outreach.');
      return { ...result, nextContactStatus: 'do_not_contact' };
    }
  }

  if (input.entity === 'discovery_run' && input.action === 'request_internal_reuse') {
    reasons.push('Discovery run limited to zero-cost internal reuse.');
    return { ...result, nextDiscoveryStatus: 'queued' };
  }

  reasons.push('Action is not valid for this entity.');
  return { ...result, allowed: false };
}
