import { Router } from 'express';
import { db } from '../db/index';
import { sql } from 'drizzle-orm';

const router = Router();

// GET /api/automations/hub-stats
router.get('/hub-stats', async (req, res) => {
  const tenantId = req.user!.tenantId;

  const [
    sequenceRows,
    enrolmentRows,
    jobStatusRows,
    jobsByTypeRows,
    funnelRows,
    funnelMemberRows,
    funnelAssignRows,
    contactCountRows,
    contactTodayRows,
    contactBySourceRows,
  ] = await Promise.all([
    // sequences
    db.execute(sql`
      SELECT id, name, channel, is_active, steps
      FROM sequences
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY created_at DESC
    `),
    // enrolments grouped
    db.execute(sql`
      SELECT se.sequence_id,
             COUNT(*) FILTER (WHERE se.status = 'active') AS active_count,
             COUNT(*) FILTER (WHERE se.status = 'completed') AS completed_count,
             COUNT(*) FILTER (WHERE se.status = 'cancelled') AS cancelled_count,
             MAX(se.enrolled_at) AS last_enrolled_at
      FROM sequence_enrolments se
      JOIN sequences s ON s.id = se.sequence_id
      WHERE s.tenant_id = ${tenantId}::uuid
      GROUP BY se.sequence_id
    `),
    // job status counts
    db.execute(sql`
      SELECT status, COUNT(*)::int as count
      FROM jobs
      WHERE tenant_id = ${tenantId}::uuid
      GROUP BY status
    `),
    // jobs by type
    db.execute(sql`
      SELECT job_type,
             COUNT(*)::int as count,
             COUNT(*) FILTER (WHERE status = 'completed' AND created_at > NOW() - INTERVAL '24 hours')::int AS fired_today,
             MAX(created_at) AS last_run
      FROM jobs
      WHERE tenant_id = ${tenantId}::uuid
      GROUP BY job_type
      ORDER BY count DESC
    `),
    // funnels
    db.execute(sql`
      SELECT id, name, slug, is_active
      FROM funnels
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY created_at DESC
    `),
    // funnel members
    db.execute(sql`
      SELECT fm.funnel_id, fm.member_name, fm.weight
      FROM funnel_members fm
      JOIN funnels f ON f.id = fm.funnel_id
      WHERE f.tenant_id = ${tenantId}::uuid
      ORDER BY fm.weight DESC
    `),
    // funnel assignments joined through funnel_members to get member_name
    db.execute(sql`
      SELECT fa.funnel_id,
             fm.member_name AS assigned_to,
             COUNT(*)::int AS total_assigned,
             MAX(fa.assigned_at) AS last_assigned_at
      FROM funnel_assignments fa
      JOIN funnel_members fm ON fm.id = fa.funnel_member_id
      JOIN funnels f ON f.id = fa.funnel_id
      WHERE f.tenant_id = ${tenantId}::uuid
      GROUP BY fa.funnel_id, fm.member_name
    `),
    // total contacts
    db.execute(sql`
      SELECT COUNT(*)::int as count
      FROM contacts
      WHERE tenant_id = ${tenantId}::uuid AND status != 'deleted'
    `),
    // contacts created today
    db.execute(sql`
      SELECT COUNT(*)::int as count
      FROM contacts
      WHERE tenant_id = ${tenantId}::uuid
        AND created_at > NOW() - INTERVAL '24 hours'
        AND status != 'deleted'
    `),
    // contacts by source
    db.execute(sql`
      SELECT COALESCE(source, 'direct') AS source, COUNT(*)::int as count
      FROM contacts
      WHERE tenant_id = ${tenantId}::uuid AND status != 'deleted'
      GROUP BY COALESCE(source, 'direct')
      ORDER BY count DESC
      LIMIT 10
    `),
  ]);

  // Process sequences
  const enrolMap: Record<string, any> = {};
  for (const e of enrolmentRows.rows as any[]) {
    enrolMap[e.sequence_id] = e;
  }

  const sequences = (sequenceRows.rows as any[]).map((s) => {
    const enr = enrolMap[s.id] ?? {};
    const steps = Array.isArray(s.steps) ? s.steps : [];
    return {
      id: s.id,
      name: s.name,
      channel: s.channel,
      isActive: s.is_active,
      stepCount: steps.length,
      activeEnrolments: Number(enr.active_count ?? 0),
      completedEnrolments: Number(enr.completed_count ?? 0),
      cancelledEnrolments: Number(enr.cancelled_count ?? 0),
      lastEnrolledAt: enr.last_enrolled_at ?? null,
    };
  });

  // Process job statuses
  const jobStatusMap: Record<string, number> = {};
  for (const r of jobStatusRows.rows as any[]) {
    jobStatusMap[r.status] = Number(r.count);
  }

  const jobsByType = (jobsByTypeRows.rows as any[]).map((r) => ({
    jobType: r.job_type,
    count: Number(r.count),
    firedToday: Number(r.fired_today ?? 0),
    lastRun: r.last_run ?? null,
  }));

  const firedToday = jobsByType.reduce((sum, r) => sum + r.firedToday, 0);

  const jobs = {
    pending: jobStatusMap['pending'] ?? 0,
    processing: jobStatusMap['processing'] ?? 0,
    completed: jobStatusMap['completed'] ?? 0,
    failed: jobStatusMap['failed'] ?? 0,
    deadLetter: jobStatusMap['dead_letter'] ?? 0,
    firedToday,
    byType: jobsByType,
  };

  // Process funnels
  const memberMap: Record<string, any[]> = {};
  for (const m of funnelMemberRows.rows as any[]) {
    if (!memberMap[m.funnel_id]) memberMap[m.funnel_id] = [];
    memberMap[m.funnel_id].push(m);
  }
  const assignMap: Record<string, Record<string, any>> = {};
  for (const a of funnelAssignRows.rows as any[]) {
    if (!assignMap[a.funnel_id]) assignMap[a.funnel_id] = {};
    assignMap[a.funnel_id][a.assigned_to] = a;
  }

  const funnels = (funnelRows.rows as any[]).map((f) => {
    const members = (memberMap[f.id] ?? []).map((m) => {
      const asgn = (assignMap[f.id] ?? {})[m.member_name] ?? {};
      return {
        memberName: m.member_name,
        totalAssigned: Number(asgn.total_assigned ?? 0),
        weight: Number(m.weight ?? 1),
        lastAssignedAt: asgn.last_assigned_at ?? null,
      };
    });
    const totalAssignments = members.reduce((s, m) => s + m.totalAssigned, 0);
    return {
      id: f.id,
      name: f.name,
      slug: f.slug,
      isActive: f.is_active,
      memberCount: members.length,
      totalAssignments,
      members,
    };
  });

  // Summary
  const liveCount = sequences.filter((s) => s.isActive).length;
  const pausedCount = sequences.filter((s) => !s.isActive).length;

  const summary = {
    totalAutomations: 11,
    liveCount,
    pausedCount,
    firedToday,
  };

  // Contacts
  const contacts = {
    total: Number((contactCountRows.rows as any[])[0]?.count ?? 0),
    createdToday: Number((contactTodayRows.rows as any[])[0]?.count ?? 0),
    bySource: (contactBySourceRows.rows as any[]).map((r) => ({
      source: r.source,
      count: Number(r.count),
    })),
  };

  res.json({ summary, sequences, jobs, funnels, contacts });
});

export default router;
