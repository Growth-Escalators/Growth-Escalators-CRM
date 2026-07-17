/**
 * Wizmatch X-Ray SERP Scraper Service
 *
 * Uses SearchAPI.io to run Google X-ray searches for public LinkedIn results.
 * Extracts candidate info from search results and creates contacts + candidates.
 *
 * Free tier: 100 searches/mo — runs 3/day max.
 *
 * Called by the X-ray cron in worker.ts (daily 8 AM IST).
 */

import { pool } from '../db/index';
import { db } from '../db/index';
import { wizmatchCandidates } from '../db/schema';
import { WIZMATCH_INDIA_ONLY } from '../config/constants';
import { findOrCreateContact } from './contactService';
import logger from '../utils/logger';
import { createSourceRun, finishSourceRun, getWizmatchSourcingConfig } from './wizmatchSourcing';
import { assertSearchApiAllowance, getSearchApiRunUsage, searchPublicWeb } from './wizmatchSearchApi';
import { extractCanonicalSkillKeywords } from './wizmatchSkillExtraction';

// ── Types ────────────────────────────────────────────────────────────────────

interface SerpResult {
  position: number;
  title: string;
  link: string;
  snippet: string;
}

interface XrayQuery {
  q: string;
  label: string;
  skills: string[];
}

interface XrayResult {
  queries_run: number;
  candidates_found: number;
  candidates_created: number;
  skipped_exists: number;
  errors: number;
}

export function normalizeLinkedInProfileUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname) || !url.pathname.toLowerCase().startsWith('/in/')) return null;
    url.protocol = 'https:';
    url.hostname = 'www.linkedin.com';
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function normalizeXrayResultLimit(value: unknown = 3): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) throw new RangeError('maxResults must be an integer from 1 to 10');
  return parsed;
}

export function capLinkedInProfileResults(results: SerpResult[], maxResults: number, seen = new Set<string>()): SerpResult[] {
  const limit = normalizeXrayResultLimit(maxResults);
  return results
    .map((result) => ({ ...result, link: normalizeLinkedInProfileUrl(result.link) }))
    .filter((result): result is SerpResult => Boolean(result.link))
    .filter((result) => {
      if (seen.has(result.link)) return false;
      seen.add(result.link);
      return true;
    })
    .slice(0, limit);
}

// ── Search templates ─────────────────────────────────────────────────────────

// India-only seed queries — all target Indian metros (no US cities).
export const INDIA_XRAY_QUERIES: XrayQuery[] = [
  {
    q: 'site:linkedin.com/in "java developer" "bengaluru" "open to work"',
    label: 'Bengaluru Java',
    skills: ['java', 'spring', 'backend'],
  },
  {
    q: 'site:linkedin.com/in "python developer" "bangalore" "open to work"',
    label: 'Bangalore Python',
    skills: ['python', 'django', 'backend'],
  },
  {
    q: 'site:linkedin.com/in "react developer" "india" "open to work"',
    label: 'India React',
    skills: ['react', 'javascript', 'frontend'],
  },
  {
    q: 'site:linkedin.com/in "devops engineer" "gurgaon" "open to work"',
    label: 'Gurgaon DevOps',
    skills: ['devops', 'aws', 'docker', 'kubernetes'],
  },
  {
    q: 'site:linkedin.com/in "data engineer" "hyderabad" "open to work"',
    label: 'Hyderabad Data Eng',
    skills: ['python', 'spark', 'airflow', 'sql'],
  },
  {
    q: 'site:linkedin.com/in ".net developer" "chennai" "open to work"',
    label: 'Chennai .NET',
    skills: ['.net', 'c#', 'sql'],
  },
  {
    q: 'site:linkedin.com/in "full stack developer" "hyderabad" "open to work"',
    label: 'Hyderabad Full Stack',
    skills: ['react', 'node', 'javascript'],
  },
  {
    q: 'site:linkedin.com/in "salesforce developer" "pune" "open to work"',
    label: 'Pune Salesforce',
    skills: ['salesforce', 'apex', 'lightning'],
  },
  {
    q: 'site:linkedin.com/in "AWS engineer" "noida" "open to work"',
    label: 'Noida AWS',
    skills: ['aws', 'devops', 'terraform'],
  },
  {
    q: 'site:linkedin.com/in "mobile developer" "mumbai" "open to work"',
    label: 'Mumbai Mobile',
    skills: ['ios', 'android', 'swift', 'kotlin'],
  },
];

