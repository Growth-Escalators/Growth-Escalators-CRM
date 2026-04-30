import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED = new Set([
  'https://ecom.growthescalators.com',
  'https://crm.growthescalators.com',
  'http://localhost:5173',
  'http://localhost:3000',
]);

/**
 * Handle CORS for landing-page edge functions. Returns true if the request
 * was an OPTIONS preflight and has been responded to (caller should return).
 */
export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin;
  if (origin && (ALLOWED.has(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Edge-Token');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
