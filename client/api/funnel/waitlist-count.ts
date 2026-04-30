import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from '../_lib/cors.js';
import { proxyGet } from '../_lib/proxy.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  await proxyGet(req, res, '/api/funnel/waitlist-count', {
    fallback: { count: null },
    cacheSeconds: 30,
    staleSeconds: 600,
    timeoutMs: 2500,
  });
}
