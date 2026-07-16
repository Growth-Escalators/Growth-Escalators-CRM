import type { Pool } from 'pg';
import { pool } from '../db';

type Queryable = Pick<Pool, 'query'>;

export function normalizePersistedPocCandidate(candidate: Record<string, any>) {
  return {
    ...candidate,
    state: candidate.state || candidate.metadata?.pocState || 'pending_research',
  };
}

export const SIGNAL_DRAFTS_QUERY = `SELECT id, content, metadata, status, sent_at AS created_at
 FROM messages
 WHERE tenant_id=$3 AND contact_id = $1 AND metadata->>'signal_id' = $2
 ORDER BY sent_at DESC NULLS LAST`;

export function normalizeWizmatchSignalListItem(signal: Record<string, any>) {
  return {
    ...signal,
    qualification: {
      qualified: Boolean(signal.qualified),
      taskId: signal.poc_task_id || null,
      taskStatus: signal.poc_task_status || null,
      dueAt: signal.poc_task_due_at || null,
    },
    linked_requirement: signal.linked_requirement_id ? {
      id: signal.linked_requirement_id,
      title: signal.linked_requirement_title,
      stage: signal.linked_requirement_stage,
    } : null,
  };
}

export async function getWizmatchSignalDetail(tenantId: string, signalId: string, db: Queryable = pool) {
  const result = await db.query(
    `SELECT s.*, c.name AS company_name, c.domain AS company_domain, c.ats_type,
            cnt.first_name AS contact_first_name, cnt.last_name AS contact_last_name,
            cnt.id AS contact_id
     FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id AND c.tenant_id=s.tenant_id
     LEFT JOIN contacts cnt ON cnt.id = s.contact_id AND cnt.tenant_id=s.tenant_id
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [signalId, tenantId],
  );
  if (!result.rows.length) return null;

  const signal = result.rows[0];
  const matchedCandidatesPromise = signal.matched_candidate_ids?.length
    ? db.query(
      `SELECT wc.id, wc.skills, wc.location, wc.visa_status, wc.rate_hourly,
              wc.rate_currency, wc.availability_date, wc.availability_status,
              c.first_name, c.last_name
       FROM wizmatch_candidates wc
       JOIN contacts c ON c.id = wc.contact_id AND c.tenant_id=wc.tenant_id
      WHERE wc.id = ANY($1::uuid[]) AND wc.tenant_id=$2`,
      [signal.matched_candidate_ids, tenantId],
    )
    : Promise.resolve({ rows: [] });

  const [matchedCandidates, drafts, qualification, linkedRequirement, pocCandidates] = await Promise.all([
    matchedCandidatesPromise,
    db.query(SIGNAL_DRAFTS_QUERY, [signal.contact_id, signalId, tenantId]),
    db.query(
      `SELECT event.occurred_at AS qualified_at,
              task.id AS task_id,task.status AS task_status,task.assigned_to AS owner_user_id,task.due_at
       FROM (SELECT $1::text AS signal_id) input
       LEFT JOIN LATERAL (
         SELECT occurred_at FROM wizmatch_staffing_events
         WHERE tenant_id=$2 AND event_type='job_signal.qualified' AND source_id=input.signal_id
         ORDER BY occurred_at DESC LIMIT 1
       ) event ON true
       LEFT JOIN LATERAL (
         SELECT t.id,t.status,t.assigned_to,t.due_at
         FROM wizmatch_task_links link
         JOIN tasks t ON t.id=link.task_id AND t.tenant_id=link.tenant_id
         WHERE link.tenant_id=$2 AND link.job_signal_id=input.signal_id::uuid AND t.title='Find Main POC'
         ORDER BY (t.status='open') DESC,t.updated_at DESC LIMIT 1
       ) task ON true`,
      [signalId, tenantId],
    ),
    db.query(
      `SELECT id,title,stage,status,attribution_status,created_at
       FROM wizmatch_requirements
       WHERE tenant_id=$1 AND source_job_signal_id=$2
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, signalId],
    ),
    signal.company_id ? db.query(
      `SELECT id,name,title,role_category,email,phone,linkedin_url,source,source_url,
              deliverability_status,status,metadata,ranking_score,confidence_score
       FROM wizmatch_contact_candidates
       WHERE tenant_id=$1 AND company_id=$2 AND metadata->>'signalId'=$3
         AND status NOT IN ('rejected','do_not_contact')
       ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'linked_to_crm' THEN 1 ELSE 2 END,
                ranking_score DESC NULLS LAST,created_at DESC
       LIMIT 3`,
      [tenantId, signal.company_id, signalId],
    ) : Promise.resolve({ rows: [] }),
  ]);

  const qualificationRow = qualification.rows[0] || {};
  const requirementRow = linkedRequirement.rows[0] || null;
  return {
    ...signal,
    matched_candidates: matchedCandidates.rows,
    drafts: drafts.rows,
    qualification: {
      qualified: Boolean(qualificationRow.qualified_at),
      qualifiedAt: qualificationRow.qualified_at || null,
      taskId: qualificationRow.task_id || null,
      taskStatus: qualificationRow.task_status || null,
      ownerUserId: qualificationRow.owner_user_id || null,
      dueAt: qualificationRow.due_at || null,
    },
    linked_requirement: requirementRow,
    linked_requirement_id: requirementRow?.id || null,
    poc_candidates: pocCandidates.rows.slice(0, 3).map(normalizePersistedPocCandidate),
  };
}
