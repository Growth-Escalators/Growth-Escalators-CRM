import { Router, type Request, type Response } from 'express';
import { db } from '../db/index';
import { userPermissions, users } from '../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { resolveStaffingAccess } from '../services/wizmatchStaffingAccess';
import { generatePassword } from '../utils/password';

const router = Router();

const VALID_ROLES = ['admin', 'manager_ops', 'manager_ads', 'team_lead', 'sales', 'staff', 'creative_assistant', 'viewer'];

// Ensure runtime columns exist (idempotent — safe to run on every cold start)
db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true`).catch(() => {});
db.execute(sql`ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS access_social boolean DEFAULT false`).catch(() => {});

// ---------------------------------------------------------------------------
// GET /api/permissions/me
// ---------------------------------------------------------------------------
router.get('/me', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const staffing = resolveStaffingAccess({
      tenantId: req.user!.tenantId,
      userId,
      role: req.user!.role,
    });
    // Read fresh from the DB rather than trusting the JWT — same reasoning
    // requirePlatformSuperadmin (src/middleware/rbac.ts) reads it fresh: a
    // grant or revocation must take effect without waiting for token expiry.
    // This is the ONLY place isPlatformSuperadmin reaches the client — it is
    // exposed for the calling user's own session only, never as part of any
    // listing of other users.
    const [userRow] = await db.select({ isPlatformSuperadmin: users.isPlatformSuperadmin })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const isPlatformSuperadmin = userRow?.isPlatformSuperadmin === true;

    const [p] = await db.select().from(userPermissions)
      .where(eq(userPermissions.userId, userId))
      .limit(1);

    if (!p) {
      res.json({ permissions: {
        isOwner: false,
        staffingPilotAccess: staffing.allowed,
        staffingCapabilities: staffing.capabilities,
        isPlatformSuperadmin,
      } });
      return;
    }

    res.json({ permissions: {
      ...p,
      staffingPilotAccess: staffing.allowed,
      staffingCapabilities: staffing.capabilities,
      isPlatformSuperadmin,
    } });
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
  const tenantId = req.user!.tenantId;
  const targetUserId = req.params.userId as string;
  const [myPerms] = await db.select().from(userPermissions)
    .where(eq(userPermissions.userId, myUserId)).limit(1);
  if (!myPerms?.isOwner) { res.status(403).json({ error: 'owner only' }); return; }

  try {
    // Target user must belong to the caller's own tenant — without this, an
    // owner of one tenant could read another tenant's user permissions by
    // guessing/enumerating a userId GUID (IDOR).
    const [targetUser] = await db.select({ tenantId: users.tenantId }).from(users)
      .where(eq(users.id, targetUserId)).limit(1);
    if (!targetUser || targetUser.tenantId !== tenantId) {
      res.status(404).json({ error: 'user not found' });
      return;
    }

    const [p] = await db.select().from(userPermissions)
      .where(eq(userPermissions.userId, targetUserId)).limit(1);
    res.json({ permissions: p ?? null });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Only these keys are allowed in a permissions update — strips DB metadata (id, createdAt, updatedAt, etc.)
const PERM_KEYS = [
  'contactsView', 'contactsCreate', 'contactsEdit', 'contactsDelete', 'contactsExport', 'contactsBulk',
  'pipelineView', 'pipelineCreate', 'pipelineEdit', 'pipelineDelete', 'pipelineManage',
  'billingView', 'billingCreate', 'billingEdit', 'billingMarkPaid', 'billingViewMrr', 'billingDownload', 'billingManageClients',
  'automationsView', 'automationsTrigger',
  'reportsView', 'reportsMetaAds',
  'settingsUsers', 'settingsPipelines', 'settingsTemplates', 'settingsBilling',
  'isOwner',
  'accessSocial',
] as const;

type PermKey = typeof PERM_KEYS[number];

function sanitizePerms(body: Record<string, unknown>): Partial<Record<PermKey, boolean>> & { updatedAt: Date } {
  const out: Partial<Record<PermKey, boolean>> & { updatedAt: Date } = { updatedAt: new Date() };
  for (const key of PERM_KEYS) {
    if (key in body) (out as Record<string, unknown>)[key] = Boolean(body[key]);
  }
  return out;
}

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
    // Target user must belong to the caller's own tenant — without this, an
    // owner of one tenant could edit (or create) permissions for another
    // tenant's user by GUID (IDOR).
    const [targetUser] = await db.select({ tenantId: users.tenantId }).from(users)
      .where(eq(users.id, targetUserId)).limit(1);
    if (!targetUser || targetUser.tenantId !== tenantId) {
      res.status(404).json({ error: 'user not found' });
      return;
    }

    const sanitized = sanitizePerms(req.body as Record<string, unknown>);
    const [existing] = await db.select().from(userPermissions)
      .where(eq(userPermissions.userId, targetUserId)).limit(1);

    let result;
    if (existing) {
      [result] = await db.update(userPermissions)
        .set(sanitized)
        .where(eq(userPermissions.userId, targetUserId))
        .returning();
    } else {
      [result] = await db.insert(userPermissions)
        .values({ ...sanitized, userId: targetUserId, tenantId })
        .returning();
    }

    res.json({ permissions: result });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/permissions/users — create a new team member (admin/owner only)
// Body: { name, email, role, password? } — password auto-generated if omitted
// Returns the new user + the plaintext password ONCE (so admin can share it).
// User can change their password later via /auth/forgot-password.
// ---------------------------------------------------------------------------
router.post('/users', async (req: Request, res: Response) => {
  const myUserId = req.user!.id;
  const tenantId = req.user!.tenantId;

  const [myPerms] = await db.select().from(userPermissions)
    .where(eq(userPermissions.userId, myUserId)).limit(1);
  const meIsAdmin = myPerms?.isOwner || req.user!.role === 'admin';
  if (!meIsAdmin) { res.status(403).json({ error: 'admin only' }); return; }

  const { name, email, role, password: rawPassword } = req.body as {
    name?: string; email?: string; role?: string; password?: string;
  };

  if (!name || !email) { res.status(400).json({ error: 'name and email are required' }); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'invalid email' }); return;
  }
  const newRole = role || 'staff';
  if (!VALID_ROLES.includes(newRole)) {
    res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    return;
  }
  if (rawPassword && rawPassword.length < 8) {
    res.status(400).json({ error: 'password must be at least 8 characters' });
    return;
  }

  const normalisedEmail = email.toLowerCase().trim();
  const existing = await db.select().from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.email, normalisedEmail)))
    .limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: `a user with email ${normalisedEmail} already exists in this product` });
    return;
  }

  try {
    const plaintextPassword = rawPassword || generatePassword();
    const passwordHash = await hash(plaintextPassword);

    // db.execute() on node-postgres returns { rows, rowCount } (pg shape) — NOT
    // an iterable. The previous `const [inserted] = await db.execute(...)`
    // tried to destructure index 0 of the result object, which threw
    // "(intermediate value) is not iterable" and made admin user creation
    // completely broken in prod. Pull .rows[0] explicitly.
    const insertRes = await db.execute(sql`
      INSERT INTO users (tenant_id, name, email, password_hash, role, token_version)
      VALUES (${tenantId}, ${name.trim()}, ${normalisedEmail}, ${passwordHash}, ${newRole}, 1)
      RETURNING id, name, email, role, created_at
    `);
    const inserted = (insertRes.rows as Array<{ id: string; name: string; email: string; role: string; created_at: string }>)[0];
    if (!inserted) {
      res.status(500).json({ error: 'INSERT returned no rows' });
      return;
    }

    // Seed an empty user_permissions row so the user shows up in /users list filters
    await db.execute(sql`
      INSERT INTO user_permissions (user_id, tenant_id, is_owner)
      VALUES (${inserted.id}, ${tenantId}, false)
      ON CONFLICT (user_id) DO NOTHING
    `).catch(() => { /* table may not have unique constraint; ignore */ });

    res.json({
      ok: true,
      user: inserted,
      temporaryPassword: plaintextPassword,
      note: 'Share this password securely with the user. They can change it any time via the "Forgot password" flow on the login page.',
    });
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

  // Target user must belong to the caller's own tenant — without this, an
  // owner of one tenant could deactivate / strip permissions from another
  // tenant's user by GUID (IDOR).
  const [targetUser] = await db.select({ tenantId: users.tenantId }).from(users)
    .where(eq(users.id, targetUserId)).limit(1);
  if (!targetUser || targetUser.tenantId !== tenantId) {
    res.status(404).json({ error: 'user not found' });
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
    // Remove granular permissions — scoped by tenant_id, matching the
    // deactivation UPDATE above (targetUserId is already verified to belong
    // to this tenant, but keep the predicate explicit as defense in depth).
    await db.delete(userPermissions)
      .where(and(eq(userPermissions.userId, targetUserId), eq(userPermissions.tenantId, tenantId)));

    res.json({ removed: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
