// ---------------------------------------------------------------------------
// Roles / Access Control — CRUD for the NEW, tenant-customizable RBAC
// foundation (src/db/schema.ts's `roles` / `role_permissions` /
// `user_permission_overrides` tables, src/config/permissions.ts's registry,
// src/services/permissionResolver.ts's effective-permission computation).
//
// THIS DOES NOT TOUCH THE CURRENTLY-ENFORCED AUTHORIZATION PATH. Today's real
// gate is still `PERMISSION_MAP` (src/middleware/rbac.ts) + the 28-boolean
// `user_permissions` table managed by src/routes/permissions.ts and
// admin/src/pages/PermissionsPage.jsx — neither of those is read, written, or
// otherwise touched by this file. `users.role` (the legacy text column) and
// `users.role_id` (this system's new UUID FK, still unread by any authz
// check) are two entirely separate columns; see the PATCH /users/:userId/role
// handler below for the explicit split between the two systems' role-
// assignment endpoints.
//
// GATING CONVENTION (matches src/routes/billing.ts / tenantBranding.ts):
//   - Reads: open to any authenticated tenant member (requireStrictAuth only).
//   - Writes: `userPermissions.isOwner` only. This is a deliberate
//     bootstrapping choice — role management cannot be gated by the very
//     permission system it manages before any role has ever been assigned,
//     so it reuses the same pre-existing `isOwner` escape hatch every other
//     owner-only route in this codebase already relies on.
//
// ROUTE ORDER MATTERS. Express matches routes in declaration order; `GET
// /registry` is a static 1-segment path and must be declared BEFORE `GET
// /:roleId` (also 1 segment), or `/registry` would be captured as a roleId
// value and never reach its own handler. The `/users/:userId/...` routes are
// 3-segment paths and don't collide with `/:roleId` (1 segment) or
// `/:roleId/members` (2 segments) regardless of order, but are kept above the
// `/:roleId` routes anyway for readability.
// ---------------------------------------------------------------------------
import { Router, type Request, type Response } from 'express';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { roles, rolePermissions, userPermissionOverrides, userPermissions, users } from '../db/schema';
import { isPermission, permissionsByModule, type Permission } from '../config/permissions';
import logger from '../utils/logger';

const router = Router();

const ROLE_KEY_RE = /^[a-z0-9_]+$/;

// ---------------------------------------------------------------------------
// Permission helper — identical shape to billing.ts's own getPerms().
// ---------------------------------------------------------------------------
async function getPerms(userId: string) {
  // tenant-scoping-lint-ignore-next-line — userId alone is sufficient: a
  // user belongs to exactly one tenant, so no cross-tenant row can match.
  // Same accepted pattern as billing.ts's own getPerms() (baselined).
  const [p] = await db.select().from(userPermissions).where(eq(userPermissions.userId, userId)).limit(1);
  return p ?? null;
}

/** True if every element of `value` is a string AND a recognised registry key. Returns the invalid subset. */
function invalidPermissionKeys(value: unknown[]): string[] {
  return value.filter((p) => typeof p !== 'string' || !isPermission(p)).map((p) => String(p));
}

