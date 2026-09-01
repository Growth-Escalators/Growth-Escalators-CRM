// Internal job-queue drainer — 2026-07-31.
//
// WHY THIS EXISTS. The `jobs` table had exactly ONE consumer: the HTTP endpoint
// `/api/jobs/pending`, which n8n polled. n8n's workflows were deleted upstream
// and n8n is no longer in the production environment at all, so nothing has
// drained this queue — ever. Measured on production before this was written:
//
//     221 pending jobs, oldest 2026-03-17, "last job ever completed: NEVER"
//     178 of them `form_submit` — real website leads from Tally
//
// `form_submit` had no inline fallback: `webhooks.ts` marks the event processed
// and enqueues, returning `{status:'queued'}`. The job WAS the only path, so
// those 178 submissions never became contacts. The payloads survive in
// `jobs.payload`, so they are recoverable — and enabling this drainer recovers
// them, because they are simply pending jobs it will now pick up. No separate
// backfill script is needed.
//
// SCOPE — `form_submit`, `sequence_step`, and `hot_lead_alert`.
// The remaining queued types (`inbound_wa`, `chatwoot_event`,
// `booking_processed`, `facebook_lead_failed`) were handled by n8n workflow
// logic that does not exist in this repo and cannot be read. Guessing at it
// would risk creating wrong records from real customer data. Those jobs are
// LEFT PENDING and untouched, which is the honest default: they keep their
// payloads and can be handled once their intended behaviour is established.
// `inbound_wa` is already safe regardless — `webhooks.ts` also writes those
// straight to the `messages` table, so the inbox was never affected.
//
// `sequence_step` ADDED 2026-08-04 (fix: sequences never send, for anyone).
// `src/workers/sequenceWorker.ts` enqueues one `sequence_step` job per due
// sequence step, but until now nothing drained that job type — they
// accumulated forever and no sequence email ever went out, in every
// environment, regardless of AUTOMATED_EMAILS_ENABLED. Unlike the n8n types
// above, the step-execution logic for this one DOES exist in this repo
// (`emailService.ts`'s `sendSequenceEmail`, already used by the manual-send
// route `POST /email/send`) — this file just reuses it instead of
// reimplementing sending. See `processSequenceStepJob` below.
//
// `hot_lead_alert` ADDED 2026-08-06 — different from the n8n-only types
// above for a specific reason: its payload (contactId, contactName, score,
// tier, scheduledAt, dealTitle — set by bookingService.ts around the
// `insertJob(tenantId, 'hot_lead_alert', ...)` call) is fully
// self-describing, the job creates NO records, and its only sensible effect
// is a Slack notification to sales. None of the "guessing risks corrupting
// real customer data" reasoning above applies here — there is nothing to
// guess and nothing to corrupt.
//
// The real hazard is different: production has a hot_lead_alert backlog
// going back to 2026-03 (never drained, same root cause as everything else
// in this file). Draining it naively would fire five months of stale
// "🔥 hot lead just booked!" pings into a live Slack channel in one batch.
// See HOT_LEAD_STALENESS_MS below — a job whose booking is older than that
// window is completed WITHOUT alerting (a distinct 'stale' outcome, not
// 'failed': an old booking isn't an error, it's just no longer actionable as
// a "just booked" ping) and counted separately in drainHotLeadAlertsOnce's
// stats, so the log stays honest about what was suppressed.
//
// Deliberately NOT a replacement for the HTTP endpoint: that stays, so any
// external consumer keeps working.

import { eq } from 'drizzle-orm';
import { db, contacts } from '../db/index';
import { findOrCreateContact } from './contactService';
import { getPendingJobs, claimJob, completeJob, failJob } from './jobQueue';
import { getDefaultIngestTenant } from './tenantFeatures';
import { sendSequenceEmail, automatedEmailsEnabled } from './emailService';
import { sendSlackMessage } from './slackService';
import { SLACK_SALES_BD_CHANNEL, SLACK_SAKCHAM } from '../config/constants';
import { drainLeadAcksOnce } from './whatsapp/leadAckService';
import logger from '../utils/logger';

const POLL_INTERVAL_MS = 60_000;
const BATCH_SIZE = 25;

let timer: NodeJS.Timeout | null = null;

/** Explicit opt-in, matching this repo's fail-closed flag convention. */
export function isJobDrainerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(env.JOB_DRAINER_ENABLED || '').trim().toLowerCase());
}

