/**
 * Candidate matcher — pure SQL + TypeScript rules, $0 LLM cost.
 *
 * Region-aware: US roles score visa eligibility (W2/C2C); India roles skip that
 * entirely. The SQL prefilter is case-insensitive (candidate 'Java' vs keyword
 * 'java' now overlap) and falls back to job-title tokens when a signal has no
 * keywords, so niche/manual roles still surface candidates instead of zero.
 *
 * No Claude calls in the hot path.
 */

import { pool } from '../db/index';
import { detectRegion, type Region } from './wizmatchScoring';

export interface CandidateMatch {
  candidateId: string;
  matchScore: number;
  reasoning: string;
  concerns: string;
}

interface SignalData {
  id: string;
  tenantId: string;
  jobTitle: string;
  keywords: string[];
  employmentType: string | null;
  location: string | null;
}

interface CandidateData {
  id: string;
  contactId: string;
  skills: string[];
  location: string | null;
  visaStatus: string | null;
  rateHourly: number | null;
  rateCurrency: string | null;
  availabilityDate: string | null;
  availabilityStatus: string;
}

const US_W2_VISAS = ['H1B', 'GC', 'USC', 'OPT'];

const TITLE_STOPWORDS = new Set([
  'senior', 'sr', 'junior', 'jr', 'lead', 'principal', 'staff', 'engineer', 'developer',
  'consultant', 'specialist', 'analyst', 'manager', 'architect', 'expert', 'associate',
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'of', 'in', 'to',
  'remote', 'onsite', 'hybrid', 'contract', 'position', 'role', 'hiring', 'job',
]);

/** Search terms for the prefilter: keywords if present, else title tokens. */
function searchTermsFor(signal: SignalData): string[] {
  const base = signal.keywords?.length
    ? signal.keywords
    : signal.jobTitle.toLowerCase().replace(/[^a-z0-9+#. ]/g, ' ').split(/\s+/)
        .filter((w) => w.length > 2 && !TITLE_STOPWORDS.has(w));
  return Array.from(new Set(base.map((t) => t.toLowerCase().trim()).filter(Boolean)));
}

export async function matchCandidates(signal: SignalData): Promise<CandidateMatch[]> {
  const region: Region = detectRegion(signal.location);
  const terms = searchTermsFor(signal);

  // Case-insensitive skill overlap; when there are no terms at all, fall back to
  // any available candidate (cardinality 0 disables the skill filter).
  const result = await pool.query(
    `SELECT id, contact_id, skills, location, visa_status, rate_hourly, rate_currency,
            availability_date, availability_status
     FROM wizmatch_candidates
     WHERE tenant_id = $1
       AND availability_status = 'available'
       AND ( cardinality($2::text[]) = 0
             OR EXISTS (SELECT 1 FROM unnest(skills) sk WHERE lower(sk) = ANY($2::text[])) )
     LIMIT 40`,
    [signal.tenantId, terms],
  );

  if (result.rows.length === 0) return [];
  const candidates = result.rows as unknown as CandidateData[];

  const scored = candidates.map((c) => {
    let score = 0;
    const reasons: string[] = [];
    const concerns: string[] = [];

    // Skill overlap (0–4) — substring-tolerant, case-insensitive
    const candidateSkillsLower = c.skills.map((s) => s.toLowerCase());
    const overlap = candidateSkillsLower.filter((s) =>
      terms.some((k) => s.includes(k) || k.includes(s)),
    );
    const overlapPct = terms.length > 0 ? overlap.length / terms.length : 0;
    if (overlapPct >= 0.6) { score += 4; reasons.push(`${Math.round(overlapPct * 100)}% skill overlap (${overlap.length}/${terms.length})`); }
    else if (overlapPct >= 0.4) { score += 2; reasons.push(`${Math.round(overlapPct * 100)}% skill overlap`); }
    else if (overlap.length > 0) { score += 1; concerns.push(`low skill overlap (${Math.round(overlapPct * 100)}%)`); }
    else { concerns.push('no direct skill overlap'); }

    // Visa eligibility — US only; India has no such gate
    if (region === 'us') {
      const isUSW2 = signal.employmentType?.toUpperCase() === 'W2';
      const isUSC2C = signal.employmentType?.toUpperCase() === 'C2C';
      if (isUSW2) {
        if (c.visaStatus && US_W2_VISAS.includes(c.visaStatus)) { score += 2; reasons.push(`${c.visaStatus} eligible for W2`); }
        else if (c.visaStatus) { concerns.push(`${c.visaStatus} not ideal for W2`); }
      } else if (isUSC2C) {
        score += 1; reasons.push('C2C — any visa OK');
      }
    }

    // Rate specified (0–1) — proxy for transparency
    if (c.rateHourly && c.rateHourly > 0) {
      score += 1;
      reasons.push(`${c.rateCurrency === 'INR' ? '₹' : '$'}${c.rateHourly}/hr`);
    }

    // Availability ≤30 days (0–2)
    if (c.availabilityDate) {
      const daysUntilAvail = Math.ceil((new Date(c.availabilityDate).getTime() - Date.now()) / 86400000);
      if (daysUntilAvail <= 30) { score += 2; reasons.push(`available in ${Math.max(0, daysUntilAvail)}d`); }
      else { concerns.push(`available in ${daysUntilAvail}d (>30)`); }
    } else {
      score += 1; // status='available', assume immediate
    }

    return {
      candidateId: c.id,
      matchScore: Math.min(10, score),
      reasoning: reasons.join(', ') || 'partial match',
      concerns: concerns.join(', ') || 'none',
    } as CandidateMatch;
  });

  scored.sort((a, b) => b.matchScore - a.matchScore);
  return scored.slice(0, 3);
}
