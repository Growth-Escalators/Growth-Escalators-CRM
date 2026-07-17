import { pool } from '../db/index';
import logger from '../utils/logger';
import { normalizeProviderId, signalIdentityFingerprint } from './wizmatchSignalIdentity';
import { createDefaultWizmatchContactDiscoveryProviders } from './wizmatchContactDiscoveryProviders';
import { dedupeDiscoveryCandidates, getWizmatchContactDiscoveryConfig } from './wizmatchContactDiscovery';
import {
  assertSearchApiAllowance,
  buildPocSearchQuery,
  classifyPocResult,
  getSearchApiRunUsage,
  normalizePocRoles,
  SearchApiRequestError,
  searchPublicWeb,
  type PocRole,
} from './wizmatchSearchApi';

export type WizmatchSourceProvider = 'theirstack' | 'ats' | 'xray' | 'poc_discovery';

export interface SourcingSignalInput {
  job_title: string;
  job_url?: string;
  source: string;
  provider_id?: string;
  posted_at?: string;
  employment_type?: string;
  keywords?: string[];
  location?: string;
  raw_text?: string;
  company_name?: string;
  company_domain?: string;
}

export interface SignalIngestResult {
  inserted: number;
  updated: number;
  duplicates: number;
  rejected: number;
  errors: number;
}

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export type PocDiscoveryFailure = {
  status: number;
  error: string;
  code: string;
  retryable: boolean;
  retryAfterSeconds: number | null;
};

export class PocDiscoveryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'PocDiscoveryError';
  }
}

