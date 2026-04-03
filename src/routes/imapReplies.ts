import { Router, type Request, type Response } from 'express';
import logger from '../utils/logger';
import { fetchProspectReplies } from '../services/imapService';

const router = Router();

// ---------------------------------------------------------------------------
// Internal-secret auth — used by n8n WF-02B to call this endpoint
// Set OUTREACH_INTERNAL_SECRET in Railway → n8n service env vars
// ---------------------------------------------------------------------------
function checkInternalSecret(req: Request, res: Response): boolean {
  const secret = process.env.OUTREACH_INTERNAL_SECRET;
  if (!secret) {
    logger.error('[imap-replies] OUTREACH_INTERNAL_SECRET not set — blocking request');
    res.status(401).json({ error: 'internal secret not configured' });
    return false;
  }
  const provided = req.headers['x-internal-secret'];
  if (provided !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// GET /api/outreach/imap/fetch-replies
// Called by n8n WF-02B every 5 minutes.
// Returns unread prospect replies from all 6 Purelymail inboxes.
// Marks emails as seen in IMAP and records message IDs to prevent reprocessing.
// ---------------------------------------------------------------------------
router.get('/fetch-replies', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;

  try {
    const replies = await fetchProspectReplies();
    res.json({ count: replies.length, replies });
  } catch (err) {
    logger.error({ err }, '[imap-replies] fetch-replies failed');
    res.status(500).json({ error: 'Internal error', count: 0, replies: [] });
  }
});

export default router;
