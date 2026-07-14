/**
 * TheirStack importer — pulls India job postings (incl. Naukri-sourced) via the
 * TheirStack API (https://api.theirstack.com/v1/jobs/search) and ingests them as
 * wizmatch_job_signals (source=theirstack). This is the $0 validation path for the
 * India/Naukri demand that Akamai blocks us from scraping directly.
 *
 * DORMANT until THEIRSTACK_API_KEY is set. Free tier = 200 API credits/month
 * (1 credit per job), so this defaults to a tight cap (WIZMATCH_THEIRSTACK_LIMIT,
 * default 25) and is scheduled weekly — ~100 credits/month, safely under the cap.
 * Bump the limit / cadence only after confirming coverage is worth paid credits.
 *
 * NOTE: verify the response field mapping against a live payload once the key is
 * available — TheirStack's schema is mapped defensively here with fallbacks.
 */
import { pool } from '../db/index';
import logger from '../utils/logger';
import { extractKeywords } from './wizmatchAtsPoller';
import { isWizmatchRelevantRole } from './wizmatchRoleRelevance';
import {
  createSourceRun,
  finishSourceRun,
  getWizmatchSourcingConfig,
  ingestWizmatchSignals,
  type SourcingSignalInput,
} from './wizmatchSourcing';

const SEARCH_URL = 'https://api.theirstack.com/v1/jobs/search';
const CREDIT_URL = 'https://api.theirstack.com/v0/billing/credit-balance';

interface TheirStackJob {
  id?: string | number;
  job_id?: string | number;
  job_title?: string;
  title?: string;
  url?: string;
  final_url?: string;
  date_posted?: string;
  location?: string;
  employment_statuses?: string[];
  description?: string;
  company_object?: { name?: string; domain?: string };
  company?: string;
  company_domain?: string;
  source_url?: string;
  discovered_at?: string;
  hiring_team?: unknown;
}

export interface TheirStackHiringPerson { name: string; title: string | null; linkedinUrl: string | null; email: string | null }

export function parseTheirStackHiringTeam(value: unknown): TheirStackHiringPerson[] {
  const rows = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  return rows.map((row: any) => ({
    name: String(row?.name || row?.full_name || [row?.first_name, row?.last_name].filter(Boolean).join(' ') || '').trim(),
    title: String(row?.title || row?.job_title || row?.role || '').trim() || null,
    linkedinUrl: String(row?.linkedin_url || row?.linkedin || row?.profile_url || '').trim() || null,
    email: String(row?.email || '').trim().toLowerCase() || null,
  })).filter((person) => person.name && (person.title || person.linkedinUrl || person.email));
}

export function isTheirStackEnabled(): boolean {
  return !!process.env.THEIRSTACK_API_KEY;
}

export function buildTheirStackQuery(limit: number, cursor?: string | null, preview = false, seenJobIds: number[] = []) {
  return {
    page: 0,
    limit,
    posted_at_max_age_days: 30,
    job_country_code_or: ['IN'],
    job_title_or: ['sap abap', 'sap fico', 'java backend', 'java developer', 'javascript developer', 'frontend developer'],
    ...(cursor ? { discovered_at_gte: cursor } : {}),
    ...(seenJobIds.length ? { job_id_not: seenJobIds.slice(0, 500) } : {}),
    order_by: [{ field: 'date_posted', desc: true }],
    ...(preview ? { blur_company_data: true } : {}),
  };
}

export function previewTheirStackImport(env: NodeJS.ProcessEnv = process.env) {
  const config = getWizmatchSourcingConfig(env);
  return { enabled: config.theirstackEnabled, configured: config.theirstackConfigured, limit: config.theirstackLimit, query: buildTheirStackQuery(config.theirstackLimit) };
}

async function theirStackRequest(url: string, apiKey: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init.headers || {}), Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`TheirStack HTTP ${response.status}`);
  return response.json() as Promise<any>;
}

