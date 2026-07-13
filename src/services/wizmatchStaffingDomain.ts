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

export function createWizmatchStaffingService(dbPool: TransactionPool = pool) {
  return {
    async listCompanies(tenantId: string, search = '') {
      const result = await (dbPool as unknown as Queryable).query(
        `SELECT c.id,c.name,c.domain,c.industry,c.country,
                COUNT(DISTINCT cc.id)::int AS contact_count,
                COUNT(DISTINCT r.id) FILTER (WHERE r.stage NOT IN ('filled','closed_lost','cancelled'))::int AS open_requirement_count
         FROM wizmatch_companies c
         LEFT JOIN wizmatch_company_contacts cc ON cc.company_id=c.id AND cc.tenant_id=c.tenant_id AND cc.relationship_stage='active'
         LEFT JOIN wizmatch_requirements r ON r.company_id=c.id AND r.tenant_id=c.tenant_id
         WHERE c.tenant_id=$1 AND ($2='' OR c.name ILIKE '%' || $2 || '%' OR COALESCE(c.domain,'') ILIKE '%' || $2 || '%')
         GROUP BY c.id ORDER BY c.name LIMIT 200`,
        [tenantId, search.trim()],
      );
      return result.rows;
    },

    async listUsers(tenantId: string) {
      const result = await (dbPool as unknown as Queryable).query(`SELECT id,name,email,role FROM users WHERE tenant_id=$1 ORDER BY name`, [tenantId]);
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
      const requirement = await (dbPool as unknown as Queryable).query(`SELECT r.*,c.name AS company_name FROM wizmatch_requirements r LEFT JOIN wizmatch_companies c ON c.id=r.company_id AND c.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.id=$2`, [tenantId, requirementId]);
      if (!requirement.rowCount) throw new StaffingDomainError(404, 'not_found', 'Requirement was not found');
      const [contactsResult, assignments, events, tasksResult] = await Promise.all([
        this.listRequirementContacts(tenantId, requirementId),
        this.listAssignments(tenantId, requirementId),
        this.getTimeline(tenantId, requirementId),
        (dbPool as unknown as Queryable).query(`SELECT t.* FROM tasks t JOIN wizmatch_task_links l ON l.task_id=t.id AND l.tenant_id=t.tenant_id WHERE t.tenant_id=$1 AND l.requirement_id=$2 ORDER BY t.status,t.due_at`, [tenantId, requirementId]),
      ]);
      return { requirement: requirement.rows[0], contacts: contactsResult, assignments, events, tasks: tasksResult.rows };
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
               EXISTS(SELECT 1 FROM wizmatch_requirement_assignments WHERE tenant_id=$1 AND requirement_id=$2 AND active AND role='account_owner') AS has_owner,
               EXISTS(SELECT 1 FROM wizmatch_requirement_assignments WHERE tenant_id=$1 AND requirement_id=$2 AND active AND role='recruiter') AS has_recruiter`,
            [actor.tenantId, requirementId],
          );
          const missing: string[] = [];
          if (!readiness.rows[0].has_primary) missing.push('primary source contact');
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
