/**
 * Wizmatch Staffing Module — API Router
 *
 * All routes under /api/wizmatch/*
 * Groups: signals, candidates, placements, primes, domains, compliance, reply, analytics
 *
 * Auth:
 *   - requireAuth: CRM user JWT (req.user.tenantId)
 *   - requireInternalToken: cron/CI calls (x-internal-secret header)
 *   - Public: /unsubscribe (HMAC verified), Vapi webhook (signature verified)
 *
 * Cost guardrails:
 *   - /score and /match: pure TS ($0)
 *   - /draft: Sonnet on-demand only
 *   - /classify-reply: reuses Haiku classifier
 */

import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { db, pool } from '../db/index';
import {
  wizmatchCandidates,
  wizmatchPlacements,
  wizmatchDomainHealth,
  wizmatchSuppressionList,
  messages,
  events,
  sequenceEnrolments,
} from '../db/schema';
import { requireInternalToken } from '../middleware/internalAuth';
import { scoreSignal } from '../services/wizmatchScoring';
import { matchCandidates } from '../services/wizmatchMatching';
import { callClaude, parseClaudeJSON, CLAUDE_MODELS } from '../services/claudeService';
import { findOrCreateContact } from '../services/contactService';
import { sendSlackMessage } from '../services/slackService';
import {
  WIZMATCH_LEADS_CHANNEL,
  WIZMATCH_SYSTEM_CHANNEL,
  WIZMATCH_DAILY_CHANNEL,
  WIZMATCH_PHYSICAL_ADDRESS,
  WIZMATCH_UNSUBSCRIBE_HMAC_SECRET,
  WIZMATCH_MEETING_URL,
} from '../config/constants';
import logger from '../utils/logger';

const router = Router();

// ============================================================
// SECTION 1 — SIGNAL ROUTES
// ============================================================

// GET /api/wizmatch/signals — list with filters
router.get('/signals', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramIdx = 2;

  if (req.query.status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(req.query.status);
  }
  if (req.query.min_score) {
    conditions.push(`score >= $${paramIdx++}`);
    params.push(Number(req.query.min_score));
  }
  if (req.query.source) {
    conditions.push(`source = $${paramIdx++}`);
    params.push(req.query.source);
  }
  if (req.query.company_id) {
    conditions.push(`company_id = $${paramIdx++}`);
    params.push(req.query.company_id);
  }

  const whereClause = conditions.join(' AND ');

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM wizmatch_job_signals WHERE ${whereClause}`,
    params,
  );
  const total = countResult.rows[0]?.total ?? 0;

  const dataResult = await pool.query(
    `SELECT s.*, c.name AS company_name, c.domain AS company_domain,
            cnt.first_name AS contact_first_name, cnt.last_name AS contact_last_name
     FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id
     LEFT JOIN contacts cnt ON cnt.id = s.contact_id
     WHERE ${whereClause}
     ORDER BY s.score DESC NULLS LAST, s.created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset],
  );

  res.json({ items: dataResult.rows, total });
});

