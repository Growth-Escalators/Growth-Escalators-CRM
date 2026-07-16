import type { Pool, PoolClient, QueryResult } from 'pg';
import { pool } from '../db';

export const COMPANY_CONTACT_ROLES = [
  'talent_acquisition', 'hiring_manager', 'coordinator', 'approver', 'interviewer',
  'procurement', 'vendor_manager', 'source', 'other',
] as const;
export const REQUIREMENT_CONTACT_ROLES = ['source', 'hiring_manager', 'coordinator', 'approver', 'interviewer'] as const;
export const ASSIGNMENT_ROLES = ['account_owner', 'delivery_owner', 'recruiter'] as const;
export const RELATIONSHIP_STAGES = ['active', 'inactive', 'do_not_contact'] as const;
export const REQUIREMENT_STAGES = [
  'draft', 'qualifying', 'accepted', 'sourcing', 'covered', 'submitted', 'interviewing',
  'offer', 'filled', 'on_hold', 'closed_lost', 'cancelled',
] as const;

const TERMINAL_STAGES = new Set(['filled', 'closed_lost', 'cancelled']);
const STAGE_TRANSITIONS: Record<string, Set<string>> = {
  draft: new Set(['qualifying', 'cancelled']),
  qualifying: new Set(['accepted', 'on_hold', 'closed_lost', 'cancelled']),
  accepted: new Set(['sourcing', 'on_hold', 'closed_lost', 'cancelled']),
  sourcing: new Set(['covered', 'on_hold', 'closed_lost', 'cancelled']),
  covered: new Set(['sourcing', 'submitted', 'on_hold', 'closed_lost', 'cancelled']),
  submitted: new Set(['sourcing', 'interviewing', 'on_hold', 'closed_lost', 'cancelled']),
  interviewing: new Set(['submitted', 'offer', 'on_hold', 'closed_lost', 'cancelled']),
  offer: new Set(['interviewing', 'filled', 'closed_lost', 'cancelled']),
  on_hold: new Set(['qualifying', 'accepted', 'sourcing', 'covered', 'submitted', 'interviewing', 'offer', 'closed_lost', 'cancelled']),
  filled: new Set(),
  closed_lost: new Set(),
  cancelled: new Set(),
};

export class StaffingDomainError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

type Queryable = Pick<PoolClient, 'query'>;
type TransactionPool = Pick<Pool, 'connect'>;

type Actor = { tenantId: string; userId: string };

function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new StaffingDomainError(400, 'validation_error', `${name} is required`);
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireAllowed(value: unknown, allowed: readonly string[], name: string): string {
  const result = requireText(value, name);
  if (!allowed.includes(result)) throw new StaffingDomainError(400, 'validation_error', `${name} is invalid`);
  return result;
}

function optionalDate(value: unknown, name: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new StaffingDomainError(400, 'validation_error', `${name} must be a valid date`);
  return date;
}

