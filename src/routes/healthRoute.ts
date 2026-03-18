import { Router } from 'express';
import { sql, count, eq } from 'drizzle-orm';
import {
  db,
  contacts,
  jobs,
  bookings,
  sequences,
  sequenceEnrolments,
} from '../db/index';

const router = Router();

// ---------------------------------------------------------------------------
// GET /health  (mounted at app root)
// Returns service health including DB connectivity check.
// ---------------------------------------------------------------------------
router.get('/health', async (_req, res) => {
  let databaseConnected = false;
  try {
    await db.execute(sql`SELECT 1`);
    databaseConnected = true;
  } catch {
    databaseConnected = false;
  }

  res.json({
    status: databaseConnected ? 'ok' : 'degraded',
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    database: databaseConnected,
    workers: {
      sequenceWorker: 'running',
      stuckJobWorker: 'running',
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