// GET /api/wizmatch/signals/:id — full detail
router.get('/signals/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const result = await pool.query(
    `SELECT s.*, c.name AS company_name, c.domain AS company_domain, c.ats_type,
            cnt.first_name AS contact_first_name, cnt.last_name AS contact_last_name,
            cnt.id AS contact_id
     FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id
     LEFT JOIN contacts cnt ON cnt.id = s.contact_id
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [req.params.id, tenantId],
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Signal not found' });
    return;
  }

  const signal = result.rows[0];

  // Get matched candidates
  let matchedCandidates: unknown[] = [];
  if (signal.matched_candidate_ids && signal.matched_candidate_ids.length > 0) {
    const candResult = await pool.query(
      `SELECT wc.id, wc.skills, wc.location, wc.visa_status, wc.rate_hourly,
              wc.rate_currency, wc.availability_date, wc.availability_status,
              c.first_name, c.last_name
       FROM wizmatch_candidates wc
       JOIN contacts c ON c.id = wc.contact_id
       WHERE wc.id = ANY($1::uuid[])`,
      [signal.matched_candidate_ids],
    );
    matchedCandidates = candResult.rows;
  }

  // Get draft messages
  const draftsResult = await pool.query(
    `SELECT id, content, metadata, status, created_at
     FROM messages
     WHERE contact_id = $1 AND metadata->>'signal_id' = $2
     ORDER BY created_at DESC`,
    [signal.contact_id, req.params.id],
  );

  res.json({ ...signal, matched_candidates: matchedCandidates, drafts: draftsResult.rows });
});

// POST /api/wizmatch/signals/ingest — internal endpoint for CI/cron scrapers
router.post('/signals/ingest', requireInternalToken, async (req: Request, res: Response) => {
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  if (!tenantId) {
    res.status(500).json({ error: 'WIZMATCH_TENANT_ID not configured' });
    return;
  }

  const incomingSignals = req.body.signals as Array<{
    job_title: string;
    job_url?: string;
    source: string;
    posted_at?: string;
    employment_type?: string;
    keywords?: string[];
    location?: string;
    raw_text?: string;
    company_name?: string;
    company_domain?: string;
  }>;

  if (!Array.isArray(incomingSignals)) {
    res.status(400).json({ error: 'Expected { signals: [...] }' });
    return;
  }

  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (const sig of incomingSignals) {
    try {
      // Resolve or create company
      let companyId: string | null = null;
      if (sig.company_name || sig.company_domain) {
        const companyResult = await pool.query(
          `INSERT INTO wizmatch_companies (tenant_id, name, domain, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (tenant_id, name) DO UPDATE SET updated_at = NOW()
           RETURNING id`,
          [
            tenantId,
            sig.company_name || sig.company_domain || 'Unknown',
            sig.company_domain || null,
          ],
        );
        companyId = companyResult.rows[0].id;
      }

      // Dedupe by job_url — update last_seen_at if exists
      if (sig.job_url) {
        const existing = await pool.query(
          `UPDATE wizmatch_job_signals
           SET last_seen_at = NOW(),
               days_open = GREATEST(days_open, EXTRACT(EPOCH FROM (NOW() - first_seen_at))/86400)::int
           WHERE tenant_id = $1 AND job_url = $2
           RETURNING id`,
          [tenantId, sig.job_url],
        );
        if (existing.rows.length > 0) {
          updated++;
          continue;
        }
      }

      await pool.query(
        `INSERT INTO wizmatch_job_signals
         (tenant_id, company_id, job_title, job_url, source, posted_at,
          employment_type, keywords, location, raw_text, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'new', NOW())`,
        [
          tenantId,
          companyId,
          sig.job_title,
          sig.job_url || null,
          sig.source,
          sig.posted_at || null,
          sig.employment_type || null,
          sig.keywords || [],
          sig.location || null,
          sig.raw_text || null,
        ],
      );
      inserted++;
    } catch (e) {
      logger.error({ err: e }, '[wizmatch] ingest error for signal');
      errors++;
    }
  }

  logger.info(`[wizmatch] ingest: ${inserted} new, ${updated} updated, ${errors} errors`);
  res.json({ inserted, updated, errors });
});

// POST /api/wizmatch/signals/:id/score — deterministic TS scorer (internal)
router.post('/signals/:id/score', requireInternalToken, async (req: Request, res: Response) => {
  const tenantId = process.env.WIZMATCH_TENANT_ID!;
  const signalId = req.params.id;

  const result = await pool.query(
    `SELECT s.*, c.h1b_sponsor_count,
            (SELECT COUNT(*)::int FROM wizmatch_job_signals s2
             WHERE s2.company_id = s.company_id AND s2.status NOT IN ('dead','placed')) AS company_volume
     FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [signalId, tenantId],
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Signal not found' });
    return;
  }

  const row = result.rows[0];
  const daysOpen = row.days_open || Math.floor((Date.now() - new Date(row.first_seen_at).getTime()) / 86400000);

  const { score, breakdown, reasoning } = scoreSignal({
    daysOpen,
    repostCount: row.repost_count || 0,
    companyVolumeCount: row.company_volume || 0,
    employmentType: row.employment_type,
    keywords: row.keywords,
    h1bSponsorCount: row.h1b_sponsor_count || 0,
  });

  await pool.query(
    `UPDATE wizmatch_job_signals
     SET score = $3, score_breakdown = $4::jsonb, status = 'scored', days_open = $5
     WHERE id = $1 AND tenant_id = $2`,
    [signalId, tenantId, score, JSON.stringify({ ...breakdown, reasoning }), daysOpen],
  );

  // Slack alert for high scores
  if (score >= 7 && WIZMATCH_LEADS_CHANNEL) {
    await sendSlackMessage(
      WIZMATCH_LEADS_CHANNEL,
      `🎯 *Priority Signal* (score ${score}/10)\n*${row.job_title}* at ${row.company_name || 'Unknown'}\n${reasoning}`,
    ).catch(() => {});
  }

  res.json({ signalId, score, breakdown, reasoning });
});

// POST /api/wizmatch/signals/:id/enrich — reuse emailExtractorService (internal)
router.post('/signals/:id/enrich', requireInternalToken, async (req: Request, res: Response) => {
  const tenantId = process.env.WIZMATCH_TENANT_ID!;
  const signalId = req.params.id;

  const signalResult = await pool.query(
    `SELECT s.*, c.name AS company_name, c.domain AS company_domain
     FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [signalId, tenantId],
  );

  if (signalResult.rows.length === 0) {
    res.status(404).json({ error: 'Signal not found' });
    return;
  }

  const signal = signalResult.rows[0];
  const websiteUrl = signal.company_domain ? `https://${signal.company_domain}` : null;

  if (!websiteUrl) {
    res.json({ signalId, enriched: false, reason: 'no company domain' });
    return;
  }

  try {
    // Reuse the existing enrichment waterfall
    const { findEmail } = await import('../services/emailExtractorService');
    const emailResult = await findEmail(websiteUrl);

    if (!emailResult) {
      res.json({ signalId, enriched: false, reason: 'no email found' });
      return;
    }

    // Create contact via findOrCreateContact (normalizes email, writes channels)
    const { contact } = await findOrCreateContact(tenantId, {
      firstName: 'Hiring',
      lastName: 'Manager',
      source: 'wizmatch_enrichment',
      sourceDetail: `Signal: ${signal.job_title} at ${signal.company_name}`,
      channels: [{ channelType: 'email', channelValue: emailResult.email, isPrimary: true }],
    });

    // Link contact to signal
    await pool.query(
      `UPDATE wizmatch_job_signals SET contact_id = $3, status = 'enriched' WHERE id = $1 AND tenant_id = $2`,
      [signalId, tenantId, contact.id],
    );

    res.json({
      signalId,
      enriched: true,
      contactId: contact.id,
      email: emailResult.email,
      confidence: emailResult.confidence,
      source: emailResult.source,
    });
  } catch (e) {
    logger.error({ err: e }, '[wizmatch] enrich failed');
    res.status(500).json({ error: 'enrichment failed', detail: e instanceof Error ? e.message : 'unknown' });
  }
});

// POST /api/wizmatch/signals/:id/match — pure SQL+TS matcher (internal)
router.post('/signals/:id/match', requireInternalToken, async (req: Request, res: Response) => {
  const tenantId = process.env.WIZMATCH_TENANT_ID!;
  const signalId = req.params.id;

  const signalResult = await pool.query(
    `SELECT id, tenant_id, job_title, keywords, employment_type, location
     FROM wizmatch_job_signals
     WHERE id = $1 AND tenant_id = $2`,
    [signalId, tenantId],
  );

  if (signalResult.rows.length === 0) {
    res.status(404).json({ error: 'Signal not found' });
    return;
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
    ).catch(() => {});
  }

  res.json({ signalId, matches });
});

