import { eq, and, or, isNull, lte, lt, asc } from 'drizzle-orm';
import { db, jobs } from '../db/index';

type Job = typeof jobs.$inferSelect;

/**
 * Tenant scope for a job-queue operation (S1, QA 2026-07-30).
 *
 * OPTIONAL BY DESIGN. Omitting it leaves the query unscoped, which is correct
 * and required for internal system callers — `stuckJobWorker.ts` sweeps stuck
 * jobs across every tenant. Only the HTTP layer (`src/routes/jobs.ts`, mounted
 * with `requireAuth` and reachable by any authenticated user of any role) passes
 * a scope, derived from `req.user.tenantId`.
 *
 * Before this existed, all four operations below filtered by `id`/`status` only
 * and never by `tenant_id`, so any authenticated user could read every tenant's
 * job payloads and claim/complete/dead-letter their jobs by GUID.
 */
export type JobTenantScope = { tenantId: string };

/**
 * Own tenant OR NULL — deliberately not a strict equality.
 *
 * Webhook-originated jobs are inserted with an explicit `null` tenant
 * (`webhooks.ts` inbound_wa / booking_failed / form_submit / chatwoot_event):
 * system-level work not yet attributed to a tenant. A strict
 * `tenant_id = caller` filter would hide every one of them from every caller and
 * silently stop inbound processing.
 *
 * Residual gap, documented not hidden: NULL-tenant jobs stay visible to every
 * authenticated tenant. Closing that needs webhook jobs attributed to a tenant
 * at ingestion — a product change, tracked in the QA roadmap doc.
 */
function tenantPredicate(scope?: JobTenantScope) {
  if (!scope) return undefined;
  return or(eq(jobs.tenantId, scope.tenantId), isNull(jobs.tenantId));
}

// ---------------------------------------------------------------------------
// insertJob — enqueue a new job, skip silently if idempotencyKey already exists
// ---------------------------------------------------------------------------
export async function insertJob(
  tenantId: string | null,
  jobType: string,
  payload: object,
  idempotencyKey: string,
  processAfter?: Date,
): Promise<{ job: Job; duplicate: boolean }> {
  // Check for existing job first
  const existing = await db
    .select()
    .from(jobs)
    .where(eq(jobs.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existing.length > 0) {
    return { job: existing[0], duplicate: true };
  }

  const inserted = await db
    .insert(jobs)
    .values({
      tenantId: tenantId ?? undefined,
      jobType,
      payload,
      idempotencyKey,
      processAfter: processAfter ?? new Date(),
      status: 'pending',
    })
    .onConflictDoNothing()
    .returning();

  // Edge case: race condition between select and insert — fetch the row
  if (inserted.length === 0) {
    const raceWinner = await db
      .select()
      .from(jobs)
      .where(eq(jobs.idempotencyKey, idempotencyKey))
      .limit(1);
    return { job: raceWinner[0], duplicate: true };
  }

  return { job: inserted[0], duplicate: false };
}

// ---------------------------------------------------------------------------
// claimJob — mark a job as processing
// ---------------------------------------------------------------------------
export async function claimJob(jobId: string, scope?: JobTenantScope): Promise<Job | undefined> {
  const updated = await db
    .update(jobs)
    .set({ status: 'processing', processingStartedAt: new Date() })
    .where(and(eq(jobs.id, jobId), tenantPredicate(scope)))
    .returning();
  return updated[0];
}

// ---------------------------------------------------------------------------
// completeJob — mark a job as completed
// ---------------------------------------------------------------------------
export async function completeJob(jobId: string, scope?: JobTenantScope): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'completed', completedAt: new Date() })
    .where(and(eq(jobs.id, jobId), tenantPredicate(scope)));
}

// ---------------------------------------------------------------------------
// failJob — increment attempts; exponential backoff or dead_letter
// ---------------------------------------------------------------------------
export async function failJob(jobId: string, error: string, scope?: JobTenantScope): Promise<void> {
  const current = await db.select().from(jobs).where(and(eq(jobs.id, jobId), tenantPredicate(scope))).limit(1);
  if (current.length === 0) return;

  const job = current[0];
  const newAttempts = (job.attempts ?? 0) + 1;
  const maxAttempts = job.maxAttempts ?? 3;

  if (newAttempts >= maxAttempts) {
    await db
      .update(jobs)
      .set({ status: 'dead_letter', attempts: newAttempts, lastError: error })
      .where(eq(jobs.id, jobId));
  } else {
    // Exponential backoff: newAttempts * 5 minutes
    const processAfter = new Date(Date.now() + newAttempts * 5 * 60 * 1000);
    await db
      .update(jobs)
      .set({ status: 'failed', attempts: newAttempts, lastError: error, processAfter })
      .where(eq(jobs.id, jobId));
  }
}

// ---------------------------------------------------------------------------
// getPendingJobs — fetch jobs ready to be processed
// ---------------------------------------------------------------------------
export async function getPendingJobs(jobType?: string, limit = 10, scope?: JobTenantScope): Promise<Job[]> {
  const conditions = [eq(jobs.status, 'pending'), lte(jobs.processAfter, new Date())];
  if (jobType) conditions.push(eq(jobs.jobType, jobType));
  const tenant = tenantPredicate(scope);
  if (tenant) conditions.push(tenant);

  return db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .orderBy(asc(jobs.processAfter))
    .limit(limit);
}
