import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from '../_lib/cors';
import { enqueue } from '../_lib/queue';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  // Page-view beacon — no auth, fire-and-forget. Enqueue best-effort and
  // always 200 so the client never sees an error.
  enqueue('tally_beacon', req.body ?? {}).catch(() => {});
  res.status(200).json({ ok: true });
}