// POST /api/wizmatch/signals/:id/draft — Sonnet on-demand email drafts
router.post('/signals/:id/draft', async (req: Request, res: Response) => {
  // Allow both JWT (from UI) and internal token
  const tenantId = req.user?.tenantId || process.env.WIZMATCH_TENANT_ID!;
  const signalId = req.params.id;

  const signalResult = await pool.query(
    `SELECT s.*, c.name AS company_name, c.domain AS company_domain, c.h1b_sponsor_count,
            cnt.first_name AS contact_first_name, cnt.last_name AS contact_last_name
     FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id
     LEFT JOIN contacts cnt ON cnt.id = s.contact_id
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [signalId, tenantId],
  );

  if (signalResult.rows.length === 0) {
    res.status(404).json({ error: 'Signal not found' });
    return;
  }

  const signal = signalResult.rows[0];
  if (!signal.contact_id) {
    res.status(400).json({ error: 'Signal has no enriched contact — run /enrich first' });
    return;
  }

  // Get matched candidates with full detail
  let candidatesDetail = '';
  if (signal.matched_candidate_ids?.length > 0) {
    const candsResult = await pool.query(
      `SELECT wc.skills, wc.visa_status, wc.rate_hourly, wc.rate_currency,
              wc.availability_date, c.first_name, c.last_name
       FROM wizmatch_candidates wc
       JOIN contacts c ON c.id = wc.contact_id
       WHERE wc.id = ANY($1::uuid[])`,
      [signal.matched_candidate_ids],
    );
    candidatesDetail = candsResult.rows
      .map((c: { first_name: string; last_name: string; skills: string[]; visa_status: string; rate_hourly: number; rate_currency: string; availability_date: string }, i: number) =>
        `Candidate ${String.fromCharCode(65 + i)}: ${c.first_name} ${c.last_name}, ${c.skills.join(', ')}, ${c.visa_status}, $${c.rate_hourly}/${c.rate_currency}, available ${c.availability_date || 'immediate'}`,
      )
      .join('\n');
  }

  const contactName = `${signal.contact_first_name || 'Hiring'} ${signal.contact_last_name || 'Manager'}`.trim();

  const prompt = `You are writing cold outreach emails for Wizmatch, a US + India IT staffing firm. Write 3 variants of a cold email to a decision-maker who has a job open that we have candidates for.

Context:
- Recipient: ${contactName} at ${signal.company_name || 'the company'}
- Job: ${signal.job_title}, posted ${signal.days_open} days ago, ${signal.employment_type || 'unknown'} in ${signal.location || 'unspecified'}
- Recipient company files H-1B LCAs: ${signal.h1b_sponsor_count || 0} in last year

Available candidates:
${candidatesDetail || 'No specific candidates matched — focus on our bench of certified IT professionals.'}

Rules (NON-NEGOTIABLE):
- Under 120 words per email
- Lead with proof: name 2 specific candidates with their skills + rates
- Reference the specific role + how long it's been open (if 7+ days)
- One ask: "Want profiles in 30 minutes?"
- Sign as: "— Archit, Wizmatch"
- NO service bundles, NO "we're a staffing firm" language, NO "can we connect"
- NO buzzwords (synergy, leverage, partner, solutions)
- Plain text only, no HTML, no markdown
- Include exactly: [UNSUBSCRIBE_LINK] placeholder
- Include exactly: [PHYSICAL_ADDRESS] placeholder

Return JSON only:
{
  "variant_a": { "subject": "<under 60 chars>", "body": "<email body>" },
  "variant_b": { "subject": "<different angle>", "body": "<different angle body>" },
  "variant_c": { "subject": "<different angle>", "body": "<different angle body>" }
}

Variant A: Direct pitch — lead with candidates + rates.
Variant B: Pain-point angle — reference days open + repost, then offer candidates.
Variant C: Social proof angle — reference similar past placements, then offer candidates.`;

  try {
    const response = await callClaude(prompt, CLAUDE_MODELS.SONNET, 1500);
    const drafts = parseClaudeJSON<Record<string, { subject: string; body: string }>>(response.text);

    // Insert 3 draft messages — body in content, subject in metadata
    const insertedDrafts = [];
    for (const [variantKey, draft] of Object.entries(drafts)) {
      const bodyWithFooter = `${draft.body}\n\n[UNSUBSCRIBE_LINK]\n[PHYSICAL_ADDRESS]`;
      const [msg] = await db
        .insert(messages)
        .values({
          tenantId,
          contactId: signal.contact_id,
          channel: 'email',
          direction: 'outbound',
          content: bodyWithFooter,
          status: 'draft',
          metadata: {
            subject: draft.subject,
            signal_id: signalId,
            variant: variantKey,
          },
        })
        .returning();
      insertedDrafts.push(msg);
    }

    await pool.query(
      `UPDATE wizmatch_job_signals SET status = 'drafted' WHERE id = $1 AND tenant_id = $2`,
      [signalId, tenantId],
    );

    res.json({ signalId, drafts: insertedDrafts });
  } catch (e) {
    logger.error({ err: e }, '[wizmatch] draft generation failed');
    res.status(500).json({ error: 'draft generation failed', detail: e instanceof Error ? e.message : 'unknown' });
  }
});

// POST /api/wizmatch/signals/:id/send — send via multi-domain mailer
router.post('/signals/:id/send', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const signalId = req.params.id;
  const { variant_message_id } = req.body as { variant_message_id: string };

  if (!variant_message_id) {
    res.status(400).json({ error: 'variant_message_id required' });
    return;
  }

  // Get the draft message
  const msgResult = await pool.query(
    `SELECT m.*, cnt.first_name, cnt.last_name
     FROM messages m
     JOIN contacts cnt ON cnt.id = m.contact_id
     WHERE m.id = $1 AND m.tenant_id = $2`,
    [variant_message_id, tenantId],
  );

  if (msgResult.rows.length === 0) {
    res.status(404).json({ error: 'Draft message not found' });
    return;
  }

  const draft = msgResult.rows[0] as {
    id: string; contact_id: string; content: string; metadata: { subject: string; signal_id: string };
    first_name: string; last_name: string;
  };

  // Get contact email
  const emailResult = await pool.query(
    `SELECT channel_value FROM contact_channels WHERE contact_id = $1 AND channel_type = 'email' LIMIT 1`,
    [draft.contact_id],
  );

  if (emailResult.rows.length === 0) {
    res.status(400).json({ error: 'Contact has no email channel' });
    return;
  }

  const toEmail = emailResult.rows[0].channel_value;

  // Suppression check
  const suppressed = await pool.query(
    `SELECT id FROM wizmatch_suppression_list WHERE tenant_id = $1 AND email = $2`,
    [tenantId, toEmail],
  );
  if (suppressed.rows.length > 0) {
    res.status(400).json({ error: 'Contact is on suppression list' });
    return;
  }

  // Generate unsubscribe link with HMAC
  const unsubSig = crypto
    .createHmac('sha256', WIZMATCH_UNSUBSCRIBE_HMAC_SECRET || 'default-secret')
    .update(toEmail)
    .digest('base64url');

  const unsubLink = `https://api.growthescalators.com/api/wizmatch/unsubscribe?email=${encodeURIComponent(toEmail)}&sig=${unsubSig}`;

  // Render email body
  const renderedBody = draft.content
    .replace('[UNSUBSCRIBE_LINK]', unsubLink)
    .replace('[PHYSICAL_ADDRESS]', WIZMATCH_PHYSICAL_ADDRESS);

  // Send via multi-domain mailer
  try {
    const { sendColdEmail } = await import('../services/multiDomainMailer');
    const sendResult = await sendColdEmail({
      to: toEmail,
      subject: draft.metadata.subject,
      body: renderedBody,
      fromName: 'Archit',
      tenantId,
    });

    // Update message status to sent
    await pool.query(
      `UPDATE messages SET status = 'sent', sent_at = NOW(), metadata = metadata || $3::jsonb WHERE id = $1 AND tenant_id = $2`,
      [draft.id, tenantId, JSON.stringify({ ...draft.metadata, sent_from: sendResult.from, domain: sendResult.domain })],
    );

    // Update signal status
    await pool.query(
      `UPDATE wizmatch_job_signals SET status = 'sent' WHERE id = $1 AND tenant_id = $2`,
      [draft.metadata.signal_id, tenantId],
    );

    // Enroll in follow-up sequence (find the Wizmatch sequence)
    const seqResult = await pool.query(
      `SELECT id FROM sequences WHERE tenant_id = $1 AND name LIKE '%Wizmatch%' AND is_active = true LIMIT 1`,
      [tenantId],
    );
    if (seqResult.rows.length > 0) {
      const seqId = seqResult.rows[0].id;
      const nextStepAt = new Date(Date.now() + 3 * 86400000); // Day 3 follow-up
      await db.insert(sequenceEnrolments).values({
        tenantId,
        contactId: draft.contact_id,
        sequenceId: seqId,
        currentStep: 0,
        status: 'active',
        nextStepAt,
      }).onConflictDoNothing();
    }

    res.json({ messageId: draft.id, sent: true, from: sendResult.from, domain: sendResult.domain });
  } catch (e) {
    logger.error({ err: e }, '[wizmatch] send failed');
    res.status(500).json({ error: 'send failed', detail: e instanceof Error ? e.message : 'unknown' });
  }
});

// ============================================================
// SECTION 2 — CANDIDATE ROUTES
// ============================================================

router.get('/candidates', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const conditions: string[] = ['wc.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramIdx = 2;

  if (req.query.skill) {
    conditions.push(`$${paramIdx++}::text = ANY(wc.skills)`);
    params.push(req.query.skill);
  }
  if (req.query.visa_status) {
    conditions.push(`wc.visa_status = $${paramIdx++}`);
    params.push(req.query.visa_status);
  }
  if (req.query.availability_status) {
    conditions.push(`wc.availability_status = $${paramIdx++}`);
    params.push(req.query.availability_status);
  }
  if (req.query.source) {
    conditions.push(`wc.source = $${paramIdx++}`);
    params.push(req.query.source);
  }

  const whereClause = conditions.join(' AND ');
  const dataResult = await pool.query(
    `SELECT wc.*, c.first_name, c.last_name, c.company_name
     FROM wizmatch_candidates wc
     JOIN contacts c ON c.id = wc.contact_id
     WHERE ${whereClause}
     ORDER BY wc.created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset],
  );

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM wizmatch_candidates wc WHERE ${whereClause}`,
    params,
  );

  res.json({ items: dataResult.rows, total: countResult.rows[0]?.total ?? 0 });
});

router.post('/candidates', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const body = req.body as {
    name: string; email: string; skills: string[]; location?: string;
    visa_status?: string; rate_hourly?: number; availability_date?: string;
    source?: string; linkedin_url?: string; github_url?: string;
  };

  // Create contact via findOrCreateContact
  const [firstName, ...lastNameParts] = body.name.split(' ');
  const { contact } = await findOrCreateContact(tenantId, {
    firstName,
    lastName: lastNameParts.join(' ') || undefined,
    source: 'wizmatch_manual',
    channels: [{ channelType: 'email', channelValue: body.email, isPrimary: true }],
  });

  const [candidate] = await db
    .insert(wizmatchCandidates)
    .values({
      tenantId,
      contactId: contact.id,
      skills: body.skills,
      location: body.location,
      visaStatus: body.visa_status,
      rateHourly: body.rate_hourly,
      availabilityDate: body.availability_date,
      source: body.source || 'manual',
      linkedinUrl: body.linkedin_url,
      githubUrl: body.github_url,
    })
    .returning();

  res.json(candidate);
});

