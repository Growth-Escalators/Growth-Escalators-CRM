import { and, eq, lte, or, sql } from 'drizzle-orm';
import { db, jobs, messages, waLeadAcks } from '../../db/index';
import { insertJob, completeJob, failJob } from '../jobQueue';
import {
  KAPSO_TEMPLATE_NAME,
  KAPSO_TEMPLATE_LANGUAGE,
  KAPSO_TEMPLATE_PARAM_NAMES,
} from '../../config/constants';
import { assigneeDisplayName } from '../leadAssignmentService';
import { redactPhone } from '../phoneService';
import * as policy from './outboundPolicy';
import * as kapso from './kapsoClient';
import logger from '../../utils/logger';

/**
 * WhatsApp acknowledgement for a website lead: enqueue, drain, send, record.
 *
 * ANCHORED ON THE EVENT ROW, NOT A NEW TABLE.
 *   POST /api/leads/website already writes exactly one `events` row per form
 *   submission (eventType 'website_lead_submitted'). That row is the canonical
 *   per-submission record, so it is the idempotency anchor here — a second
 *   "lead submissions" table would have duplicated a concept the CRM already
 *   models. `wa_lead_acks` is an acknowledgement ledger keyed by that event id,
 *   not a second lead ledger.
 *
 * RELIABILITY.
 *   The lead is committed and the HTTP response returned before a job row is
 *   written. A Kapso or Meta outage therefore costs an acknowledgement, never a
 *   lead.
 *
 * IDEMPOTENCY.
 *   jobs.idempotency_key is UNIQUE and derived from the event id, so a repeated
 *   enqueue is a database no-op. The drainer then claims each job with a
 *   conditional UPDATE so two workers cannot both take it. The policy gate's
 *   cooldown check is a third net.
 */

export const JOB_TYPE = 'wa_lead_ack';

export interface AckJobPayload {
  eventId: string;
  tenantId: string;
  contactId: string;
  firstName: string;
  service: string;
  assignedTo: string | null;
  phoneSubmitted: string;
  phoneE164: string | null;
  regionHint?: string;
  consentGiven: boolean;
}

/**
 * WhatsApp template variables must not contain newlines, tabs, or runs of 4+
 * spaces — Meta rejects the send outright. They are also the one place
 * visitor-controlled text reaches a message, so length is hard-capped and
 * control characters stripped rather than trusting upstream validation.
 */
export function sanitizeVariable(raw: string, fallback: string, maxLength = 60): string {
  const cleaned = (raw ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trim()}…` : cleaned;
}

/**
 * Build the three approved template variables with safe fallbacks.
 *
 * Supports both template parameter styles. A template created with NAMED
 * parameters ({{customer_name}}) must be sent with a parameter_name on every
 * parameter; a positional template ({{1}}) must be sent without them. Meta
 * treats a mismatch as a permanent error, so this is configuration, not a
 * detail — set KAPSO_TEMPLATE_PARAM_NAMES to the template's names in order.
 */
export function buildVariables(payload: Pick<AckJobPayload, 'firstName' | 'service' | 'assignedTo'>) {
  const values = [
    sanitizeVariable(payload.firstName.split(/\s+/)[0] ?? '', 'there', 40),
    sanitizeVariable(payload.service, 'your enquiry', 60),
    sanitizeVariable(assigneeDisplayName(payload.assignedTo), 'our team', 40),
  ];

  return values.map((text, i) => {
    const name = KAPSO_TEMPLATE_PARAM_NAMES[i];
    return name
      ? { type: 'text' as const, parameter_name: name, text }
      : { type: 'text' as const, text };
  });
}

async function setAckStatus(eventId: string, status: string, reason?: string, messageId?: string) {
  await db
    .insert(waLeadAcks)
    .values({
      eventId,
      status,
      reason: reason?.slice(0, 500) ?? null,
      messageId: messageId ?? null,
    })
    .onConflictDoUpdate({
      target: waLeadAcks.eventId,
      set: {
        status,
        ...(reason !== undefined ? { reason: reason.slice(0, 500) } : {}),
        ...(messageId !== undefined ? { messageId } : {}),
        updatedAt: new Date(),
      },
    });
}

/**
 * Queue an acknowledgement. Called after the lead transaction commits.
 * Never throws — a queueing failure must not surface to the visitor.
 */
export async function enqueueAck(payload: AckJobPayload): Promise<{ queued: boolean; duplicate: boolean }> {
  try {
    const { duplicate } = await insertJob(
      payload.tenantId,
      JOB_TYPE,
      payload as unknown as object,
      `wa_ack:${payload.eventId}`,
    );
    if (!duplicate) await setAckStatus(payload.eventId, 'queued');
    return { queued: true, duplicate };
  } catch (e) {
    logger.error('[wa_ack] failed to enqueue acknowledgement', (e as Error).message);
    return { queued: false, duplicate: false };
  }
}

/**
 * Atomically claim a job.
 *
 * jobQueue.claimJob() updates by id with no status predicate, so two concurrent
 * drainers could both "claim" the same row. This conditional version only
 * succeeds for the first caller.
 */
async function claimExclusively(jobId: string): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE jobs
       SET status = 'processing', processing_started_at = NOW()
     WHERE id = ${jobId}
       AND status IN ('pending', 'failed')
    RETURNING id
  `);
  return result.rows.length > 0;
}

