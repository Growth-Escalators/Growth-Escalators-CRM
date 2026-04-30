import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from '../_lib/cors.js';
import { enqueue } from '../_lib/queue.js';

interface AgencyLeadBody {
  name?: string;
  agencyName?: string;
  email?: string;
  phone?: string;
  adSpend?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const body = (req.body ?? {}) as AgencyLeadBody;
  if (!body.name || !body.email || !body.phone) {
    res.status(400).json({ error: 'name, email, phone are required' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email).trim())) {
    res.status(400).json({ error: 'valid email required' });
    return;
  }

  try {
    await enqueue('agency_lead', body);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