router.get('/candidates/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const result = await pool.query(
    `SELECT wc.*, c.first_name, c.last_name, c.company_name
     FROM wizmatch_candidates wc
     JOIN contacts c ON c.id = wc.contact_id
     WHERE wc.id = $1 AND wc.tenant_id = $2`,
    [req.params.id, tenantId],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Candidate not found' });
    return;
  }
  res.json(result.rows[0]);
});

router.put('/candidates/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const updates = req.body;

  // Build SET clause dynamically
  const allowedFields = [
    'skills', 'location', 'visa_status', 'rate_hourly', 'rate_currency',
    'availability_date', 'availability_status', 'source', 'linkedin_url',
    'github_url', 'resume_url', 'is_wizmatch_certified', 'india_specific',
  ];

  const setClauses: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [req.params.id, tenantId];
  let paramIdx = 3;

  for (const [key, value] of Object.entries(updates)) {
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (allowedFields.includes(snakeKey)) {
      setClauses.push(`${snakeKey} = $${paramIdx++}`);
      params.push(value);
    }
  }

  const result = await pool.query(
    `UPDATE wizmatch_candidates SET ${setClauses.join(', ')}
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    params,
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Candidate not found' });
    return;
  }
  res.json(result.rows[0]);
});

// ============================================================
// SECTION 3 — PLACEMENT ROUTES
// ============================================================

router.get('/placements', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const conditions: string[] = ['wp.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramIdx = 2;

  if (req.query.status) {
    conditions.push(`wp.status = $${paramIdx++}`);
    params.push(req.query.status);
  }
  if (req.query.candidate_id) {
    conditions.push(`wp.candidate_id = $${paramIdx++}`);
    params.push(req.query.candidate_id);
  }
  if (req.query.company_id) {
    conditions.push(`wp.company_id = $${paramIdx++}`);
    params.push(req.query.company_id);
  }

  const whereClause = conditions.join(' AND ');
  const result = await pool.query(
    `SELECT wp.*, c.first_name AS candidate_first, c.last_name AS candidate_last,
            comp.name AS company_name, js.job_title
     FROM wizmatch_placements wp
     LEFT JOIN wizmatch_candidates wc ON wc.id = wp.candidate_id
     LEFT JOIN contacts c ON c.id = wc.contact_id
     LEFT JOIN wizmatch_companies comp ON comp.id = wp.company_id
     LEFT JOIN wizmatch_job_signals js ON js.id = wp.job_signal_id
     WHERE ${whereClause}
     ORDER BY wp.created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset],
  );

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM wizmatch_placements wp WHERE ${whereClause}`,
    params,
  );

  res.json({ items: result.rows, total: countResult.rows[0]?.total ?? 0 });
});

router.post('/placements', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const body = req.body as {
    candidate_id: string; job_signal_id?: string; company_id?: string;
    prime_company_id?: string; placement_type: string;
    bill_rate_hourly?: number; pay_rate_hourly?: number;
    contract_start_date?: string; contract_end_date?: string;
    contract_length_months?: number; perm_fee_percentage?: number; perm_ctc_annual?: number;
  };

  // Compute margin or perm fee
  let marginHourly: number | null = null;
  let permFeeAmount: number | null = null;
  if (body.bill_rate_hourly && body.pay_rate_hourly) {
    marginHourly = body.bill_rate_hourly - body.pay_rate_hourly;
  }
  if (body.perm_ctc_annual && body.perm_fee_percentage) {
    permFeeAmount = Math.round(body.perm_ctc_annual * body.perm_fee_percentage / 100);
  }

  // Get candidate's contact_id for the deal
  const candResult = await pool.query(
    `SELECT contact_id FROM wizmatch_candidates WHERE id = $1 AND tenant_id = $2`,
    [body.candidate_id, tenantId],
  );
  if (candResult.rows.length === 0) {
    res.status(404).json({ error: 'Candidate not found' });
    return;
  }
  const contactId = candResult.rows[0].contact_id;

  // Find or create a Wizmatch pipeline
  let pipelineResult = await pool.query(
    `SELECT id FROM pipelines WHERE tenant_id = $1 AND slug = 'wizmatch-placements' LIMIT 1`,
    [tenantId],
  );
  let pipelineId = pipelineResult.rows[0]?.id;

  // Create deal
  const dealResult = await pool.query(
    `INSERT INTO deals (tenant_id, contact_id, pipeline_id, title, stage, value, deal_value, service_type, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'submitted', $5, $6, 'staffing', NOW(), NOW())
     RETURNING id`,
    [
      tenantId,
      contactId,
      pipelineId,
      `Placement: ${body.placement_type}`,
      marginHourly ? String(marginHourly * 160) : String(permFeeAmount || 0),
      permFeeAmount || marginHourly,
    ],
  );
  const dealId = dealResult.rows[0].id;

  const [placement] = await db
    .insert(wizmatchPlacements)
    .values({
      tenantId,
      dealId,
      candidateId: body.candidate_id,
      jobSignalId: body.job_signal_id,
      companyId: body.company_id,
      primeCompanyId: body.prime_company_id,
      placementType: body.placement_type,
      billRateHourly: body.bill_rate_hourly,
      payRateHourly: body.pay_rate_hourly,
      marginHourly,
      contractStartDate: body.contract_start_date,
      contractEndDate: body.contract_end_date,
      contractLengthMonths: body.contract_length_months,
      permFeePercentage: body.perm_fee_percentage?.toString(),
      permCtcAnnual: body.perm_ctc_annual,
      permFeeAmount,
      status: 'submitted',
    })
    .returning();

  res.json(placement);
});

// POST /api/wizmatch/placements/:id/rtr — generate RTR PDF and upload to R2
router.post('/placements/:id/rtr', async (req: Request, res: Response) => {
  const { generateRtrPdf } = await import('../services/wizmatchRtrGenerator');
  const result = await generateRtrPdf(String(req.params.id));
  if (!result.success) {
    res.status(500).json({ error: result.error });
    return;
  }

  // Slack alert
  if (WIZMATCH_LEADS_CHANNEL) {
    await sendSlackMessage(
      WIZMATCH_LEADS_CHANNEL,
      `📄 RTR generated for placement ${req.params.id}: ${result.rtr_url}`,
    ).catch(() => {});
  }

  res.json({ rtr_url: result.rtr_url });
});

router.put('/placements/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { status } = req.body as { status: string };

  if (status) {
    const result = await pool.query(
      `UPDATE wizmatch_placements SET status = $3, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, tenantId, status],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Placement not found' });
      return;
    }

    // Log status change event
    await pool.query(
      `INSERT INTO events (tenant_id, event_type, payload, source_id, occurred_at)
       VALUES ($1, 'placement_status_change', $2::jsonb, $3, NOW())`,
      [tenantId, JSON.stringify({ placementId: req.params.id, newStatus: status }), req.params.id],
    );

    res.json(result.rows[0]);
  } else {
    res.status(400).json({ error: 'Only status updates supported' });
  }
});

