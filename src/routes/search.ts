import { Router, type Request, type Response } from 'express';
import { db, contacts, deals } from '../db/index';
import { sql } from 'drizzle-orm';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/search?q=query&types=contacts,deals
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const q = (req.query.q as string || '').trim();

  if (!q || q.length < 2) {
    res.json({ results: [] });
    return;
  }

  const searchTerm = `%${q}%`;

  try {
    const [contactRows, dealRows] = await Promise.all([
      db.execute(sql`
        SELECT c.id, c.first_name, c.last_name, c.company_name, c.status, c.score,
               cc.channel_value as email
        FROM contacts c
        LEFT JOIN contact_channels cc ON cc.contact_id = c.id AND cc.channel_type = 'email'
        WHERE c.tenant_id = ${tenantId}
          AND (
            c.first_name ILIKE ${searchTerm}
            OR c.last_name ILIKE ${searchTerm}
            OR c.company_name ILIKE ${searchTerm}
            OR cc.channel_value ILIKE ${searchTerm}
          )
        LIMIT 10
      `),
      db.execute(sql`
        SELECT d.id, d.title, d.stage, d.deal_value, d.created_at,
               c.first_name || COALESCE(' ' || c.last_name, '') as contact_name
        FROM deals d
        LEFT JOIN contacts c ON c.id = d.contact_id
        WHERE d.tenant_id = ${tenantId}
          AND (
            d.title ILIKE ${searchTerm}
            OR d.stage ILIKE ${searchTerm}
          )
        LIMIT 10
      `),
    ]);

    const results = [
      ...(contactRows.rows as Array<Record<string, unknown>>).map(r => ({
        type: 'contact',
        id: r.id,
        name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        subtitle: (r.email as string) || (r.company_name as string) || r.status,
        score: r.score,
      })),
      ...(dealRows.rows as Array<Record<string, unknown>>).map(r => ({
        type: 'deal',
        id: r.id,
        name: r.title,
        subtitle: `${r.stage}${r.contact_name ? ` — ${r.contact_name}` : ''}`,
        value: r.deal_value,
      })),
    ];

    res.json({ results });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