type TallyField = { label?: string; value?: unknown; type?: string };
type TallyPayload = { eventId?: string; data?: { responseId?: string; fields?: TallyField[] } };

/**
 * Reads a Tally field by label, case- and whitespace-insensitively.
 * Field ORDER is not stable across forms and `type` was null on every sampled
 * production payload, so the label is the only reliable key.
 */
function fieldValue(fields: TallyField[], ...labels: string[]): string | undefined {
  const wanted = labels.map((l) => l.trim().toLowerCase());
  for (const f of fields) {
    const label = String(f?.label ?? '').trim().toLowerCase();
    if (!wanted.includes(label)) continue;
    const v = f?.value;
    if (v === null || v === undefined) continue;
    // Tally sends multi-select answers as arrays.
    const s = Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v);
    if (s.trim().length) return s.trim();
  }
  return undefined;
}

export type ParsedFormSubmission = {
  name?: string;
  email?: string;
  phone?: string;
  source?: string;
  utm?: string;
  businessType?: string;
};

/** Pure — exported so it can be tested without a database. */
export function parseTallySubmission(payload: unknown): ParsedFormSubmission {
  const p = (payload ?? {}) as TallyPayload;
  const fields = Array.isArray(p?.data?.fields) ? p.data!.fields! : [];
  return {
    name: fieldValue(fields, 'name', 'full name', 'your name'),
    email: fieldValue(fields, 'email', 'email address'),
    phone: fieldValue(fields, 'phone', 'phone number', 'mobile'),
    source: fieldValue(fields, 'source'),
    utm: fieldValue(fields, 'utm'),
    businessType: fieldValue(fields, 'business type', 'business'),
  };
}

/**
 * Contact-invariant compliance (see AGENTS.md): email lowercased/trimmed, phone
 * reduced to digits and prefixed 91 when missing, and `lastActivityAt` bumped on
 * every write so the CRM list sorts correctly.
 */
export async function processFormSubmitJob(jobId: string, payload: unknown): Promise<'created' | 'updated' | 'skipped'> {
  const parsed = parseTallySubmission(payload);
  if (!parsed.email) return 'skipped';

  // Pinned to GE's own tenant (PR: fix lead-theft-by-slug-order) — this
  // recovers website leads submitted through GE's OWN Tally forms, so the
  // destination tenant is GE, full stop. Must NOT be resolved by scanning
  // every active tenant for "crmAutomation" — a reseller_pilot tenant also
  // has that flag on, and if its slug sorted before growth-escalators, GE's
  // own recovered leads would silently land in the reseller's CRM instead.
  const tenant = await getDefaultIngestTenant('crmAutomation');
  if (!tenant) throw new Error('no active tenant has the "crmAutomation" feature enabled');

  const channels: { channelType: 'email' | 'whatsapp'; channelValue: string; isPrimary?: boolean }[] = [
    { channelType: 'email', channelValue: parsed.email.trim().toLowerCase(), isPrimary: true },
  ];
  const digits = (parsed.phone || '').replace(/\D/g, '');
  if (digits) {
    channels.push({ channelType: 'whatsapp', channelValue: digits.startsWith('91') ? digits : `91${digits}` });
  }

  const name = (parsed.name || '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const { contact, created } = await findOrCreateContact(tenant.id, {
    firstName: parts[0] || parsed.email.split('@')[0],
    lastName: parts.slice(1).join(' ') || undefined,
    source: parsed.source || 'tally_form',
    sourceDetail: parsed.utm || undefined,
    channels,
    metadata: { businessType: parsed.businessType, utm: parsed.utm, recoveredFromJob: jobId },
  });

  const now = new Date();
  const existing = await db.select().from(contacts).where(eq(contacts.id, contact.id)).limit(1);
  const existingTags = (existing[0]?.tags ?? []) as string[];
  await db.update(contacts).set({
    tags: [...new Set([...existingTags, 'website_lead'])],
    status: 'lead',
    updatedAt: now,
    // Never skip this — the CRM sorts by it.
    lastActivityAt: now,
  }).where(eq(contacts.id, contact.id));

  return created ? 'created' : 'updated';
}

// ---------------------------------------------------------------------------
// sequence_step processing — reuses emailService.ts's sendSequenceEmail
// (already used by the manual-send route) rather than reimplementing sending.
// ---------------------------------------------------------------------------