// Legacy US+India seed set — used only when WIZMATCH_INDIA_ONLY is disabled.
export const GLOBAL_XRAY_QUERIES: XrayQuery[] = [
  { q: 'site:linkedin.com/in "java developer" "dallas" "open to work"', label: 'Dallas Java', skills: ['java', 'spring', 'backend'] },
  { q: 'site:linkedin.com/in "react developer" "remote" "open to work"', label: 'Remote React', skills: ['react', 'javascript', 'frontend'] },
  { q: 'site:linkedin.com/in "devops engineer" "austin" "open to work"', label: 'Austin DevOps', skills: ['devops', 'aws', 'docker', 'kubernetes'] },
  { q: 'site:linkedin.com/in "data engineer" "seattle" "open to work"', label: 'Seattle Data Eng', skills: ['python', 'spark', 'airflow', 'sql'] },
  { q: 'site:linkedin.com/in "AWS engineer" "denver" "open to work"', label: 'Denver AWS', skills: ['aws', 'devops', 'terraform'] },
  { q: 'site:linkedin.com/in "mobile developer" "san francisco" "open to work"', label: 'SF Mobile', skills: ['ios', 'android', 'swift', 'kotlin'] },
  ...INDIA_XRAY_QUERIES,
];

const XRAY_QUERIES: XrayQuery[] = WIZMATCH_INDIA_ONLY ? INDIA_XRAY_QUERIES : GLOBAL_XRAY_QUERIES;

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractLocationFromQuery(query: XrayQuery): string | null {
  const match = query.q.match(/"([^"]+)"[^"]*$/);
  // Try to find the location between the last two quoted strings
  const quotes = query.q.match(/"([^"]+)"/g);
  if (quotes && quotes.length >= 2) {
    // The location is typically the second-to-last quoted term (before "open to work")
    const locationCandidate = quotes[quotes.length - 2]?.replace(/"/g, '');
    if (locationCandidate && locationCandidate !== 'open to work') return locationCandidate;
  }
  return null;
}

function parseNameFromTitle(title: string): { firstName: string; lastName: string } {
  // LinkedIn titles are usually "First Last - Title at Company" or "First Last | ..."
  const namePart = title.split(/[|\-–—]/)[0].trim();
  const parts = namePart.split(/\s+/);
  const firstName = parts[0] || 'Unknown';
  const lastName = parts.slice(1).join(' ') || '';
  return { firstName, lastName };
}

export function buildRequirementXraySearch(skill: string, location: string): XrayQuery {
  const normalizedSkill = skill.trim();
  const normalizedLocation = location.trim() || 'India';
  return {
    q: `site:linkedin.com/in "${normalizedSkill} developer" "${normalizedLocation}" "open to work"`,
    label: `Requirement: ${normalizedSkill} in ${normalizedLocation}`,
    skills: [normalizedSkill.toLowerCase()],
  };
}

export function buildReviewedRequirementXraySearch(input: {
  mandatorySkills: string[]; preferredSkills?: string[]; location?: string | null; workMode?: string | null; minExperience?: number | null;
}): XrayQuery {
  const mandatory = input.mandatorySkills.map((skill) => skill.trim()).filter(Boolean);
  const preferred = (input.preferredSkills || []).map((skill) => skill.trim()).filter(Boolean);
  const location = String(input.location || 'India').trim();
  const mandatoryClause = mandatory.map((skill) => `"${skill}"`).join(' ');
  const preferredClause = preferred.length ? ` (${preferred.map((skill) => `"${skill}"`).join(' OR ')})` : '';
  const experience = input.minExperience ? ` "${input.minExperience}+ years"` : '';
  const workMode = input.workMode ? ` "${input.workMode}"` : '';
  return {
    q: `site:linkedin.com/in ${mandatoryClause}${preferredClause} "${location}"${workMode}${experience} ("open to work" OR "looking for opportunities")`,
    label: `Requirement: ${mandatory.join(', ')} in ${location}`,
    skills: [...mandatory, ...preferred].map((skill) => skill.toLowerCase()),
  };
}

// ── Main scraper ─────────────────────────────────────────────────────────────

