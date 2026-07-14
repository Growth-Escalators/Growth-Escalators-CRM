import { Router, type Request, type Response } from 'express';
import { db, contacts, deals } from '../db/index';
import { sql } from 'drizzle-orm';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/search?q=query&types=contacts,deals
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const isWizmatchTenant = req.user!.tenantSlug === 'wizmatch';
  const q = (req.query.q as string || '').trim();

  if (!q || q.length < 2) {
    res.json({ results: [] });
    return;
  }

  const searchTerm = `%${q}%`;

  try {
    const [contactRows, dealRows, wizmatchRows] = await Promise.all([
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
      // Wizmatch-only entities. Gated on tenantSlug so Growth-tenant search
      // behavior/timing is completely unaffected (these tables are always
      // tenant-scoped anyway, but skipping the queries entirely for the
      // Growth tenant avoids 3 pointless round-trips on every keystroke).
      isWizmatchTenant
        ? searchWizmatchEntities(tenantId, searchTerm)
        : Promise.resolve({ companies: [], requirements: [], submissions: [] }),
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
      ...wizmatchRows.companies,
      ...wizmatchRows.requirements,
      ...wizmatchRows.submissions,
    ];

    res.json({ results });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

async function searchWizmatchEntities(tenantId: string, searchTerm: string) {
  const [companyRows, requirementRows, submissionRows] = await Promise.all([
    db.execute(sql`
      SELECT id, name, domain, prime_msa_status
      FROM wizmatch_companies
      WHERE tenant_id = ${tenantId} AND name ILIKE ${searchTerm}
      LIMIT 8
    `),
    db.execute(sql`
      SELECT r.id, r.title, r.stage, c.name AS company_name
      FROM wizmatch_requirements r
      LEFT JOIN wizmatch_companies c ON c.id = r.company_id AND c.tenant_id = r.tenant_id
      WHERE r.tenant_id = ${tenantId} AND r.title ILIKE ${searchTerm}
      LIMIT 8
    `),
    db.execute(sql`
      SELECT s.id, s.status, r.title AS requirement_title,
             cand.first_name || COALESCE(' ' || cand.last_name, '') AS candidate_name
      FROM wizmatch_submissions s
      LEFT JOIN wizmatch_requirements r ON r.id = s.requirement_id AND r.tenant_id = s.tenant_id
      LEFT JOIN wizmatch_candidates wc ON wc.id = s.candidate_id AND wc.tenant_id = s.tenant_id
      LEFT JOIN contacts cand ON cand.id = wc.contact_id AND cand.tenant_id = s.tenant_id
      WHERE s.tenant_id = ${tenantId}
        AND (r.title ILIKE ${searchTerm} OR cand.first_name ILIKE ${searchTerm} OR cand.last_name ILIKE ${searchTerm})
      LIMIT 8
    `),
  ]);

  return {
    companies: (companyRows.rows as Array<Record<string, unknown>>).map(r => ({
      type: 'wizmatch_company',
      id: r.id,
      name: r.name,
      subtitle: (r.domain as string) || 'Company',
    })),
    requirements: (requirementRows.rows as Array<Record<string, unknown>>).map(r => ({
      type: 'wizmatch_requirement',
      id: r.id,
      name: r.title,
      subtitle: `${r.stage}${r.company_name ? ` — ${r.company_name}` : ''}`,
    })),
    submissions: (submissionRows.rows as Array<Record<string, unknown>>).map(r => ({
      type: 'wizmatch_submission',
      id: r.id,
      name: `${r.candidate_name || 'Candidate'} → ${r.requirement_title || 'Requirement'}`,
      subtitle: String(r.status || ''),
    })),
  };
}

export default router;
