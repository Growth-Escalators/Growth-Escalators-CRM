import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from '../../_lib/cors.js';
import { proxyGet } from '../../_lib/proxy.js';
import ecomConfig from '../../../src/data/funnelConfigs/ecom.json';
import doctorsConfig from '../../../src/data/funnelConfigs/doctors.json';
import realEstateConfig from '../../../src/data/funnelConfigs/real-estate.json';

const BUNDLED: Record<string, unknown> = {
  ecom: ecomConfig,
  doctors: doctorsConfig,
  'real-estate': realEstateConfig,
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const slug = String((req.query.slug as string) || 'ecom');
  const fallback = { ok: true, config: BUNDLED[slug] ?? BUNDLED.ecom };
  await proxyGet(req, res, `/api/funnel-configs/public/${encodeURIComponent(slug)}`, {
    fallback,
    cacheSeconds: 300,
    staleSeconds: 86_400,
    timeoutMs: 3000,
  });
}
