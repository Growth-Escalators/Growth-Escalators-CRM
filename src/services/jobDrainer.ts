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
// SCOPE — deliberately `form_submit` ONLY.
// The other queued types (`inbound_wa`, `chatwoot_event`, `booking_processed`,
// `hot_lead_alert`, `facebook_lead_failed`, `sequence_step`) were handled by n8n
// workflow logic that does not exist in this repo and cannot be read. Guessing
// at it would risk creating wrong records from real customer data. Those jobs
// are LEFT PENDING and untouched, which is the honest default: they keep their
// payloads and can be handled once their intended behaviour is established.
// `inbound_wa` is already safe regardless — `webhooks.ts` also writes those
// straight to the `messages` table, so the inbox was never affected.
//
// Deliberately NOT a replacement for the HTTP endpoint: that stays, so any
// external consumer keeps working.

import { eq } from 'drizzle-orm';
import { db, tenants, contacts } from '../db/index';
import { findOrCreateContact } from './contactService';
import { getPendingJobs, claimJob, completeJob, failJob } from './jobQueue';
import { DEFAULT_TENANT_SLUG } from '../config/constants';
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

  const [tenant] = await db.select({ id: tenants.id }).from(tenants)
    .where(eq(tenants.slug, DEFAULT_TENANT_SLUG)).limit(1);
  if (!tenant) throw new Error(`default tenant "${DEFAULT_TENANT_SLUG}" not found`);

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

export function startJobDrainer(): void {
  if (!isJobDrainerEnabled()) {
    logger.info('[job-drainer] disabled — set JOB_DRAINER_ENABLED=true to enable');
    return;
  }
  if (timer) return;
  logger.info(`[job-drainer] started (form_submit only, every ${POLL_INTERVAL_MS / 1000}s)`);
  const tick = () => { void drainOnce().catch((e) => logger.error({ err: e?.message }, '[job-drainer] loop error')); };
  tick();
  timer = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopJobDrainer(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