export async function runXrayScrape(
  maxQueries = 3,
  adhocQuery?: { skill: string; location: string; query?: XrayQuery },
  context: { requirementId?: string | null; requestedBy?: string | null; maxResults?: number } = {},
): Promise<XrayResult> {
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  const searchApiKey = process.env.SEARCHAPI_API_KEY;

  if (!tenantId) {
    logger.warn('[wizmatch-xray] WIZMATCH_TENANT_ID not set — skipping');
    return { queries_run: 0, candidates_found: 0, candidates_created: 0, skipped_exists: 0, errors: 0 };
  }

  if (!searchApiKey) {
    logger.warn('[wizmatch-xray] SEARCHAPI_API_KEY not set — skipping');
    return { queries_run: 0, candidates_found: 0, candidates_created: 0, skipped_exists: 0, errors: 0 };
  }

  // The daily cron called this function directly with no allowance check at
  // all (only the recruiter-triggered runRequirementXray path checked the
  // cap, before calling in here). Checked here too so every caller —
  // present and future — respects the cap, not just the one that happens
  // to remember to check first.
  const config = getWizmatchSourcingConfig();
  const usage = await getSearchApiRunUsage(tenantId);
  try {
    assertSearchApiAllowance(usage, { daily: config.searchApiDailyCap, monthly: config.searchApiMonthlyCap });
  } catch (e) {
    logger.warn('[wizmatch-xray] SearchAPI allowance reached — skipping run:', e instanceof Error ? e.message : String(e));
    return { queries_run: 0, candidates_found: 0, candidates_created: 0, skipped_exists: 0, errors: 0 };
  }

  // Always create a source_run row — including the daily cron path, which
  // previously passed no requirementId and so recorded nothing at all here.
  // getSearchApiRunUsage() sums quota_consumed from this table, so those ~3
  // credits/day were invisible to the cost cap: the cron could keep running
  // indefinitely after the account's SearchAPI allowance was actually
  // exhausted, since nothing it did ever counted against the check other
  // callers rely on.
  const sourceRun = await createSourceRun({
    tenantId, provider: 'xray', trigger: adhocQuery ? 'manual' : 'scheduled',
    requirementId: context.requirementId ?? null, requestedBy: context.requestedBy, query: adhocQuery || {},
  });

  let todayQueries: XrayQuery[];
  if (adhocQuery) {
    // On-demand path (recruiter-triggered "Source now"): run exactly ONE query for
    // the requested skill+location. Does not touch the daily rotating cron set below.
    // SerpAPI free tier is ~100 searches/month — callers must not loop this.
    todayQueries = [adhocQuery.query || buildRequirementXraySearch(adhocQuery.skill, adhocQuery.location)];
  } else {
    // Rotate queries day-by-day
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    const startIdx = (dayOfYear * maxQueries) % XRAY_QUERIES.length;
    todayQueries = Array.from({ length: Math.min(maxQueries, XRAY_QUERIES.length) }, (_, i) =>
      XRAY_QUERIES[(startIdx + i) % XRAY_QUERIES.length],
    );
  }

  let totalFound = 0;
  let totalCreated = 0;
  let skippedExists = 0;
  let totalErrors = 0;
  const maxResults = normalizeXrayResultLimit(context.maxResults ?? 3);
  const seenProfileUrls = new Set<string>();

  for (const search of todayQueries) {
    const remaining = maxResults - totalFound;
    if (remaining <= 0) break;
    try {
      const results = capLinkedInProfileResults(await searchPublicWeb(search.q, { count: remaining }) as SerpResult[], remaining, seenProfileUrls);

      totalFound += results.length;

      for (const result of results) {
        try {
          // Check if candidate already exists (by LinkedIn URL, normalised)
          const existing = await pool.query(
            `SELECT id FROM wizmatch_candidates
             WHERE tenant_id = $1
               AND REGEXP_REPLACE(LOWER(SPLIT_PART(linkedin_url,'?',1)),'/$','') = LOWER($2)`,
            [tenantId, result.link],
          ).catch(() => ({ rows: [] }));

          if (existing.rows.length > 0) {
            skippedExists++;
            continue;
          }

          // Parse name from title
          const { firstName, lastName } = parseNameFromTitle(result.title);

          // Extract skills from snippet + title
          const combinedText = `${result.title} ${result.snippet}`;
          const skills = [...new Set([...search.skills, ...extractCanonicalSkillKeywords(combinedText)])];
          const location = extractLocationFromQuery(search);

          // We don't have an email from X-ray — create contact with LinkedIn URL only
          const { contact } = await findOrCreateContact(tenantId, {
            firstName,
            lastName: lastName || undefined,
            source: 'wizmatch_xray',
            sourceDetail: `LinkedIn X-ray: ${result.link}`,
            channels: [], // No email from X-ray — will be enriched later
          });

          await db.insert(wizmatchCandidates).values({
            tenantId,
            contactId: contact.id,
            skills,
            location,
            visaStatus: 'unknown',
            source: 'xray',
            linkedinUrl: result.link,
            indiaSpecific: {
              sourcingEvidence: {
                state: 'candidate_lead',
                requirementId: context.requirementId || null,
                query: search.q,
                headline: result.title,
                snippet: result.snippet,
                discoveredAt: new Date().toISOString(),
                reviewed: false,
              },
            },
          }).onConflictDoNothing();

          totalCreated++;
        } catch (e) {
          totalErrors++;
          logger.error(`[wizmatch-xray] Error processing result:`, e instanceof Error ? e.message : String(e));
        }
      }
    } catch (e) {
      totalErrors++;
      logger.error(`[wizmatch-xray] Query "${search.label}" failed:`, e instanceof Error ? e.message : String(e));
    }

    if (todayQueries.length > 1) await new Promise((r) => setTimeout(r, 1000));
  }

  await finishSourceRun(sourceRun.id, tenantId, {
    status: totalErrors ? 'partial' : 'succeeded', fetched: totalFound, inserted: totalCreated,
    updated: 0, duplicates: skippedExists, rejected: 0, errors: totalErrors, quotaConsumed: todayQueries.length,
  });

  logger.info(
    `[wizmatch-xray] Scraped ${todayQueries.length} queries: ${totalFound} results found, ${totalCreated} candidates created, ${skippedExists} already existed, ${totalErrors} errors`,
  );

  return {
    queries_run: todayQueries.length,
    candidates_found: totalFound,
    candidates_created: totalCreated,
    skipped_exists: skippedExists,
    errors: totalErrors,
  };
}

