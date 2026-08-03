/**
 * Wizmatch signal pipeline — in-process core logic for score / enrich / match.
 *
 * Extracted verbatim from the `POST /api/wizmatch/signals/:id/{score,enrich,match}`
 * route handlers so the worker crons can drive the pipeline via direct function calls
 * instead of public-internet HTTPS self-requests. Removing the network hop kills three
 * failure modes at once: full round-trips per signal, contention on the global
 * 100-req/min limiter, and the pipeline silently wedging on a hung/429 fetch that had
 * no timeout and no `res.ok` check.
 *
 * The route handlers are now thin wrappers over these functions. Behavior, side effects
 * (Slack alerts, event logging, status transitions new→scored→enriched→matched) and the
 * returned payloads are identical — the only difference is that there is no HTTP call.
 */
import { pool } from '../db/index';
import { scoreSignal } from './wizmatchScoring';
import { matchCandidates } from './wizmatchMatching';
import { findOrCreateContact } from './contactService';
import { sendSlackMessage } from './slackService';
import { WIZMATCH_LEADS_CHANNEL } from '../config/constants';

export type ScoreSignalResult =
  | { notFound: true }
  | {
      notFound: false;
      signalId: string;
      score: number;
      breakdown: Record<string, number>;
      reasoning: string;
    };

/** Matches the injectable executor in wizmatchSourcing, so ingest can pass its own. */
type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export type ScoreSignalOptions = {
  /**
   * Query executor. Defaults to the shared pool. Ingest passes the same injected
   * executor it was handed, so a test that fakes the database for ingestion does not
   * get a live connection attempt smuggled in through the scorer.
   */
  db?: Queryable;
  /**
   * Post the `score >= 7` Slack alert. Defaults to true, which is what the cron and
   * the HTTP route have always done.
   *
   * Ingest and backfill pass `false`. Scoring at ingest means a single TheirStack run
   * can score 15 signals in one loop, and a backfill can score every historical row —
   * both would turn one designed alert into a burst against a real channel. Whether
   * ingest should alert is a product decision, not a side effect of fixing scoring;
   * `WIZMATCH_SCORE_ALERTS_ENABLED` (below) is the deliberate switch for it.
   */
  notify?: boolean;
};

/**
 * Opt-in switch for ingest-time priority alerts. Default off.
 *
 * Without this, making scoring run at ingest would silently retire the `score >= 7`
 * alert: the cron only picks up `status='new'` rows, and ingest-scored signals are
 * already `'scored'` by the time it looks. Off-by-default keeps the blast radius at
 * zero while leaving the feature one documented flag away.
 */
export function isWizmatchScoreAlertsEnabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.WIZMATCH_SCORE_ALERTS_ENABLED || '').toLowerCase());
}

/**
 * Deterministic TS scorer (pure, $0). Returns `{ notFound: true }` when the signal
 * does not exist for this tenant so the caller can translate it into a 404.
 */
