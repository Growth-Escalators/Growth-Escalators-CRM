// Permission resolver — computes a user's EFFECTIVE permission set from the
// tenant-customizable RBAC foundation (src/db/schema.ts's `roles` /
// `role_permissions` / `user_permission_overrides` tables) plus the existing,
// unrelated `user_permissions.isOwner` bypass.
//
// effective permissions = (the user's role's role_permissions)
//                          UNION any 'grant' overrides
//                          MINUS any 'revoke' overrides
// ...unless `user_permissions.isOwner` is true, in which case the user gets
// every permission in the registry, unconditionally (isOwner is an existing,
// read-only-from-here concept — this file does not write to that table).
//
// NOT WIRED INTO ANY ROUTE BY THIS PR. This is foundation only — see
// src/middleware/requirePerm.ts for the middleware that will eventually
// consume this, and PERMISSION_SHADOW_MODE for how that cutover is meant to
// be rolled out module-by-module without behavior change on day one.
//
// Caching: same TTL value and shape as src/middleware/auth.ts's identity
// cache (`identityCache` / `TOKEN_VERSION_CACHE_TTL_MS`) — a plain
// per-user Map with an `expiresAt` timestamp, no manual invalidation path.
// Querying the DB on every permission check would add a round-trip to every
// gated request; a short TTL bounds "how stale can a permission change be"
// to 30s instead of adding that cost to the hot path. Consistent with
// auth.ts's identity cache, a failed resolution is NEVER cached — only a
// successful computation populates an entry, so a transient DB blip cannot
// wedge a user into a stale allow/deny for the TTL window.
import { eq } from 'drizzle-orm';
import { db, users, roles, rolePermissions, userPermissionOverrides, userPermissions } from '../db/index';
import { ALL_PERMISSIONS, isPermission, type Permission } from '../config/permissions';

const EFFECTIVE_PERMISSIONS_CACHE_TTL_MS = 30_000;

const permissionsCache = new Map<string, { permissions: Set<Permission>; expiresAt: number }>();

async function computeEffectivePermissions(userId: string): Promise<Set<Permission>> {
  // isOwner bypass — read-only reference to the EXISTING user_permissions
  // table (28 legacy booleans, unrelated to the new roles/overrides tables).
  // Same query shape every route's own `getPerms()` helper already uses
  // (filter by userId alone — user_permissions.tenantId is denormalized from
  // the same users.tenant_id a user can only ever have one of).
  const [legacyPerms] = await db
    .select({ isOwner: userPermissions.isOwner })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId))
    .limit(1);
  if (legacyPerms?.isOwner) {
    return new Set(ALL_PERMISSIONS);
  }

  const effective = new Set<Permission>();

  const [user] = await db
    .select({ roleId: users.roleId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.roleId) {
    const rolePerms = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, user.roleId));
    for (const row of rolePerms) {
      // Fail closed on a stale/unrecognised permission string sitting in the
      // DB (e.g. a key later removed from the registry) — never add it to
      // the effective set silently.
      if (isPermission(row.permission)) effective.add(row.permission);
    }
  }

  const overrides = await db
    .select({ permission: userPermissionOverrides.permission, effect: userPermissionOverrides.effect })
    .from(userPermissionOverrides)
    .where(eq(userPermissionOverrides.userId, userId));
  for (const row of overrides) {
    if (!isPermission(row.permission)) continue;
    if (row.effect === 'grant') {
      effective.add(row.permission);
    } else if (row.effect === 'revoke') {
      effective.delete(row.permission);
    }
  }

  return effective;
}

/**
 * Returns the full set of permissions this user currently holds. Throws on a
 * DB error — callers (requirePerm) are expected to fail closed on that,
 * matching every other fail-closed lookup in this codebase (requireAuth's
 * currentIdentity, requireTenantFeature's getTenantFeatures,
 * requirePlatformSuperadmin).
 */
export async function getEffectivePermissions(userId: string): Promise<Set<Permission>> {
  const cached = permissionsCache.get(userId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.permissions;

  const permissions = await computeEffectivePermissions(userId);
  permissionsCache.set(userId, { permissions, expiresAt: now + EFFECTIVE_PERMISSIONS_CACHE_TTL_MS });
  return permissions;
}

/** Convenience single-permission check, mirroring rbac.ts's `hasPermission`. */
export async function hasEffectivePermission(userId: string, permission: Permission): Promise<boolean> {
  const effective = await getEffectivePermissions(userId);
  return effective.has(permission);
}
