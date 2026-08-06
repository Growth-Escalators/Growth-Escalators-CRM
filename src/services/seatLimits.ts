// Seat-limit enforcement — first reader of `plans.limits` (src/db/schema.ts).
// That column has existed since the subscription-billing tables shipped but
// nothing has ever read it (confirmed by grep: no route, service, seed, or
// test references `.limits`/`seatCap`/`maxUsers`/`maxSeats` anywhere in this
// repo before this file). Consequently there is also no real `plans` row
// anywhere (seed data, provisioning scripts, tests) that pins a canonical key
// name — the schema.ts column comment's `{ "seats": 5 }` is an ILLUSTRATIVE
// example, not an established contract. This module picks `maxUsers` as the
// canonical, self-documenting key going forward (matching the terminology
// used when this feature was scoped) and additionally accepts `seats` as an
// alias, in case any environment already hand-created a plan row using the
// schema comment's example name. Whichever key is absent/non-numeric is
// simply ignored — never invented.
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db, plans, subscriptions, users } from '../db/index';

/**
 * Pure — extracts a seat cap from a plan's `limits` jsonb, or null when no
 * cap is configured. Exported separately from resolveTenantSeatLimit() so
 * this logic is testable without mocking the DB (matches this repo's
 * convention, e.g. tenantFeatures.ts's computeTenantFeatures).
 */
export function extractSeatLimit(limits: unknown): number | null {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) return null;
  const bag = limits as Record<string, unknown>;
  const raw = bag.maxUsers ?? bag.seats;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * Resolves a tenant's current seat cap, if any. Looks at the tenant's most
 * recent ACTIVE subscription's plan — a tenant with no active subscription
 * (true for virtually every tenant today; subscription billing is brand new)
 * has no seat cap, i.e. unlimited. Never invents a default cap for a plan
 * that was never given one — see extractSeatLimit.
 */
export async function resolveTenantSeatLimit(tenantId: string): Promise<number | null> {
  const [activeSub] = await db
    .select({ planId: subscriptions.planId })
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.status, 'active')))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  if (!activeSub) return null;

  const [plan] = await db.select({ limits: plans.limits }).from(plans).where(eq(plans.id, activeSub.planId)).limit(1);
  if (!plan) return null;

  return extractSeatLimit(plan.limits);
}

/**
 * Count of the tenant's currently-active users — same "active" definition
 * GET /api/permissions/users and login already use (`is_active IS NULL OR
 * is_active = true`), so a pending-invited user (created active, just with
 * an unusable password) already counts against the cap and can't be used to
 * bypass it.
 */
export async function countActiveTenantUsers(tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), or(isNull(users.isActive), eq(users.isActive, true))));
  return rows.length;
}