export async function scoreSignalById(
  tenantId: string,
  signalId: string,
  options: ScoreSignalOptions = {},
): Promise<ScoreSignalResult> {
  const notify = options.notify !== false;
  const db = options.db ?? pool;
  const result = await db.query(
    `SELECT s.*, c.h1b_sponsor_count,
            (SELECT COUNT(*)::int FROM wizmatch_job_signals s2
             WHERE s2.company_id = s.company_id AND s2.status NOT IN ('dead','placed')) AS company_volume
     FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [signalId, tenantId],
  );

  if (result.rows.length === 0) {
    return { notFound: true };
  }

  const row = result.rows[0];
  const daysOpen = row.days_open || Math.floor((Date.now() - new Date(row.first_seen_at).getTime()) / 86400000);

  const { score, region, breakdown, reasoning, urgencyLevel, strugglingScore, c2cFriendly } = scoreSignal({
    daysOpen,
    repostCount: row.repost_count || 0,
    companyVolumeCount: row.company_volume || 0,
    employmentType: row.employment_type,
    keywords: row.keywords,
    h1bSponsorCount: row.h1b_sponsor_count || 0,
    location: row.location, // drives India-vs-US rubric selection
    jobTitle: row.job_title, // scanned for contract/C2C/urgency language
    rawText: row.raw_text,   // scanned for contract/C2C/urgency language
  });

  await db.query(
    `UPDATE wizmatch_job_signals
     SET score = $3, score_breakdown = $4::jsonb, status = 'scored', days_open = $5
     WHERE id = $1 AND tenant_id = $2`,
    [signalId, tenantId, score, JSON.stringify({ ...breakdown, region, reasoning, urgencyLevel, strugglingScore, c2cFriendly }), daysOpen],
  );

  // Slack alert for high scores
  if (notify && score >= 7 && WIZMATCH_LEADS_CHANNEL) {
    await sendSlackMessage(
      WIZMATCH_LEADS_CHANNEL,
      `🎯 *Priority Signal* (score ${score}/10)\n*${row.job_title}* at ${row.company_name || 'Unknown'}\n${reasoning}`,
      undefined,
      { allowDuringPause: true }, // client-acquisition alert — fires even while routine Slack is paused
    ).catch(() => {});
  }

  return { notFound: false, signalId, score, breakdown, reasoning };
}

/**
 * Scores a signal only if it has never been scored, and reports which happened.
 *
 * `score` alone cannot answer "has this been scored?" — the column defaults to 0
 * (`schema.ts:1411`) and `scoreSignal` can legitimately return 0, so a never-scored
 * row and a genuinely-worthless one are indistinguishable by score. `score_breakdown`
 * is the discriminator: it defaults to `{}` and is always non-empty after a real
 * scoring pass.
 *
 * Idempotent by design — qualify may be pressed repeatedly on the same signal, and
 * re-running the scorer each time would re-fire the priority alert.
 */
export async function ensureSignalScored(
  tenantId: string,
  signalId: string,
  options: ScoreSignalOptions = {},
): Promise<{ scored: boolean; reason: 'already_scored' | 'not_found' | 'scored_now' }> {
  const existing = await (options.db ?? pool).query(
    'SELECT score_breakdown FROM wizmatch_job_signals WHERE id = $1 AND tenant_id = $2',
    [signalId, tenantId],
  );
  if (existing.rows.length === 0) return { scored: false, reason: 'not_found' };

  const breakdown = existing.rows[0].score_breakdown;
  if (breakdown && Object.keys(breakdown).length > 0) return { scored: false, reason: 'already_scored' };

  const result = await scoreSignalById(tenantId, signalId, options);
  return result.notFound
    ? { scored: false, reason: 'not_found' }
    : { scored: true, reason: 'scored_now' };
}

export type EnrichSignalPayload =
  | { signalId: string; enriched: false; reason: string }
  | {
      signalId: string;
      enriched: true;
      contactId: string;
      email: string;
      confidence: unknown;
      source: unknown;
    };

export type EnrichSignalResult =
  | { notFound: true }
  | { notFound: false; payload: EnrichSignalPayload };

/**
 * Enrichment via the email-extractor waterfall (paid providers off). Returns
 * `{ notFound: true }` for a missing signal. On a genuine enrichment failure this
 * throws — the caller (route wrapper) translates that into a 500, exactly as the
 * original handler's try/catch did; the worker cron isolates it per-signal.
 */
export async function enrichSignalById(tenantId: string, signalId: string): Promise<EnrichSignalResult> {
  const signalResult = await pool.query(
    `SELECT s.*, c.name AS company_name, c.domain AS company_domain
     FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [signalId, tenantId],
  );

  if (signalResult.rows.length === 0) {
    return { notFound: true };
  }

  const signal = signalResult.rows[0];
  const websiteUrl = signal.company_domain ? `https://${signal.company_domain}` : null;

  if (!websiteUrl) {
    return { notFound: false, payload: { signalId, enriched: false, reason: 'no company domain' } };
  }

  // Reuse the existing enrichment waterfall
  const { findEmail } = await import('./emailExtractorService');
  const emailResult = await findEmail(websiteUrl, undefined, undefined, { allowPaidProviders: false });

  if (!emailResult) {
    return { notFound: false, payload: { signalId, enriched: false, reason: 'no email found' } };
  }

  // Create contact via findOrCreateContact (normalizes email, writes channels)
  const { contact } = await findOrCreateContact(tenantId, {
    firstName: 'Hiring',
    lastName: 'Manager',
    source: 'wizmatch_enrichment',
    sourceDetail: `Signal: ${signal.job_title} at ${signal.company_name}`,
    channels: [{ channelType: 'email', channelValue: emailResult.email, isPrimary: true }],
    tags: ['Client Lead'],
    companyName: signal.company_name || undefined,
  });

  // Link contact to signal
  await pool.query(
    `UPDATE wizmatch_job_signals SET contact_id = $3, status = 'enriched' WHERE id = $1 AND tenant_id = $2`,
    [signalId, tenantId, contact.id],
  );

  return {
    notFound: false,
    payload: {
      signalId,
      enriched: true,
      contactId: contact.id,
      email: emailResult.email,
      confidence: emailResult.confidence,
      source: emailResult.source,
    },
  };
}

