import { Router, type Request } from 'express';
import { claimJob, completeJob, failJob, getPendingJobs, type JobTenantScope } from '../services/jobQueue';

const router = Router();

// S1 (QA 2026-07-30) — this router is mounted with `requireAuth` ONLY
// (`src/index.ts:252`): no role gate, so it is reachable by any authenticated
// user of any role, in any tenant. Until this scope existed, every handler below
// addressed jobs by id/status alone, so an ordinary `staff` user could read
// every tenant's job payloads via GET /pending and claim/complete/dead-letter
// any other tenant's job by GUID.
//
// The scope is taken from the authenticated session and NOWHERE else — never
// from a body, query or header, which would just hand the attacker the control
// back. `jobQueue` widens it to "own tenant OR NULL" because webhook jobs are
// deliberately inserted un-attributed; see the rationale there.
function scopeOf(req: Request): JobTenantScope | undefined {
  const tenantId = req.user?.tenantId;
  return tenantId ? { tenantId } : undefined;
}

// ---------------------------------------------------------------------------
// GET /jobs/pending?jobType=&limit=10
// Returns pending jobs ready to be processed. Used by n8n to poll the queue.
// ---------------------------------------------------------------------------
router.get('/pending', async (req, res) => {
  const { jobType } = req.query as Record<string, string>;
  const limit = Math.min(parseInt((req.query.limit as string) || '10', 10), 100);

  const pendingJobs = await getPendingJobs(jobType, limit, scopeOf(req));
  res.json(pendingJobs);
});

// ---------------------------------------------------------------------------
// PATCH /jobs/:id/claim
// Marks job as processing. Called by n8n when it picks up a job.
// ---------------------------------------------------------------------------
router.patch('/:id/claim', async (req, res) => {
  const job = await claimJob(req.params.id, scopeOf(req));
  if (!job) {
    res.status(404).json({ error: 'job not found' });
    return;
  }
  res.json({ status: 'claimed', job });
});

// ---------------------------------------------------------------------------
// PATCH /jobs/:id/complete
// Marks a job as completed.
// ---------------------------------------------------------------------------
router.patch('/:id/complete', async (req, res) => {
  await completeJob(req.params.id, scopeOf(req));
  res.json({ status: 'completed' });
});

// ---------------------------------------------------------------------------
// PATCH /jobs/:id/fail
// Body: { error: string }
// Marks a job as failed with exponential backoff or dead_letter.
// ---------------------------------------------------------------------------
router.patch('/:id/fail', async (req, res) => {
  const { error } = req.body as { error?: string };
  await failJob(req.params.id, error ?? 'unknown error', scopeOf(req));
  res.json({ status: 'failed' });
});

export default router;