type SequenceStepPayload = {
  enrolmentId?: string;
  contactId?: string;
  tenantId?: string;
  sequenceId?: string;
  stepIndex?: number;
  stepDefinition?: { templateName?: string; channel?: string; [key: string]: unknown };
  scheduledFor?: string;
};

/**
 * Executes one `sequence_step` job by calling the SAME `sendSequenceEmail`
 * used by the manual-send route (`POST /email/send` in routes/email.ts) —
 * this is the "step-execution logic that already exists" referenced in the
 * PR: template lookup, contact/email-channel resolution, the
 * AUTOMATED_EMAILS_ENABLED kill switch, and the WizMatch outreach-policy
 * re-check all live there already, so this function does not duplicate any
 * of it.
 *
 * Tenant-correct: `tenantId` comes off the job's OWN payload (set by
 * sequenceWorker.ts from `enrolment.tenantId`), falling back to the job
 * row's `tenant_id` column — never a global/default tenant, since sequences
 * belong to whichever tenant enrolled the contact (Growth CRM or WizMatch).
 */
export async function processSequenceStepJob(
  jobId: string,
  payload: unknown,
  jobTenantId: string | null,
): Promise<'sent' | 'blocked' | 'skipped'> {
  const p = (payload ?? {}) as SequenceStepPayload;
  const tenantId = p.tenantId || jobTenantId || undefined;
  const contactId = p.contactId;
  const templateName = p.stepDefinition?.templateName;

  if (!tenantId || !contactId || !templateName) {
    throw new Error(
      `sequence_step job ${jobId} missing tenantId/contactId/stepDefinition.templateName in payload`,
    );
  }

  const result = await sendSequenceEmail(contactId, templateName, tenantId);
  if (result.success) return 'sent';

  // "automated_emails_disabled" is a steady-state / transient condition, not
  // a permanent fact about THIS job — the kill switch may be turned on
  // later, and drainSequenceStepsOnce() already checks it up front so
  // pending jobs are never even claimed while it's off (see below). Reaching
  // this branch means the flag flipped off mid-batch: throw so failJob's
  // backoff retries it, rather than marking a suppressed send "done" and
  // losing it forever once sending is turned on.
  if (result.reason === 'automated_emails_disabled') {
    throw new Error('sequence_step send suppressed — AUTOMATED_EMAILS_ENABLED is off');
  }

  if (result.reason && result.reason.startsWith('outreach_blocked')) {
    logger.info(
      { jobId, tenantId, contactId, reason: result.reason },
      '[job-drainer] sequence_step blocked by outreach policy — not retrying',
    );
    return 'blocked';
  }

  // Terminal, non-retryable conditions for this specific job (contact
  // deleted, no email channel, unknown template) — retrying will not fix
  // any of these, so mark it done rather than burning retry attempts.
  logger.warn(
    { jobId, tenantId, contactId, templateName, reason: result.reason },
    '[job-drainer] sequence_step not sent — marking done',
  );
  return 'skipped';
}

export async function drainSequenceStepsOnce(): Promise<{
  processed: number;
  sent: number;
  blocked: number;
  skipped: number;
  failed: number;
}> {
  const stats = { processed: 0, sent: 0, blocked: 0, skipped: 0, failed: 0 };

  // Preserve the existing send gating exactly: while AUTOMATED_EMAILS_ENABLED
  // is off, don't even claim sequence_step jobs — they stay untouched and
  // pending, so nothing is lost or dead-lettered while sending is
  // intentionally disabled. This mirrors the fail-closed convention used
  // throughout the mailer (see emailService.ts / multiDomainMailer.ts).
  if (!automatedEmailsEnabled()) {
    return stats;
  }

  // Unscoped fetch, same posture as the form_submit drain above: each job
  // carries its own tenantId (see processSequenceStepJob), so tenant
  // correctness is enforced per-job, not by scoping the queue read.
  const jobs = await getPendingJobs('sequence_step', BATCH_SIZE);
  for (const job of jobs) {
    try {
      const claimed = await claimJob(job.id);
      // Another worker won the race — leave it alone.
      if (!claimed) continue;
      const outcome = await processSequenceStepJob(job.id, job.payload, job.tenantId);
      await completeJob(job.id);
      stats.processed += 1;
      if (outcome === 'sent') stats.sent += 1;
      if (outcome === 'blocked') stats.blocked += 1;
      if (outcome === 'skipped') stats.skipped += 1;
    } catch (error) {
      // A single bad job (malformed payload, transport error, suppressed
      // send) must never wedge the loop — failJob applies the existing
      // backoff / dead-letter policy and we move on to the next job.
      const message = error instanceof Error ? error.message : String(error);
      await failJob(job.id, message).catch(() => {});
      stats.failed += 1;
      logger.error({ jobId: job.id, err: message }, '[job-drainer] sequence_step failed');
    }
  }
  if (stats.processed || stats.failed) {
    logger.info(stats, '[job-drainer] sequence_step batch complete');
  }
  return stats;
}

