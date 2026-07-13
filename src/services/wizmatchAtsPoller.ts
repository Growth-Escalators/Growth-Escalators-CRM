/**
 * Wizmatch ATS Poller Service
 *
 * Polls Greenhouse, Lever, and Ashby public job boards for companies
 * that have ATS metadata stored in wizmatch_companies. New jobs become
 * wizmatch_job_signals with the appropriate source.
 *
 * APIs (all free, no auth required for public boards):
 *   Greenhouse: GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
 *   Lever:      GET https://api.lever.co/v0/postings/{slug}
 *   Ashby:      GET https://api.ashby.com/v1/{slug}/jobs (fallback: scrape board HTML)
 *
 * Called by the ATS Poller cron in worker.ts (daily 6 AM IST).
 */

import { pool } from '../db/index';
import logger from '../utils/logger';
import { isWizmatchRelevantRole } from './wizmatchRoleRelevance';

// ── Types ────────────────────────────────────────────────────────────────────

interface AtsCompany {
  id: string;
  tenant_id: string;
  name: string;
  domain: string | null;
  ats_type: string;
  ats_slug: string | null;
  ats_board_url: string | null;
}

interface IngestedJob {
  job_title: string;
  job_url: string;
  source: string;
  posted_at: string | null;
  employment_type: string | null;
  keywords: string[];
  location: string | null;
  raw_text: string | null;
  company_name: string;
  company_domain: string | null;
}

interface PollResult {
  company: string;
  ats_type: string;
  found: number;
  inserted: number;
  updated: number;
  error: string | null;
}

// ── Greenhouse ───────────────────────────────────────────────────────────────

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at: string;
  location: { name: string } | null;
  departments: Array<{ name: string }> | null;
  metadata: Array<{ name: string; value: string }> | null;
}

async function pollGreenhouse(slug: string): Promise<IngestedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Greenhouse API ${res.status} for slug "${slug}"`);
  const data = (await res.json()) as { jobs: GreenhouseJob[] };

  return (data.jobs || []).map((job) => {
    const employmentType = job.metadata?.find((m) =>
      m.name.toLowerCase().includes('employment') || m.name.toLowerCase().includes('type'),
    )?.value || null;

    return {
      job_title: job.title,
      job_url: job.absolute_url,
      source: 'greenhouse',
      posted_at: job.updated_at,
      employment_type: normalizeEmploymentType(employmentType),
      keywords: extractKeywords(job.title, job.departments?.map((d) => d.name).join(' ') || ''),
      location: job.location?.name || null,
      raw_text: null,
      company_name: '', // filled by caller
      company_domain: null,
    };
  });
}

// ── Lever ────────────────────────────────────────────────────────────────────

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt: number;
  categories: { location: string; team: string; commitment: string } | null;
}

async function pollLever(slug: string): Promise<IngestedJob[]> {
  const url = `https://api.lever.co/v0/postings/${slug}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Lever API ${res.status} for slug "${slug}"`);
  const data = (await res.json()) as LeverPosting[];

  return (data || []).map((posting) => ({
    job_title: posting.text,
    job_url: posting.hostedUrl,
    source: 'lever',
    posted_at: new Date(posting.createdAt).toISOString(),
    employment_type: normalizeEmploymentType(posting.categories?.commitment || null),
    keywords: extractKeywords(posting.text, posting.categories?.team || ''),
    location: posting.categories?.location || null,
    raw_text: null,
    company_name: '',
    company_domain: null,
  }));
}

// ── Ashby ────────────────────────────────────────────────────────────────────
// Ashby doesn't have a stable public JSON API — try the jobs endpoint first,
// fall back to scraping the board page HTML.