async function requireTenantRow(client: Queryable, table: string, id: string, tenantId: string, label: string) {
  const allowed = new Set(['wizmatch_companies', 'contacts', 'users', 'wizmatch_requirements', 'wizmatch_company_contacts', 'tasks']);
  if (!allowed.has(table)) throw new Error('Unsafe tenant table');
  const result = await client.query(`SELECT id FROM ${table} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!result.rowCount) throw new StaffingDomainError(404, 'not_found', `${label} was not found`);
}

async function appendEvent(client: Queryable, actor: Actor, eventType: string, links: Record<string, unknown>, payload: Record<string, unknown> = {}) {
  await client.query(
    `INSERT INTO wizmatch_staffing_events
       (tenant_id, actor_user_id, event_type, company_id, contact_id, company_contact_id, requirement_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [actor.tenantId, actor.userId, eventType, links.companyId ?? null, links.contactId ?? null,
      links.companyContactId ?? null, links.requirementId ?? null, JSON.stringify(payload)],
  );
}

async function inTransaction<T>(dbPool: TransactionPool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function assertStageTransition(from: string, to: string) {
  if (!REQUIREMENT_STAGES.includes(to as typeof REQUIREMENT_STAGES[number])) {
    throw new StaffingDomainError(400, 'invalid_stage', 'Target requirement stage is invalid');
  }
  if (from === to) return;
  if (!STAGE_TRANSITIONS[from]?.has(to)) {
    throw new StaffingDomainError(409, 'invalid_transition', `Cannot move requirement from ${from} to ${to}`);
  }
}

export function buildRequirementReadiness(requirement: Record<string, any>, checks: Record<string, any>) {
  const acceptanceMissing: string[] = [];
  if (!requirement.company_id) acceptanceMissing.push('company');
  if (!checks.has_primary_source) acceptanceMissing.push('primary source contact');
  if (!checks.has_primary_channel) acceptanceMissing.push('primary source contact channel');
  if (!checks.has_account_owner) acceptanceMissing.push('account owner');
  if (!checks.has_recruiter) acceptanceMissing.push('recruiter');
  if (!requirement.sla_due_at) acceptanceMissing.push('SLA due date');
  if (!requirement.next_action || !requirement.next_action_due_at) acceptanceMissing.push('dated next action');
  const matchingMissing = checks.has_mandatory_skill ? [] : ['reviewed mandatory canonical skill'];
  return {
    acceptance: { ready: acceptanceMissing.length === 0, missing: acceptanceMissing },
    matching: { ready: acceptanceMissing.length === 0 && matchingMissing.length === 0, missing: [...acceptanceMissing, ...matchingMissing] },
    checks: {
      company: Boolean(requirement.company_id),
      primarySource: Boolean(checks.has_primary_source),
      primarySourceChannel: Boolean(checks.has_primary_channel),
      accountOwner: Boolean(checks.has_account_owner),
      recruiter: Boolean(checks.has_recruiter),
      sla: Boolean(requirement.sla_due_at),
      datedNextAction: Boolean(requirement.next_action && requirement.next_action_due_at),
      mandatorySkill: Boolean(checks.has_mandatory_skill),
    },
  };
}

export function allowedRequirementTransitions(stage: string, acceptanceReady: boolean) {
  return [...(STAGE_TRANSITIONS[stage] ?? [])].map((targetStage) => ({
    stage: targetStage,
    allowed: targetStage !== 'accepted' || acceptanceReady,
    blockers: targetStage === 'accepted' && !acceptanceReady ? ['Complete requirement acceptance readiness'] : [],
  }));
}

function workBucket(input: { dueAt?: unknown; blocker?: string | null; text?: unknown }, now: Date) {
  const dueAt = input.dueAt ? new Date(String(input.dueAt)) : null;
  if (input.blocker) return 'blocked';
  if (dueAt && Number.isFinite(dueAt.getTime()) && dueAt.getTime() < now.getTime()) return 'overdue';
  if (dueAt && dueAt.toDateString() === now.toDateString()) return 'due_today';
  if (dueAt && Number.isFinite(dueAt.getTime()) && dueAt.getTime() > now.getTime()) return 'waiting';
  if (/\b(wait|await|pending|follow[ -]?up)\b/i.test(String(input.text || ''))) return 'waiting';
  return 'recently_changed';
}

export function buildNormalizedWorkItems(requirements: any[], tasks: any[], now = new Date()) {
  const taskActions = new Set(tasks.map((task) => `${task.requirement_id || ''}|${String(task.title || '').trim().toLowerCase()}`));
  const requirementItems = requirements
    .filter((requirement) => !taskActions.has(`${requirement.id}|${String(requirement.next_action || '').trim().toLowerCase()}`))
    .map((requirement) => {
      const blocker = requirement.attribution_status !== 'attributed'
        ? 'Source contact attribution is required'
        : !requirement.next_action || !requirement.next_action_due_at ? 'A dated next action is required' : null;
      const dueAt = requirement.next_action_due_at || requirement.sla_due_at || null;
      return {
        id: `requirement:${requirement.id}`,
        kind: 'requirement',
        entityType: 'requirement',
        entityId: requirement.id,
        entityHref: `/wizmatch/roles?requirementId=${encodeURIComponent(requirement.id)}`,
        title: requirement.title,
        companyName: requirement.company_name || null,
        bucket: workBucket({ dueAt, blocker, text: requirement.next_action }, now),
        blocker,
        recommendedAction: requirement.next_action || (blocker ? 'Complete requirement intake' : 'Review requirement'),
        dueAt,
        slaDueAt: requirement.sla_due_at || null,
        capability: 'manageAssignedWork',
      };
    });
  const taskItems = tasks.map((task) => ({
    id: `task:${task.id}`,
    kind: 'task',
    entityType: task.requirement_id ? 'requirement' : task.company_id ? 'company' : 'task',
    entityId: task.requirement_id || task.company_id || task.id,
    entityHref: task.requirement_id
      ? `/wizmatch/roles?requirementId=${encodeURIComponent(task.requirement_id)}`
      : task.company_id ? `/wizmatch/companies?companyId=${encodeURIComponent(task.company_id)}` : '/wizmatch/today',
    title: task.title,
    companyName: null,
    bucket: workBucket({ dueAt: task.due_at, text: task.title }, now),
    blocker: null,
    recommendedAction: task.title,
    dueAt: task.due_at || null,
    slaDueAt: null,
    capability: 'manageAssignedWork',
  }));
  const priority: Record<string, number> = { overdue: 0, due_today: 1, blocked: 2, waiting: 3, recently_changed: 4 };
  return [...requirementItems, ...taskItems].sort((a, b) =>
    (priority[a.bucket] ?? 9) - (priority[b.bucket] ?? 9)
      || new Date(String(a.dueAt || '9999-12-31')).getTime() - new Date(String(b.dueAt || '9999-12-31')).getTime(),
  );
}

export function createWizmatchStaffingService(dbPool: TransactionPool = pool) {
  return {
    async listCompanies(tenantId: string, search = '') {
      // Returns the CI qualification tier + target region (via a 1-row LATERAL)
      // and prime/ats/employee fields so the Companies page can filter on them
      // client-side (the list is small and also fanned out by Hiring Contacts, so
      // it stays a single capped call rather than server-paginated).
      const result = await (dbPool as unknown as Queryable).query(
        `SELECT c.id,c.name,c.domain,c.industry,c.country,c.is_prime,c.ats_type,c.employee_count,
                ci.tier, ci.region,
                COUNT(DISTINCT cc.id)::int AS contact_count,
                COUNT(DISTINCT r.id) FILTER (WHERE r.stage NOT IN ('filled','closed_lost','cancelled'))::int AS open_requirement_count
         FROM wizmatch_companies c
         LEFT JOIN LATERAL (
           SELECT qualification_tier AS tier, target_region AS region
           FROM wizmatch_company_intelligence i
           WHERE i.company_id=c.id AND i.tenant_id=c.tenant_id
           ORDER BY i.created_at DESC NULLS LAST LIMIT 1
         ) ci ON true
         LEFT JOIN wizmatch_company_contacts cc ON cc.company_id=c.id AND cc.tenant_id=c.tenant_id AND cc.relationship_stage='active'
         LEFT JOIN wizmatch_requirements r ON r.company_id=c.id AND r.tenant_id=c.tenant_id
         WHERE c.tenant_id=$1 AND ($2='' OR c.name ILIKE '%' || $2 || '%' OR COALESCE(c.domain,'') ILIKE '%' || $2 || '%')
         GROUP BY c.id, ci.tier, ci.region ORDER BY c.name LIMIT 500`,
        [tenantId, search.trim()],
      );
      return result.rows;
    },

    async listUsers(tenantId: string) {
      const result = await (dbPool as unknown as Queryable).query(`SELECT id,name,email,role FROM users WHERE tenant_id=$1 ORDER BY name`, [tenantId]);
      return result.rows;
    },

    async listHiringContacts(tenantId: string, search = '') {
      const result = await (dbPool as unknown as Queryable).query(
        `SELECT cc.id,cc.company_id,cc.contact_id,cc.relationship_stage,cc.owner_user_id,cc.source_type,
                cc.source_confidence,cc.last_activity_at,cc.next_action,cc.next_action_due_at,
                comp.name AS company_name,p.first_name,p.last_name,p.last_contacted_at,
                owner.name AS owner_name,
                COALESCE(array_agg(DISTINCT ccr.role) FILTER (WHERE ccr.active),'{}') AS roles,
                (SELECT channel_value FROM contact_channels ch WHERE ch.tenant_id=cc.tenant_id AND ch.contact_id=p.id AND ch.channel_type='email' ORDER BY ch.is_primary DESC,ch.created_at LIMIT 1) AS email,
                (SELECT channel_value FROM contact_channels ch WHERE ch.tenant_id=cc.tenant_id AND ch.contact_id=p.id AND ch.channel_type IN ('phone','whatsapp') ORDER BY ch.is_primary DESC,ch.created_at LIMIT 1) AS phone,
                CASE
                  WHEN EXISTS(SELECT 1 FROM contact_channels ch WHERE ch.tenant_id=cc.tenant_id AND ch.contact_id=p.id AND ch.verified=true AND ch.channel_type IN ('email','phone','whatsapp','linkedin')) THEN 'verified'
                  WHEN EXISTS(SELECT 1 FROM contact_channels ch WHERE ch.tenant_id=cc.tenant_id AND ch.contact_id=p.id AND ch.channel_type IN ('email','phone','whatsapp','linkedin')) THEN 'identified_channel_pending'
                  ELSE 'pending_research'
                END AS verification_state,
                COUNT(DISTINCT rc.requirement_id) FILTER (WHERE rc.active)::int AS requirement_count,
                COUNT(DISTINCT req.id) FILTER (WHERE rc.active AND req.stage NOT IN ('filled','closed_lost','cancelled'))::int AS open_requirement_count
         FROM wizmatch_company_contacts cc
         JOIN wizmatch_companies comp ON comp.id=cc.company_id AND comp.tenant_id=cc.tenant_id
         JOIN contacts p ON p.id=cc.contact_id AND p.tenant_id=cc.tenant_id
         LEFT JOIN users owner ON owner.id=cc.owner_user_id AND owner.tenant_id=cc.tenant_id
         LEFT JOIN wizmatch_company_contact_roles ccr ON ccr.company_contact_id=cc.id AND ccr.tenant_id=cc.tenant_id
         LEFT JOIN wizmatch_requirement_contacts rc ON rc.company_contact_id=cc.id AND rc.tenant_id=cc.tenant_id
         LEFT JOIN wizmatch_requirements req ON req.id=rc.requirement_id AND req.tenant_id=rc.tenant_id
         WHERE cc.tenant_id=$1 AND cc.relationship_stage='active'
           AND ($2='' OR concat_ws(' ',p.first_name,p.last_name,comp.name) ILIKE '%' || $2 || '%'
             OR EXISTS(SELECT 1 FROM contact_channels ch WHERE ch.tenant_id=$1 AND ch.contact_id=p.id AND ch.channel_value ILIKE '%' || $2 || '%'))
         GROUP BY cc.id,comp.id,p.id,owner.id
         ORDER BY cc.last_activity_at DESC NULLS LAST,p.first_name LIMIT 200`,
        [tenantId, search.trim()],
      );
      return result.rows;
    },

    async searchContacts(tenantId: string, search = '') {
      const result = await (dbPool as unknown as Queryable).query(
        `SELECT c.id,c.first_name,c.last_name,c.company_name,
                (SELECT channel_value FROM contact_channels WHERE tenant_id=c.tenant_id AND contact_id=c.id AND channel_type='email' ORDER BY is_primary DESC,created_at LIMIT 1) AS email,
                (SELECT channel_value FROM contact_channels WHERE tenant_id=c.tenant_id AND contact_id=c.id AND channel_type IN ('phone','whatsapp') ORDER BY is_primary DESC,created_at LIMIT 1) AS phone
         FROM contacts c WHERE c.tenant_id=$1 AND ($2='' OR concat_ws(' ',c.first_name,c.last_name,c.company_name) ILIKE '%' || $2 || '%'
           OR EXISTS(SELECT 1 FROM contact_channels ch WHERE ch.tenant_id=$1 AND ch.contact_id=c.id AND ch.channel_value ILIKE '%' || $2 || '%'))
         ORDER BY c.last_activity_at DESC NULLS LAST,c.first_name LIMIT 100`,
        [tenantId, search.trim()],
      );
      return result.rows;
    },

    async getCompany360(tenantId: string, companyId: string) {
      const company = await (dbPool as unknown as Queryable).query(`SELECT * FROM wizmatch_companies WHERE tenant_id=$1 AND id=$2`, [tenantId, companyId]);
      if (!company.rowCount) throw new StaffingDomainError(404, 'not_found', 'Company was not found');
      const [contactsResult, requirements, events, tasksResult] = await Promise.all([
        this.listCompanyContacts(tenantId, companyId),
        (dbPool as unknown as Queryable).query(`SELECT r.*,pc.first_name AS source_first_name,pc.last_name AS source_last_name FROM wizmatch_requirements r LEFT JOIN wizmatch_requirement_contacts rc ON rc.requirement_id=r.id AND rc.tenant_id=r.tenant_id AND rc.active AND rc.is_primary_source LEFT JOIN wizmatch_company_contacts cc ON cc.id=rc.company_contact_id LEFT JOIN contacts pc ON pc.id=cc.contact_id WHERE r.tenant_id=$1 AND r.company_id=$2 ORDER BY r.created_at DESC`, [tenantId, companyId]),
        (dbPool as unknown as Queryable).query(`SELECT e.*,u.name AS actor_name FROM wizmatch_staffing_events e LEFT JOIN users u ON u.id=e.actor_user_id AND u.tenant_id=e.tenant_id WHERE e.tenant_id=$1 AND e.company_id=$2 ORDER BY e.occurred_at DESC LIMIT 100`, [tenantId, companyId]),
        (dbPool as unknown as Queryable).query(`SELECT t.*,l.requirement_id FROM tasks t JOIN wizmatch_task_links l ON l.task_id=t.id AND l.tenant_id=t.tenant_id WHERE t.tenant_id=$1 AND l.company_id=$2 AND t.status='open' ORDER BY t.due_at`, [tenantId, companyId]),
      ]);
      return { company: company.rows[0], contacts: contactsResult, requirements: requirements.rows, events: events.rows, tasks: tasksResult.rows };
    },

    async getCompanyContact360(tenantId: string, companyContactId: string) {
      const relationship = await (dbPool as unknown as Queryable).query(
        `SELECT cc.*,c.name AS company_name,p.first_name,p.last_name,p.company_name AS crm_company_name,
                COALESCE(array_agg(DISTINCT r.role) FILTER (WHERE r.active),'{}') AS roles,
                (SELECT channel_value FROM contact_channels WHERE tenant_id=$1 AND contact_id=p.id AND channel_type='email' ORDER BY is_primary DESC,created_at LIMIT 1) AS email,
                (SELECT channel_value FROM contact_channels WHERE tenant_id=$1 AND contact_id=p.id AND channel_type IN ('phone','whatsapp') ORDER BY is_primary DESC,created_at LIMIT 1) AS phone
         FROM wizmatch_company_contacts cc JOIN wizmatch_companies c ON c.id=cc.company_id AND c.tenant_id=cc.tenant_id JOIN contacts p ON p.id=cc.contact_id AND p.tenant_id=cc.tenant_id LEFT JOIN wizmatch_company_contact_roles r ON r.company_contact_id=cc.id AND r.tenant_id=cc.tenant_id
         WHERE cc.tenant_id=$1 AND cc.id=$2 GROUP BY cc.id,c.id,p.id`, [tenantId, companyContactId]);
      if (!relationship.rowCount) throw new StaffingDomainError(404, 'not_found', 'Hiring contact was not found');
      const [requirements, events, tasksResult] = await Promise.all([
        (dbPool as unknown as Queryable).query(`SELECT req.*,rc.role AS contact_role,rc.is_primary_source FROM wizmatch_requirement_contacts rc JOIN wizmatch_requirements req ON req.id=rc.requirement_id AND req.tenant_id=rc.tenant_id WHERE rc.tenant_id=$1 AND rc.company_contact_id=$2 ORDER BY rc.active DESC,req.created_at DESC`, [tenantId, companyContactId]),
        (dbPool as unknown as Queryable).query(`SELECT e.*,u.name AS actor_name FROM wizmatch_staffing_events e LEFT JOIN users u ON u.id=e.actor_user_id AND u.tenant_id=e.tenant_id WHERE e.tenant_id=$1 AND e.company_contact_id=$2 ORDER BY e.occurred_at DESC LIMIT 100`, [tenantId, companyContactId]),
        (dbPool as unknown as Queryable).query(`SELECT t.*,l.requirement_id FROM tasks t JOIN wizmatch_task_links l ON l.task_id=t.id AND l.tenant_id=t.tenant_id WHERE t.tenant_id=$1 AND l.company_contact_id=$2 AND t.status='open' ORDER BY t.due_at`, [tenantId, companyContactId]),
      ]);
      return { contact: relationship.rows[0], requirements: requirements.rows, events: events.rows, tasks: tasksResult.rows };
    },

    async getRequirement360(tenantId: string, requirementId: string) {
      const requirement = await (dbPool as unknown as Queryable).query(
        `SELECT r.*,c.name AS company_name,s.source AS source_signal_provider,s.provider_id AS source_signal_provider_id,
                s.job_title AS source_signal_title,s.job_url AS source_signal_url,s.status AS source_signal_status
         FROM wizmatch_requirements r
         LEFT JOIN wizmatch_companies c ON c.id=r.company_id AND c.tenant_id=r.tenant_id
         LEFT JOIN wizmatch_job_signals s ON s.id=r.source_job_signal_id AND s.tenant_id=r.tenant_id
         WHERE r.tenant_id=$1 AND r.id=$2`,
        [tenantId, requirementId],
      );
      if (!requirement.rowCount) throw new StaffingDomainError(404, 'not_found', 'Requirement was not found');
      const [contactsResult, assignments, events, tasksResult, readinessResult, countsResult, requirementSkillsResult] = await Promise.all([
        this.listRequirementContacts(tenantId, requirementId),
        this.listAssignments(tenantId, requirementId),
        this.getTimeline(tenantId, requirementId),
        (dbPool as unknown as Queryable).query(`SELECT t.* FROM tasks t JOIN wizmatch_task_links l ON l.task_id=t.id AND l.tenant_id=t.tenant_id WHERE t.tenant_id=$1 AND l.requirement_id=$2 ORDER BY t.status,t.due_at`, [tenantId, requirementId]),
        (dbPool as unknown as Queryable).query(
          `SELECT
             EXISTS(SELECT 1 FROM wizmatch_requirement_contacts rc WHERE rc.tenant_id=$1 AND rc.requirement_id=$2 AND rc.active AND rc.is_primary_source) AS has_primary_source,
             EXISTS(SELECT 1 FROM wizmatch_requirement_contacts rc JOIN wizmatch_company_contacts cc ON cc.id=rc.company_contact_id AND cc.tenant_id=rc.tenant_id JOIN contact_channels ch ON ch.contact_id=cc.contact_id AND ch.tenant_id=rc.tenant_id WHERE rc.tenant_id=$1 AND rc.requirement_id=$2 AND rc.active AND rc.is_primary_source AND ch.channel_type IN ('email','phone','whatsapp') AND COALESCE(ch.channel_value,'')<>'') AS has_primary_channel,
             EXISTS(SELECT 1 FROM wizmatch_requirement_assignments a WHERE a.tenant_id=$1 AND a.requirement_id=$2 AND a.active AND a.role='account_owner') AS has_account_owner,
             EXISTS(SELECT 1 FROM wizmatch_requirement_assignments a WHERE a.tenant_id=$1 AND a.requirement_id=$2 AND a.active AND a.role='recruiter') AS has_recruiter,
             EXISTS(SELECT 1 FROM wizmatch_requirement_skills rs WHERE rs.tenant_id=$1 AND rs.requirement_id=$2 AND rs.importance='mandatory') AS has_mandatory_skill`,
          [tenantId, requirementId],
        ),
        (dbPool as unknown as Queryable).query(
          `SELECT
             (SELECT COUNT(*)::int FROM wizmatch_requirement_skills WHERE tenant_id=$1 AND requirement_id=$2) AS skill_count,
             (SELECT COUNT(*)::int FROM wizmatch_candidate_requirement_matches WHERE tenant_id=$1 AND requirement_id=$2) AS match_count,
             (SELECT COUNT(*)::int FROM wizmatch_candidate_requirement_matches WHERE tenant_id=$1 AND requirement_id=$2 AND human_decision='shortlisted') AS shortlist_count,
             (SELECT COUNT(*)::int FROM wizmatch_submissions WHERE tenant_id=$1 AND requirement_id=$2) AS submission_count,
             (SELECT COUNT(*)::int FROM wizmatch_placements WHERE tenant_id=$1 AND requirement_id=$2) AS placement_count,
             (SELECT COUNT(DISTINCT invoice_id)::int FROM wizmatch_placements WHERE tenant_id=$1 AND requirement_id=$2 AND invoice_id IS NOT NULL) AS invoice_count,
             (SELECT COUNT(DISTINCT payment.id)::int
              FROM wizmatch_placements placement
              JOIN payments payment ON payment.invoice_id=placement.invoice_id AND payment.tenant_id=placement.tenant_id
              WHERE placement.tenant_id=$1 AND placement.requirement_id=$2) AS collection_count`,
          [tenantId, requirementId],
        ),
        (dbPool as unknown as Queryable).query(
          `SELECT rs.id,rs.skill_id,rs.importance,rs.minimum_years,rs.evidence,rs.allow_broad_family,
                  skill.canonical_label,skill.family,skill.specialization,skill.platform_version
           FROM wizmatch_requirement_skills rs
           JOIN wizmatch_skills skill ON skill.id=rs.skill_id AND skill.tenant_id=rs.tenant_id
           WHERE rs.tenant_id=$1 AND rs.requirement_id=$2
           ORDER BY CASE rs.importance WHEN 'mandatory' THEN 0 ELSE 1 END,skill.canonical_label`,
          [tenantId, requirementId],
        ),
      ]);
      const readiness = buildRequirementReadiness(requirement.rows[0], readinessResult.rows[0] || {});
      return {
        requirement: requirement.rows[0],
        contacts: contactsResult,
        assignments,
        events,
        tasks: tasksResult.rows,
        requirementSkills: requirementSkillsResult.rows,
        readiness,
        allowedTransitions: allowedRequirementTransitions(requirement.rows[0].stage || 'draft', readiness.acceptance.ready),
        sourceTrace: requirement.rows[0].source_job_signal_id ? {
          jobSignalId: requirement.rows[0].source_job_signal_id,
          provider: requirement.rows[0].source_signal_provider,
          providerId: requirement.rows[0].source_signal_provider_id,
          title: requirement.rows[0].source_signal_title,
          url: requirement.rows[0].source_signal_url,
          status: requirement.rows[0].source_signal_status,
        } : null,
        relatedCounts: countsResult.rows[0] || { skill_count: 0, match_count: 0, shortlist_count: 0, submission_count: 0, placement_count: 0, invoice_count: 0, collection_count: 0 },
      };
    },

    async listCompanyContacts(tenantId: string, companyId: string) {
      await requireTenantRow(dbPool as unknown as Queryable, 'wizmatch_companies', companyId, tenantId, 'Company');
      const result = await (dbPool as unknown as Queryable).query(
        `SELECT cc.*, c.first_name, c.last_name, c.company_name,
                COALESCE(array_agg(DISTINCT ccr.role) FILTER (WHERE ccr.active), '{}') AS roles,
                (SELECT channel_value FROM contact_channels WHERE tenant_id = cc.tenant_id AND contact_id = c.id AND channel_type = 'email' ORDER BY is_primary DESC, created_at LIMIT 1) AS email,
                (SELECT channel_value FROM contact_channels WHERE tenant_id = cc.tenant_id AND contact_id = c.id AND channel_type IN ('phone','whatsapp') ORDER BY is_primary DESC, created_at LIMIT 1) AS phone,
                COUNT(DISTINCT rc.requirement_id) FILTER (WHERE rc.active) ::int AS active_requirement_count
         FROM wizmatch_company_contacts cc
         JOIN contacts c ON c.id = cc.contact_id AND c.tenant_id = cc.tenant_id
         LEFT JOIN wizmatch_company_contact_roles ccr ON ccr.company_contact_id = cc.id AND ccr.tenant_id = cc.tenant_id
         LEFT JOIN wizmatch_requirement_contacts rc ON rc.company_contact_id = cc.id AND rc.tenant_id = cc.tenant_id
         WHERE cc.tenant_id = $1 AND cc.company_id = $2
         GROUP BY cc.id, c.id ORDER BY cc.last_activity_at DESC NULLS LAST, c.first_name`,
        [tenantId, companyId],
      );
      return result.rows;
    },

    async createCompanyContact(actor: Actor, companyId: string, input: Record<string, unknown>) {
      return inTransaction(dbPool, async (client) => {
        const contactId = requireText(input.contactId, 'contactId');
        await requireTenantRow(client, 'wizmatch_companies', companyId, actor.tenantId, 'Company');
        await requireTenantRow(client, 'contacts', contactId, actor.tenantId, 'Contact');
        const ownerUserId = optionalText(input.ownerUserId);
        if (ownerUserId) await requireTenantRow(client, 'users', ownerUserId, actor.tenantId, 'Owner');
        const roles = Array.isArray(input.roles) ? [...new Set(input.roles.map(String))] : [];
        roles.forEach((role) => requireAllowed(role, COMPANY_CONTACT_ROLES, 'role'));
        try {
          const relationshipStage = requireAllowed(input.relationshipStage ?? 'active', RELATIONSHIP_STAGES, 'relationshipStage');
          const result = await client.query(
            `INSERT INTO wizmatch_company_contacts
               (tenant_id, company_id, contact_id, relationship_stage, business_unit, seniority, owner_user_id, source_type, source_id, source_confidence, next_action, next_action_due_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [actor.tenantId, companyId, contactId, relationshipStage, optionalText(input.businessUnit),
              optionalText(input.seniority), ownerUserId, input.sourceType ?? 'manual', optionalText(input.sourceId),
              typeof input.sourceConfidence === 'number' ? input.sourceConfidence : null, optionalText(input.nextAction), optionalDate(input.nextActionDueAt, 'nextActionDueAt')],
          );
          for (const role of roles) {
            await client.query(`INSERT INTO wizmatch_company_contact_roles (tenant_id, company_contact_id, role, added_by) VALUES ($1,$2,$3,$4)`, [actor.tenantId, result.rows[0].id, role, actor.userId]);
          }
          await client.query(`UPDATE contacts SET last_activity_at = now(), updated_at = now() WHERE id = $1 AND tenant_id = $2`, [contactId, actor.tenantId]);
          await appendEvent(client, actor, 'company_contact.created', { companyId, contactId, companyContactId: result.rows[0].id }, { roles });
          return result.rows[0];
        } catch (error: any) {
          if (error?.code === '23505') throw new StaffingDomainError(409, 'duplicate_relationship', 'This person is already linked to the company');
          throw error;
        }
      });
    },

    async updateCompanyContact(actor: Actor, companyId: string, companyContactId: string, input: Record<string, unknown>) {
      return inTransaction(dbPool, async (client) => {
        await requireTenantRow(client, 'wizmatch_companies', companyId, actor.tenantId, 'Company');
        const existing = await client.query(`SELECT * FROM wizmatch_company_contacts WHERE id=$1 AND company_id=$2 AND tenant_id=$3`, [companyContactId, companyId, actor.tenantId]);
        if (!existing.rowCount) throw new StaffingDomainError(404, 'not_found', 'Company contact relationship was not found');
        const relationshipStage = input.relationshipStage === undefined
          ? null
          : requireAllowed(input.relationshipStage, RELATIONSHIP_STAGES, 'relationshipStage');
        if (relationshipStage && relationshipStage !== 'active') {
          const linked = await client.query(`SELECT 1 FROM wizmatch_requirement_contacts WHERE tenant_id=$1 AND company_contact_id=$2 AND active LIMIT 1`, [actor.tenantId, companyContactId]);
          if (linked.rowCount) throw new StaffingDomainError(409, 'active_attribution_exists', 'Deactivate or reassign this person’s active requirement attributions first');
        }
        const ownerUserId = optionalText(input.ownerUserId);
        if (ownerUserId) await requireTenantRow(client, 'users', ownerUserId, actor.tenantId, 'Owner');
        const result = await client.query(
          `UPDATE wizmatch_company_contacts SET
             relationship_stage=COALESCE($4,relationship_stage), business_unit=$5, seniority=$6,
             owner_user_id=$7, next_action=$8, next_action_due_at=$9, last_activity_at=now(), updated_at=now()
           WHERE id=$1 AND company_id=$2 AND tenant_id=$3 RETURNING *`,
          [companyContactId, companyId, actor.tenantId, relationshipStage, optionalText(input.businessUnit),
            optionalText(input.seniority), ownerUserId, optionalText(input.nextAction), optionalDate(input.nextActionDueAt, 'nextActionDueAt')],
        );
        if (Array.isArray(input.roles)) {
          const roles = [...new Set(input.roles.map(String))];
          roles.forEach((role) => requireAllowed(role, COMPANY_CONTACT_ROLES, 'role'));
          await client.query(`UPDATE wizmatch_company_contact_roles SET active=false,deactivated_by=$3,deactivated_at=now() WHERE tenant_id=$1 AND company_contact_id=$2 AND active=true AND NOT (role = ANY($4::text[]))`, [actor.tenantId, companyContactId, actor.userId, roles]);
          for (const role of roles) {
            await client.query(
              `INSERT INTO wizmatch_company_contact_roles (tenant_id,company_contact_id,role,added_by) VALUES ($1,$2,$3,$4)
               ON CONFLICT (tenant_id,company_contact_id,role) DO UPDATE SET active=true,deactivated_by=NULL,deactivated_at=NULL`,
              [actor.tenantId, companyContactId, role, actor.userId],
            );
          }
        }
        await client.query(`UPDATE contacts SET last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2`, [existing.rows[0].contact_id, actor.tenantId]);
        await appendEvent(client, actor, 'company_contact.updated', { companyId, contactId: existing.rows[0].contact_id, companyContactId }, { fields: Object.keys(input) });
        return result.rows[0];
      });
    },

    async deactivateCompanyContact(actor: Actor, companyId: string, companyContactId: string) {
      return inTransaction(dbPool, async (client) => {
        const linked = await client.query(`SELECT 1 FROM wizmatch_requirement_contacts WHERE tenant_id=$1 AND company_contact_id=$2 AND active LIMIT 1`, [actor.tenantId, companyContactId]);
        if (linked.rowCount) throw new StaffingDomainError(409, 'active_attribution_exists', 'Deactivate or reassign this person’s active requirement attributions first');
        const result = await client.query(
          `UPDATE wizmatch_company_contacts SET relationship_stage='inactive',last_activity_at=now(),updated_at=now()
           WHERE id=$1 AND company_id=$2 AND tenant_id=$3 RETURNING *`, [companyContactId, companyId, actor.tenantId]);
        if (!result.rowCount) throw new StaffingDomainError(404, 'not_found', 'Company contact relationship was not found');
        await client.query(`UPDATE wizmatch_company_contact_roles SET active=false,deactivated_by=$2,deactivated_at=now() WHERE company_contact_id=$1 AND tenant_id=$3 AND active=true`, [companyContactId, actor.userId, actor.tenantId]);
        await client.query(`UPDATE contacts SET last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2`, [result.rows[0].contact_id, actor.tenantId]);
        await appendEvent(client, actor, 'company_contact.deactivated', { companyId, contactId: result.rows[0].contact_id, companyContactId });
        return result.rows[0];
      });
    },

    // Permanent delete of a hiring-contact (POC) *relationship* only. The
    // underlying CRM contact row, its channels and history are NEVER touched —
    // this removes the person's link to this company plus their role rows.
    // Blocked when the POC is still load-bearing: an active requirement
    // attribution, or a real delivery record (submission recipient / interview
    // participant) that must not be orphaned. Deactivate instead in that case.
    async deleteCompanyContact(actor: Actor, companyId: string, companyContactId: string) {
      return inTransaction(dbPool, async (client) => {
        const existing = await client.query(
          `SELECT cc.id, cc.contact_id, c.first_name, c.last_name
           FROM wizmatch_company_contacts cc JOIN contacts c ON c.id=cc.contact_id AND c.tenant_id=cc.tenant_id
           WHERE cc.id=$1 AND cc.company_id=$2 AND cc.tenant_id=$3`,
          [companyContactId, companyId, actor.tenantId],
        );
        if (!existing.rowCount) throw new StaffingDomainError(404, 'not_found', 'Company contact relationship was not found');
        const contactId = existing.rows[0].contact_id;

        const [activeAttr, recipients, interviews] = await Promise.all([
          client.query(`SELECT COUNT(*)::int AS n FROM wizmatch_requirement_contacts WHERE tenant_id=$1 AND company_contact_id=$2 AND active`, [actor.tenantId, companyContactId]),
          client.query(`SELECT COUNT(*)::int AS n FROM wizmatch_submission_recipients WHERE tenant_id=$1 AND company_contact_id=$2`, [actor.tenantId, companyContactId]),
          client.query(`SELECT COUNT(*)::int AS n FROM wizmatch_interview_participants WHERE tenant_id=$1 AND company_contact_id=$2`, [actor.tenantId, companyContactId]),
        ]);
        const dependencies: string[] = [];
        if (activeAttr.rows[0].n > 0) dependencies.push(`${activeAttr.rows[0].n} active requirement attribution(s)`);
        if (recipients.rows[0].n > 0) dependencies.push(`${recipients.rows[0].n} submission(s)`);
        if (interviews.rows[0].n > 0) dependencies.push(`${interviews.rows[0].n} interview(s)`);
        if (dependencies.length) {
          throw new StaffingDomainError(409, 'has_dependencies', `Cannot delete — this hiring contact has ${dependencies.join(', ')}. Deactivate the relationship instead (the CRM contact record is always kept).`);
        }

        // Remove NOT NULL children (role rows + inactive historical attributions).
        await client.query(`DELETE FROM wizmatch_company_contact_roles WHERE tenant_id=$1 AND company_contact_id=$2`, [actor.tenantId, companyContactId]);
        await client.query(`DELETE FROM wizmatch_requirement_contacts WHERE tenant_id=$1 AND company_contact_id=$2`, [actor.tenantId, companyContactId]);
        // Detach nullable FK history/operational rows BEFORE the delete.
        await client.query(`UPDATE wizmatch_task_links SET company_contact_id = NULL WHERE tenant_id=$1 AND company_contact_id=$2`, [actor.tenantId, companyContactId]);
        await client.query(`UPDATE wizmatch_staffing_events SET company_contact_id = NULL WHERE tenant_id=$1 AND company_contact_id=$2`, [actor.tenantId, companyContactId]);

        const result = await client.query(`DELETE FROM wizmatch_company_contacts WHERE id=$1 AND company_id=$2 AND tenant_id=$3 RETURNING id`, [companyContactId, companyId, actor.tenantId]);
        if (!result.rowCount) throw new StaffingDomainError(404, 'not_found', 'Company contact relationship was not found');
        // Keep the CRM contact row itself; just bump its activity timestamp.
        await client.query(`UPDATE contacts SET last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2`, [contactId, actor.tenantId]);
        const name = [existing.rows[0].first_name, existing.rows[0].last_name].filter(Boolean).join(' ');
        await appendEvent(client, actor, 'company_contact.deleted', { companyId, contactId, companyContactId: null }, { deletedCompanyContactId: companyContactId, name });
        return { deleted: true, id: companyContactId };
      });
    },

    // Permanent delete, empty companies only — no signals, requirements, or
    // linked hiring contacts. Anything with activity must stay (there is no
    // "archive company" concept; qualification/rejection lives on the
    // company-intelligence row and the company stays visible in history).
    async deleteCompany(actor: Actor, companyId: string) {
      return inTransaction(dbPool, async (client) => {
        await requireTenantRow(client, 'wizmatch_companies', companyId, actor.tenantId, 'Company');
        const [signals, requirements, contacts] = await Promise.all([
          client.query(`SELECT COUNT(*)::int AS n FROM wizmatch_job_signals WHERE tenant_id=$1 AND company_id=$2`, [actor.tenantId, companyId]),
          client.query(`SELECT COUNT(*)::int AS n FROM wizmatch_requirements WHERE tenant_id=$1 AND company_id=$2`, [actor.tenantId, companyId]),
          client.query(`SELECT COUNT(*)::int AS n FROM wizmatch_company_contacts WHERE tenant_id=$1 AND company_id=$2`, [actor.tenantId, companyId]),
        ]);
        const dependencies: string[] = [];
        if (signals.rows[0].n > 0) dependencies.push(`${signals.rows[0].n} job signal(s)`);
        if (requirements.rows[0].n > 0) dependencies.push(`${requirements.rows[0].n} requirement(s)`);
        if (contacts.rows[0].n > 0) dependencies.push(`${contacts.rows[0].n} hiring contact(s)`);
        if (dependencies.length) {
          throw new StaffingDomainError(409, 'has_dependencies', `Cannot delete — this company has ${dependencies.join(', ')}.`);
        }
        await client.query(`DELETE FROM wizmatch_discovery_runs WHERE tenant_id=$1 AND company_id=$2`, [actor.tenantId, companyId]);
        await client.query(`DELETE FROM wizmatch_source_runs WHERE tenant_id=$1 AND company_id=$2`, [actor.tenantId, companyId]);
        await client.query(`DELETE FROM wizmatch_company_intelligence WHERE tenant_id=$1 AND company_id=$2`, [actor.tenantId, companyId]);
        await client.query(`DELETE FROM wizmatch_contact_candidates WHERE tenant_id=$1 AND company_id=$2`, [actor.tenantId, companyId]);
        // Detach the event/task-link FK columns (history rows are kept, just
        // unlinked) BEFORE the delete — the FK requires this to happen first.
        await client.query(`UPDATE wizmatch_staffing_events SET company_id = NULL WHERE tenant_id=$1 AND company_id=$2`, [actor.tenantId, companyId]);
        await client.query(`UPDATE wizmatch_task_links SET company_id = NULL WHERE tenant_id=$1 AND company_id=$2`, [actor.tenantId, companyId]);
        const result = await client.query(`DELETE FROM wizmatch_companies WHERE id=$1 AND tenant_id=$2 RETURNING name`, [companyId, actor.tenantId]);
        if (!result.rowCount) throw new StaffingDomainError(404, 'not_found', 'Company was not found');
        await appendEvent(client, actor, 'company.deleted', { companyId: null }, { deletedCompanyId: companyId, name: result.rows[0].name });
        return { deleted: true, id: companyId };
      });
    },

    async listRequirementContacts(tenantId: string, requirementId: string) {
      await requireTenantRow(dbPool as unknown as Queryable, 'wizmatch_requirements', requirementId, tenantId, 'Requirement');
      const result = await (dbPool as unknown as Queryable).query(
        `SELECT rc.*, cc.company_id, cc.contact_id, c.first_name, c.last_name,
                (SELECT channel_value FROM contact_channels WHERE tenant_id=$1 AND contact_id=c.id AND channel_type='email' ORDER BY is_primary DESC,created_at LIMIT 1) AS email
         FROM wizmatch_requirement_contacts rc
         JOIN wizmatch_company_contacts cc ON cc.id=rc.company_contact_id AND cc.tenant_id=rc.tenant_id
         JOIN contacts c ON c.id=cc.contact_id AND c.tenant_id=rc.tenant_id
         WHERE rc.tenant_id=$1 AND rc.requirement_id=$2 ORDER BY rc.active DESC,rc.is_primary_source DESC,rc.attributed_at`,
        [tenantId, requirementId],
      );
      return result.rows;
    },

    async addRequirementContact(actor: Actor, requirementId: string, input: Record<string, unknown>) {
      return inTransaction(dbPool, async (client) => {
        const companyContactId = requireText(input.companyContactId, 'companyContactId');
        const role = requireAllowed(input.role ?? 'source', REQUIREMENT_CONTACT_ROLES, 'role');
        const requirement = await client.query(`SELECT id,company_id FROM wizmatch_requirements WHERE id=$1 AND tenant_id=$2`, [requirementId, actor.tenantId]);
        if (!requirement.rowCount) throw new StaffingDomainError(404, 'not_found', 'Requirement was not found');
        const relationship = await client.query(`SELECT id,company_id,contact_id FROM wizmatch_company_contacts WHERE id=$1 AND tenant_id=$2`, [companyContactId, actor.tenantId]);
        if (!relationship.rowCount || relationship.rows[0].company_id !== requirement.rows[0].company_id) {
          throw new StaffingDomainError(400, 'company_mismatch', 'The contact relationship must belong to the requirement company');
        }
        const isPrimarySource = input.isPrimarySource === true;
        try {
          const result = await client.query(
            `INSERT INTO wizmatch_requirement_contacts
               (tenant_id,requirement_id,company_contact_id,role,is_primary_source,received_channel,notes,attributed_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (tenant_id,requirement_id,company_contact_id,role) DO UPDATE
               SET active=true,is_primary_source=EXCLUDED.is_primary_source,received_channel=EXCLUDED.received_channel,
                   notes=EXCLUDED.notes,deactivated_by=NULL,deactivated_at=NULL RETURNING *`,
            [actor.tenantId, requirementId, companyContactId, role, isPrimarySource, optionalText(input.receivedChannel), optionalText(input.notes), actor.userId],
          );
          await client.query(`UPDATE wizmatch_requirements SET attribution_status=CASE WHEN $3 THEN 'attributed' ELSE attribution_status END,last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2`, [requirementId, actor.tenantId, isPrimarySource]);
          await client.query(`UPDATE wizmatch_company_contacts SET last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2`, [companyContactId, actor.tenantId]);
          await client.query(`UPDATE contacts SET last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2`, [relationship.rows[0].contact_id, actor.tenantId]);
          await appendEvent(client, actor, 'requirement_contact.attributed', { companyId: requirement.rows[0].company_id, contactId: relationship.rows[0].contact_id, companyContactId, requirementId }, { role, isPrimarySource });
          return result.rows[0];
        } catch (error: any) {
          if (error?.code === '23505') throw new StaffingDomainError(409, 'primary_source_exists', 'This requirement already has an active primary source');
          throw error;
        }
      });
    },

    async updateRequirementContact(actor: Actor, requirementId: string, attributionId: string, input: Record<string, unknown>) {
      return inTransaction(dbPool, async (client) => {
        const existing = await client.query(`SELECT rc.*,cc.company_id,cc.contact_id FROM wizmatch_requirement_contacts rc JOIN wizmatch_company_contacts cc ON cc.id=rc.company_contact_id WHERE rc.id=$1 AND rc.requirement_id=$2 AND rc.tenant_id=$3`, [attributionId, requirementId, actor.tenantId]);
        if (!existing.rowCount) throw new StaffingDomainError(404, 'not_found', 'Requirement contact attribution was not found');
        const role = input.role === undefined ? existing.rows[0].role : requireAllowed(input.role, REQUIREMENT_CONTACT_ROLES, 'role');
        const primary = input.isPrimarySource === undefined ? existing.rows[0].is_primary_source : input.isPrimarySource === true;
        try {
          const result = await client.query(`UPDATE wizmatch_requirement_contacts SET role=$4,is_primary_source=$5,received_channel=$6,notes=$7 WHERE id=$1 AND requirement_id=$2 AND tenant_id=$3 RETURNING *`, [attributionId, requirementId, actor.tenantId, role, primary, optionalText(input.receivedChannel), optionalText(input.notes)]);
          await client.query(`UPDATE wizmatch_requirements SET attribution_status=CASE WHEN EXISTS(SELECT 1 FROM wizmatch_requirement_contacts WHERE tenant_id=$2 AND requirement_id=$1 AND active AND is_primary_source) THEN 'attributed' ELSE 'needs_attribution' END,last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2`, [requirementId, actor.tenantId]);
          await appendEvent(client, actor, 'requirement_contact.updated', { companyId: existing.rows[0].company_id, contactId: existing.rows[0].contact_id, companyContactId: existing.rows[0].company_contact_id, requirementId }, { attributionId, role, isPrimarySource: primary });
          return result.rows[0];
        } catch (error: any) {
          if (error?.code === '23505') throw new StaffingDomainError(409, 'primary_source_exists', 'This requirement already has an active primary source');
          throw error;
        }
      });
    },

    async deactivateRequirementContact(actor: Actor, requirementId: string, attributionId: string) {
      return inTransaction(dbPool, async (client) => {
        const result = await client.query(`UPDATE wizmatch_requirement_contacts SET active=false,is_primary_source=false,deactivated_by=$4,deactivated_at=now() WHERE id=$1 AND requirement_id=$2 AND tenant_id=$3 RETURNING *`, [attributionId, requirementId, actor.tenantId, actor.userId]);
        if (!result.rowCount) throw new StaffingDomainError(404, 'not_found', 'Requirement contact attribution was not found');
        await client.query(`UPDATE wizmatch_requirements SET attribution_status=CASE WHEN EXISTS(SELECT 1 FROM wizmatch_requirement_contacts WHERE tenant_id=$2 AND requirement_id=$1 AND active AND is_primary_source) THEN 'attributed' ELSE 'needs_attribution' END,last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2`, [requirementId, actor.tenantId]);
        await appendEvent(client, actor, 'requirement_contact.deactivated', { companyContactId: result.rows[0].company_contact_id, requirementId }, { attributionId });
        return result.rows[0];
      });
    },

    async listAssignments(tenantId: string, requirementId: string) {
      await requireTenantRow(dbPool as unknown as Queryable, 'wizmatch_requirements', requirementId, tenantId, 'Requirement');
      const result = await (dbPool as unknown as Queryable).query(`SELECT a.*,u.name,u.email FROM wizmatch_requirement_assignments a JOIN users u ON u.id=a.user_id AND u.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.requirement_id=$2 ORDER BY a.active DESC,a.assigned_at`, [tenantId, requirementId]);
      return result.rows;
    },

    async addAssignment(actor: Actor, requirementId: string, input: Record<string, unknown>) {
      return inTransaction(dbPool, async (client) => {
        const userId = requireText(input.userId, 'userId');
        const role = requireAllowed(input.role, ASSIGNMENT_ROLES, 'role');
        await requireTenantRow(client, 'wizmatch_requirements', requirementId, actor.tenantId, 'Requirement');
        await requireTenantRow(client, 'users', userId, actor.tenantId, 'User');
        try {
          const result = await client.query(`INSERT INTO wizmatch_requirement_assignments (tenant_id,requirement_id,user_id,role,assigned_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [actor.tenantId, requirementId, userId, role, actor.userId]);
          await client.query(`UPDATE wizmatch_requirements SET last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2`, [requirementId, actor.tenantId]);
          await appendEvent(client, actor, 'requirement_assignment.created', { requirementId }, { assignmentId: result.rows[0].id, userId, role });
          return result.rows[0];
        } catch (error: any) {
          if (error?.code === '23505') throw new StaffingDomainError(409, 'duplicate_assignment', 'This active assignment already exists');
          throw error;
        }
      });
    },

    async updateAssignment(actor: Actor, requirementId: string, assignmentId: string, input: Record<string, unknown>) {
      return inTransaction(dbPool, async (client) => {
        const role = requireAllowed(input.role, ASSIGNMENT_ROLES, 'role');
        const result = await client.query(`UPDATE wizmatch_requirement_assignments SET role=$4 WHERE id=$1 AND requirement_id=$2 AND tenant_id=$3 AND active=true RETURNING *`, [assignmentId, requirementId, actor.tenantId, role]);
        if (!result.rowCount) throw new StaffingDomainError(404, 'not_found', 'Active assignment was not found');
        await client.query(`UPDATE wizmatch_requirements SET last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2`, [requirementId, actor.tenantId]);
        await appendEvent(client, actor, 'requirement_assignment.updated', { requirementId }, { assignmentId, role });
        return result.rows[0];
      });
    },

    async deactivateAssignment(actor: Actor, requirementId: string, assignmentId: string) {
      return inTransaction(dbPool, async (client) => {
        const result = await client.query(`UPDATE wizmatch_requirement_assignments SET active=false,unassigned_by=$4,unassigned_at=now() WHERE id=$1 AND requirement_id=$2 AND tenant_id=$3 AND active=true RETURNING *`, [assignmentId, requirementId, actor.tenantId, actor.userId]);
        if (!result.rowCount) throw new StaffingDomainError(404, 'not_found', 'Active assignment was not found');
        await client.query(`UPDATE wizmatch_requirements SET last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2`, [requirementId, actor.tenantId]);
        await appendEvent(client, actor, 'requirement_assignment.deactivated', { requirementId }, { assignmentId, userId: result.rows[0].user_id, role: result.rows[0].role });
        return result.rows[0];
      });
    },

    async transitionRequirement(actor: Actor, requirementId: string, input: Record<string, unknown>) {
      return inTransaction(dbPool, async (client) => {
        const targetStage = requireAllowed(input.stage, REQUIREMENT_STAGES, 'stage');
        const requirement = await client.query(`SELECT * FROM wizmatch_requirements WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [requirementId, actor.tenantId]);
        if (!requirement.rowCount) throw new StaffingDomainError(404, 'not_found', 'Requirement was not found');
        const currentStage = requirement.rows[0].stage ?? 'draft';
        assertStageTransition(currentStage, targetStage);
        const closureReason = optionalText(input.closureReason);
        if (['closed_lost', 'cancelled'].includes(targetStage) && !closureReason) throw new StaffingDomainError(400, 'closure_reason_required', 'A closure reason is required');
        if (targetStage === 'accepted') {
          const readiness = await client.query(
            `SELECT
               EXISTS(SELECT 1 FROM wizmatch_requirement_contacts WHERE tenant_id=$1 AND requirement_id=$2 AND active AND is_primary_source) AS has_primary,
               EXISTS(SELECT 1 FROM wizmatch_requirement_contacts rc
                 JOIN wizmatch_company_contacts cc ON cc.id=rc.company_contact_id AND cc.tenant_id=rc.tenant_id
                 JOIN contact_channels ch ON ch.contact_id=cc.contact_id AND ch.tenant_id=rc.tenant_id
                 WHERE rc.tenant_id=$1 AND rc.requirement_id=$2 AND rc.active AND rc.is_primary_source
                   AND ch.channel_type IN ('email','phone','whatsapp') AND COALESCE(ch.channel_value,'')<>'') AS has_primary_channel,
               EXISTS(SELECT 1 FROM wizmatch_requirement_assignments WHERE tenant_id=$1 AND requirement_id=$2 AND active AND role='account_owner') AS has_owner,
               EXISTS(SELECT 1 FROM wizmatch_requirement_assignments WHERE tenant_id=$1 AND requirement_id=$2 AND active AND role='recruiter') AS has_recruiter`,
            [actor.tenantId, requirementId],
          );
          const missing: string[] = [];
          if (!readiness.rows[0].has_primary) missing.push('primary source contact');
          if (!readiness.rows[0].has_primary_channel) missing.push('primary source contact channel');
          if (!readiness.rows[0].has_owner) missing.push('account owner');
          if (!readiness.rows[0].has_recruiter) missing.push('recruiter');
          if (!requirement.rows[0].sla_due_at) missing.push('SLA due date');
          if (!requirement.rows[0].next_action || !requirement.rows[0].next_action_due_at) missing.push('dated next action');
          if (missing.length) throw new StaffingDomainError(409, 'acceptance_not_ready', `Requirement cannot be accepted; missing ${missing.join(', ')}`);
        }
        const result = await client.query(
          `UPDATE wizmatch_requirements SET stage=$3,stage_entered_at=now(),accepted_at=CASE WHEN $3='accepted' THEN COALESCE(accepted_at,now()) ELSE accepted_at END,
             closure_reason=$4,last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING *`,
          [requirementId, actor.tenantId, targetStage, TERMINAL_STAGES.has(targetStage) ? closureReason : null],
        );
        await appendEvent(client, actor, 'requirement.stage_changed', { companyId: requirement.rows[0].company_id, requirementId }, { from: currentStage, to: targetStage, closureReason });
        return result.rows[0];
      });
    },

    async setNextAction(actor: Actor, requirementId: string, input: Record<string, unknown>) {
      return inTransaction(dbPool, async (client) => {
        const nextAction = requireText(input.nextAction, 'nextAction');
        const nextActionDueAt = optionalDate(input.nextActionDueAt, 'nextActionDueAt');
        if (!nextActionDueAt) throw new StaffingDomainError(400, 'validation_error', 'nextActionDueAt is required');
        const assigneeUserId = optionalText(input.assigneeUserId) ?? actor.userId;
        await requireTenantRow(client, 'users', assigneeUserId, actor.tenantId, 'Assignee');
        const requirement = await client.query(`UPDATE wizmatch_requirements SET next_action=$3,next_action_due_at=$4,sla_due_at=COALESCE($5,sla_due_at),last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING *`, [requirementId, actor.tenantId, nextAction, nextActionDueAt, optionalDate(input.slaDueAt, 'slaDueAt')]);
        if (!requirement.rowCount) throw new StaffingDomainError(404, 'not_found', 'Requirement was not found');
        const task = await client.query(`INSERT INTO tasks (tenant_id,title,description,assigned_to,due_at,status) VALUES ($1,$2,$3,$4,$5,'open') RETURNING *`, [actor.tenantId, nextAction, `Wizmatch requirement: ${requirement.rows[0].title}`, assigneeUserId, nextActionDueAt]);
        await client.query(`INSERT INTO wizmatch_task_links (tenant_id,task_id,company_id,requirement_id) VALUES ($1,$2,$3,$4)`, [actor.tenantId, task.rows[0].id, requirement.rows[0].company_id, requirementId]);
        await appendEvent(client, actor, 'requirement.next_action_set', { companyId: requirement.rows[0].company_id, requirementId }, { nextAction, nextActionDueAt, assigneeUserId, taskId: task.rows[0].id });
        return { requirement: requirement.rows[0], task: task.rows[0] };
      });
    },

    async createReviewPlan(actor: Actor, requirementId: string, input: Record<string, unknown>) {
      return inTransaction(dbPool, async (client) => {
        const action = requireAllowed(input.action ?? 'review_candidates', ['review_candidates', 'approve_contact', 'complete_requirement', 'watch', 'blocked', 'contact_client', 'resolve_blockers'], 'action');
        const dueAt = optionalDate(input.dueAt, 'dueAt');
        const requirement = await client.query(`SELECT id,company_id,title FROM wizmatch_requirements WHERE id=$1 AND tenant_id=$2`, [requirementId, actor.tenantId]);
        if (!requirement.rowCount) throw new StaffingDomainError(404, 'not_found', 'Requirement was not found');
        const labels: Record<string, string> = {
          review_candidates: 'Review candidates', approve_contact: 'Approve source contact',
          complete_requirement: 'Complete requirement intake', watch: 'Review watched requirement',
          blocked: 'Resolve requirement blockers', contact_client: 'Contact client', resolve_blockers: 'Resolve blockers',
        };
        const label = labels[action];
        const title = `${label} — ${requirement.rows[0].title}`;
        const task = await client.query(
          `INSERT INTO tasks (tenant_id,title,description,assigned_to,due_at,status) VALUES ($1,$2,$3,$4,$5,'open') RETURNING *`,
          [actor.tenantId, title, optionalText(input.notes) ?? 'Created from Wizmatch Requirement Priority review plan.', actor.userId, dueAt],
        );
        await client.query(`INSERT INTO wizmatch_task_links (tenant_id,task_id,company_id,requirement_id) VALUES ($1,$2,$3,$4)`, [actor.tenantId, task.rows[0].id, requirement.rows[0].company_id, requirementId]);
        if (dueAt) {
          await client.query(`UPDATE wizmatch_requirements SET next_action=$3,next_action_due_at=$4,last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2`, [requirementId, actor.tenantId, title, dueAt]);
        } else {
          await client.query(`UPDATE wizmatch_requirements SET last_activity_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2`, [requirementId, actor.tenantId]);
        }
        await appendEvent(client, actor, 'requirement.review_plan_created', { companyId: requirement.rows[0].company_id, requirementId }, { action, taskId: task.rows[0].id, dueAt });
        return { task: task.rows[0], nextActionUpdated: Boolean(dueAt) };
      });
    },

    async getTimeline(tenantId: string, requirementId: string) {
      await requireTenantRow(dbPool as unknown as Queryable, 'wizmatch_requirements', requirementId, tenantId, 'Requirement');
      const result = await (dbPool as unknown as Queryable).query(
        `SELECT e.*,u.name AS actor_name,u.email AS actor_email FROM wizmatch_staffing_events e LEFT JOIN users u ON u.id=e.actor_user_id AND u.tenant_id=e.tenant_id WHERE e.tenant_id=$1 AND e.requirement_id=$2 ORDER BY e.occurred_at DESC,e.created_at DESC`,
        [tenantId, requirementId],
      );
      return result.rows;
    },

    async getMyWork(tenantId: string, userId: string) {
      await requireTenantRow(dbPool as unknown as Queryable, 'users', userId, tenantId, 'User');
      const queryable = dbPool as unknown as Queryable;
      const [requirements, taskResult] = await Promise.all([
        queryable.query(
          `SELECT r.*,c.name AS company_name,
                  COALESCE(array_agg(DISTINCT a.role) FILTER (WHERE a.active AND a.user_id=$2),'{}') AS my_roles,
                  pc.first_name AS source_first_name,pc.last_name AS source_last_name
           FROM wizmatch_requirements r
           JOIN wizmatch_requirement_assignments a ON a.requirement_id=r.id AND a.tenant_id=r.tenant_id AND a.active AND a.user_id=$2
           LEFT JOIN wizmatch_companies c ON c.id=r.company_id AND c.tenant_id=r.tenant_id
           LEFT JOIN wizmatch_requirement_contacts rc ON rc.requirement_id=r.id AND rc.tenant_id=r.tenant_id AND rc.active AND rc.is_primary_source
           LEFT JOIN wizmatch_company_contacts cc ON cc.id=rc.company_contact_id AND cc.tenant_id=r.tenant_id
           LEFT JOIN contacts pc ON pc.id=cc.contact_id AND pc.tenant_id=r.tenant_id
           WHERE r.tenant_id=$1 AND r.stage NOT IN ('filled','closed_lost','cancelled')
           GROUP BY r.id,c.id,pc.id ORDER BY r.next_action_due_at ASC NULLS LAST,r.priority DESC`,
          [tenantId, userId],
        ),
        queryable.query(
          `SELECT t.*,l.requirement_id,l.company_id FROM tasks t JOIN wizmatch_task_links l ON l.task_id=t.id AND l.tenant_id=t.tenant_id WHERE t.tenant_id=$1 AND t.assigned_to=$2 AND t.status='open' ORDER BY t.due_at ASC NULLS LAST`,
          [tenantId, userId],
        ),
      ]);
      return { requirements: requirements.rows, tasks: taskResult.rows };
    },
  };
}

export type WizmatchStaffingService = ReturnType<typeof createWizmatchStaffingService>;
export const wizmatchStaffingService = createWizmatchStaffingService();