// ============================================================
// SECTION 4 — PRIME ROUTES
// ============================================================

router.get('/primes', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const result = await pool.query(
    `SELECT wc.*,
            (SELECT COUNT(*)::int FROM wizmatch_placements wp WHERE wp.prime_company_id = wc.id AND wp.status NOT IN ('lost','ended')) AS active_placements,
            (SELECT COALESCE(SUM(margin_hourly * 160), 0)::int FROM wizmatch_placements wp WHERE wp.prime_company_id = wc.id AND wp.status IN ('started')) AS monthly_margin
     FROM wizmatch_companies wc
     WHERE wc.tenant_id = $1 AND wc.is_prime = true
     ORDER BY wc.name`,
    [tenantId],
  );
  res.json({ items: result.rows });
});

router.post('/primes', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { company_id } = req.body as { company_id: string };

  const result = await pool.query(
    `UPDATE wizmatch_companies SET is_prime = true, updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [company_id, tenantId],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Company not found' });
    return;
  }
  res.json(result.rows[0]);
});

// ============================================================
// SECTION 5 — DOMAIN HEALTH ROUTES
// ============================================================

router.get('/domains', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const result = await pool.query(
    `SELECT * FROM wizmatch_domain_health WHERE tenant_id = $1 ORDER BY domain`,
    [tenantId],
  );
  res.json({ items: result.rows });
});

router.post('/domains/:id/pause', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { reason } = req.body as { reason: string };
  const result = await pool.query(
    `UPDATE wizmatch_domain_health SET status = 'paused', paused_reason = $3, paused_at = NOW()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [req.params.id, tenantId, reason],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Domain not found' });
    return;
  }

  if (WIZMATCH_SYSTEM_CHANNEL) {
    await sendSlackMessage(WIZMATCH_SYSTEM_CHANNEL, `⏸️ Domain *${result.rows[0].domain}* paused: ${reason}`).catch(() => {});
  }

  res.json(result.rows[0]);
});