export function describePocDiscoveryFailure(error: unknown): PocDiscoveryFailure {
  if (error instanceof PocDiscoveryError) {
    return {
      status: error.code === 'poc_retry_cooldown' ? 429 : 409,
      error: error.message,
      code: error.code,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  if (error instanceof SearchApiRequestError) {
    return {
      status: error.code === 'provider_timeout' ? 504 : error.status === 429 ? 429 : error.retryable ? 503 : 409,
      error: error.code === 'provider_timeout'
        ? 'POC research timed out before the provider returned evidence.'
        : error.code === 'provider_rate_limited'
          ? 'POC research is temporarily rate limited.'
          : error.retryable
            ? 'POC research provider is temporarily unavailable.'
            : 'POC research could not be completed.',
      code: error.code,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  const message = error instanceof Error ? error.message : '';
  if (/allowance reached/i.test(message)) {
    return { status: 429, error: 'The shared POC research allowance has been reached.', code: 'provider_allowance_reached', retryable: false, retryAfterSeconds: null };
  }
  if (message === 'POC discovery is disabled') {
    return { status: 403, error: message, code: 'poc_discovery_disabled', retryable: false, retryAfterSeconds: null };
  }
  if (message === 'Signal company was not found') {
    return { status: 404, error: message, code: 'signal_company_not_found', retryable: false, retryAfterSeconds: null };
  }
  return { status: 409, error: 'POC discovery could not be completed.', code: 'poc_discovery_failed', retryable: true, retryAfterSeconds: 60 };
}

function enabled(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export const THEIRSTACK_CRON = '35 1 * * 1,4';
export const ATS_CRON = '40 0 * * *';

export function getWizmatchSourcingConfig(env: NodeJS.ProcessEnv = process.env) {
  const masterEnabled = env.DISABLE_BACKGROUND_JOBS !== 'true'
    && Boolean(env.WIZMATCH_TENANT_ID)
    && enabled(env.WIZMATCH_SOURCE_AUTOMATION_ENABLED);
  return {
    masterEnabled,
    theirstackEnabled: masterEnabled && enabled(env.WIZMATCH_THEIRSTACK_IMPORT_ENABLED) && Boolean(env.THEIRSTACK_API_KEY),
    atsEnabled: masterEnabled && enabled(env.WIZMATCH_ATS_POLLING_ENABLED),
    xrayEnabled: enabled(env.WIZMATCH_XRAY_CANDIDATE_ENABLED) && Boolean(env.SEARCHAPI_API_KEY),
    pocDiscoveryEnabled: enabled(env.WIZMATCH_POC_DISCOVERY_ENABLED),
    theirstackConfigured: Boolean(env.THEIRSTACK_API_KEY),
    xrayConfigured: Boolean(env.SEARCHAPI_API_KEY),
    searchApiConfigured: Boolean(env.SEARCHAPI_API_KEY),
    theirstackLimit: Math.min(Math.max(Number(env.WIZMATCH_THEIRSTACK_LIMIT) || 15, 1), 25),
    searchApiDailyCap: Math.min(Math.max(Number(env.WIZMATCH_SEARCHAPI_DAILY_CAP) || 5, 1), 5),
    searchApiMonthlyCap: Math.min(Math.max(Number(env.WIZMATCH_SEARCHAPI_MONTHLY_CAP) || 80, 1), 80),
    xrayDailyCap: Math.min(Math.max(Number(env.WIZMATCH_SEARCHAPI_DAILY_CAP) || 5, 1), 5),
    xrayMonthlyCap: Math.min(Math.max(Number(env.WIZMATCH_SEARCHAPI_MONTHLY_CAP) || 80, 1), 80),
    execution: masterEnabled ? 'web-in-process' as const : 'disabled' as const,
    schedules: {
      theirstack: '07:05 IST Monday and Thursday',
      ats: '06:10 IST daily',
      xray: 'requirement-first manual only',
    },
  };
}

export function isAuditOnlyRequirementTitle(title: unknown): boolean {
  const normalized = String(title || '').trim().toLowerCase();
  return normalized.startsWith('zz audit test') || normalized.includes('(delete me)');
}

export async function ingestWizmatchSignals(
  tenantId: string,
  incomingSignals: SourcingSignalInput[],
  dbPool: Queryable = pool,
): Promise<SignalIngestResult> {
  const result: SignalIngestResult = { inserted: 0, updated: 0, duplicates: 0, rejected: 0, errors: 0 };
  for (const sig of incomingSignals) {
    const title = String(sig.job_title || '').trim();
    if (!title || !sig.source) {
      result.rejected++;
      continue;
    }
    try {
      let companyId: string | null = null;
      if (sig.company_name || sig.company_domain) {
        const company = await dbPool.query(
          `INSERT INTO wizmatch_companies (tenant_id,name,domain,created_at,updated_at)
           VALUES ($1,$2,$3,NOW(),NOW())
           ON CONFLICT (tenant_id,name) DO UPDATE
           SET domain=COALESCE(wizmatch_companies.domain,EXCLUDED.domain),updated_at=NOW()
           RETURNING id`,
          [tenantId, sig.company_name || sig.company_domain || 'Unknown', sig.company_domain || null],
        );
        companyId = company.rows[0]?.id || null;
      }
      const providerId = normalizeProviderId(sig.provider_id);
      const fingerprint = signalIdentityFingerprint({
        companyName: sig.company_name || sig.company_domain,
        jobTitle: title,
        location: sig.location,
      });
      const existing = await dbPool.query(
        `UPDATE wizmatch_job_signals
         SET last_seen_at=NOW(),days_open=GREATEST(days_open,EXTRACT(EPOCH FROM (NOW()-first_seen_at))/86400)::int,
             company_id=COALESCE($6,company_id),job_title=$7,job_url=COALESCE($4,job_url),
             posted_at=COALESCE($8,posted_at),employment_type=COALESCE($9,employment_type),
             keywords=CASE WHEN cardinality($10::text[])>0 THEN $10::text[] ELSE keywords END,
             location=COALESCE($11,location),raw_text=COALESCE($12,raw_text)
         WHERE tenant_id=$1 AND (
           (source=$2 AND provider_id=$3 AND $3 IS NOT NULL)
           OR (job_url=$4 AND $4 IS NOT NULL)
           OR (identity_fingerprint=$5 AND $5 IS NOT NULL)
         ) RETURNING id`,
        [tenantId, sig.source, providerId, sig.job_url || null, fingerprint, companyId, title,
          sig.posted_at || null, sig.employment_type || null, sig.keywords || [], sig.location || null, sig.raw_text || null],
      );
      if (existing.rows.length) {
        result.updated++;
        result.duplicates++;
        continue;
      }
      await dbPool.query(
        `INSERT INTO wizmatch_job_signals
         (tenant_id,company_id,job_title,job_url,source,provider_id,identity_fingerprint,posted_at,employment_type,keywords,location,raw_text,status,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'new',NOW())`,
        [tenantId, companyId, title, sig.job_url || null, sig.source, providerId, fingerprint,
          sig.posted_at || null, sig.employment_type || null, sig.keywords || [], sig.location || null, sig.raw_text || null],
      );
      result.inserted++;
    } catch (error) {
      result.errors++;
      logger.error({ err: error, source: sig.source }, '[wizmatch/sourcing] signal ingest failed');
    }
  }
  return result;
}

export async function withWizmatchSourceLock<T>(tenantId: string, provider: string, run: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  const key = `wizmatch-source:${tenantId}:${provider}`;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [key]);
    if (!lock.rows[0]?.locked) return null;
    try { return await run(); }
    finally { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]); }
  } finally { client.release(); }
}

export async function createSourceRun(input: {
  tenantId: string; provider: WizmatchSourceProvider; trigger?: 'manual' | 'scheduled';
  requirementId?: string | null; companyId?: string | null; query?: Record<string, unknown>;
  requestedBy?: string | null; cursorBefore?: string | null;
}) {
  const result = await pool.query(
    `INSERT INTO wizmatch_source_runs
     (tenant_id,provider,trigger,status,requirement_id,company_id,query,cursor_before,requested_by)
     VALUES ($1,$2,$3,'running',$4,$5,$6::jsonb,$7,$8) RETURNING *`,
    [input.tenantId, input.provider, input.trigger || 'manual', input.requirementId || null,
      input.companyId || null, JSON.stringify(input.query || {}), input.cursorBefore || null, input.requestedBy || null],
  );
  return result.rows[0];
}

export async function finishSourceRun(runId: string, tenantId: string, input: Partial<SignalIngestResult> & {
  status: 'succeeded' | 'partial' | 'failed' | 'skipped' | 'blocked'; fetched?: number; quotaConsumed?: number;
  cursorAfter?: string | null; errorMessage?: string | null;
}) {
  const result = await pool.query(
    `UPDATE wizmatch_source_runs SET status=$3,fetched_count=$4,inserted_count=$5,updated_count=$6,
       rejected_count=$7,duplicate_count=$8,quota_consumed=$9,cursor_after=$10,error_message=$11,finished_at=NOW()
     WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [runId, tenantId, input.status, input.fetched || 0, input.inserted || 0, input.updated || 0,
      input.rejected || 0, input.duplicates || 0, input.quotaConsumed || 0, input.cursorAfter || null, input.errorMessage || null],
  );
  return result.rows[0];
}

export async function qualifySignalAndCreatePocTask(tenantId: string, signalId: string, userId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const signal = await client.query(
      `UPDATE wizmatch_job_signals SET status='scored' WHERE id=$1 AND tenant_id=$2 AND status NOT IN ('dead','placed') RETURNING *`,
      [signalId, tenantId],
    );
    if (!signal.rows[0]) throw new Error('Signal not found or not qualifiable');
    const existing = await client.query(
      `SELECT t.* FROM tasks t JOIN wizmatch_task_links l ON l.task_id=t.id AND l.tenant_id=t.tenant_id
       WHERE t.tenant_id=$1 AND l.job_signal_id=$2 AND t.status='open' AND t.title='Find Main POC' LIMIT 1`,
      [tenantId, signalId],
    );
    let task = existing.rows[0];
    if (!task) {
      const created = await client.query(
        `INSERT INTO tasks (tenant_id,title,description,assigned_to,due_at,status)
         VALUES ($1,'Find Main POC',$2,$3,NOW()+INTERVAL '24 hours','open') RETURNING *`,
        [tenantId, `Find the named hiring POC for ${signal.rows[0].job_title}.`, userId],
      );
      task = created.rows[0];
      await client.query(
        `INSERT INTO wizmatch_task_links (tenant_id,task_id,company_id,job_signal_id) VALUES ($1,$2,$3,$4)`,
        [tenantId, task.id, signal.rows[0].company_id, signalId],
      );
    }
    await client.query(
      `INSERT INTO wizmatch_staffing_events (tenant_id,actor_user_id,event_type,source,source_id,company_id,payload)
       VALUES ($1,$2,'job_signal.qualified','sourcing',$3,$4,$5::jsonb)`,
      [tenantId, userId, signalId, signal.rows[0].company_id, JSON.stringify({ taskId: task.id })],
    );
    await client.query('COMMIT');
    return { signal: signal.rows[0], task };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function rejectSignal(tenantId: string, signalId: string, userId: string, reason?: string) {
  const result = await pool.query(
    `UPDATE wizmatch_job_signals SET status='dead',score_breakdown=COALESCE(score_breakdown,'{}'::jsonb)||$3::jsonb
     WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [signalId, tenantId, JSON.stringify({ rejectionReason: reason || 'rejected by reviewer', rejectedBy: userId, rejectedAt: new Date().toISOString() })],
  );
  if (!result.rows[0]) throw new Error('Signal not found');
  return result.rows[0];
}

export async function promoteSignalToRequirement(tenantId: string, signalId: string, userId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT * FROM wizmatch_requirements WHERE tenant_id=$1 AND source_job_signal_id=$2 LIMIT 1`,
      [tenantId, signalId],
    );
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { requirement: existing.rows[0], created: false };
    }
    const signal = await client.query(`SELECT * FROM wizmatch_job_signals WHERE id=$1 AND tenant_id=$2`, [signalId, tenantId]);
    if (!signal.rows[0]) throw new Error('Signal not found');
    if (!signal.rows[0].company_id) throw new Error('Signal must have a company before promotion');
    const created = await client.query(
      `INSERT INTO wizmatch_requirements
       (tenant_id,company_id,title,raw_jd,required_skills,location,employment_type,status,stage,attribution_status,source_job_signal_id,created_by,received_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft','draft','needs_attribution',$8,$9,NOW()) RETURNING *`,
      [tenantId, signal.rows[0].company_id, signal.rows[0].job_title, signal.rows[0].raw_text,
        signal.rows[0].keywords || [], signal.rows[0].location, signal.rows[0].employment_type, signalId, userId],
    );
    await client.query(`UPDATE wizmatch_job_signals SET status='drafted' WHERE id=$1 AND tenant_id=$2`, [signalId, tenantId]);
    await client.query(
      `UPDATE wizmatch_task_links SET requirement_id=$3 WHERE tenant_id=$1 AND job_signal_id=$2`,
      [tenantId, signalId, created.rows[0].id],
    );
    await client.query(
      `INSERT INTO wizmatch_staffing_events (tenant_id,actor_user_id,event_type,source,source_id,company_id,requirement_id,payload)
       VALUES ($1,$2,'job_signal.promoted','sourcing',$3,$4,$5,'{}'::jsonb)`,
      [tenantId, userId, signalId, signal.rows[0].company_id, created.rows[0].id],
    );
    await client.query('COMMIT');
    return { requirement: created.rows[0], created: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function discoverFreePocsForSignal(tenantId: string, signalId: string, userId: string, roles?: PocRole[]) {
  const config = getWizmatchSourcingConfig();
  if (!config.pocDiscoveryEnabled) throw new Error('POC discovery is disabled');
  const pocRoles = normalizePocRoles(roles);
  const signal = await pool.query(
    `SELECT s.id,s.company_id,c.name AS company_name,c.domain
     FROM wizmatch_job_signals s JOIN wizmatch_companies c ON c.id=s.company_id AND c.tenant_id=s.tenant_id
     WHERE s.id=$1 AND s.tenant_id=$2`,
    [signalId, tenantId],
  );
  if (!signal.rows[0]) throw new Error('Signal company was not found');
  const run = await createSourceRun({ tenantId, provider: 'poc_discovery', companyId: signal.rows[0].company_id, requestedBy: userId, query: { signalId } });
  let searchApiAttempted = false;
  try {
    const intelligence = await pool.query(
      `INSERT INTO wizmatch_company_intelligence (tenant_id,company_id,status,review_status,last_qualified_at,created_at,updated_at)
       VALUES ($1,$2,'needs_review','needs_review',NOW(),NOW(),NOW())
       ON CONFLICT (tenant_id,company_id) DO UPDATE SET updated_at=NOW() RETURNING id`,
      [tenantId, signal.rows[0].company_id],
    );
    const internal = await pool.query(
      `SELECT COUNT(DISTINCT wc.id)::int AS count,
              COUNT(DISTINCT wc.id) FILTER (WHERE ch.id IS NOT NULL)::int AS with_channel
       FROM wizmatch_company_contacts wc
       LEFT JOIN contact_channels ch ON ch.tenant_id=wc.tenant_id AND ch.contact_id=wc.contact_id
         AND ch.channel_type IN ('email','phone','whatsapp','linkedin')
       WHERE wc.tenant_id=$1 AND wc.company_id=$2 AND wc.relationship_stage='active'`,
      [tenantId, signal.rows[0].company_id],
    );
    if ((internal.rows[0]?.count || 0) > 0) {
      await finishSourceRun(run.id, tenantId, { status: 'succeeded', fetched: internal.rows[0].count, quotaConsumed: 0 });
      return { state: internal.rows[0].with_channel > 0 ? 'verified' : 'identified_channel_pending', candidatesFound: 0, existingRelationships: internal.rows[0].count, inserted: 0, duplicates: 0, searchApiUsed: false };
    }

    const providers = createDefaultWizmatchContactDiscoveryProviders();
    const websiteCandidates = signal.rows[0].domain ? await providers.websitePatternSearch({
      companyName: signal.rows[0].company_name,
      domain: signal.rows[0].domain,
      targetRegion: 'india',
    }) : [];
    const candidates = [...websiteCandidates];
    const hasNamedWebsitePoc = websiteCandidates.some((candidate) => candidate.raw?.roleCategory !== 'generic' && candidate.name);
    let searchApiUsed = false;
    if (!hasNamedWebsitePoc && config.searchApiConfigured) {
      const recent = await pool.query(
        `SELECT 1 FROM wizmatch_source_runs WHERE tenant_id=$1 AND provider='poc_discovery' AND company_id=$2
         AND quota_consumed>0 AND status IN ('succeeded','partial') AND created_at>NOW()-INTERVAL '30 days' LIMIT 1`,
        [tenantId, signal.rows[0].company_id],
      );
      if (!recent.rows.length) {
        const failedCooldown = await pool.query(
          `SELECT GREATEST(1,CEIL(EXTRACT(EPOCH FROM (created_at+INTERVAL '10 minutes'-NOW())))::int) AS retry_after_seconds
           FROM wizmatch_source_runs
           WHERE tenant_id=$1 AND provider='poc_discovery' AND company_id=$2 AND status='failed' AND quota_consumed>0
             AND created_at>NOW()-INTERVAL '10 minutes'
           ORDER BY created_at DESC LIMIT 1`,
          [tenantId, signal.rows[0].company_id],
        );
        if (failedCooldown.rows.length) {
          throw new PocDiscoveryError(
            'poc_retry_cooldown',
            'POC research recently failed for this company. Retry after the cooldown.',
            true,
            Number(failedCooldown.rows[0].retry_after_seconds) || 600,
          );
        }
        const usage = await getSearchApiRunUsage(tenantId);
        assertSearchApiAllowance(usage, { daily: config.searchApiDailyCap, monthly: config.searchApiMonthlyCap });
        searchApiAttempted = true;
        const publicResults = await searchPublicWeb(buildPocSearchQuery(signal.rows[0].company_name, signal.rows[0].domain, pocRoles));
        searchApiUsed = true;
        for (const result of publicResults) {
          const classified = classifyPocResult(result);
          if (!classified.category || !classified.name) continue;
          candidates.push({
            name: classified.name,
            title: result.title.slice(0, 240),
            email: null,
            linkedinUrl: result.link.includes('linkedin.com/in/') ? result.link : null,
            source: 'searchapi_public_web',
            sourceUrl: result.link,
            deliverabilityStatus: 'unknown',
            rankingScore: Math.max(0, 90 - result.position),
            confidenceScore: 60,
            reasons: ['Public search evidence; contact channel requires human verification'],
            raw: { roleCategory: classified.category, snippet: result.snippet },
          } as any);
        }
      }
    }
    // Hard cap: this free path built its own candidate list (website scrape +
    // public search) independent of executeWizmatchContactDiscovery, so it must
    // apply the same dedup + 5-contact ceiling before persisting anything.
    const cappedCandidates = dedupeDiscoveryCandidates(candidates)
      .sort((a, b) => b.rankingScore - a.rankingScore)
      .slice(0, getWizmatchContactDiscoveryConfig().maxContactCandidatesShown);

    let inserted = 0;
    let duplicates = 0;
    for (const candidate of cappedCandidates) {
      const roleCategory = String(candidate.raw?.roleCategory || 'generic');
      const pocState = roleCategory === 'generic'
        ? 'generic_contact_only'
        : candidate.deliverabilityStatus === 'verified' ? 'verified' : 'identified_channel_pending';
      const result = await pool.query(
        `INSERT INTO wizmatch_contact_candidates
         (tenant_id,company_intelligence_id,company_id,name,title,role_category,email,linkedin_url,region,source,source_url,
          deliverability_status,ranking_score,confidence_score,status,metadata,created_at,updated_at)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,'india',$9,$10,$11,$12,$13,'needs_review',$14::jsonb,NOW(),NOW()
         WHERE NOT EXISTS (SELECT 1 FROM wizmatch_contact_candidates cc WHERE cc.tenant_id=$1 AND cc.company_id=$3
           AND (($7::text IS NOT NULL AND LOWER(cc.email)=LOWER($7::text)) OR ($8::text IS NOT NULL AND LOWER(cc.linkedin_url)=LOWER($8::text))))
         RETURNING id`,
        [tenantId, intelligence.rows[0].id, signal.rows[0].company_id, candidate.name, candidate.title, roleCategory,
          candidate.email?.trim().toLowerCase() || null, candidate.linkedinUrl, candidate.source, candidate.sourceUrl,
          candidate.deliverabilityStatus, candidate.rankingScore, candidate.confidenceScore,
          JSON.stringify({ pocState, signalId, reasons: candidate.reasons, lastVerifiedAt: new Date().toISOString() })],
      );
      if (result.rows.length) inserted++; else duplicates++;
    }
    const state = cappedCandidates.some((c) => c.raw?.roleCategory !== 'generic')
      ? 'identified_channel_pending'
      : cappedCandidates.length ? 'generic_contact_only' : 'human_research_required';
    await finishSourceRun(run.id, tenantId, {
      status: cappedCandidates.length || internal.rows[0]?.count ? 'succeeded' : 'partial', fetched: cappedCandidates.length + (internal.rows[0]?.count || 0),
      inserted, duplicates, updated: 0, rejected: 0, errors: 0, quotaConsumed: searchApiUsed ? 1 : 0,
    });
    return { state, candidatesFound: cappedCandidates.length, existingRelationships: 0, inserted, duplicates, searchApiUsed };
  } catch (error) {
    await finishSourceRun(run.id, tenantId, {
      status: error instanceof PocDiscoveryError && error.code === 'poc_retry_cooldown' ? 'blocked' : 'failed',
      quotaConsumed: searchApiAttempted ? 1 : 0,
      errorMessage: describePocDiscoveryFailure(error).code,
    });
    throw error;
  }
}

/**
 * Read-only dry-run for the free POC search. Returns the exact query that WOULD
 * run, the target company, cooldown/allowance state and the estimated SearchAPI
 * credit cost — WITHOUT calling any provider (no website scrape, no SearchAPI).
 * Shares the internal-contacts + cooldown + cap logic with the real run so the
 * numbers agree.
 */
export async function previewFreePocSearch(tenantId: string, signalId: string, roles?: PocRole[]) {
  const config = getWizmatchSourcingConfig();
  const pocRoles = normalizePocRoles(roles);
  const signal = await pool.query(
    `SELECT s.id,s.company_id,c.name AS company_name,c.domain
     FROM wizmatch_job_signals s JOIN wizmatch_companies c ON c.id=s.company_id AND c.tenant_id=s.tenant_id
     WHERE s.id=$1 AND s.tenant_id=$2`,
    [signalId, tenantId],
  );
  if (!signal.rows[0]) throw new Error('Signal company was not found');
  const company = signal.rows[0];

  const internal = await pool.query(
    `SELECT COUNT(DISTINCT wc.id)::int AS count
     FROM wizmatch_company_contacts wc
     WHERE wc.tenant_id=$1 AND wc.company_id=$2 AND wc.relationship_stage='active'`,
    [tenantId, company.company_id],
  );
  const internalContactsExist = (internal.rows[0]?.count || 0) > 0;

  const recent = await pool.query(
    `SELECT 1 FROM wizmatch_source_runs WHERE tenant_id=$1 AND provider='poc_discovery' AND company_id=$2
     AND quota_consumed>0 AND status IN ('succeeded','partial') AND created_at>NOW()-INTERVAL '30 days' LIMIT 1`,
    [tenantId, company.company_id],
  );
  const inCooldown = recent.rows.length > 0;

  const usage = await getSearchApiRunUsage(tenantId);
  // A SearchAPI credit is only ever spent when there are no reusable internal
  // contacts, the company isn't in cooldown, and SearchAPI is configured — and
  // even then only if the free website scrape finds no named contact first.
  const willConsumeCredit = !internalContactsExist && !inCooldown && config.searchApiConfigured;

  return {
    company: company.company_name,
    domain: company.domain || null,
    roles: pocRoles,
    query: buildPocSearchQuery(company.company_name, company.domain, pocRoles),
    pocDiscoveryEnabled: config.pocDiscoveryEnabled,
    searchApiConfigured: config.searchApiConfigured,
    internalContactsExist,
    inCooldown,
    estimatedSearchApiCredits: willConsumeCredit ? 1 : 0,
    searchApiUsage: {
      daily: usage.daily,
      monthly: usage.monthly,
      dailyLimit: config.searchApiDailyCap,
      monthlyLimit: config.searchApiMonthlyCap,
      dailyRemaining: Math.max(0, config.searchApiDailyCap - usage.daily),
      monthlyRemaining: Math.max(0, config.searchApiMonthlyCap - usage.monthly),
    },
    notes: [
      internalContactsExist
        ? 'This company already has linked hiring contacts — reused for free; no search runs.'
        : inCooldown
          ? 'Within the 30-day per-company cooldown — a fresh SearchAPI search will not run.'
          : 'Runs free internal + website checks first; a SearchAPI credit is spent only if no named website contact is found.',
      'Preview only — no provider is called. Contact channels are never guessed; results still need human verification.',
    ],
  };
}