export async function drainOnce(): Promise<{ processed: number; created: number; failed: number; skipped: number }> {
  const stats = { processed: 0, created: 0, failed: 0, skipped: 0 };
  // Unscoped by design: this is an internal system sweeper, the same posture as
  // stuckJobWorker. The tenant scope added for S1 applies to the HTTP lane only.
  const jobs = await getPendingJobs('form_submit', BATCH_SIZE);
  for (const job of jobs) {
    try {
      const claimed = await claimJob(job.id);
      // Another worker won the race — leave it alone.
      if (!claimed) continue;
      const outcome = await processFormSubmitJob(job.id, job.payload);
      await completeJob(job.id);
      stats.processed += 1;
      if (outcome === 'created') stats.created += 1;
      if (outcome === 'skipped') stats.skipped += 1;
    } catch (error) {
      // failJob applies the existing backoff / dead-letter policy, so a
      // permanently malformed payload stops retrying instead of looping.
      const message = error instanceof Error ? error.message : String(error);
      await failJob(job.id, message).catch(() => {});
      stats.failed += 1;
      logger.error({ jobId: job.id, err: message }, '[job-drainer] form_submit failed');
    }
  }
  if (stats.processed || stats.failed) {
    logger.info(stats, '[job-drainer] batch complete');
  }
  return stats;
}

// ---------------------------------------------------------------------------
// hot_lead_alert processing — see the file header for why this type moved
// out of the "cannot be read, do not guess" bucket. No records are created;
// the only effect is a Slack ping to the sales/BD channel.
// ---------------------------------------------------------------------------

/**
 * A hot-lead booking older than this is no longer "just booked" — alerting
 * on it late is actively misleading (sales would be chasing a lead that
 * already went cold days or weeks ago) and, given the 2026-03 backlog,
 * draining without a window like this would fire months of pings at once.
 * 24 hours is the window a "🔥 just booked!" alert is still true in
 * practice: same-/next-day follow-up is the entire point of the hot tier,
 * and beyond a day the booking has already surfaced through the normal
 * deal pipeline regardless of whether this alert fires.
 */
const HOT_LEAD_STALENESS_MS = 24 * 60 * 60 * 1000;

type HotLeadAlertPayload = {
  contactId?: string;
  contactName?: string;
  score?: number;
  tier?: string;
  scheduledAt?: string;
  dealTitle?: string;
};

/**
 * Resolves the booking time used to judge staleness: the payload's own
 * `scheduledAt` (set by bookingService.ts from the actual booked slot) when
 * present and parseable, falling back to the job row's own `createdAt`.
 * Never throws — a malformed or missing timestamp on either side must not
 * crash the drainer, it should just fall through to the next source.
 */
