import { and, eq, desc, sql } from 'drizzle-orm';
import { db, funnels, funnelMembers, funnelAssignments } from '../db/index';

// ---------------------------------------------------------------------------
// getNextMember
// Picks the member most "behind" their target weight, updates counters, and
// inserts an assignment row. Wrapped in a transaction for concurrency safety.
// ---------------------------------------------------------------------------
export async function getNextMember(
  funnelSlug: string,
  tenantId: string,
  visitorIp?: string,
  metadata: Record<string, unknown> = {},
) {
  // 1. Resolve funnel
  const [funnel] = await db
    .select()
    .from(funnels)
    .where(
      and(
        eq(funnels.slug, funnelSlug),
        eq(funnels.tenantId, tenantId),
        eq(funnels.isActive, true),
      ),
    )
    .limit(1);

  if (!funnel) throw new Error(`Funnel not found: ${funnelSlug}`);

  // 2. Fetch active members
  const members = await db
    .select()
    .from(funnelMembers)
    .where(
      and(
        eq(funnelMembers.funnelId, funnel.id),
        eq(funnelMembers.isActive, true),
      ),
    );

  if (members.length === 0) throw new Error(`No active members in funnel: ${funnelSlug}`);

  // 3. Weight-based selection: pick whoever is most behind their target %
  const grandTotal = members.reduce((s, m) => s + (m.totalAssigned ?? 0), 0);

  const scored = members.map((m) => {
    const targetPct = (m.weight ?? 50) / 100;
    const actualPct = grandTotal > 0 ? (m.totalAssigned ?? 0) / grandTotal : 0;
    const deficit = targetPct - actualPct;
    return { ...m, deficit };
  });

  // Sort: highest deficit first, then fewest assignments, then oldest lastAssignedAt
  scored.sort((a, b) => {
    if (b.deficit !== a.deficit) return b.deficit - a.deficit;
    if ((a.totalAssigned ?? 0) !== (b.totalAssigned ?? 0))
      return (a.totalAssigned ?? 0) - (b.totalAssigned ?? 0);
    const aTime = a.lastAssignedAt ? a.lastAssignedAt.getTime() : 0;
    const bTime = b.lastAssignedAt ? b.lastAssignedAt.getTime() : 0;
    return aTime - bTime;
  });

  const chosen = scored[0];

  // 4. Atomically update counter + insert assignment log
  await db.transaction(async (tx) => {
    await tx
      .update(funnelMembers)
      .set({
        totalAssigned: sql`${funnelMembers.totalAssigned} + 1`,
        lastAssignedAt: new Date(),
      })
      .where(eq(funnelMembers.id, chosen.id));

    await tx.insert(funnelAssignments).values({
      tenantId,
      funnelId: funnel.id,
      funnelMemberId: chosen.id,
      visitorIp: visitorIp ?? null,
      metadata,
    });
  });

  return chosen;
}

// ---------------------------------------------------------------------------
// createFunnel
// ---------------------------------------------------------------------------
export async function createFunnel(tenantId: string, name: string, slug: string) {
  const [funnel] = await db
    .insert(funnels)
    .values({ tenantId, name, slug })
    .returning();
  return funnel;
}

// ---------------------------------------------------------------------------
// addMember
// ---------------------------------------------------------------------------
export async function addMember(
  funnelId: string,
  tenantId: string,
  memberName: string,
  calcomUrl: string,
  weight: number,
) {
  const [member] = await db
    .insert(funnelMembers)
    .values({ funnelId, tenantId, memberName, calcomUrl, weight })
    .returning();
  return member;
}

// ---------------------------------------------------------------------------
// getFunnelStats
// Returns funnel info, all members with assignment %, and last 10 assignments.
// ---------------------------------------------------------------------------
export async function getFunnelStats(funnelSlug: string, tenantId: string) {
  const [funnel] = await db
    .select()
    .from(funnels)
    .where(and(eq(funnels.slug, funnelSlug), eq(funnels.tenantId, tenantId)))
    .limit(1);

  if (!funnel) throw new Error(`Funnel not found: ${funnelSlug}`);

  const members = await db
    .select()
    .from(funnelMembers)
    .where(eq(funnelMembers.funnelId, funnel.id));

  const grandTotal = members.reduce((s, m) => s + (m.totalAssigned ?? 0), 0);

  const membersWithPct = members.map((m) => ({
    ...m,
    percentage: grandTotal > 0 ? Math.round(((m.totalAssigned ?? 0) / grandTotal) * 100) : 0,
  }));

  const recentAssignments = await db
    .select({
      id: funnelAssignments.id,
      assignedAt: funnelAssignments.assignedAt,
      visitorIp: funnelAssignments.visitorIp,
      memberName: funnelMembers.memberName,
      calcomUrl: funnelMembers.calcomUrl,
    })
    .from(funnelAssignments)
    .innerJoin(funnelMembers, eq(funnelAssignments.funnelMemberId, funnelMembers.id))
    .where(eq(funnelAssignments.funnelId, funnel.id))
    .orderBy(desc(funnelAssignments.assignedAt))
    .limit(10);

  return { funnel, members: membersWithPct, recentAssignments };
}

// ---------------------------------------------------------------------------
// resetFunnelCounts
// Resets totalAssigned to 0 for all members in the funnel.
// ---------------------------------------------------------------------------
export async function resetFunnelCounts(funnelSlug: string, tenantId: string) {
  const [funnel] = await db
    .select({ id: funnels.id })
    .from(funnels)
    .where(and(eq(funnels.slug, funnelSlug), eq(funnels.tenantId, tenantId)))
    .limit(1);

  if (!funnel) throw new Error(`Funnel not found: ${funnelSlug}`);

  await db
    .update(funnelMembers)
    .set({ totalAssigned: 0 })
    .where(eq(funnelMembers.funnelId, funnel.id));
}
