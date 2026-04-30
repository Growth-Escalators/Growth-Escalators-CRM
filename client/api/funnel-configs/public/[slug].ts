import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from '../../_lib/cors.js';
import { proxyGet } from '../../_lib/proxy.js';

// We deliberately do NOT bundle funnel configs into this edge function. The
// client SPA already imports the JSON configs at build time
// (client/src/data/funnelConfigs/*.json) and uses them as the primary render
// source. This proxy only exists to fetch live updates from Railway. If
// Railway is unreachable, returning `config: null` tells the client "no fresh
// data" and the bundled config stays in place — see useFunnelConfig.js.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const slug = String((req.query.slug as string) || 'ecom');
  await proxyGet(req, res, `/api/funnel-configs/public/${encodeURIComponent(slug)}`, {
    fallback: { ok: false, config: null },
    cacheSeconds: 300,
    staleSeconds: 86_400,
    timeoutMs: 3000,
  });
}
