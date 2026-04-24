import { Router, type Request, type Response } from 'express';
import { db } from '../db/index';
import { userPermissions } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

const router = Router();

// Ensure is_active column exists (idempotent — safe to run on every cold start)
db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true`).catch(() => {});

// ---------------------------------------------------------------------------
// GET /api/permissions/me
// ---------------------------------------------------------------------------
router.get('/me', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const [p] = await db.select().from(userPermissions)
      .where(eq(userPermissions.userId, userId))
      .limit(1);

    if (!p) {
      res.json({ permissions: { isOwner: false } });
      return;
    }

    res.json({ permissions: p });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/permissions/users
// ---------------------------------------------------------------------------
router.get('/users', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const [myPerms] = await db.select().from(userPermissions)
    .where(eq(userPermissions.userId, userId)).limit(1);
  if (!myPerms?.isOwner) { res.status(403).json({ error: 'owner only' }); return; }

  try {
    const allUsers = await db.execute(sql`
      SELECT u.id, u.name, u.email, u.role,
             up.id as permissions_id,
             up.is_owner
      FROM users u
      LEFT JOIN user_permissions up ON up.user_id = u.id
      WHERE u.tenant_id = ${tenantId}
        AND (u.is_active IS NULL OR u.is_active = true)
      ORDER BY u.name
    `);

    res.json({ users: allUsers.rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/permissions/users/:userId
// ---------------------------------------------------------------------------
router.get('/users/:userId', async (req: Request, res: Response) => {
  const myUserId = req.user!.id;
  const targetUserId = req.params.userId as string;
  const [myPerms] = await db.select().from(userPermissions)
    .where(eq(userPermissions.userId, myUserId)).limit(1);
  if (!myPerms?.isOwner) { res.status(403).json({ error: 'owner only' }); return; }

  try {
    const [p] = await db.select().from(userPermissions)
      .where(eq(userPermissions.userId, targetUserId)).limit(1);
    res.json({ permissions: p ?? null });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/permissions/users/:userId
// ---------------------------------------------------------------------------
router.put('/users/:userId', async (req: Request, res: Response) => {
  const myUserId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const targetUserId = req.params.userId as string;

  const [myPerms] = await db.select().from(userPermissions)
    .where(eq(userPermissions.userId, myUserId)).limit(1);
  if (!myPerms?.isOwner) { res.status(403).json({ error: 'owner only' }); return; }

  if (targetUserId === myUserId && req.body.isOwner === false) {
    res.status(400).json({ error: 'cannot remove owner status from yourself' });
    return;
  }

  try {
    const [existing] = await db.select().from(userPermissions)
      .where(eq(userPermissions.userId, targetUserId)).limit(1);

    let result;
    if (existing) {
      [result] = await db.update(userPermissions)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(userPermissions.userId, targetUserId))
        .returning();
    } else {
      [result] = await db.insert(userPermissions)
        .values({ ...req.body, userId: targetUserId, tenantId })
        .returning();
    }

    res.json({ permissions: result });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/permissions/users/:userId/role — update a user's role
// ---------------------------------------------------------------------------
router.patch('/users/:userId/role', async (req: Request, res: Response) => {
  const myUserId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const targetUserId = req.params.userId as string;

  const [myPerms] = await db.select().from(userPermissions)
    .where(eq(userPermissions.userId, myUserId)).limit(1);
  if (!myPerms?.isOwner) { res.status(403).json({ error: 'owner only' }); return; }

  const { role } = req.body as { role: string };
  const VALID_ROLES = ['admin', 'manager_ops', 'manager_ads', 'sales', 'staff'];
  if (!role || !VALID_ROLES.includes(role)) {
    res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    return;
  }

  try {
    await db.execute(sql`
      UPDATE users
      SET role = ${role}, token_version = COALESCE(token_version, 1) + 1
      WHERE id = ${targetUserId} AND tenant_id = ${tenantId}
    `);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/permissions/users/:userId — remove a team member
// ---------------------------------------------------------------------------
router.delete('/users/:userId', async (req: Request, res: Response) => {
  const myUserId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const targetUserId = req.params.userId as string;

  // Only owners can remove users
  const [myPerms] = await db.select().from(userPermissions)
    .where(eq(userPermissions.userId, myUserId)).limit(1);
  if (!myPerms?.isOwner && !(myPerms as Record<string, unknown>)?.isAdmin) {
    res.status(403).json({ error: 'Only admins can remove team members' });
    return;
  }

  // Prevent removing yourself or the owner
  if (targetUserId === myUserId) {
    res.status(400).json({ error: 'Cannot remove yourself' });
    return;
  }
  const [targetPerms] = await db.select().from(userPermissions)
    .where(eq(userPermissions.userId, targetUserId)).limit(1);
  if (targetPerms?.isOwner) {
    res.status(400).json({ error: 'Cannot remove the owner' });
    return;
  }

  try {
    // Deactivate + invalidate current JWT (token_version increment)
    await db.execute(sql`
      UPDATE users
      SET is_active = false, token_version = COALESCE(token_version, 1) + 1
      WHERE id = ${targetUserId} AND tenant_id = ${tenantId}
    `);
    // Remove granular permissions
    await db.delete(userPermissions).where(eq(userPermissions.userId, targetUserId));

    res.json({ removed: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