/**
 * Fetch due jobs.
 *
 * Deliberately does NOT use jobQueue.getPendingJobs(): that helper filters on
 * status = 'pending' only, while failJob() parks retryable failures as 'failed'
 * with a future process_after. Selecting both statuses is what makes the
 * existing backoff actually retry. (Every other job type in the CRM inherits
 * that gap — see docs/WHATSAPP_LEAD_ACK.md.)
 */
async function getDueJobs(limit: number) {
  return db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.jobType, JOB_TYPE),
        or(eq(jobs.status, 'pending'), eq(jobs.status, 'failed')),
        lte(jobs.processAfter, new Date()),
      ),
    )
    .limit(limit);
}

/** Process one acknowledgement job. Exported for direct unit testing. */
export async function processAckJob(job: { id: string; payload: unknown }): Promise<string> {
  const payload = job.payload as AckJobPayload;

  const decision = await policy.evaluate({
    tenantId: payload.tenantId,
    contactId: payload.contactId,
    phoneSubmitted: payload.phoneSubmitted,
    phoneE164: payload.phoneE164,
    regionHint: payload.regionHint,
    consentGiven: payload.consentGiven,
  });

  // A policy skip is a terminal, successful outcome — the system did the right
  // thing by not sending. Completing the job stops it retrying forever.
  if (!decision.allowed) {
    await setAckStatus(payload.eventId, decision.status, decision.reason);
    await completeJob(job.id);
    logger.info(`[wa_ack] ${payload.eventId} skipped: ${decision.status}`);
    return decision.status;
  }

  const outcome = await kapso.sendTemplate(
    decision.toE164,
    KAPSO_TEMPLATE_NAME,
    KAPSO_TEMPLATE_LANGUAGE,
    buildVariables(payload),
  );

  if (outcome.ok) {
    // Record the message BEFORE completing the job. If this insert fails the
    // job retries, but the policy cooldown will then see the message and skip —
    // so a retry cannot produce a second delivered template.
    await db
      .insert(messages)
      .values({
        tenantId: payload.tenantId,
        contactId: payload.contactId,
        channel: 'whatsapp',
        direction: 'outbound',
        externalId: outcome.messageId,
        templateName: KAPSO_TEMPLATE_NAME,
        content: `[template:${KAPSO_TEMPLATE_NAME}]`,
        messageType: 'template',
        status: 'sent',
        metadata: { eventId: payload.eventId, automated: true },
      })
      .onConflictDoNothing();

    await policy.recordSend(payload.tenantId);
    await setAckStatus(payload.eventId, 'sent', undefined, outcome.messageId);
    await completeJob(job.id);
    logger.info(`[wa_ack] ${payload.eventId} sent to ${redactPhone(decision.toE164)}`);
    return 'sent';
  }

  if (outcome.retryable) {
    await setAckStatus(payload.eventId, 'failed_retryable', outcome.error);
    await failJob(job.id, outcome.error);
    return 'failed_retryable';
  }

  // Permanent rejection — never retry. Completing removes it from the queue.
  await setAckStatus(payload.eventId, 'failed_permanent', outcome.error);
  await completeJob(job.id);
  logger.warn(`[wa_ack] ${payload.eventId} permanently rejected: ${outcome.error}`);
  return 'failed_permanent';
}

/**
 * Drain due acknowledgement jobs. Registered in jobDrainer.startJobDrainer(),
 * alongside form_submit / sequence_step / hot_lead_alert.
 */
export async function drainLeadAcksOnce(limit = 20): Promise<{
  processed: number;
  results: Record<string, number>;
}> {
  const due = await getDueJobs(limit);
  const results: Record<string, number> = {};
  let processed = 0;

  for (const job of due) {
    const claimed = await claimExclusively(job.id);
    if (!claimed) continue; // another worker got there first
    try {
      const outcome = await processAckJob(job);
      results[outcome] = (results[outcome] ?? 0) + 1;
      processed++;
    } catch (e) {
      const msg = (e as Error).message;
      logger.error('[wa_ack] handler threw', msg);
      await failJob(job.id, `handler_threw: ${msg}`);
      results.handler_error = (results.handler_error ?? 0) + 1;
      processed++;
    }
  }

  return { processed, results };
}
