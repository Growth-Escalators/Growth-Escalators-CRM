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
 *
 * Also hosts `releaseEnrolment` / `runEnrolmentReleaseActions` — the only writer of
 * the `manually_released` terminal enrolment state (see the section header below).
 */

import { db, pool } from '../db/index';
import { messages, sequenceEnrolments } from '../db/schema';
import { callClaude, parseClaudeJSON, CLAUDE_MODELS } from './claudeService';
import {
  WIZMATCH_PHYSICAL_ADDRESS,
} from '../config/constants';
import { WIZMATCH_LIVE_ENROLMENT_STATES } from '../config/wizmatchOutreachStates';
import { auditLog } from './auditLogger';
import logger from '../utils/logger';
import { evaluateWizmatchOutreachGate, shouldBlock } from '../modules/outreach/outreachGate';
import { mintUnsubscribeToken } from '../modules/outreach/unsubscribeToken';

/** §8.10.1 rows 1/2/3 — every row needs the signal's company_id to call the gate. */
async function getSignalCompanyId(tenantId: string, signalId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT company_id FROM wizmatch_job_signals WHERE id = $1 AND tenant_id = $2`,
    [signalId, tenantId],
  );
  return result.rows[0]?.company_id ?? null;
}

export type DraftResult =
  | { kind: 'not_found' }
  | { kind: 'no_contact' }
  | { kind: 'blocked'; reasonCodes: string[] }
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

  // §8.10.1 row 4 — the chokepoint applies to queueing (drafting), not only sending.
  // Gated on `shouldBlock`, never on a hand-written predicate: §8.10 rule 2
  // forbids a caller deriving its own partial check, and an inline
  // `decision === 'deny'` would silently let a `review` decision through here
  // while every other send/queue site blocks it.
  if (signal.company_id) {
    const gateCtx = {
      tenantId,
      action: 'queue' as const,
      companyId: signal.company_id,
      contactId: signal.contact_id,
      outreachMode: 'cold_email' as const,
    };
    const decision = await evaluateWizmatchOutreachGate(gateCtx);
    if (shouldBlock(gateCtx, decision)) {
      return { kind: 'blocked', reasonCodes: decision.reasonCodes };
    }
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
  | { kind: 'blocked'; reasonCodes: string[] }
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

  // Normalised once here — minted (below) and verified (routes/wizmatch.ts
  // /unsubscribe) MUST sign the same string, or every mixed-case recipient
  // gets a permanently broken unsubscribe link (§8.10.1 row 26).
  const toEmail = String(emailResult.rows[0].channel_value).trim().toLowerCase();

  // §8.10.1 rows 1/2/25-29 — the gate's suppression union is the sole check
  // (replaces the old inline, non-lowercased wizmatch_suppression_list query).
  const companyId = await getSignalCompanyId(tenantId, draft.metadata.signal_id);
  const decision = await evaluateWizmatchOutreachGate({
    tenantId,
    action: 'send',
    companyId: companyId ?? undefined,
    contactId: draft.contact_id,
    email: toEmail,
    outreachMode: 'cold_email',
  });
  if (shouldBlock({ tenantId, action: 'send', companyId: companyId ?? undefined, contactId: draft.contact_id }, decision)) {
    return { kind: 'blocked', reasonCodes: decision.reasonCodes };
  }

  // D-36: the unsubscribe link now signs tenant_id + normalised email +
  // expiry (not email alone), so verification never needs to guess which
  // tenant sent it. Fail closed: with no configured secret we must NOT mint
  // a link signed with a public default (that is forgeable), so refuse to
  // send rather than embed a bogus-signed / unverifiable link. Mirrors the
  // fail-closed posture of src/middleware/internalAuth.ts.
  const token = mintUnsubscribeToken(tenantId, toEmail);
  if (!token) {
    logger.error('[wizmatch] WIZMATCH_UNSUBSCRIBE_HMAC_SECRET not set — refusing to embed a forgeable unsubscribe link');
    return { kind: 'hmac_secret_unset' };
  }

  const unsubLink = `https://api.growthescalators.com/api/wizmatch/unsubscribe?v=2&tenantId=${encodeURIComponent(token.tenantId)}&email=${encodeURIComponent(token.email)}&exp=${token.exp}&sig=${encodeURIComponent(token.sig)}`;

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

    // Enroll in follow-up sequence (find the Wizmatch sequence).
    // §8.10.1 row 3 — this raw insert previously bypassed enrolContact and
    // therefore every check of any kind; it now goes through the same gate
    // as the send above before re-enrolling. Full migration onto
    // wizmatch_outreach_enrolments (rather than the generic CRM
    // sequence_enrolments table) is out of scope for this PR — stated, not
    // hidden, matching PR 2's documented-scope-limit convention.
    const followUpDecision = await evaluateWizmatchOutreachGate({
      tenantId,
      action: 're_enrol',
      companyId: companyId ?? undefined,
      contactId: draft.contact_id,
      email: toEmail,
      outreachMode: 'cold_email',
    });
    if (!shouldBlock({ tenantId, action: 're_enrol', companyId: companyId ?? undefined, contactId: draft.contact_id }, followUpDecision)) {
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
    }

    return { kind: 'succeeded', body: { messageId: draft.id, sent: true, from: sendResult.from, domain: sendResult.domain } };
  } catch (e) {
    logger.error({ err: e }, '[wizmatch] send failed');
    return { kind: 'failed', detail: e instanceof Error ? e.message : 'unknown' };
  }
}