export async function validateTheirStackAccount(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = String(env.THEIRSTACK_API_KEY || '').trim();
  if (!apiKey) return { configured: false, validated: false, credits: null };
  try {
    const body = await theirStackRequest(CREDIT_URL, apiKey);
    const credits = Number(body?.api_credits ?? body?.credit_balance ?? body?.credits ?? body?.remaining_credits);
    return { configured: true, validated: true, credits: Number.isFinite(credits) ? credits : null };
  } catch (error) {
    return { configured: true, validated: false, credits: null, error: error instanceof Error ? error.message : 'TheirStack validation failed' };
  }
}

export async function fetchTheirStackPreview(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = String(env.THEIRSTACK_API_KEY || '').trim();
  const config = getWizmatchSourcingConfig(env);
  if (!apiKey) throw new Error('TheirStack is not configured');
  const query = buildTheirStackQuery(config.theirstackLimit, null, true);
  const body = await theirStackRequest(SEARCH_URL, apiKey, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query),
  });
  const jobs = Array.isArray(body?.data) ? body.data : Array.isArray(body?.results) ? body.results : [];
  return {
    configured: true,
    preview: true,
    fetched: jobs.length,
    query,
    sample: jobs.slice(0, 5).map((job: TheirStackJob) => ({
      providerId: String(job.id || job.job_id || ''), title: job.job_title || job.title || '',
      location: job.location || '', hiringTeamCount: parseTheirStackHiringTeam(job.hiring_team).length,
    })),
  };
}

