/**
 * Wizmatch — signal outreach (draft + send)
 *
 * Extracted from src/routes/wizmatch.ts (finding M26): the `/signals/:id/draft` and
 * `/signals/:id/send` route bodies, moved verbatim. Draft generation builds a Claude
 * prompt from the signal + matched candidates and persists 3 email variants as draft
 * messages. Sending renders the chosen draft, HMAC-signs an unsubscribe link, checks
 * the suppression list, sends via the multi-domain mailer, and enrolls the contact in
 * the Wizmatch follow-up sequence.
 *
 * The `WIZMATCH_SENDING_ENABLED` kill-switch is intentionally NOT here — it stays
 * inline in the `/signals/:id/send` route as a synchronous gate on the route itself.
 */

import crypto from 'crypto';
import { db, pool } from '../db/index';
import { messages, sequenceEnrolments } from '../db/schema';
import { callClaude, parseClaudeJSON, CLAUDE_MODELS } from './claudeService';
import {
  WIZMATCH_PHYSICAL_ADDRESS,
  WIZMATCH_UNSUBSCRIBE_HMAC_SECRET,
} from '../config/constants';
import logger from '../utils/logger';

export type DraftResult =
  | { kind: 'not_found' }
  | { kind: 'no_contact' }
  | { kind: 'succeeded'; body: { signalId: string; drafts: unknown[] } }
  | { kind: 'failed'; detail: string };

export async function generateSignalDraftEmails(tenantId: string, signalId: string): Promise<DraftResult> {
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
    return { kind: 'not_found' };
  }

  const signal = signalResult.rows[0];
  if (!signal.contact_id) {
    return { kind: 'no_contact' };
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

    return { kind: 'succeeded', body: { signalId, drafts: insertedDrafts } };
  } catch (e) {
    logger.error({ err: e }, '[wizmatch] draft generation failed');
    return { kind: 'failed', detail: e instanceof Error ? e.message : 'unknown' };
  }
}

export type SendDraftResult =
  | { kind: 'not_found' }
  | { kind: 'no_email_channel' }
  | { kind: 'suppressed' }
  | { kind: 'hmac_secret_unset' }
  | { kind: 'succeeded'; body: { messageId: string; sent: true; from: string; domain: string } }
  | { kind: 'failed'; detail: string };

export async function sendSignalDraftEmail(tenantId: string, variantMessageId: string): Promise<SendDraftResult> {
  // Get the draft message
  const msgResult = await pool.query(
    `SELECT m.*, cnt.first_name, cnt.last_name
     FROM messages m
     JOIN contacts cnt ON cnt.id = m.contact_id
     WHERE m.id = $1 AND m.tenant_id = $2`,
    [variantMessageId, tenantId],
  );

  if (msgResult.rows.length === 0) {
    return { kind: 'not_found' };
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
    return { kind: 'no_email_channel' };
  }

  const toEmail = emailResult.rows[0].channel_value;

  // Suppression check
  const suppressed = await pool.query(
    `SELECT id FROM wizmatch_suppression_list WHERE tenant_id = $1 AND email = $2`,
    [tenantId, toEmail],
  );
  if (suppressed.rows.length > 0) {
    return { kind: 'suppressed' };
  }

  // Generate unsubscribe link with HMAC. Fail closed: with no configured secret
  // we must NOT mint a link signed with a public default (that is forgeable), so
  // refuse to send rather than embed a bogus-signed / unverifiable link. Mirrors
  // the fail-closed posture of src/middleware/internalAuth.ts.
  const unsubSecret = WIZMATCH_UNSUBSCRIBE_HMAC_SECRET;
  if (!unsubSecret) {
    logger.error('[wizmatch] WIZMATCH_UNSUBSCRIBE_HMAC_SECRET not set — refusing to embed a forgeable unsubscribe link');
    return { kind: 'hmac_secret_unset' };
  }
  const unsubSig = crypto
    .createHmac('sha256', unsubSecret)
    .update(toEmail)
    .digest('base64url');

  const unsubLink = `https://api.growthescalators.com/api/wizmatch/unsubscribe?email=${encodeURIComponent(toEmail)}&sig=${unsubSig}`;

  // Render email body
  const renderedBody = draft.content
    .replace('[UNSUBSCRIBE_LINK]', unsubLink)
    .replace('[PHYSICAL_ADDRESS]', WIZMATCH_PHYSICAL_ADDRESS);

  // Send via multi-domain mailer
  try {
    const { sendColdEmail } = await import('./multiDomainMailer');
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

    return { kind: 'succeeded', body: { messageId: draft.id, sent: true, from: sendResult.from, domain: sendResult.domain } };
  } catch (e) {
    logger.error({ err: e }, '[wizmatch] send failed');
    return { kind: 'failed', detail: e instanceof Error ? e.message : 'unknown' };
  }
}
