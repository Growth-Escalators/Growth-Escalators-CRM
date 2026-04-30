import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from '../_lib/cors.js';
import { enqueue } from '../_lib/queue.js';

interface WaitlistBody {
  name?: string;
  email?: string;
  source?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const { name, email, source = 'unknown' } = (req.body ?? {}) as WaitlistBody;
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: 'valid email is required' });
    return;
  }

  try {
    await enqueue('waitlist', { name: name.trim(), email: email.trim(), source });
    // We can't return a real count from the edge — Postgres lives behind
    // Railway. Returning success: true with count: null lets the client
    // show "you're in" without a misleading number. The CRM-side count will
    // be updated when the waitlist-count endpoint is fetched next.
    res.status(200).json({ success: true, count: null });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
