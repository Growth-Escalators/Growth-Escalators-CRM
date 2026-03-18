import { Router, type Request, type Response } from 'express';
import { and, count, eq, sum } from 'drizzle-orm';
import { db, tenants, funnels, funnelMembers } from '../db/index';
import {
  getNextMember,
  createFunnel,
  addMember,
  getFunnelStats,
  resetFunnelCounts,
} from '../services/roundRobinService';

const router = Router();

const FALLBACK_URL = 'https://cal.com/jatin-agrawal';

// ---------------------------------------------------------------------------
// Resolve the Growth Escalators tenant ID (cached in module scope after first
// successful lookup — avoids a DB round-trip on every redirect).
// ---------------------------------------------------------------------------
let _cachedTenantId: string | null = null;

async function getTenantId(): Promise<string> {
  if (_cachedTenantId) return _cachedTenantId;
  const [row] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, 'growth-escalators'))
    .limit(1);
  if (!row) throw new Error('Tenant growth-escalators not found');
  _cachedTenantId = row.id;
  return row.id;
}

// ---------------------------------------------------------------------------
// POST /book/funnels  — create funnel + members in one call
// ---------------------------------------------------------------------------
router.post('/funnels', async (req: Request, res: Response) => {
  const { tenantId, name, slug, members } = req.body as {
    tenantId: string;
    name: string;
    slug: string;
    members: { memberName: string; calcomUrl: string; weight: number }[];
  };

  if (!tenantId || !name || !slug || !Array.isArray(members) || members.length === 0) {
    res.status(400).json({ error: 'tenantId, name, slug, and members[] are required' });
    return;
  }

  const weightSum = members.reduce((s, m) => s + (m.weight ?? 0), 0);
  if (weightSum !== 100) {
    res.status(400).json({ error: 'Member weights must add up to 100' });
    return;
  }

  try {
    const funnel = await createFunnel(tenantId, name, slug);
    const createdMembers = [];
    for (const m of members) {
      const member = await addMember(funnel.id, tenantId, m.memberName, m.calcomUrl, m.weight);
      createdMembers.push(member);
    }
    res.status(201).json({ funnel, members: createdMembers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /book/funnels  — list all funnels for a tenant
// ---------------------------------------------------------------------------
router.get('/funnels', async (req: Request, res: Response) => {
  const tenantId = req.query['tenantId'] as string | undefined;
  if (!tenantId) {
    res.status(400).json({ error: 'tenantId query param is required' });
    return;
  }

  try {
    const rows = await db
      .select({
        id: funnels.id,
        name: funnels.name,
        slug: funnels.slug,
        isActive: funnels.isActive,
        createdAt: funnels.createdAt,
        memberCount: count(funnelMembers.id),
        totalAssigned: sum(funnelMembers.totalAssigned),
      })
      .from(funnels)
      .leftJoin(funnelMembers, eq(funnelMembers.funnelId, funnels.id))
      .where(eq(funnels.tenantId, tenantId))
      .groupBy(funnels.id);

    res.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /book/funnels/:slug/stats
// ---------------------------------------------------------------------------
router.get('/funnels/:slug/stats', async (req: Request, res: Response) => {
  const slug = String(req.params['slug']);
  const tenantId = req.query['tenantId'] as string | undefined;
  if (!tenantId) {
    res.status(400).json({ error: 'tenantId query param is required' });
    return;
  }

  try {
    const stats = await getFunnelStats(slug, tenantId);
    res.json(stats);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /book/funnels/:slug/members  — add a member to an existing funnel
// ---------------------------------------------------------------------------
router.post('/funnels/:slug/members', async (req: Request, res: Response) => {
  const slug = String(req.params['slug']);
  const { tenantId, memberName, calcomUrl, weight } = req.body as {
    tenantId: string;
    memberName: string;
    calcomUrl: string;
    weight: number;
  };

  if (!tenantId || !memberName || !calcomUrl || weight === undefined) {
    res.status(400).json({ error: 'tenantId, memberName, calcomUrl, and weight are required' });
    return;
  }

  try {
    const [funnel] = await db
      .select({ id: funnels.id })
      .from(funnels)
      .where(and(eq(funnels.slug, slug), eq(funnels.tenantId, tenantId)))
      .limit(1);

    if (!funnel) {
      res.status(404).json({ error: `Funnel not found: ${slug}` });
      return;
    }

    const member = await addMember(funnel.id, tenantId, memberName, calcomUrl, weight);
    res.status(201).json(member);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// PATCH /book/funnels/:slug/members/:memberId  — update calcomUrl / weight / isActive
// ---------------------------------------------------------------------------
router.patch('/funnels/:slug/members/:memberId', async (req: Request, res: Response) => {
  const memberId = String(req.params['memberId']);
  const { calcomUrl, weight, isActive } = req.body as {
    calcomUrl?: string;
    weight?: number;
    isActive?: boolean;
  };

  const partial: Record<string, unknown> = {};
  if (calcomUrl !== undefined) partial['calcomUrl'] = calcomUrl;
  if (weight !== undefined) partial['weight'] = weight;
  if (isActive !== undefined) partial['isActive'] = isActive;

  if (Object.keys(partial).length === 0) {
    res.status(400).json({ error: 'Provide at least one of: calcomUrl, weight, isActive' });
    return;
  }

  try {
    const [updated] = await db
      .update(funnelMembers)
      .set(partial)
      .where(eq(funnelMembers.id, memberId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }
    res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /book/funnels/:slug/reset  — reset all assignment counts
// ---------------------------------------------------------------------------
router.post('/funnels/:slug/reset', async (req: Request, res: Response) => {
  const slug = String(req.params['slug']);
  const { tenantId } = req.body as { tenantId: string };
  if (!tenantId) {
    res.status(400).json({ error: 'tenantId is required' });
    return;
  }

  try {
    await resetFunnelCounts(slug, tenantId);
    res.json({ message: 'Reset complete' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /book/:slug  — main redirect (visitor-facing, never returns an error)
// IMPORTANT: Must be last — wildcard would shadow /funnels routes above.
// ---------------------------------------------------------------------------
router.get('/:slug', async (req: Request, res: Response) => {
  const slug = String(req.params['slug']);
  try {
    const tenantId = await getTenantId();
    const member = await getNextMember(slug, tenantId, req.ip ?? undefined, {
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.redirect(302, member.calcomUrl);
  } catch {
    res.redirect(302, FALLBACK_URL);
  }
});

export default router;
