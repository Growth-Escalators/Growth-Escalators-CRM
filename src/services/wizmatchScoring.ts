/**
 * Deterministic signal scorer — pure TypeScript, $0 LLM cost.
 *
 * Region-aware: the US rubric (H-1B/LCA, W2/C2C contract keywords) does not fit
 * India (80% of target), so India signals get their own rubric. Both produce a
 * comparable 0–10 range so the `score >= 7` enrichment gate works for either.
 *
 * US rubric (PRD §5.1):   daysOpen +3/+2 · repost +3 · volume +2/+1 · contract kw +2 · LCA +1
 * India rubric:           daysOpen +3/+2 · repost +2 · volume +2/+1 · contract/urgency kw +2 · high-demand skill +1
 *
 * No network calls. Fully unit-testable.
 */

export type Region = 'india' | 'us';

interface SignalInput {
  daysOpen: number;
  repostCount: number;
  companyVolumeCount: number;
  employmentType: string | null;
  keywords: string[] | null;
  h1bSponsorCount: number;
  region?: Region;
  location?: string | null;
}

export type HiringUrgency = 'high' | 'medium' | 'low';

export interface ScoreResult {
  score: number;
  region: Region;
  breakdown: Record<string, number>;
  reasoning: string;
  /** How strongly this company looks like it is STRUGGLING to hire (staffing-buy signal). */
  urgencyLevel: HiringUrgency;
  /** Points behind urgencyLevel: stale days-open + reposts + volume + urgency language. */
  strugglingScore: number;
}

// Language that signals a company is struggling / urgently needs to fill roles.
const URGENCY_KEYWORDS = [
  'urgent', 'immediate', 'immediate joiner', 'immediate need', 'asap', 'asap joiner',
  'multiple positions', 'multiple openings', 'multiple roles', 'walk-in', 'walk in',
  'bench', 'hot requirement', 'quick hire', 'priority', 'backfill', 'notice period',
  'looking for', 'actively hiring', 'need immediately',
];

// US staffing/contract signals
const US_CONTRACT_KEYWORDS = [
  'w2', 'c2c', 'corp-to-corp', 'contract', 'contract-to-hire', '6-month',
  '6 month', '12-month', 'contractor', '1099', 'temp', 'temporary',
];

// India contract / urgency signals
const INDIA_KEYWORDS = [
  'contract', 'contractual', 'c2h', 'contract-to-hire', 'immediate', 'immediate joiner',
  'urgent', 'notice period', 'payroll', 'third party', 'contract to hire',
];

// Broadly high-demand India IT skills (proxy for placeability)
const INDIA_HIGH_DEMAND = [
  'java', 'python', 'react', 'angular', 'node', 'javascript', 'typescript', 'devops',
  'aws', 'azure', 'gcp', 'data engineer', 'data scientist', 'machine learning', 'ml',
  'sap', 'salesforce', 'servicenow', 'full stack', 'dotnet', '.net', 'golang', 'go',
  'qa', 'automation', 'selenium', 'spring', 'microservices', 'kubernetes',
];

// Indian city / region markers for region inference
const INDIA_LOCATION_MARKERS = [
  'india', 'bangalore', 'bengaluru', 'hyderabad', 'pune', 'chennai', 'mumbai',
  'delhi', 'gurgaon', 'gurugram', 'noida', 'kolkata', 'ahmedabad', 'kochi',
  'coimbatore', 'indore', 'chandigarh', 'jaipur', 'remote - india',
];

/** Infer region from a free-text location; defaults to 'us' when unknown. */
export function detectRegion(location?: string | null): Region {
  if (!location) return 'us';
  const l = location.toLowerCase();
  return INDIA_LOCATION_MARKERS.some((m) => l.includes(m)) ? 'india' : 'us';
}

export function scoreSignal(input: SignalInput): ScoreResult {
  const region: Region = input.region ?? detectRegion(input.location);
  const allText = [input.employmentType ?? '', ...(input.keywords ?? [])].join(' ').toLowerCase();

  const breakdown: Record<string, number> = {};
  const reasons: string[] = [];

  // Shared: days open + volume
  if (input.daysOpen >= 30) { breakdown.daysOpen = 3; reasons.push(`open ${input.daysOpen}d (stale)`); }
  else if (input.daysOpen >= 14) { breakdown.daysOpen = 2; reasons.push(`open ${input.daysOpen}d`); }
  else breakdown.daysOpen = 0;

  if (input.companyVolumeCount >= 4) { breakdown.volume = 2; reasons.push(`${input.companyVolumeCount} similar roles (high volume)`); }
  else if (input.companyVolumeCount >= 2) { breakdown.volume = 1; reasons.push(`${input.companyVolumeCount} similar roles`); }
  else breakdown.volume = 0;

  if (region === 'india') {
    breakdown.repost = input.repostCount > 0 ? 2 : 0;
    if (breakdown.repost) reasons.push(`reposted ${input.repostCount}x`);

    breakdown.keywords = INDIA_KEYWORDS.some((kw) => allText.includes(kw)) ? 2 : 0;
    if (breakdown.keywords) reasons.push('contract / urgent hire');

    const skillText = (input.keywords ?? []).join(' ').toLowerCase();
    breakdown.skillDemand = INDIA_HIGH_DEMAND.some((s) => skillText.includes(s)) ? 1 : 0;
    if (breakdown.skillDemand) reasons.push('high-demand skill');
  } else {
    breakdown.repost = input.repostCount > 0 ? 3 : 0;
    if (breakdown.repost) reasons.push(`reposted ${input.repostCount}x`);

    breakdown.keywords = US_CONTRACT_KEYWORDS.some((kw) => allText.includes(kw)) ? 2 : 0;
    if (breakdown.keywords) reasons.push('contract keywords');

    breakdown.lca = input.h1bSponsorCount >= 5 ? 1 : 0;
    if (breakdown.lca) reasons.push(`H-1B sponsor (${input.h1bSponsorCount} LCAs)`);
  }

  const score = Math.min(10, Object.values(breakdown).reduce((a, b) => a + b, 0));

  // Derived "struggling to hire" indicator — does NOT change the numeric score (so the
  // score>=7 enrich gate is unaffected); it just surfaces WHY a company is worth pursuing.
  const hasUrgencyLanguage = URGENCY_KEYWORDS.some((kw) => allText.includes(kw));
  const strugglingScore =
    (breakdown.daysOpen || 0) + (breakdown.repost || 0) + (breakdown.volume || 0) + (hasUrgencyLanguage ? 2 : 0);
  const urgencyLevel: HiringUrgency = strugglingScore >= 6 ? 'high' : strugglingScore >= 3 ? 'medium' : 'low';
  if (hasUrgencyLanguage) reasons.push('urgent/immediate hiring language');
  if (urgencyLevel === 'high') reasons.push('strong "struggling to hire" signal');

  const reasoning = reasons.length > 0 ? reasons.join(', ') : 'low priority signal';

  return { score, region, breakdown, reasoning, urgencyLevel, strugglingScore };
}
