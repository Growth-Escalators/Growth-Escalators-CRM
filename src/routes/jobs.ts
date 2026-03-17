import { Router } from 'express';
import { claimJob, completeJob, failJob, getPendingJobs } from '../services/jobQueue';

const router = Router();

// ---------------------------------------------------------------------------
// GET /jobs/pending?jobType=&limit=10
// Returns pending jobs ready to be processed. Used by n8n to poll the queue.
// ---------------------------------------------------------------------------
router.get('/pending', async (req, res) => {
  const { jobType } = req.query as Record<string, string>;
  const limit = Math.min(parseInt((req.query.limit as string) || '10', 10), 100);

  const pendingJobs = await getPendingJobs(jobType, limit);
  res.json(pendingJobs);
});

// ---------------------------------------------------------------------------
// PATCH /jobs/:id/claim
// Marks job as processing. Called by n8n when it picks up a job.
// ---------------------------------------------------------------------------
router.patch('/:id/claim', async (req, res) => {
  const job = await claimJob(req.params.id);
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
  await completeJob(req.params.id);
  res.json({ status: 'completed' });
});

// ---------------------------------------------------------------------------
// PATCH /jobs/:id/fail
// Body: { error: string }
// Marks a job as failed with exponential backoff or dead_letter.
// ---------------------------------------------------------------------------
router.patch('/:id/fail', async (req, res) => {
  const { error } = req.body as { error?: string };
  await failJob(req.params.id, error ?? 'unknown error');
  res.json({ status: 'failed' });
});

export default router;
