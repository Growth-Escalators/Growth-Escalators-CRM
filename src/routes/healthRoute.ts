import { Router } from 'express';
import { sql, count, eq, and, lt } from 'drizzle-orm';
import {
  db,
  contacts,
  jobs,
  bookings,
  sequences,
  sequenceEnrolments,
  messages,
} from '../db/index';

const router = Router();

// ---------------------------------------------------------------------------
// GET /health  (mounted at app root)
// Returns service health including DB connectivity, stuck jobs, last webhook.
// ---------------------------------------------------------------------------
router.get('/health', async (_req, res) => {
  type CheckStatus = 'ok' | 'error' | 'warning' | 'stale';

  // 1. Database connectivity
  let dbStatus: CheckStatus = 'error';
  let dbMessage: string | undefined;
  try {
    await db.execute(sql`SELECT 1`);
    dbStatus = 'ok';
  } catch (e) {
    dbMessage = e instanceof Error ? e.message : 'unknown error';
  }

  // 2. Stuck jobs (processing for > 2 hours)
  let stuckJobCount = 0;
  let stuckStatus: CheckStatus = 'ok';
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const [result] = await db
      .select({ count: count() })
      .from(jobs)
      .where(and(eq(jobs.status, 'processing'), lt(jobs.processingStartedAt, twoHoursAgo)));
    stuckJobCount = Number(result.count);
    stuckStatus = stuckJobCount > 0 ? 'warning' : 'ok';
  } catch { /* ignore */ }

  // 3. Last inbound message (WhatsApp/Meta). INFORMATIONAL ONLY — this is
  //    traffic-dependent (no inbound messages != a broken service), so it must
  //    not by itself mark the whole service "degraded". Previously mislabeled
  //    "lastWebhook", which wrongly implied a payment-webhook failure.
  let lastInboundAt: string | null = null;
  let inboundStatus: CheckStatus = 'ok';
  try {
    const [latest] = await db
      .select({ sentAt: messages.sentAt })
      .from(messages)
      .where(eq(messages.direction, 'inbound'))
      .orderBy(sql`sent_at DESC`)
      .limit(1);
    if (latest?.sentAt) {
      lastInboundAt = new Date(latest.sentAt).toISOString();
      const hoursSince = (Date.now() - new Date(latest.sentAt).getTime()) / (1000 * 60 * 60);
      inboundStatus = hoursSince > 48 ? 'stale' : 'ok';
    }
  } catch { /* ignore */ }

  // 4. Last processed Cashfree payment webhook. Also informational — absent when
  //    there simply have been no recent sales, so it never degrades health.
  let lastCashfreeAt: string | null = null;
  try {
    const result: unknown = await db.execute(
      sql`SELECT MAX(processed_at) AS latest FROM processed_events WHERE source = 'cashfree'`,
    );
    const rows = (result as { rows?: Array<{ latest?: unknown }> }).rows ?? (result as Array<{ latest?: unknown }>);
    const latest = Array.isArray(rows) ? rows[0]?.latest : undefined;
    if (latest) lastCashfreeAt = new Date(latest as string).toISOString();
  } catch { /* ignore */ }

  // Overall status: only real failures degrade it — DB down (unhealthy) or stuck
  // jobs (degraded). Traffic-dependent freshness signals are reported, not scored.
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (dbStatus === 'error') overallStatus = 'unhealthy';
  else if (stuckStatus === 'warning') overallStatus = 'degraded';

  res.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    env: process.env.NODE_ENV,
    checks: {
      database: { status: dbStatus, ...(dbMessage && { message: dbMessage }) },
      stuckJobs: { status: stuckStatus, count: stuckJobCount },
      lastInboundMessage: {
        status: inboundStatus,
        lastReceivedAt: lastInboundAt,
        note: 'inbound WhatsApp/Meta — traffic-dependent, informational only',
      },
      cashfreePayments: {
        lastProcessedAt: lastCashfreeAt,
        note: 'last processed payment webhook — absent when no recent sales',
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /stats  (mounted at app root)
// Returns production statistics across contacts, jobs, bookings, sequences.
// ---------------------------------------------------------------------------
router.get('/stats', async (_req, res) => {
  const [totalContacts] = await db.select({ count: count() }).from(contacts);

  const jobsByStatus = await db
    .select({ status: jobs.status, count: count() })
    .from(jobs)
    .groupBy(jobs.status);

  const bookingsByTier = await db
    .select({ tier: bookings.qualificationTier, count: count() })
    .from(bookings)
    .groupBy(bookings.qualificationTier);

  const [totalSequences] = await db.select({ count: count() }).from(sequences);

  const [activeEnrolments] = await db
    .select({ count: count() })
    .from(sequenceEnrolments)
    .where(eq(sequenceEnrolments.status, 'active'));

  res.json({
    uptime: Math.floor(process.uptime()),
    contacts: { total: Number(totalContacts.count) },
    jobs: Object.fromEntries(jobsByStatus.map((r) => [r.status ?? 'unknown', Number(r.count)])),
    bookings: Object.fromEntries(
      bookingsByTier.map((r) => [r.tier ?? 'unscored', Number(r.count)]),
    ),
    sequences: {
      total: Number(totalSequences.count),
      activeEnrolments: Number(activeEnrolments.count),
    },
  });
});

export default router;