// ---------------------------------------------------------------------------
// Manual release of an outreach enrolment — the ONLY writer of the
// `manually_released` terminal state (PRD-005 §10.6.1, ADR-006 D-6).
//
// D-6 deliberately keeps the company cold-email lock held through every reply
// state: `replied`, `awaiting_action`, `positive_reply`, `referral_received`
// and `conversation_open` are all in WIZMATCH_LIVE_ENROLMENT_STATES, so a reply
// never silently re-opens a company to cold email. The intended escape hatch is
// an explicit, audited transition to a terminal state — and until this function
// `manually_released` was written by NOTHING: it appeared only in schema.ts and
// its CHECK constraints, with no transition to any terminal state anywhere in
// src/. The practical effect was that a prospect replying locked their company
// out of cold email permanently, with no operator path back.
// ---------------------------------------------------------------------------

/**
 * Derived, never spelled out. The four partial-unique-index predicates in
 * schema.ts (§10.6.2) derive their live-state lists from this same constant; a
 * literal copy here would silently drift from the DB constraints the day a
 * state is added, and the compare-and-set below would start releasing (or
 * refusing to release) rows the indexes still consider locked.
 */
const LIVE_ENROLMENT_STATES: string[] = [...WIZMATCH_LIVE_ENROLMENT_STATES];

/** A bulk release of every live enrolment in one request is not an operator action; it is an accident. */
const MAX_RELEASE_TARGETS = 100;

export interface EnrolmentReleaseActor {
  tenantId: string;
  userId?: string;
  role?: string;
}

export class EnrolmentReleaseValidationError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'EnrolmentReleaseValidationError';
    this.code = code;
  }
}

export type ReleaseEnrolmentResult =
  | {
      kind: 'released';
      enrolment: {
        id: string;
        companyId: string;
        contactId: string | null;
        batchId: string;
        previousState: string;
      };
    }
  /** The row exists for this tenant but is already terminal — reported, never re-written. */
  | { kind: 'already_released'; state: string }
  /** No row for (tenant, id). A cross-tenant id lands here too, by construction. */
  | { kind: 'not_found' };

/**
 * Releases ONE enrolment's company cold-email lock.
 *
 * The eligibility check is the `state = ANY(...)` predicate on the UPDATE
 * itself, not a preceding SELECT — the same race pattern `resolveDuplicate`
 * (modules/outreach/decisionWorkbenchActions.ts -> duplicateService.ts) uses for
 * `resolution = 'pending'`. Two operators releasing the same enrolment
 * concurrently means exactly one UPDATE matches; the loser sees zero rows and
 * is reported `already_released` rather than writing a second
 * `released_by_user_id`/`release_reason` over the first operator's decision.
 *
 * Tenant scoping is part of the same predicate, so an enrolment id belonging to
 * another tenant is indistinguishable from one that does not exist.
 */