// ---------------------------------------------------------------------------
// GET /api/roles — list this tenant's roles (system + custom) with member counts.
// Open read.
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const rows = await db
      .select({
        id: roles.id,
        tenantId: roles.tenantId,
        key: roles.key,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem,
        createdAt: roles.createdAt,
        updatedAt: roles.updatedAt,
        // COUNT(users.id) (not COUNT(*)) so a role with zero matching users
        // via the LEFT JOIN counts as 0, not 1.
        memberCount: sql<number>`count(${users.id})::int`,
      })
      .from(roles)
      .leftJoin(users, eq(users.roleId, roles.id))
      .where(eq(roles.tenantId, tenantId))
      .groupBy(roles.id)
      .orderBy(desc(roles.isSystem), asc(roles.name));

    res.json({ roles: rows });
  } catch (e: unknown) {
    logger.error('[roles] list error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/roles/registry — the full permission registry grouped by module.
// The Access Control UI's matrix (Roles tab checkboxes, Access map columns)
// renders directly from this. Open read. MUST stay declared before
// GET /:roleId — see file header.
// ---------------------------------------------------------------------------
router.get('/registry', async (_req: Request, res: Response) => {
  res.json({ modules: permissionsByModule() });
});

// ---------------------------------------------------------------------------
// GET /api/roles/users — this tenant's users with their current NEW-system
// role assignment (users.role_id, possibly null — most users are unassigned
// until the backfill script is run with owner approval) and standing
// override count. Powers the Access Control UI's "Members" tab in one call
// instead of N+1'ing GET /:roleId/members per role (which would also miss
// any user with no role_id at all). Open read. Declared before GET /:roleId
// for the same reason as /registry — see file header.
//
// Deliberately separate from `GET /api/permissions/users` (src/routes/
// permissions.ts), which is the existing, untouched endpoint for the OLD
// system and does not expose `role_id` at all.
// ---------------------------------------------------------------------------
router.get('/users', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        legacyRole: users.role,
        roleId: users.roleId,
        roleName: roles.name,
        isActive: users.isActive,
      })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.tenantId, tenantId))
      .orderBy(asc(users.name));

    const overrideCounts = await db
      .select({ userId: userPermissionOverrides.userId, count: sql<number>`count(*)::int` })
      .from(userPermissionOverrides)
      .innerJoin(users, eq(users.id, userPermissionOverrides.userId))
      .where(eq(users.tenantId, tenantId))
      .groupBy(userPermissionOverrides.userId);
    const countByUser = new Map(overrideCounts.map((r) => [r.userId, r.count]));

    res.json({
      users: rows.map((r) => ({ ...r, overrideCount: countByUser.get(r.id) ?? 0 })),
    });
  } catch (e: unknown) {
    logger.error('[roles] list users error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/roles — create a custom role (is_system: false). Owner only.
// Body: { key, name, description?, permissions: Permission[] }
// ---------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  const myUserId = req.user!.id;
  const tenantId = req.user!.tenantId;

  const perms = await getPerms(myUserId);
  if (!perms?.isOwner) { res.status(403).json({ error: 'owner only' }); return; }

  const { key, name, description, permissions } = req.body as {
    key?: unknown; name?: unknown; description?: unknown; permissions?: unknown;
  };

  if (typeof key !== 'string' || !key.trim()) {
    res.status(400).json({ error: 'key is required' });
    return;
  }
  const trimmedKey = key.trim().toLowerCase();
  if (!ROLE_KEY_RE.test(trimmedKey) || trimmedKey.length > 64) {
    res.status(400).json({ error: 'key must be lowercase letters, numbers, and underscores only (max 64 chars)' });
    return;
  }
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (!Array.isArray(permissions)) {
    res.status(400).json({ error: 'permissions must be an array' });
    return;
  }
  const invalid = invalidPermissionKeys(permissions);
  if (invalid.length > 0) {
    res.status(400).json({ error: `unknown permission key(s): ${invalid.join(', ')}` });
    return;
  }
  const validPermissions = [...new Set(permissions as Permission[])];

  try {
    // Pre-check for a friendlier 409 than a raw unique-constraint error
    // (roles_tenant_key_unique on (tenant_id, key) is still the real backstop).
    const [existing] = await db.select({ id: roles.id }).from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.key, trimmedKey))).limit(1);
    if (existing) {
      res.status(409).json({ error: `a role with key "${trimmedKey}" already exists` });
      return;
    }

    const [created] = await db.insert(roles).values({
      tenantId,
      key: trimmedKey,
      name: name.trim(),
      description: typeof description === 'string' ? (description.trim() || null) : null,
      isSystem: false,
    }).returning();

    if (validPermissions.length > 0) {
      await db.insert(rolePermissions).values(
        validPermissions.map((permission) => ({ roleId: created.id, permission })),
      );
    }

    res.status(201).json({ role: { ...created, permissions: validPermissions } });
  } catch (e: unknown) {
    logger.error('[roles] create error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/roles/users/:userId/permission-overrides — a user's standing
// grant/revoke overrides. Open read, same-tenant IDOR guard.
// ---------------------------------------------------------------------------
router.get('/users/:userId/permission-overrides', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const targetUserId = req.params.userId as string;
  try {
    const [targetUser] = await db.select({ tenantId: users.tenantId }).from(users)
      .where(eq(users.id, targetUserId)).limit(1);
    if (!targetUser || targetUser.tenantId !== tenantId) {
      res.status(404).json({ error: 'user not found' });
      return;
    }

    const overrides = await db.select().from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, targetUserId));
    res.json({ overrides });
  } catch (e: unknown) {
    logger.error('[roles] get overrides error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/roles/users/:userId/permission-overrides — replace the FULL
// override set for a user. Owner only. Same-tenant IDOR guard.
// Body: { overrides: Array<{ permission, effect: 'grant'|'revoke' }> }
// ---------------------------------------------------------------------------
router.put('/users/:userId/permission-overrides', async (req: Request, res: Response) => {
  const myUserId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const targetUserId = req.params.userId as string;

  const perms = await getPerms(myUserId);
  if (!perms?.isOwner) { res.status(403).json({ error: 'owner only' }); return; }

  const { overrides } = req.body as { overrides?: unknown };
  if (!Array.isArray(overrides)) {
    res.status(400).json({ error: 'overrides must be an array' });
    return;
  }

  const seen = new Set<string>();
  for (const o of overrides) {
    if (!o || typeof o !== 'object') {
      res.status(400).json({ error: 'each override must be an object with permission and effect' });
      return;
    }
    const { permission, effect } = o as { permission?: unknown; effect?: unknown };
    if (typeof permission !== 'string' || !isPermission(permission)) {
      res.status(400).json({ error: `unknown permission key: ${String(permission)}` });
      return;
    }
    if (effect !== 'grant' && effect !== 'revoke') {
      res.status(400).json({ error: `effect must be "grant" or "revoke" (got: ${String(effect)})` });
      return;
    }
    if (seen.has(permission)) {
      res.status(400).json({ error: `duplicate permission "${permission}" in overrides` });
      return;
    }
    seen.add(permission);
  }

  try {
    const [targetUser] = await db.select({ tenantId: users.tenantId }).from(users)
      .where(eq(users.id, targetUserId)).limit(1);
    if (!targetUser || targetUser.tenantId !== tenantId) {
      res.status(404).json({ error: 'user not found' });
      return;
    }

    // Replace-full-set: delete then insert, matching this codebase's existing
    // precedent (e.g. userInvites.ts's createInviteToken) rather than wrapping
    // in a DB transaction — acceptable here since nothing reads this table on
    // any authorization hot path yet (PERMISSION_SHADOW_MODE has not cut over).
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.userId, targetUserId));
    const typedOverrides = overrides as Array<{ permission: Permission; effect: 'grant' | 'revoke' }>;
    if (typedOverrides.length > 0) {
      await db.insert(userPermissionOverrides).values(
        typedOverrides.map((o) => ({ userId: targetUserId, permission: o.permission, effect: o.effect, createdBy: myUserId })),
      );
    }

    const saved = await db.select().from(userPermissionOverrides).where(eq(userPermissionOverrides.userId, targetUserId));
    res.json({ overrides: saved });
  } catch (e: unknown) {
    logger.error('[roles] put overrides error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/roles/users/:userId/role — assign a NEW-system role to a user
// (sets `users.role_id`). Owner only. Same-tenant IDOR guard on BOTH the
// target user and the role being assigned.
//
// NOT THE SAME ENDPOINT as `PATCH /api/permissions/users/:userId/role`
// (src/routes/permissions.ts), which sets the OLD `users.role` TEXT column —
// the one PERMISSION_MAP/rbac.ts actually reads today. That endpoint takes a
// `{ role: string }` body (one of VALID_ROLES) and bumps token_version to
// force re-auth, because it changes REAL, currently-enforced access.
//
// This endpoint takes a `{ roleId: string }` body (a `roles.id` UUID) and
// deliberately does NOT bump token_version: `users.role_id` is not read by
// any authorization check yet (see permissionResolver.ts's own header), so
// forcing every affected user to re-log-in for a currently-inert field would
// be a pointless disruption. Revisit this once PERMISSION_SHADOW_MODE cuts
// any route over to requirePerm.
// ---------------------------------------------------------------------------
router.patch('/users/:userId/role', async (req: Request, res: Response) => {
  const myUserId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const targetUserId = req.params.userId as string;

  const perms = await getPerms(myUserId);
  if (!perms?.isOwner) { res.status(403).json({ error: 'owner only' }); return; }

  const { roleId } = req.body as { roleId?: unknown };
  if (typeof roleId !== 'string' || !roleId) {
    res.status(400).json({ error: 'roleId is required' });
    return;
  }

  try {
    const [role] = await db.select({ id: roles.id, tenantId: roles.tenantId }).from(roles)
      .where(eq(roles.id, roleId)).limit(1);
    if (!role || role.tenantId !== tenantId) {
      res.status(404).json({ error: 'role not found' });
      return;
    }

    const [targetUser] = await db.select({ tenantId: users.tenantId }).from(users)
      .where(eq(users.id, targetUserId)).limit(1);
    if (!targetUser || targetUser.tenantId !== tenantId) {
      res.status(404).json({ error: 'user not found' });
      return;
    }

    await db.update(users).set({ roleId }).where(eq(users.id, targetUserId));
    res.json({ ok: true });
  } catch (e: unknown) {
    logger.error('[roles] assign role error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/roles/:roleId — role detail + full role_permissions list.
// Open read. Same-tenant IDOR guard.
// ---------------------------------------------------------------------------
router.get('/:roleId', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const roleId = req.params.roleId as string;
  try {
    const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!role || role.tenantId !== tenantId) {
      res.status(404).json({ error: 'role not found' });
      return;
    }

    const permRows = await db.select({ permission: rolePermissions.permission }).from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));
    res.json({ role: { ...role, permissions: permRows.map((r) => r.permission) } });
  } catch (e: unknown) {
    logger.error('[roles] detail error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/roles/:roleId — edit name/description/permission set. Owner only.
// Same-tenant IDOR guard. `key` and `is_system` are immutable for EVERY role
// (not just system ones) — the legacy-parity backfill and every future
// tenant-authored role both depend on `key` staying stable once created (see
// schema.ts's comment on the `roles` table). Permission-SET edits, by
// contrast, are allowed on system roles too: read src/scripts/
// backfillRolesFromPermissionMap.ts's own header for why the seeded system
// roles are meant to be a starting point a tenant can loosen/tighten, not a
// locked default — that's the whole point of "tenant-customizable" RBAC.
// ---------------------------------------------------------------------------
router.patch('/:roleId', async (req: Request, res: Response) => {
  const myUserId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const roleId = req.params.roleId as string;

  const perms = await getPerms(myUserId);
  if (!perms?.isOwner) { res.status(403).json({ error: 'owner only' }); return; }

  if ('key' in req.body || 'is_system' in req.body || 'isSystem' in req.body) {
    res.status(400).json({ error: 'key and is_system cannot be changed' });
    return;
  }

  const { name, description, permissions } = req.body as {
    name?: unknown; description?: unknown; permissions?: unknown;
  };

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    res.status(400).json({ error: 'name must be a non-empty string' });
    return;
  }
  let validPermissions: Permission[] | undefined;
  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) {
      res.status(400).json({ error: 'permissions must be an array' });
      return;
    }
    const invalid = invalidPermissionKeys(permissions);
    if (invalid.length > 0) {
      res.status(400).json({ error: `unknown permission key(s): ${invalid.join(', ')}` });
      return;
    }
    validPermissions = [...new Set(permissions as Permission[])];
  }

  try {
    const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!role || role.tenantId !== tenantId) {
      res.status(404).json({ error: 'role not found' });
      return;
    }

    const updates: { name?: string; description?: string | null; updatedAt?: Date } = {};
    if (name !== undefined) updates.name = (name as string).trim();
    if (description !== undefined) {
      updates.description = typeof description === 'string' ? (description.trim() || null) : null;
    }
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.update(roles).set(updates).where(eq(roles.id, roleId));
    }

    if (validPermissions !== undefined) {
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      if (validPermissions.length > 0) {
        await db.insert(rolePermissions).values(
          validPermissions.map((permission) => ({ roleId, permission })),
        );
      }
    }

    const [updatedRole] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    const permRows = await db.select({ permission: rolePermissions.permission }).from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));
    res.json({ role: { ...updatedRole, permissions: permRows.map((r) => r.permission) } });
  } catch (e: unknown) {
    logger.error('[roles] update error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/roles/:roleId — only for custom roles with zero members. Owner
// only. Same-tenant IDOR guard.
// ---------------------------------------------------------------------------
router.delete('/:roleId', async (req: Request, res: Response) => {
  const myUserId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const roleId = req.params.roleId as string;

  const perms = await getPerms(myUserId);
  if (!perms?.isOwner) { res.status(403).json({ error: 'owner only' }); return; }

  try {
    const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!role || role.tenantId !== tenantId) {
      res.status(404).json({ error: 'role not found' });
      return;
    }

    if (role.isSystem) {
      res.status(400).json({ error: 'system roles cannot be deleted' });
      return;
    }

    const memberRows = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.roleId, roleId), eq(users.tenantId, tenantId)));
    if (memberRows.length > 0) {
      res.status(400).json({
        error: `cannot delete role "${role.name}" — ${memberRows.length} member(s) are still assigned to it; reassign them to another role first`,
      });
      return;
    }

    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    await db.delete(roles).where(eq(roles.id, roleId));
    res.json({ deleted: true });
  } catch (e: unknown) {
    logger.error('[roles] delete error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/roles/:roleId/members — users currently on this role. Open read.
// Same-tenant IDOR guard.
// ---------------------------------------------------------------------------
router.get('/:roleId/members', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const roleId = req.params.roleId as string;
  try {
    const [role] = await db.select({ id: roles.id, tenantId: roles.tenantId }).from(roles)
      .where(eq(roles.id, roleId)).limit(1);
    if (!role || role.tenantId !== tenantId) {
      res.status(404).json({ error: 'role not found' });
      return;
    }

    const members = await db.select({
      id: users.id, name: users.name, email: users.email, role: users.role, isActive: users.isActive,
    }).from(users)
      .where(and(eq(users.roleId, roleId), eq(users.tenantId, tenantId)))
      .orderBy(asc(users.name));

    res.json({ members });
  } catch (e: unknown) {
    logger.error('[roles] members error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