export async function importTheirStackJobs(options: { trigger?: 'manual' | 'scheduled'; requestedBy?: string | null } = {}): Promise<{
  fetched: number; inserted: number; updated: number; duplicates: number; rejected: number; errors: number;
}> {
  const apiKey = process.env.THEIRSTACK_API_KEY;
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  if (!apiKey || !tenantId) {
    logger.info('[wizmatch/theirstack] THEIRSTACK_API_KEY not set — importer dormant');
    return { fetched: 0, inserted: 0, updated: 0, duplicates: 0, rejected: 0, errors: 0 };
  }
  const config = getWizmatchSourcingConfig();
  const limit = config.theirstackLimit;
  const cursorResult = await pool.query(
    `SELECT cursor_after FROM wizmatch_source_runs WHERE tenant_id=$1 AND provider='theirstack' AND status='succeeded' AND cursor_after IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [tenantId],
  );
  const cursor = cursorResult.rows[0]?.cursor_after || null;
  const seenResult = await pool.query(
    `SELECT provider_id FROM wizmatch_job_signals
     WHERE tenant_id=$1 AND source='theirstack' AND provider_id IS NOT NULL
     ORDER BY last_seen_at DESC NULLS LAST LIMIT 500`,
    [tenantId],
  );
  const seenJobIds = seenResult.rows.map((row) => Number(row.provider_id)).filter(Number.isSafeInteger);
  const query = buildTheirStackQuery(limit, cursor, false, seenJobIds);
  const run = await createSourceRun({ tenantId, provider: 'theirstack', trigger: options.trigger, requestedBy: options.requestedBy, query, cursorBefore: cursor });

  let jobs: TheirStackJob[] = [];
  try {
    const body = await theirStackRequest(SEARCH_URL, apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    });
    jobs = body.data || body.results || [];
  } catch (e) {
    logger.error({ err: e }, '[wizmatch/theirstack] fetch failed');
    await finishSourceRun(run.id, tenantId, { status: 'failed', errorMessage: e instanceof Error ? e.message : 'fetch failed' });
    return { fetched: 0, inserted: 0, updated: 0, duplicates: 0, rejected: 0, errors: 1 };
  }

  const signals: SourcingSignalInput[] = jobs
    .map((j) => {
      const title = (j.job_title || j.title || '').trim();
      if (!title) return null;
      const isContract = (j.employment_statuses || []).some((s) => /contract|c2h|temporary/i.test(s));
      const description = (j.description || '').replace(/<[^>]+>/g, ' ').slice(0, 20_000);
      const keywords = extractKeywords(title, description);
      if (!isWizmatchRelevantRole({ title, description, skills: keywords })) return null;
      return {
        job_title: title,
        job_url: j.final_url || j.url,
        source: 'theirstack',
        provider_id: String(j.id || j.job_id || '').trim() || undefined,
        posted_at: j.date_posted,
        employment_type: isContract ? 'contract' : undefined,
        keywords,
        location: j.location || 'India',
        raw_text: description,
        company_name: j.company_object?.name || j.company || undefined,
        company_domain: j.company_object?.domain || j.company_domain || undefined,
      } as SourcingSignalInput;
    })
    .filter((s): s is SourcingSignalInput => !!s && !!s.job_url);

  logger.info(`[wizmatch/theirstack] fetched ${jobs.length} India jobs, ingesting ${signals.length} (limit ${limit})`);
  const result = await ingestWizmatchSignals(tenantId, signals);
  for (const job of jobs) {
    const providerId = String(job.id || job.job_id || '').trim();
    const people = parseTheirStackHiringTeam(job.hiring_team);
    if (!providerId || !people.length) continue;
    const source = await pool.query(
      `SELECT s.id AS signal_id,s.company_id,ci.id AS intelligence_id
       FROM wizmatch_job_signals s
       LEFT JOIN wizmatch_company_intelligence ci ON ci.tenant_id=s.tenant_id AND ci.company_id=s.company_id
       WHERE s.tenant_id=$1 AND s.source='theirstack' AND s.provider_id=$2 LIMIT 1`,
      [tenantId, providerId],
    );
    if (!source.rows[0]?.company_id) continue;
    let intelligenceId = source.rows[0].intelligence_id;
    if (!intelligenceId) {
      const created = await pool.query(
        `INSERT INTO wizmatch_company_intelligence (tenant_id,company_id,status,review_status,created_at,updated_at)
         VALUES ($1,$2,'needs_review','needs_review',NOW(),NOW())
         ON CONFLICT (tenant_id,company_id) DO UPDATE SET updated_at=NOW() RETURNING id`,
        [tenantId, source.rows[0].company_id],
      );
      intelligenceId = created.rows[0]?.id;
    }
    for (const person of people) {
      await pool.query(
        `INSERT INTO wizmatch_contact_candidates
         (tenant_id,company_intelligence_id,company_id,name,title,role_category,email,linkedin_url,region,source,source_url,
          deliverability_status,ranking_score,confidence_score,status,metadata,created_at,updated_at)
         SELECT $1,$2,$3,$4,$5,'talent_acquisition',$6,$7,'india','theirstack_hiring_team',$8,
                $9,85,70,'needs_review',$10::jsonb,NOW(),NOW()
         WHERE NOT EXISTS (SELECT 1 FROM wizmatch_contact_candidates cc WHERE cc.tenant_id=$1 AND cc.company_id=$3
           AND (($6::text IS NOT NULL AND LOWER(cc.email)=LOWER($6::text)) OR ($7::text IS NOT NULL AND LOWER(cc.linkedin_url)=LOWER($7::text))))`,
        [tenantId, intelligenceId, source.rows[0].company_id, person.name, person.title, person.email, person.linkedinUrl,
          job.final_url || job.url || null, person.email ? 'unverified' : 'unknown',
          JSON.stringify({ pocState: person.email ? 'identified_channel_pending' : 'identified_channel_pending', signalId: source.rows[0].signal_id, providerEvidence: true })],
      );
    }
  }
  const cursorAfter = jobs.map((job) => job.discovered_at).filter(Boolean).sort().at(-1) || cursor;
  await finishSourceRun(run.id, tenantId, {
    status: result.errors ? 'partial' : 'succeeded', fetched: jobs.length, quotaConsumed: jobs.length, cursorAfter, ...result,
  });
  return { fetched: jobs.length, ...result };
}