function resolveBookingTime(
  scheduledAt: string | undefined,
  jobCreatedAt: Date | string | null | undefined,
): Date {
  if (scheduledAt) {
    const parsed = new Date(scheduledAt);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (jobCreatedAt) {
    const fallback = new Date(jobCreatedAt);
    if (!Number.isNaN(fallback.getTime())) return fallback;
  }
  // Both sources are missing or unparseable. Defaulting to "now" rather than
  // e.g. the epoch is deliberate: a missing timestamp is not evidence the
  // booking is old, and erring toward alerting is safer than erring toward
  // silently swallowing a real hot lead.
  return new Date();
}

/**
 * Executes one `hot_lead_alert` job: a Slack ping to the sales/BD channel,
 * or a silent 'stale' completion when the booking has aged out of
 * HOT_LEAD_STALENESS_MS. Throws on a failed/suppressed Slack send so the
 * caller's failJob backoff retries it — see the file header on why a
 * silently-swallowed send is exactly the bug class this file exists to fix.
 */
export async function processHotLeadAlertJob(
  jobId: string,
  payload: unknown,
  jobTenantId: string | null,
  jobCreatedAt: Date | string | null | undefined,
): Promise<'alerted' | 'stale'> {
  const p = (payload ?? {}) as HotLeadAlertPayload;
  const bookedAt = resolveBookingTime(p.scheduledAt, jobCreatedAt);

  if (Date.now() - bookedAt.getTime() > HOT_LEAD_STALENESS_MS) {
    logger.info(
      { jobId, tenantId: jobTenantId, bookedAt: bookedAt.toISOString() },
      '[job-drainer] hot_lead_alert stale — completing without alerting',
    );
    return 'stale';
  }

  // Only what the alert genuinely needs — no email/phone, and never the raw
  // payload (see the file header's PII note).
  const contactName = p.contactName?.trim() || 'Unnamed contact';
  const dealTitle = p.dealTitle?.trim() || 'Discovery call';
  const scoreText = typeof p.score === 'number' ? `${p.score}/100` : 'unknown';
  const tierText = (p.tier || 'hot').toUpperCase();
  const scheduledText = bookedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const text =
    `🔥 *Hot Lead — ${contactName}*\n\n` +
    `*Deal:* ${dealTitle}\n*Score:* ${scoreText} (${tierText})\n*Scheduled:* ${scheduledText}\n\n` +
    `<@${SLACK_SAKCHAM}> — new hot lead just booked, please follow up.`;

  const sent = await sendSlackMessage(SLACK_SALES_BD_CHANNEL, text);
  if (!sent) {
    // Covers both a genuine send failure and SLACK_NOTIFICATIONS_PAUSED —
    // same posture as processSequenceStepJob's automated_emails_disabled
    // branch above: this is a steady-state condition that may clear on its
    // own, not a permanent fact about this job, so throw and let it retry
    // rather than marking a suppressed alert "done" and losing it.
    throw new Error(`hot_lead_alert job ${jobId} — Slack send failed or was suppressed`);
  }
  return 'alerted';
}

export async function drainHotLeadAlertsOnce(): Promise<{
  processed: number;
  alerted: number;
  stale: number;
  failed: number;
}> {
  const stats = { processed: 0, alerted: 0, stale: 0, failed: 0 };

  // Unscoped fetch, same posture as the other two drains above.
  const jobs = await getPendingJobs('hot_lead_alert', BATCH_SIZE);
  for (const job of jobs) {
    try {
      const claimed = await claimJob(job.id);
      // Another worker won the race — leave it alone.
      if (!claimed) continue;
      const outcome = await processHotLeadAlertJob(job.id, job.payload, job.tenantId, job.createdAt);
      await completeJob(job.id);
      stats.processed += 1;
      if (outcome === 'alerted') stats.alerted += 1;
      if (outcome === 'stale') stats.stale += 1;
    } catch (error) {
      // A single bad job (malformed payload, Slack outage) must never wedge
      // the loop — failJob applies the existing backoff / dead-letter policy
      // and we move on to the next job.
      const message = error instanceof Error ? error.message : String(error);
      await failJob(job.id, message).catch(() => {});
      stats.failed += 1;
      logger.error({ jobId: job.id, err: message }, '[job-drainer] hot_lead_alert failed');
    }
  }
  if (stats.processed || stats.failed) {
    logger.info(stats, '[job-drainer] hot_lead_alert batch complete');
  }
  return stats;
}

export function startJobDrainer(): void {
  if (!isJobDrainerEnabled()) {
    logger.info('[job-drainer] disabled — set JOB_DRAINER_ENABLED=true to enable');
    return;
  }
  if (timer) return;
  logger.info(`[job-drainer] started (form_submit + sequence_step + hot_lead_alert + wa_lead_ack, every ${POLL_INTERVAL_MS / 1000}s)`);
  const tick = () => {
    // Three independent drains per tick — a failure/throw in one type must
    // never suppress the others. Each function already isolates per-job
    // failures internally (see each drain*Once's try/catch per job).
    void drainOnce().catch((e) => logger.error({ err: e?.message }, '[job-drainer] form_submit loop error'));
    void drainSequenceStepsOnce().catch((e) => logger.error({ err: e?.message }, '[job-drainer] sequence_step loop error'));
    void drainHotLeadAlertsOnce().catch((e) => logger.error({ err: e?.message }, '[job-drainer] hot_lead_alert loop error'));
    void drainLeadAcksOnce().catch((e) => logger.error({ err: e?.message }, '[job-drainer] wa_lead_ack loop error'));
  };
  tick();
  timer = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopJobDrainer(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