export async function runRequirementXray(tenantId: string, requirementId: string, requestedBy: string, maxResults = 3) {
  if (tenantId !== process.env.WIZMATCH_TENANT_ID) throw new Error('X-Ray tenant is not configured');
  const config = getWizmatchSourcingConfig();
  if (!config.xrayEnabled) throw new Error('Requirement-first X-Ray is disabled or not configured');
  const requirement = await pool.query(
    `SELECT r.id,r.location,r.work_mode,r.min_experience,r.stage,
            ARRAY_REMOVE(ARRAY_AGG(CASE WHEN rs.importance='mandatory' THEN s.canonical_label END),NULL) AS mandatory_skills,
            ARRAY_REMOVE(ARRAY_AGG(CASE WHEN rs.importance='preferred' THEN s.canonical_label END),NULL) AS preferred_skills
     FROM wizmatch_requirements r
     LEFT JOIN wizmatch_requirement_skills rs ON rs.requirement_id=r.id AND rs.tenant_id=r.tenant_id
     LEFT JOIN wizmatch_skills s ON s.id=rs.skill_id AND s.tenant_id=rs.tenant_id
     WHERE r.id=$1 AND r.tenant_id=$2 GROUP BY r.id`,
    [requirementId, tenantId],
  );
  if (!requirement.rows[0]) throw new Error('Requirement not found');
  if (!['accepted', 'sourcing', 'covered'].includes(requirement.rows[0].stage)) {
    throw new Error('Requirement must be accepted before candidate sourcing');
  }
  const skills = requirement.rows[0].mandatory_skills || [];
  if (!skills.length) throw new Error('Requirement needs at least one canonical mandatory skill');
  const cooldown = await pool.query(
    `SELECT 1 FROM wizmatch_source_runs WHERE tenant_id=$1 AND provider='xray' AND requirement_id=$2
     AND status IN ('succeeded','partial') AND created_at > NOW()-INTERVAL '7 days' LIMIT 1`,
    [tenantId, requirementId],
  );
  if (cooldown.rows.length) throw new Error('This requirement already used X-Ray in the last seven days');
  const usage = await getSearchApiRunUsage(tenantId);
  assertSearchApiAllowance(usage, { daily: config.searchApiDailyCap, monthly: config.searchApiMonthlyCap });
  const query = buildReviewedRequirementXraySearch({
    mandatorySkills: skills,
    preferredSkills: requirement.rows[0].preferred_skills || [],
    location: requirement.rows[0].location || 'India',
    workMode: requirement.rows[0].work_mode,
    minExperience: requirement.rows[0].min_experience,
  });
  return runXrayScrape(
    1,
    { skill: skills[0], location: requirement.rows[0].location || 'India', query },
    { requirementId, requestedBy, maxResults: normalizeXrayResultLimit(maxResults) },
  );
}