router.post('/domains/:id/resume', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const result = await pool.query(
    `UPDATE wizmatch_domain_health SET status = 'healthy', paused_reason = NULL, paused_at = NULL
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [req.params.id, tenantId],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Domain not found' });
    return;
  }

  if (WIZMATCH_SYSTEM_CHANNEL) {
    await sendSlackMessage(WIZMATCH_SYSTEM_CHANNEL, `▶️ Domain *${result.rows[0].domain}* resumed`).catch(() => {});
  }

  res.json(result.rows[0]);
});

// ============================================================
// SECTION 6 — COMPLIANCE ROUTES
// ============================================================

router.get('/suppression', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramIdx = 2;

  if (req.query.email) {
    conditions.push(`email = $${paramIdx++}`);
    params.push(req.query.email);
  }
  if (req.query.reason) {
    conditions.push(`reason = $${paramIdx++}`);
    params.push(req.query.reason);
  }

  const whereClause = conditions.join(' AND ');
  const result = await pool.query(
    `SELECT * FROM wizmatch_suppression_list WHERE ${whereClause}
     ORDER BY suppressed_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset],
  );

  res.json({ items: result.rows });
});

router.post('/suppression', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { email, reason, source_channel, notes } = req.body as {
    email: string; reason: string; source_channel?: string; notes?: string;
  };

  try {
    const [entry] = await db
      .insert(wizmatchSuppressionList)
      .values({
        tenantId,
        email: email.toLowerCase().trim(),
        reason,
        sourceChannel: source_channel || 'email',
        notes,
      })
      .onConflictDoNothing()
      .returning();

    // Also set contact_channels email_opt_out if contact exists
    await pool.query(
      `UPDATE contacts SET do_not_contact = true, opted_in_email = false
       WHERE tenant_id = $1 AND id IN (
         SELECT contact_id FROM contact_channels WHERE channel_type = 'email' AND channel_value = $2
       )`,
      [tenantId, email.toLowerCase().trim()],
    ).catch(() => {});

    res.json(entry || { suppressed: true, already_existed: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to suppress', detail: e instanceof Error ? e.message : 'unknown' });
  }
});

// GET /api/wizmatch/unsubscribe — public, HMAC-verified
router.get('/unsubscribe', async (req: Request, res: Response) => {
  const email = (req.query.email as string)?.toLowerCase().trim();
  const sig = req.query.sig as string;

  if (!email || !sig) {
    res.status(400).type('html').send('<h1>Invalid unsubscribe link</h1>');
    return;
  }

  // Verify HMAC
  const expectedSig = crypto
    .createHmac('sha256', WIZMATCH_UNSUBSCRIBE_HMAC_SECRET || 'default-secret')
    .update(email)
    .digest('base64url');

  if (sig !== expectedSig) {
    res.status(403).type('html').send('<h1>Invalid signature</h1>');
    return;
  }

  // Get tenant from any wizmatch_suppression matching — fall back to WIZMATCH_TENANT_ID
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  if (!tenantId) {
    res.status(500).type('html').send('<h1>Server misconfigured</h1>');
    return;
  }

  await db
    .insert(wizmatchSuppressionList)
    .values({
      tenantId,
      email,
      reason: 'unsubscribe',
      sourceChannel: 'email',
    })
    .onConflictDoNothing();

  // Also set do_not_contact on any matching contact
  await pool.query(
    `UPDATE contacts SET do_not_contact = true, opted_in_email = false
     WHERE tenant_id = $1 AND id IN (
       SELECT contact_id FROM contact_channels WHERE channel_type = 'email' AND channel_value = $2
     )`,
    [tenantId, email],
  ).catch(() => {});

  if (WIZMATCH_SYSTEM_CHANNEL) {
    await sendSlackMessage(WIZMATCH_SYSTEM_CHANNEL, `🚫 Unsubscribe: ${email}`).catch(() => {});
  }

  res.type('html').send(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>Unsubscribed — Wizmatch</title></head>
    <body style="font-family: system-ui; max-width: 500px; margin: 80px auto; text-align: center; color: #333;">
      <h1>You've been unsubscribed</h1>
      <p>You will no longer receive outreach emails from Wizmatch.</p>
      <p style="color: #888; font-size: 14px;">${email}</p>
    </body>
    </html>
  `);
});

// ============================================================
// SECTION 7 — REPLY CLASSIFICATION (internal)
// ============================================================

router.post('/classify-reply', requireInternalToken, async (req: Request, res: Response) => {
  const tenantId = process.env.WIZMATCH_TENANT_ID!;
  const { signal_id, reply_text, contact_email } = req.body as {
    signal_id: string; reply_text: string; contact_email: string;
  };

  if (!reply_text || !contact_email) {
    res.status(400).json({ error: 'reply_text and contact_email required' });
    return;
  }

  try {
    // Reuse the existing Haiku classifier from outreachEnrichmentService
    // Signature: classifyReplyWithAI(replyBody, originalIcebreaker, companyName)
    // Returns: { category, confidence, summary, draftReply }
    // Categories: INTERESTED | NOT_NOW | NOT_INTERESTED | UNSUBSCRIBE | UNCATEGORIZED
    const { classifyReplyWithAI } = await import('../services/outreachEnrichmentService');
    const result = await classifyReplyWithAI(reply_text, '', contact_email);

    // Map outreach categories to Wizmatch signal status
    if (result.category === 'INTERESTED') {
      await pool.query(
        `UPDATE wizmatch_job_signals SET status = 'replied_positive' WHERE id = $1 AND tenant_id = $2`,
        [signal_id, tenantId],
      );

      // Positive reply: Slack alert + create SDR task
      if (WIZMATCH_LEADS_CHANNEL) {
        await sendSlackMessage(
          WIZMATCH_LEADS_CHANNEL,
          `🔥 *POSITIVE REPLY* from ${contact_email}\nCategory: ${result.category} (${result.confidence}%)\nSummary: ${result.summary}`,
        ).catch(() => {});
      }

      // Create SDR task
      await pool.query(
        `INSERT INTO tasks (tenant_id, title, description, status, due_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'open', NOW() + INTERVAL '2 hours', NOW(), NOW())`,
        [
          tenantId,
          `Call ${contact_email} re: positive reply`,
          `Signal: ${signal_id}\nSummary: ${result.summary}\nReply: ${reply_text.slice(0, 500)}`,
        ],
      );
    } else if (result.category === 'NOT_INTERESTED' || result.category === 'UNSUBSCRIBE') {
      await pool.query(
        `UPDATE wizmatch_job_signals SET status = 'dead' WHERE id = $1 AND tenant_id = $2`,
        [signal_id, tenantId],
      );

      // Auto-suppress
      await db.insert(wizmatchSuppressionList).values({
        tenantId,
        email: contact_email,
        reason: result.category === 'UNSUBSCRIBE' ? 'unsubscribe' : 'do_not_contact',
        sourceChannel: 'email',
      }).onConflictDoNothing();
    } else if (result.category === 'NOT_NOW') {
      // Reschedule — set status back to sent for sequence to handle nurture
      await pool.query(
        `UPDATE wizmatch_job_signals SET status = 'sent' WHERE id = $1 AND tenant_id = $2`,
        [signal_id, tenantId],
      );
    }

    res.json({ signal_id, classification: result });
  } catch (e) {
    logger.error({ err: e }, '[wizmatch] classify-reply failed');
    res.status(500).json({ error: 'classification failed', detail: e instanceof Error ? e.message : 'unknown' });
  }
});

// ============================================================
// SECTION 8 — ANALYTICS + DIGEST
// ============================================================

router.get('/digest', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);

  const stats = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM wizmatch_job_signals WHERE tenant_id = $1 AND created_at::date = $2) AS signals_captured,
       (SELECT COUNT(*)::int FROM wizmatch_job_signals WHERE tenant_id = $1 AND created_at::date = $2 AND score >= 7) AS signals_priority,
       (SELECT COUNT(*)::int FROM messages WHERE tenant_id = $1 AND sent_at::date = $2 AND channel = 'email' AND direction = 'outbound') AS sends,
       (SELECT COUNT(*)::int FROM wizmatch_job_signals WHERE tenant_id = $1 AND status = 'replied_positive' AND updated_at::date = $2) AS positive_replies,
       (SELECT COUNT(*)::int FROM wizmatch_candidates WHERE tenant_id = $1 AND created_at::date = $2) AS candidates_sourced,
       (SELECT COUNT(*)::int FROM wizmatch_job_signals WHERE tenant_id = $1 AND status = 'matched' AND updated_at::date = $2) AS matches_made,
       (SELECT COUNT(*)::int FROM wizmatch_placements WHERE tenant_id = $1 AND updated_at::date = $2) AS placements_updated
    `,
    [tenantId, date],
  );

  res.json({ date, stats: stats.rows[0] });
});

router.get('/analytics', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const from = (req.query.from as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);

  // Reply rate by domain
  const domainStats = await pool.query(
    `SELECT
       d.domain,
       d.sends_7d,
       d.reply_rate_7d,
       d.bounce_rate_7d,
       d.status
     FROM wizmatch_domain_health d
     WHERE d.tenant_id = $1
     ORDER BY d.domain`,
    [tenantId],
  );

  // Pipeline value by stage
  const pipelineStats = await pool.query(
    `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(margin_hourly * 160), 0)::int AS monthly_value
     FROM wizmatch_placements
     WHERE tenant_id = $1
     GROUP BY status
     ORDER BY status`,
    [tenantId],
  );

  // Signal source breakdown
  const sourceStats = await pool.query(
    `SELECT source, COUNT(*)::int AS count, AVG(score)::real AS avg_score
     FROM wizmatch_job_signals
     WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3
     GROUP BY source
     ORDER BY count DESC`,
    [tenantId, from, to + ' 23:59:59'],
  );

  res.json({
    from,
    to,
    domains: domainStats.rows,
    pipeline: pipelineStats.rows,
    sources: sourceStats.rows,
  });
});

export default router;