async function pollAshby(slug: string): Promise<IngestedJob[]> {
  // Try the API first
  try {
    const apiUrl = `https://api.ashby.com/v1/${slug}/jobs`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const data = await res.json() as { jobs?: Array<{
        title: string; location: string; jobUrl: string; postedAt: string; employmentType: string;
      }> };
      if (data.jobs && data.jobs.length > 0) {
        return data.jobs.map((job) => ({
          job_title: job.title,
          job_url: job.jobUrl,
          source: 'ashby',
          posted_at: job.postedAt,
          employment_type: normalizeEmploymentType(job.employmentType),
          keywords: extractKeywords(job.title, ''),
          location: job.location,
          raw_text: null,
          company_name: '',
          company_domain: null,
        }));
      }
    }
  } catch {
    // Fall through to HTML scrape
  }

  // Fallback: scrape the board page
  const boardUrl = `https://boards-api.ashby.com/v1/boards/${slug}`;
  const res = await fetch(boardUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Ashby API ${res.status} for slug "${slug}"`);
  const data = await res.json() as { jobs?: Array<{
    title: string; locationName: string; jobUrl: string; publishedDate: string;
  }> };

  return (data.jobs || []).map((job) => ({
    job_title: job.title,
    job_url: job.jobUrl,
    source: 'ashby',
    posted_at: job.publishedDate,
    employment_type: null,
    keywords: extractKeywords(job.title, ''),
    location: job.locationName,
    raw_text: null,
    company_name: '',
    company_domain: null,
  }));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Broad skill taxonomy — languages/frameworks/cloud plus enterprise & functional
// stacks common in India staffing (SAP, Salesforce, ServiceNow, QA, BA, etc.),
// so niche roles don't fall through to an empty keyword set.
const SKILL_KEYWORDS = [
  // languages / core
  'java', 'python', 'javascript', 'typescript', 'c#', '.net', 'dotnet', 'go', 'golang',
  'rust', 'scala', 'ruby', 'php', 'kotlin', 'swift', 'c++', 'perl', 'r ',
  // web / frameworks
  'react', 'angular', 'vue', 'node', 'next.js', 'spring', 'spring boot', 'django',
  'flask', 'laravel', '.net core', 'express', 'graphql', 'rest api',
  // cloud / infra / devops
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'devops', 'terraform', 'ansible',
  'jenkins', 'ci/cd', 'cloud', 'linux', 'microservices',
  // data / ml
  'sql', 'postgres', 'mysql', 'oracle', 'mongodb', 'redis', 'kafka', 'spark', 'hadoop',
  'airflow', 'snowflake', 'databricks', 'tableau', 'power bi', 'etl', 'data engineer',
  'data scientist', 'data analyst', 'machine learning', 'ml', 'ai', 'nlp', 'tensorflow', 'pytorch',
  // enterprise / functional (India-heavy)
  'sap', 'sap abap', 'sap fico', 'sap mm', 'salesforce', 'servicenow', 'workday', 'peoplesoft',
  'guidewire', 'pega', 'sharepoint', 'dynamics 365', 'mulesoft', 'informatica', 'mainframe', 'cobol',
  // roles / disciplines
  'full stack', 'frontend', 'backend', 'mobile', 'ios', 'android', 'qa', 'automation',
  'selenium', 'manual testing', 'business analyst', 'scrum master', 'project manager',
  'product manager', 'ui/ux', 'security', 'network', 'sre', 'embedded',
];

// Stopwords stripped when falling back to job-title tokens.
const TITLE_STOPWORDS = new Set([
  'senior', 'sr', 'junior', 'jr', 'lead', 'principal', 'staff', 'engineer', 'developer',
  'consultant', 'specialist', 'analyst', 'manager', 'architect', 'expert', 'associate',
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'of', 'in', 'to', 'i', 'ii', 'iii',
  'remote', 'onsite', 'hybrid', 'contract', 'fulltime', 'full-time', 'position', 'role',
  'hiring', 'urgent', 'immediate', 'new', 'job', 'opening', 'years', 'exp', 'experience',
]);

function normalizeEmploymentType(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes('contract') || lower.includes('c2c') || lower.includes('1099')) return 'contract';
  if (lower.includes('full-time') || lower.includes('permanent') || lower.includes('fte')) return 'FTE';
  if (lower.includes('w2')) return 'W2';
  return raw;
}

export function extractKeywords(title: string, extra: string): string[] {
  const text = `${title} ${extra}`.toLowerCase();
  const matched = SKILL_KEYWORDS.filter((skill) => text.includes(skill)).map((s) => s.trim());
  if (matched.length > 0) return Array.from(new Set(matched));

  // Fallback: significant tokens from the title, so the matcher (which relies on
  // keyword overlap) still has something to work with for niche/unlisted roles.
  return Array.from(new Set(
    title.toLowerCase().replace(/[^a-z0-9+#. ]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 2 && !TITLE_STOPWORDS.has(w)),
  )).slice(0, 6);
}

// ── Main poller ──────────────────────────────────────────────────────────────

export async function pollAtsBoards(): Promise<{
  companies_polled: number;
  jobs_found: number;
  jobs_inserted: number;
  jobs_updated: number;
  errors: number;
  results: PollResult[];
}> {
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  if (!tenantId) {
    logger.warn('[wizmatch-ats] WIZMATCH_TENANT_ID not set — skipping');
    return { companies_polled: 0, jobs_found: 0, jobs_inserted: 0, jobs_updated: 0, errors: 0, results: [] };
  }

  const companies = (await pool.query(
    `SELECT id, tenant_id, name, domain, ats_type, ats_slug, ats_board_url
     FROM wizmatch_companies
     WHERE tenant_id = $1 AND ats_type IS NOT NULL AND ats_type != 'none' AND ats_slug IS NOT NULL`,
    [tenantId],
  )).rows as AtsCompany[];

  if (companies.length === 0) {
    logger.info('[wizmatch-ats] No companies with ATS configured');
    return { companies_polled: 0, jobs_found: 0, jobs_inserted: 0, jobs_updated: 0, errors: 0, results: [] };
  }

  const results: PollResult[] = [];
  let totalFound = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  for (const company of companies) {
    const result: PollResult = {
      company: company.name,
      ats_type: company.ats_type,
      found: 0,
      inserted: 0,
      updated: 0,
      error: null,
    };

    try {
      let jobs: IngestedJob[] = [];

      switch (company.ats_type) {
        case 'greenhouse':
          jobs = await pollGreenhouse(company.ats_slug!);
          break;
        case 'lever':
          jobs = await pollLever(company.ats_slug!);
          break;
        case 'ashby':
          jobs = await pollAshby(company.ats_slug!);
          break;
        default:
          result.error = `Unsupported ATS type: ${company.ats_type}`;
          results.push(result);
          totalErrors++;
          continue;
      }

      // Fill company info
      for (const job of jobs) {
        job.company_name = company.name;
        job.company_domain = company.domain;
      }

      // Public ATS boards contain every department. Only retain roles carrying
      // explicit technical evidence; company identity never makes a role relevant.
      jobs = jobs.filter((job) => isWizmatchRelevantRole({
        title: job.job_title,
        description: job.raw_text,
        skills: job.keywords,
      }));

      result.found = jobs.length;
      totalFound += jobs.length;

      // Upsert each job — dedupe by job_url
      for (const job of jobs) {
        try {
          // Check if already exists
          const existing = await pool.query(
            `UPDATE wizmatch_job_signals
             SET last_seen_at = NOW(),
                 days_open = GREATEST(days_open, EXTRACT(EPOCH FROM (NOW() - first_seen_at))/86400)::int
             WHERE tenant_id = $1 AND job_url = $2
             RETURNING id`,
            [tenantId, job.job_url],
          );
          if (existing.rows.length > 0) {
            result.updated++;
            totalUpdated++;
          } else {
            await pool.query(
              `INSERT INTO wizmatch_job_signals
               (tenant_id, company_id, job_title, job_url, source, posted_at,
                employment_type, keywords, location, raw_text, status, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'new', NOW())`,
              [
                tenantId, company.id, job.job_title, job.job_url, job.source,
                job.posted_at, job.employment_type, job.keywords, job.location, job.raw_text,
              ],
            );
            result.inserted++;
            totalInserted++;
          }
        } catch {
          // Per-job error — continue
        }
      }
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
      totalErrors++;
      logger.error(`[wizmatch-ats] Failed to poll ${company.name} (${company.ats_type}): ${result.error}`);
    }

    results.push(result);
    // Rate-limit between companies
    await new Promise((r) => setTimeout(r, 1000));
  }

  logger.info(
    `[wizmatch-ats] Polled ${companies.length} companies: ${totalFound} jobs found, ${totalInserted} new, ${totalUpdated} updated, ${totalErrors} errors`,
  );

  return {
    companies_polled: companies.length,
    jobs_found: totalFound,
    jobs_inserted: totalInserted,
    jobs_updated: totalUpdated,
    errors: totalErrors,
    results,
  };
}

// ── ATS type detector ────────────────────────────────────────────────────────
// Called when a new company is created — probes Greenhouse/Lever/Ashby to
// auto-detect the ATS type and slug.

export async function detectAtsType(domain: string): Promise<{
  ats_type: string;
  ats_slug: string;
  ats_board_url: string;
} | null> {
  const slug = domain.split('.')[0]; // e.g. "stripe" from "stripe.com"

  // Try Greenhouse
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json() as { jobs?: unknown[] };
      if (data.jobs && data.jobs.length > 0) {
        return {
          ats_type: 'greenhouse',
          ats_slug: slug,
          ats_board_url: `https://boards.greenhouse.io/${slug}`,
        };
      }
    }
  } catch { /* try next */ }

  // Try Lever
  try {
    const res = await fetch(`https://api.lever.co/v0/postings/${slug}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json() as unknown[];
      if (Array.isArray(data) && data.length > 0) {
        return {
          ats_type: 'lever',
          ats_slug: slug,
          ats_board_url: `https://jobs.lever.co/${slug}`,
        };
      }
    }
  } catch { /* try next */ }

  // Try Ashby
  try {
    const res = await fetch(`https://boards-api.ashby.com/v1/boards/${slug}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json() as { jobs?: unknown[] };
      if (data.jobs && data.jobs.length > 0) {
        return {
          ats_type: 'ashby',
          ats_slug: slug,
          ats_board_url: `https://boards.ashby.com/${slug}`,
        };
      }
    }
  } catch { /* not found */ }

  return null;
}
