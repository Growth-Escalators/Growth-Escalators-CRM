import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from '../_lib/cors';
import { proxyGet } from '../_lib/proxy';

const SIMULATED = [
  { name: 'Rahul', city: 'Bengaluru', minutes_ago: 4 },
  { name: 'Priya', city: 'Mumbai', minutes_ago: 7 },
  { name: 'Arjun', city: 'Delhi', minutes_ago: 2 },
  { name: 'Sneha', city: 'Pune', minutes_ago: 11 },
  { name: 'Karan', city: 'Hyderabad', minutes_ago: 6 },
];

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  await proxyGet(req, res, '/api/funnel/recent-purchase', {
    fallback: SIMULATED[Math.floor(Date.now() / 120_000) % SIMULATED.length],
    cacheSeconds: 30,
    staleSeconds: 600,
    timeoutMs: 2500,
  });
}