export async function releaseEnrolment(
  actor: EnrolmentReleaseActor,
  enrolmentId: string,
  reason: string,
): Promise<ReleaseEnrolmentResult> {
  // `wizmatch_outreach_enrolments_manually_released_chk` requires BOTH
  // released_by_user_id and release_reason to be non-null whenever state is
  // 'manually_released'. Validating here turns a missing actor or reason into a
  // clean rejection instead of a Postgres constraint violation surfacing as a 500.
  if (!actor.userId) {
    throw new EnrolmentReleaseValidationError(
      'Releasing an enrolment requires an authenticated actor with a user id.',
      'actor_required',
    );
  }
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmedReason) {
    throw new EnrolmentReleaseValidationError(
      'A release reason is required — releasing re-opens the company to cold email.',
      'release_reason_required',
    );
  }
  if (typeof enrolmentId !== 'string' || !enrolmentId.trim()) {
    throw new EnrolmentReleaseValidationError('A non-empty enrolment id is required.', 'enrolment_id_required');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // The `prev` self-join reads the pre-UPDATE snapshot of the same row, so
    // RETURNING can report the state we released FROM. Without it the audit
    // trail loses which live state (queued vs a live conversation) was ended,
    // because RETURNING on the updated row only ever sees 'manually_released'.
    const updated = await client.query(
      `UPDATE wizmatch_outreach_enrolments AS e
          SET state = 'manually_released',
              released_by_user_id = $3,
              release_reason = $4,
              state_at = NOW(),
              updated_at = NOW()
         FROM wizmatch_outreach_enrolments AS prev
        WHERE prev.id = e.id
          AND e.tenant_id = $1
          AND e.id = $2
          AND e.state = ANY($5::text[])
       RETURNING e.id, e.company_id, e.contact_id, e.batch_id, prev.state AS previous_state`,
      [actor.tenantId, enrolmentId, actor.userId, trimmedReason, LIVE_ENROLMENT_STATES],
    );

    const row = updated.rows[0];
    if (!row) {
      // Read AFTER the failed write, purely to tell the operator which of the
      // two zero-row causes they hit. It gates nothing — the decision to write
      // was already made and lost by the UPDATE's own predicate above.
      const current = await client.query(
        `SELECT state FROM wizmatch_outreach_enrolments WHERE tenant_id = $1 AND id = $2`,
        [actor.tenantId, enrolmentId],
      );
      await client.query('ROLLBACK');
      if (current.rows.length === 0) return { kind: 'not_found' };
      return { kind: 'already_released', state: String(current.rows[0].state) };
    }

    // Same transaction as the state change, following qualifySignalAndCreatePocTask
    // (services/wizmatchSourcing.ts): a released lock with no event on the
    // company timeline is an unexplained re-opening of cold email.
    await client.query(
      `INSERT INTO wizmatch_staffing_events
         (tenant_id, actor_user_id, event_type, source, source_id, company_id, contact_id, payload)
       VALUES ($1, $2, 'outreach_enrolment.manually_released', 'outreach', $3, $4, $5, $6::jsonb)`,
      [
        actor.tenantId,
        actor.userId,
        enrolmentId,
        row.company_id,
        row.contact_id,
        JSON.stringify({
          enrolmentId,
          batchId: row.batch_id,
          fromState: row.previous_state,
          toState: 'manually_released',
          releaseReason: trimmedReason,
        }),
      ],
    );

    await client.query('COMMIT');

    await auditLog({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'wizmatch_outreach_enrolment_released',
      entityType: 'wizmatch_outreach_enrolment',
      entityId: enrolmentId,
      oldValues: { state: row.previous_state },
      newValues: { state: 'manually_released', releaseReason: trimmedReason },
    });

    return {
      kind: 'released',
      enrolment: {
        id: String(row.id),
        companyId: String(row.company_id),
        contactId: row.contact_id ? String(row.contact_id) : null,
        batchId: String(row.batch_id),
        previousState: String(row.previous_state),
      },
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export interface EnrolmentReleaseTarget {
  type: 'enrolment';
  id: string;
}

export interface EnrolmentReleaseRequest {
  /** Only one action exists today; named explicitly so the endpoint can grow without changing shape. */
  action: 'release';
  targets: EnrolmentReleaseTarget[];
  reason: string;
}

export interface EnrolmentActionResult {
  type: 'enrolment';
  id: string;
  ok: boolean;
  error?: string;
  code?: string;
}

export interface EnrolmentActionsOutcome {
  requested: number;
  succeeded: number;
  failed: number;
  results: EnrolmentActionResult[];
}

/**
 * Whole-request rejection (a 400 at the route), matching
 * `validateRequestShape` in decisionWorkbenchActions.ts: a malformed or
 * over-large selection is refused outright, while per-target outcomes
 * (already released, not found) are reported in `results` so one target never
 * hides another.
 */
function validateReleaseRequestShape(request: EnrolmentReleaseRequest): void {
  if (request?.action !== 'release') {
    throw new EnrolmentReleaseValidationError(`Unknown action '${request?.action}'.`, 'unknown_action');
  }
  if (!Array.isArray(request.targets) || request.targets.length === 0) {
    throw new EnrolmentReleaseValidationError('targets must be a non-empty array.', 'targets_required');
  }
  if (request.targets.length > MAX_RELEASE_TARGETS) {
    throw new EnrolmentReleaseValidationError(
      `A release request may name at most ${MAX_RELEASE_TARGETS} enrolments.`,
      'too_many_targets',
    );
  }
  for (const target of request.targets) {
    if (!target || target.type !== 'enrolment' || typeof target.id !== 'string' || target.id.trim() === '') {
      throw new EnrolmentReleaseValidationError(
        "every target must be of type 'enrolment' with a non-empty id.",
        'mixed_invalid_targets',
      );
    }
  }
  if (typeof request.reason !== 'string' || !request.reason.trim()) {
    throw new EnrolmentReleaseValidationError(
      'A release reason is required — releasing re-opens the company to cold email.',
      'release_reason_required',
    );
  }
}

/** The sole entry point for `POST /api/wizmatch/today/enrolment-actions`. */
export async function runEnrolmentReleaseActions(
  actor: EnrolmentReleaseActor,
  request: EnrolmentReleaseRequest,
): Promise<EnrolmentActionsOutcome> {
  validateReleaseRequestShape(request);
  // Actor provenance is a whole-request property, not a per-target one: without
  // it every target would fail identically, so it belongs in the 400 alongside
  // the missing reason rather than being reported 100 times in `results`.
  if (!actor.userId) {
    throw new EnrolmentReleaseValidationError(
      'Releasing an enrolment requires an authenticated actor with a user id.',
      'actor_required',
    );
  }

  const results: EnrolmentActionResult[] = [];
  for (const target of request.targets) {
    try {
      const outcome = await releaseEnrolment(actor, target.id, request.reason);
      if (outcome.kind === 'released') {
        results.push({ type: 'enrolment', id: target.id, ok: true });
      } else if (outcome.kind === 'already_released') {
        results.push({
          type: 'enrolment',
          id: target.id,
          ok: false,
          error: `This enrolment is no longer live (state '${outcome.state}'); its release was already recorded.`,
          code: 'already_released',
        });
      } else {
        results.push({
          type: 'enrolment',
          id: target.id,
          ok: false,
          error: 'Enrolment not found.',
          code: 'not_found',
        });
      }
    } catch (error) {
      if (error instanceof EnrolmentReleaseValidationError) {
        results.push({ type: 'enrolment', id: target.id, ok: false, error: error.message, code: error.code });
        continue;
      }
      logger.error({ err: error, enrolmentId: target.id }, '[wizmatch] enrolment release failed');
      results.push({
        type: 'enrolment',
        id: target.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    requested: request.targets.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