export type MatchSignalResult =
  | { notFound: true }
  | {
      notFound: false;
      payload: { signalId: string; matches: Awaited<ReturnType<typeof matchCandidates>> };
    };

/**
 * Pure SQL+TS candidate matcher ($0). Persists matched ids, logs a `candidate_match`
 * event, alerts Slack, and returns the matches. Returns `{ notFound: true }` for a
 * missing signal so the caller can respond 404.
 */
export async function matchSignalById(tenantId: string, signalId: string): Promise<MatchSignalResult> {
  const signalResult = await pool.query(
    `SELECT id, tenant_id, job_title, keywords, employment_type, location
     FROM wizmatch_job_signals
     WHERE id = $1 AND tenant_id = $2`,
    [signalId, tenantId],
  );

  if (signalResult.rows.length === 0) {
    return { notFound: true };
  }

  const signal = signalResult.rows[0];
  const matches = await matchCandidates({
    id: signal.id,
    tenantId: signal.tenant_id,
    jobTitle: signal.job_title,
    keywords: signal.keywords || [],
    employmentType: signal.employment_type,
    location: signal.location,
  });

  const matchedIds = matches.map((m) => m.candidateId);

  await pool.query(
    `UPDATE wizmatch_job_signals
     SET matched_candidate_ids = $3::uuid[], status = 'matched'
     WHERE id = $1 AND tenant_id = $2`,
    [signalId, tenantId, matchedIds],
  );

  // Log match event
  await pool.query(
    `INSERT INTO events (tenant_id, event_type, channel, direction, payload, source_id, occurred_at)
     VALUES ($1, 'candidate_match', 'internal', 'outbound', $2::jsonb, $3, NOW())`,
    [tenantId, JSON.stringify({ signalId, matches: matches.map(m => ({ candidateId: m.candidateId, score: m.matchScore, reasoning: m.reasoning })) }), String(signalId)],
  );

  // Slack alert
  if (matches.length > 0 && WIZMATCH_LEADS_CHANNEL) {
    await sendSlackMessage(
      WIZMATCH_LEADS_CHANNEL,
      `✅ *${matches.length} candidate${matches.length > 1 ? 's' : ''} matched* for ${signal.job_title}\n${matches.map((m) => `• Score ${m.matchScore}/10 — ${m.reasoning}`).join('\n')}`,
      undefined,
      { allowDuringPause: true }, // client-acquisition alert — fires even while routine Slack is paused
    ).catch(() => {});
  }

  return { notFound: false, payload: { signalId, matches } };
}
