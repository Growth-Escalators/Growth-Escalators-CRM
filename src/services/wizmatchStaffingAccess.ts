import type { Pool } from 'pg';
import { StaffingDomainError } from './wizmatchStaffingDomain';

export type StaffingActor = {
  tenantId: string;
  userId: string;
  role: string;
};

type Environment = Record<string, string | undefined>;
type Queryable = Pick<Pool, 'query'>;

const PILOT_ELIGIBLE_ROLES = new Set(['admin', 'team_lead', 'manager_ops', 'sales', 'staff']);
const GLOBAL_REQUIREMENT_ROLES = new Set(['admin', 'team_lead', 'manager_ops']);

function enabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function phaseEnabled(phase: 'A' | 'B' | 'C', env: Environment): boolean {
  const configured = env[`WIZMATCH_STAFFING_GATE_${phase}_ENABLED`];
  if (configured !== undefined) return enabled(configured);
  return env.NODE_ENV !== 'production';
}

function pilotIds(env: Environment): Set<string> {
  return new Set(String(env.WIZMATCH_STAFFING_PILOT_USER_IDS || '')
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean));
}

export function resolveStaffingAccess(actor: StaffingActor, env: Environment = process.env) {
  const phases = {
    A: phaseEnabled('A', env),
    B: phaseEnabled('B', env),
    C: phaseEnabled('C', env),
  };
  const ids = pilotIds(env);
  const allUsers = enabled(env.WIZMATCH_STAFFING_PILOT_ALL_USERS);
  const configured = allUsers || ids.size > 0;
  const roleEligible = PILOT_ELIGIBLE_ROLES.has(actor.role);
  const pilotAllowed = roleEligible && (allUsers || ids.has(actor.userId));
  const allowed = env.NODE_ENV === 'production'
    ? configured && pilotAllowed
    : roleEligible && (!configured || pilotAllowed);

  return {
    allowed,
    configured,
    phases,
    role: actor.role,
    capabilities: {
      manageRelationships: ['admin', 'team_lead', 'manager_ops', 'sales'].includes(actor.role),
      manageAssignedWork: PILOT_ELIGIBLE_ROLES.has(actor.role),
      manageCandidateEvidence: ['admin', 'team_lead', 'manager_ops', 'staff'].includes(actor.role),
      viewDelivery: ['admin', 'team_lead', 'manager_ops', 'staff'].includes(actor.role),
      operateDelivery: ['admin', 'team_lead', 'staff'].includes(actor.role),
      approveSubmissions: ['admin', 'team_lead'].includes(actor.role),
      manageOffers: ['admin', 'team_lead'].includes(actor.role),
      viewCommercial: ['admin', 'team_lead'].includes(actor.role),
      manageFinance: actor.role === 'admin',
    },
  };
}

export function requireStaffingPilot(actor: StaffingActor, env: Environment = process.env) {
  const access = resolveStaffingAccess(actor, env);
  if (!access.allowed) {
    throw new StaffingDomainError(403, 'staffing_pilot_access_required', 'This account is not enabled for the Staffing OS pilot');
  }
  return access;
}

export function requireStaffingRole(actor: StaffingActor, roles: readonly string[], message: string) {
  if (!roles.includes(actor.role)) throw new StaffingDomainError(403, 'forbidden', message);
  return actor;
}

export async function requireRequirementAccess(db: Queryable, actor: StaffingActor, requirementId: string) {
  if (GLOBAL_REQUIREMENT_ROLES.has(actor.role)) return actor;
  const allowedAssignmentRoles = actor.role === 'staff'
    ? ['recruiter', 'delivery_owner']
    : actor.role === 'sales'
      ? ['account_owner']
      : [];
  if (!allowedAssignmentRoles.length) {
    throw new StaffingDomainError(403, 'forbidden', 'This role cannot operate staffing requirements');
  }
  const result = await db.query(
    `SELECT 1 FROM wizmatch_requirement_assignments
     WHERE tenant_id=$1 AND requirement_id=$2 AND user_id=$3 AND active=true AND role=ANY($4::text[])
     LIMIT 1`,
    [actor.tenantId, requirementId, actor.userId, allowedAssignmentRoles],
  );
  if (!result.rowCount) {
    throw new StaffingDomainError(403, 'requirement_assignment_required', 'You must be actively assigned to this requirement');
  }
  return actor;
}

export async function requireCandidateAccess(db: Queryable, actor: StaffingActor, candidateId: string) {
  if (['admin', 'team_lead', 'manager_ops'].includes(actor.role)) return actor;
  if (actor.role !== 'staff') {
    throw new StaffingDomainError(403, 'forbidden', 'This role cannot view candidate staffing evidence');
  }
  const result = await db.query(
    `SELECT 1
     FROM wizmatch_candidate_requirement_matches m
     JOIN wizmatch_requirement_assignments a
       ON a.tenant_id=m.tenant_id AND a.requirement_id=m.requirement_id
      AND a.active=true AND a.user_id=$3 AND a.role IN ('recruiter','delivery_owner')
     WHERE m.tenant_id=$1 AND m.candidate_id=$2
     LIMIT 1`,
    [actor.tenantId, candidateId, actor.userId],
  );
  if (!result.rowCount) {
    throw new StaffingDomainError(403, 'candidate_assignment_required', 'Candidate access requires an assigned matching requirement');
  }
  return actor;
}

export async function requirementForResource(
  db: Queryable,
  actor: StaffingActor,
  resource: 'match' | 'consent' | 'submission' | 'interview' | 'offer',
  id: string,
) {
  const queries = {
    match: `SELECT requirement_id FROM wizmatch_candidate_requirement_matches WHERE tenant_id=$1 AND id=$2`,
    consent: `SELECT requirement_id FROM wizmatch_candidate_consents WHERE tenant_id=$1 AND id=$2`,
    submission: `SELECT requirement_id FROM wizmatch_submissions WHERE tenant_id=$1 AND id=$2`,
    interview: `SELECT s.requirement_id FROM wizmatch_interview_rounds i JOIN wizmatch_submissions s ON s.id=i.submission_id AND s.tenant_id=i.tenant_id WHERE i.tenant_id=$1 AND i.id=$2`,
    offer: `SELECT s.requirement_id FROM wizmatch_offers o JOIN wizmatch_submissions s ON s.id=o.submission_id AND s.tenant_id=o.tenant_id WHERE o.tenant_id=$1 AND o.id=$2`,
  };
  const result = await db.query(queries[resource], [actor.tenantId, id]);
  if (!result.rowCount) throw new StaffingDomainError(404, 'not_found', 'Referenced staffing record was not found');
  return String(result.rows[0].requirement_id);
}

export async function assignedRequirementIds(db: Queryable, actor: StaffingActor): Promise<Set<string> | null> {
  if (['admin', 'team_lead', 'manager_ops'].includes(actor.role)) return null;
  if (actor.role !== 'staff') return new Set();
  const result = await db.query(
    `SELECT DISTINCT requirement_id FROM wizmatch_requirement_assignments
     WHERE tenant_id=$1 AND user_id=$2 AND active=true AND role IN ('recruiter','delivery_owner')`,
    [actor.tenantId, actor.userId],
  );
  return new Set(result.rows.map((row) => String(row.requirement_id)));
}
