import type { Pool, PoolClient } from 'pg';
import { pool } from '../db';
import { StaffingDomainError } from './wizmatchStaffingDomain';

export const CONSENT_STATUSES = ['requested', 'granted', 'revoked', 'expired'] as const;
export const SUBMISSION_STATUSES = ['draft', 'approved', 'submitted', 'interviewing', 'offered', 'placed', 'rejected', 'withdrawn', 'closed'] as const;
export const CONSENT_VALIDITY_DAYS = 30;
export const MINIMUM_CONTRACT_MARGIN_PERCENT = 20;

export interface StaffingAnalyticsFilters {
  from: string | null;
  to: string | null;
  companyId: string | null;
  recruiterId: string | null;
  skillId: string | null;
  source: string | null;
}

function optionalAnalyticsValue(value: unknown, name: string) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 100) throw new StaffingDomainError(400, 'validation_error', `${name} is invalid`);
  return value.trim() || null;
}

export function normalizeStaffingAnalyticsFilters(input: Record<string, unknown> = {}): StaffingAnalyticsFilters {
  const from = optionalAnalyticsValue(input.from, 'from');
  const to = optionalAnalyticsValue(input.to, 'to');
  for (const [name, value] of [['from', from], ['to', to]] as const) {
    const parsed = value ? new Date(`${value}T00:00:00.000Z`) : null;
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)) {
      throw new StaffingDomainError(400, 'validation_error', `${name} must use YYYY-MM-DD`);
    }
  }
  if (from && to && from > to) throw new StaffingDomainError(400, 'validation_error', 'from must be on or before to');

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const companyId = optionalAnalyticsValue(input.companyId, 'companyId');
  const recruiterId = optionalAnalyticsValue(input.recruiterId, 'recruiterId');
  const skillId = optionalAnalyticsValue(input.skillId, 'skillId');
  for (const [name, value] of [['companyId', companyId], ['recruiterId', recruiterId], ['skillId', skillId]] as const) {
    if (value && !uuidPattern.test(value)) throw new StaffingDomainError(400, 'validation_error', `${name} must be a UUID`);
  }

  const source = optionalAnalyticsValue(input.source, 'source')?.toLowerCase() || null;
  if (source && !/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(source)) throw new StaffingDomainError(400, 'validation_error', 'source is invalid');
  return { from, to, companyId, recruiterId, skillId, source };
}

function requirementAnalyticsScope(requirementAlias: string, dateExpression: string, candidateAlias?: string) {
  const candidateSource = candidateAlias ? ` OR ${candidateAlias}.source=$7::text` : '';
  return `
    AND ($2::date IS NULL OR (${dateExpression}) >= $2::date)
    AND ($3::date IS NULL OR (${dateExpression}) < $3::date + INTERVAL '1 day')
    AND ($4::uuid IS NULL OR ${requirementAlias}.company_id=$4::uuid)
    AND ($5::uuid IS NULL OR EXISTS (
      SELECT 1 FROM wizmatch_requirement_assignments analytics_assignment
      WHERE analytics_assignment.tenant_id=${requirementAlias}.tenant_id
        AND analytics_assignment.requirement_id=${requirementAlias}.id
        AND analytics_assignment.active AND analytics_assignment.role='recruiter'
        AND analytics_assignment.user_id=$5::uuid
    ))
    AND ($6::uuid IS NULL OR EXISTS (
      SELECT 1 FROM wizmatch_requirement_skills analytics_skill
      WHERE analytics_skill.tenant_id=${requirementAlias}.tenant_id
        AND analytics_skill.requirement_id=${requirementAlias}.id
        AND analytics_skill.skill_id=$6::uuid
    ))
    AND ($7::text IS NULL OR EXISTS (
      SELECT 1 FROM wizmatch_job_signals analytics_signal
      WHERE analytics_signal.tenant_id=${requirementAlias}.tenant_id
        AND analytics_signal.id=${requirementAlias}.source_job_signal_id
        AND analytics_signal.source=$7::text
    )${candidateSource})`;
}

function signalAnalyticsScope(signalAlias: string) {
  return `
    AND ($2::date IS NULL OR ${signalAlias}.created_at >= $2::date)
    AND ($3::date IS NULL OR ${signalAlias}.created_at < $3::date + INTERVAL '1 day')
    AND ($4::uuid IS NULL OR ${signalAlias}.company_id=$4::uuid)
    AND ($5::uuid IS NULL OR EXISTS (
      SELECT 1 FROM wizmatch_requirements analytics_requirement
      JOIN wizmatch_requirement_assignments analytics_assignment
        ON analytics_assignment.requirement_id=analytics_requirement.id
       AND analytics_assignment.tenant_id=analytics_requirement.tenant_id
       AND analytics_assignment.active AND analytics_assignment.role='recruiter'
      WHERE analytics_requirement.tenant_id=${signalAlias}.tenant_id
        AND analytics_requirement.source_job_signal_id=${signalAlias}.id
        AND analytics_assignment.user_id=$5::uuid
    ))
    AND ($6::uuid IS NULL OR EXISTS (
      SELECT 1 FROM wizmatch_requirements analytics_requirement
      JOIN wizmatch_requirement_skills analytics_skill
        ON analytics_skill.requirement_id=analytics_requirement.id
       AND analytics_skill.tenant_id=analytics_requirement.tenant_id
      WHERE analytics_requirement.tenant_id=${signalAlias}.tenant_id
        AND analytics_requirement.source_job_signal_id=${signalAlias}.id
        AND analytics_skill.skill_id=$6::uuid
    ))
    AND ($7::text IS NULL OR ${signalAlias}.source=$7::text)`;
}

function required(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new StaffingDomainError(400, 'validation_error', `${name} is required`);
  return value.trim();
}
function integer(value: unknown, name: string, nullable = false): number | null {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new StaffingDomainError(400, 'validation_error', `${name} must be a non-negative integer`);
  return parsed;
}
function consentExpiry(value: unknown): string {
  const now = Date.now();
  const maximum = now + CONSENT_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
  const parsed = value ? new Date(String(value)).getTime() : maximum;
  if (!Number.isFinite(parsed) || parsed <= now) throw new StaffingDomainError(400, 'validation_error', 'Consent expiry must be a future date');
  if (parsed > maximum + 60_000) throw new StaffingDomainError(400, 'consent_validity_exceeded', `Consent cannot be valid for more than ${CONSENT_VALIDITY_DAYS} days`);
  return new Date(parsed).toISOString();
}
async function tx<T>(dbPool: Pool, fn: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function row(client: Pick<PoolClient, 'query'>, table: string, tenantId: string, id: string, lock = false) {
  const allowed = new Set(['wizmatch_requirements', 'wizmatch_candidates', 'wizmatch_candidate_requirement_matches', 'wizmatch_candidate_consents', 'wizmatch_submissions', 'wizmatch_interview_rounds', 'wizmatch_offers', 'wizmatch_placements', 'wizmatch_company_contacts', 'billing_clients', 'invoices', 'payments', 'users']);
  if (!allowed.has(table)) throw new Error('Unsafe tenant table');
  const result = await client.query(`SELECT * FROM ${table} WHERE tenant_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [tenantId, id]);
  if (!result.rowCount) throw new StaffingDomainError(404, 'not_found', 'Referenced record was not found');
  return result.rows[0];
}
async function staffingEvent(client: PoolClient, actor: { tenantId: string; userId: string }, eventType: string, requirementId: string | null, payload: Record<string, unknown>) {
  await client.query(`INSERT INTO wizmatch_staffing_events (tenant_id,actor_user_id,event_type,requirement_id,candidate_id,match_id,submission_id,placement_id,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [actor.tenantId, actor.userId, eventType, requirementId, payload.candidateId || null, payload.matchId || null, payload.submissionId || null, payload.placementId || null, JSON.stringify(payload)]);
}
async function submissionEvent(client: PoolClient, actor: { tenantId: string; userId: string }, submissionId: string, eventType: string, payload: Record<string, unknown>) {
  const versionResult = await client.query(`SELECT COALESCE(MAX(version),0)+1 AS version FROM wizmatch_submission_events WHERE tenant_id=$1 AND submission_id=$2`, [actor.tenantId, submissionId]);
  await client.query(`INSERT INTO wizmatch_submission_events (tenant_id,submission_id,event_type,version,actor_user_id,payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [actor.tenantId, submissionId, eventType, versionResult.rows[0].version, actor.userId, JSON.stringify(payload)]);
}

export function calculateStaffingEconomics(input: { model: 'permanent' | 'contract'; billAmount?: number | null; payAmount?: number | null; loadedCost?: number | null; feeAmount?: number | null }) {
  if (input.model === 'permanent') {
    const revenue = input.feeAmount ?? 0;
    return { grossMarginAmount: revenue, grossMarginPercent: revenue > 0 ? 100 : 0 };
  }
  const bill = input.billAmount ?? 0;
  const cost = input.loadedCost ?? input.payAmount ?? 0;
  const margin = bill - cost;
  return { grossMarginAmount: margin, grossMarginPercent: bill > 0 ? Math.round((margin / bill) * 10_000) / 100 : 0 };
}

export function assertCurrentConsent(consent: { status: string; expires_at?: Date | string | null } | null) {
  if (!consent || consent.status !== 'granted') throw new StaffingDomainError(409, 'consent_required', 'Current requirement-specific consent is required');
  if (consent.expires_at && new Date(consent.expires_at).getTime() <= Date.now()) throw new StaffingDomainError(409, 'consent_expired', 'Candidate consent has expired');
}

export function submissionNextAllowedActions(status: string) {
  const actions: Record<string, string[]> = {
    draft: ['approve_submission', 'withdraw_submission'],
    approved: ['record_sent', 'withdraw_submission'],
    submitted: ['schedule_interview', 'withdraw_submission'],
    interviewing: ['record_interview_feedback', 'create_offer', 'withdraw_submission'],
    offered: ['update_offer', 'create_placement', 'withdraw_submission'],
    placed: [], rejected: [], withdrawn: [], closed: [],
  };
  return actions[status] || [];
}

export function placementNextAllowedActions(input: { status?: string | null; invoice_id?: string | null; amount_due?: number | string | null; open_adjustment_count?: number | string | null }) {
  const actions: string[] = [];
  if (!input.invoice_id && ['started', 'ended'].includes(String(input.status || ''))) actions.push('link_invoice');
  if (input.invoice_id) actions.push(Number(input.amount_due || 0) > 0 ? 'review_collection' : 'review_invoice');
  if (['started', 'ended'].includes(String(input.status || ''))) actions.push('open_adjustment');
  if (Number(input.open_adjustment_count || 0) > 0) actions.push('resolve_adjustment');
  return actions;
}

function privateDocumentReference(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const reference = required(value, 'documentReference');
  if (!reference.startsWith('r2://')) throw new StaffingDomainError(400, 'private_document_required', 'Consent documents must use private object storage');
  return reference;
}

export function createWizmatchDeliveryService(dbPool: Pool = pool) {
  return {
    async createConsent(actor: { tenantId: string; userId: string }, input: Record<string, unknown>) {
      const candidateId = required(input.candidateId, 'candidateId');
      const requirementId = required(input.requirementId, 'requirementId');
      const documentReference = privateDocumentReference(input.documentReference);
      const expiresAt = consentExpiry(input.expiresAt);
      return tx(dbPool, async (client) => {
        await row(client, 'wizmatch_candidates', actor.tenantId, candidateId);
        await row(client, 'wizmatch_requirements', actor.tenantId, requirementId);
        await client.query(`UPDATE wizmatch_candidate_consents SET status='expired',updated_at=NOW() WHERE tenant_id=$1 AND candidate_id=$2 AND requirement_id=$3 AND status='granted' AND expires_at IS NOT NULL AND expires_at<=NOW()`, [actor.tenantId, candidateId, requirementId]);
        const current = await client.query(`SELECT id,status FROM wizmatch_candidate_consents WHERE tenant_id=$1 AND candidate_id=$2 AND requirement_id=$3 AND status IN ('requested','granted') LIMIT 1`, [actor.tenantId, candidateId, requirementId]);
        if (current.rowCount) throw new StaffingDomainError(409, 'active_consent_exists', 'An active consent record already exists for this candidate and requirement');
        let result;
        try {
          result = await client.query(`INSERT INTO wizmatch_candidate_consents (tenant_id,candidate_id,requirement_id,consent_type,status,terms,document_reference,requested_by,granted_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,CASE WHEN $5='granted' THEN NOW() ELSE NULL END,$9) RETURNING *`, [actor.tenantId, candidateId, requirementId, input.consentType || 'rtr', input.status === 'granted' ? 'granted' : 'requested', JSON.stringify(input.terms || {}), documentReference, actor.userId, expiresAt]);
        } catch (error) {
          if ((error as { code?: string }).code === '23505') throw new StaffingDomainError(409, 'active_consent_exists', 'An active consent record already exists for this candidate and requirement');
          throw error;
        }
        await staffingEvent(client, actor, 'candidate_consent_created', requirementId, { consentId: result.rows[0].id, candidateId, status: result.rows[0].status });
        return result.rows[0];
      });
    },

    async grantConsent(actor: { tenantId: string; userId: string }, consentId: string, input: Record<string, unknown>) {
      const documentReference = privateDocumentReference(input.documentReference);
      const expiresAt = consentExpiry(input.expiresAt);
      return tx(dbPool, async (client) => {
        const consent = await row(client, 'wizmatch_candidate_consents', actor.tenantId, consentId, true);
        if (consent.status === 'revoked') throw new StaffingDomainError(409, 'invalid_transition', 'Revoked consent cannot be granted again');
        const result = await client.query(`UPDATE wizmatch_candidate_consents SET status='granted',terms=COALESCE($3::jsonb,terms),document_reference=COALESCE($4,document_reference),granted_at=NOW(),expires_at=$5,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [actor.tenantId, consentId, input.terms ? JSON.stringify(input.terms) : null, documentReference, expiresAt]);
        await staffingEvent(client, actor, 'candidate_consent_granted', consent.requirement_id, { consentId, candidateId: consent.candidate_id });
        return result.rows[0];
      });
    },

    async revokeConsent(actor: { tenantId: string; userId: string }, consentId: string, reason: string) {
      return tx(dbPool, async (client) => {
        const consent = await row(client, 'wizmatch_candidate_consents', actor.tenantId, consentId, true);
        const result = await client.query(`UPDATE wizmatch_candidate_consents SET status='revoked',revoked_at=NOW(),revocation_reason=$3,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [actor.tenantId, consentId, required(reason, 'reason')]);
        await staffingEvent(client, actor, 'candidate_consent_revoked', consent.requirement_id, { consentId, candidateId: consent.candidate_id, reason });
        return result.rows[0];
      });
    },

    async createSubmissionDraft(actor: { tenantId: string; userId: string }, input: Record<string, unknown>) {
      const requirementId = required(input.requirementId, 'requirementId');
      const candidateId = required(input.candidateId, 'candidateId');
      const matchId = required(input.matchId, 'matchId');
      return tx(dbPool, async (client) => {
        await row(client, 'wizmatch_requirements', actor.tenantId, requirementId);
        await row(client, 'wizmatch_candidates', actor.tenantId, candidateId);
        const match = await row(client, 'wizmatch_candidate_requirement_matches', actor.tenantId, matchId);
        if (match.requirement_id !== requirementId || match.candidate_id !== candidateId) throw new StaffingDomainError(400, 'invalid_reference', 'Match does not belong to this candidate and requirement');
        if (match.human_decision !== 'shortlisted') throw new StaffingDomainError(409, 'shortlist_required', 'Candidate must be shortlisted before a submission draft');
        try {
          const result = await client.query(`INSERT INTO wizmatch_submissions (tenant_id,requirement_id,candidate_id,match_id,status,submission_payload,prepared_by,next_action,next_action_due_at) VALUES ($1,$2,$3,$4,'draft',$5::jsonb,$6,$7,$8) RETURNING *`, [actor.tenantId, requirementId, candidateId, matchId, JSON.stringify(input.payload || {}), actor.userId, input.nextAction || null, input.nextActionDueAt || null]);
          await submissionEvent(client, actor, result.rows[0].id, 'draft_created', { matchId });
          await staffingEvent(client, actor, 'submission_draft_created', requirementId, { submissionId: result.rows[0].id, candidateId, matchId });
          return result.rows[0];
        } catch (error) {
          if ((error as { code?: string }).code === '23505') throw new StaffingDomainError(409, 'duplicate_submission', 'An active submission already exists for this candidate and requirement');
          throw error;
        }
      });
    },

    async approveSubmission(actor: { tenantId: string; userId: string }, submissionId: string) {
      return tx(dbPool, async (client) => {
        const submission = await row(client, 'wizmatch_submissions', actor.tenantId, submissionId, true);
        if (submission.status !== 'draft') throw new StaffingDomainError(409, 'invalid_transition', 'Only a draft can be approved');
        const consentResult = await client.query(`SELECT * FROM wizmatch_candidate_consents WHERE tenant_id=$1 AND requirement_id=$2 AND candidate_id=$3 AND status='granted' ORDER BY granted_at DESC LIMIT 1`, [actor.tenantId, submission.requirement_id, submission.candidate_id]);
        assertCurrentConsent(consentResult.rows[0] || null);
        const result = await client.query(`UPDATE wizmatch_submissions SET status='approved',consent_id=$3,approved_by=$4,approved_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [actor.tenantId, submissionId, consentResult.rows[0].id, actor.userId]);
        await submissionEvent(client, actor, submissionId, 'approved', { consentId: consentResult.rows[0].id });
        await staffingEvent(client, actor, 'submission_approved', submission.requirement_id, { submissionId, candidateId: submission.candidate_id });
        return result.rows[0];
      });
    },

    async recordSent(actor: { tenantId: string; userId: string }, submissionId: string, input: Record<string, unknown>) {
      return tx(dbPool, async (client) => {
        const submission = await row(client, 'wizmatch_submissions', actor.tenantId, submissionId, true);
        if (!['approved', 'submitted'].includes(submission.status)) throw new StaffingDomainError(409, 'approval_required', 'Submission must be approved before recording delivery');
        const consent = submission.consent_id ? await row(client, 'wizmatch_candidate_consents', actor.tenantId, submission.consent_id) : null;
        assertCurrentConsent(consent);
        const recipients = Array.isArray(input.recipients) ? input.recipients as Record<string, unknown>[] : [];
        if (!recipients.length) throw new StaffingDomainError(400, 'recipient_required', 'At least one named recipient is required');
        const requirement = await row(client, 'wizmatch_requirements', actor.tenantId, submission.requirement_id);
        for (const recipient of recipients) {
          const companyContactId = recipient.companyContactId ? required(recipient.companyContactId, 'companyContactId') : null;
          if (companyContactId) {
            const companyContact = await row(client, 'wizmatch_company_contacts', actor.tenantId, companyContactId);
            if (companyContact.company_id !== requirement.company_id) throw new StaffingDomainError(400, 'invalid_reference', 'Recipient contact does not belong to the requirement company');
          }
          await client.query(`INSERT INTO wizmatch_submission_recipients (tenant_id,submission_id,company_contact_id,name,email,role,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [actor.tenantId, submissionId, companyContactId, required(recipient.name, 'recipient name'), recipient.email || null, recipient.role || 'recipient', actor.userId]);
        }
        const resend = submission.status === 'submitted';
        const result = await client.query(`UPDATE wizmatch_submissions SET status='submitted',resend_count=resend_count+$3,first_sent_at=COALESCE(first_sent_at,NOW()),last_sent_at=NOW(),next_action=$4,next_action_due_at=$5,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [actor.tenantId, submissionId, resend ? 1 : 0, input.nextAction || 'Follow up for submission feedback', input.nextActionDueAt || null]);
        await submissionEvent(client, actor, submissionId, resend ? 'resent_recorded' : 'sent_recorded', { recipients, manualRecordOnly: true });
        await staffingEvent(client, actor, resend ? 'submission_resent_recorded' : 'submission_sent_recorded', submission.requirement_id, { submissionId, candidateId: submission.candidate_id, recipientCount: recipients.length, manualRecordOnly: true });
        return result.rows[0];
      });
    },

    async withdrawSubmission(actor: { tenantId: string; userId: string }, submissionId: string, reason: string) {
      return tx(dbPool, async (client) => {
        const submission = await row(client, 'wizmatch_submissions', actor.tenantId, submissionId, true);
        if (['placed', 'withdrawn', 'closed'].includes(submission.status)) throw new StaffingDomainError(409, 'invalid_transition', 'This submission cannot be withdrawn');
        const withdrawalReason = required(reason, 'reason');
        const result = await client.query(`UPDATE wizmatch_submissions SET status='withdrawn',withdrawn_at=NOW(),withdrawal_reason=$3,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [actor.tenantId, submissionId, withdrawalReason]);
        await submissionEvent(client, actor, submissionId, 'withdrawn', { reason: withdrawalReason });
        await staffingEvent(client, actor, 'submission_withdrawn', submission.requirement_id, { submissionId, candidateId: submission.candidate_id, reason: withdrawalReason });
        return result.rows[0];
      });
    },

    async addInterview(actor: { tenantId: string; userId: string }, submissionId: string, input: Record<string, unknown>) {
      return tx(dbPool, async (client) => {
        const submission = await row(client, 'wizmatch_submissions', actor.tenantId, submissionId, true);
        if (!['submitted', 'interviewing'].includes(submission.status)) throw new StaffingDomainError(409, 'invalid_transition', 'A submitted candidate is required');
        const roundResult = await client.query(`SELECT COALESCE(MAX(round_number),0)+1 AS round_number FROM wizmatch_interview_rounds WHERE tenant_id=$1 AND submission_id=$2`, [actor.tenantId, submissionId]);
        const result = await client.query(`INSERT INTO wizmatch_interview_rounds (tenant_id,submission_id,round_number,round_type,status,scheduled_at,timezone,next_action,next_action_due_at,created_by) VALUES ($1,$2,$3,$4,'scheduled',$5,$6,$7,$8,$9) RETURNING *`, [actor.tenantId, submissionId, roundResult.rows[0].round_number, input.roundType || 'client', input.scheduledAt || null, input.timezone || 'Asia/Kolkata', input.nextAction || null, input.nextActionDueAt || null, actor.userId]);
        await client.query(`UPDATE wizmatch_submissions SET status='interviewing',updated_at=NOW() WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, submissionId]);
        const requirement = await row(client, 'wizmatch_requirements', actor.tenantId, submission.requirement_id);
        for (const participant of (Array.isArray(input.participants) ? input.participants as Record<string, unknown>[] : [])) {
          const companyContactId = participant.companyContactId ? required(participant.companyContactId, 'companyContactId') : null;
          const userId = participant.userId ? required(participant.userId, 'userId') : null;
          if (companyContactId) {
            const companyContact = await row(client, 'wizmatch_company_contacts', actor.tenantId, companyContactId);
            if (companyContact.company_id !== requirement.company_id) throw new StaffingDomainError(400, 'invalid_reference', 'Interview contact does not belong to the requirement company');
          }
          if (userId) await row(client, 'users', actor.tenantId, userId);
          await client.query(`INSERT INTO wizmatch_interview_participants (tenant_id,interview_round_id,company_contact_id,user_id,name,email,role) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [actor.tenantId, result.rows[0].id, companyContactId, userId, required(participant.name, 'participant name'), participant.email || null, participant.role || 'participant']);
        }
        await submissionEvent(client, actor, submissionId, 'interview_scheduled', { interviewRoundId: result.rows[0].id, roundNumber: result.rows[0].round_number });
        await staffingEvent(client, actor, 'interview_scheduled', submission.requirement_id, { submissionId, interviewRoundId: result.rows[0].id, candidateId: submission.candidate_id });
        return result.rows[0];
      });
    },

    async updateInterview(actor: { tenantId: string; userId: string }, interviewId: string, input: Record<string, unknown>) {
      return tx(dbPool, async (client) => {
        const interview = await row(client, 'wizmatch_interview_rounds', actor.tenantId, interviewId, true);
        const allowedStatuses = ['scheduled', 'completed', 'cancelled', 'no_show'];
        const status = input.status ? required(input.status, 'status') : interview.status;
        if (!allowedStatuses.includes(status)) throw new StaffingDomainError(400, 'validation_error', 'Interview status is invalid');
        const result = await client.query(`UPDATE wizmatch_interview_rounds SET status=$3,feedback=COALESCE($4,feedback),outcome=COALESCE($5,outcome),next_action=COALESCE($6,next_action),next_action_due_at=COALESCE($7,next_action_due_at),updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [actor.tenantId, interviewId, status, input.feedback || null, input.outcome || null, input.nextAction || null, input.nextActionDueAt || null]);
        const submission = await row(client, 'wizmatch_submissions', actor.tenantId, interview.submission_id, true);
        await submissionEvent(client, actor, interview.submission_id, 'interview_updated', { interviewId, status, outcome: input.outcome || null });
        await staffingEvent(client, actor, 'interview_updated', submission.requirement_id, { submissionId: interview.submission_id, interviewId, status, outcome: input.outcome || null });
        return result.rows[0];
      });
    },

    async addOffer(actor: { tenantId: string; userId: string }, submissionId: string, input: Record<string, unknown>) {
      return tx(dbPool, async (client) => {
        const submission = await row(client, 'wizmatch_submissions', actor.tenantId, submissionId, true);
        if (!['interviewing', 'offered'].includes(submission.status)) throw new StaffingDomainError(409, 'invalid_transition', 'Interview-stage submission is required');
        const revisionResult = await client.query(`SELECT COALESCE(MAX(revision),0)+1 AS revision FROM wizmatch_offers WHERE tenant_id=$1 AND submission_id=$2`, [actor.tenantId, submissionId]);
        const result = await client.query(`INSERT INTO wizmatch_offers (tenant_id,submission_id,revision,status,amount,currency,period,start_date,expires_at,terms,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`, [actor.tenantId, submissionId, revisionResult.rows[0].revision, input.status === 'accepted' ? 'accepted' : 'draft', integer(input.amount, 'amount', true), input.currency || 'INR', input.period || 'annual', input.startDate || null, input.expiresAt || null, JSON.stringify(input.terms || {}), actor.userId]);
        await client.query(`UPDATE wizmatch_submissions SET status='offered',updated_at=NOW() WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, submissionId]);
        await submissionEvent(client, actor, submissionId, 'offer_revision_created', { offerId: result.rows[0].id, revision: result.rows[0].revision, status: result.rows[0].status });
        await staffingEvent(client, actor, 'offer_revision_created', submission.requirement_id, { submissionId, offerId: result.rows[0].id, revision: result.rows[0].revision });
        return result.rows[0];
      });
    },

    async updateOfferStatus(actor: { tenantId: string; userId: string }, offerId: string, status: string) {
      const allowed = ['draft', 'presented', 'accepted', 'declined', 'withdrawn'];
      if (!allowed.includes(status)) throw new StaffingDomainError(400, 'validation_error', 'Offer status is invalid');
      return tx(dbPool, async (client) => {
        const offer = await row(client, 'wizmatch_offers', actor.tenantId, offerId, true);
        const result = await client.query(`UPDATE wizmatch_offers SET status=$3,approved_by=CASE WHEN $3 IN ('presented','accepted') THEN $4 ELSE approved_by END,approved_at=CASE WHEN $3 IN ('presented','accepted') THEN NOW() ELSE approved_at END WHERE tenant_id=$1 AND id=$2 RETURNING *`, [actor.tenantId, offerId, status, actor.userId]);
        const submission = await row(client, 'wizmatch_submissions', actor.tenantId, offer.submission_id, true);
        await submissionEvent(client, actor, offer.submission_id, 'offer_status_changed', { offerId, revision: offer.revision, status });
        await staffingEvent(client, actor, 'offer_status_changed', submission.requirement_id, { submissionId: offer.submission_id, offerId, revision: offer.revision, status });
        return result.rows[0];
      });
    },

    async createPlacement(actor: { tenantId: string; userId: string }, submissionId: string, input: Record<string, unknown>) {
      return tx(dbPool, async (client) => {
        const submission = await row(client, 'wizmatch_submissions', actor.tenantId, submissionId, true);
        if (submission.status === 'placed') throw new StaffingDomainError(409, 'duplicate_placement', 'A placement already exists for this submission');
        if (submission.status !== 'offered') throw new StaffingDomainError(409, 'accepted_offer_required', 'An offered submission is required before placement');
        const offerId = required(input.offerId, 'offerId');
        const offer = await row(client, 'wizmatch_offers', actor.tenantId, offerId);
        if (offer.submission_id !== submissionId || offer.status !== 'accepted') throw new StaffingDomainError(409, 'accepted_offer_required', 'An accepted offer for this submission is required');
        const requirement = await row(client, 'wizmatch_requirements', actor.tenantId, submission.requirement_id);
        const model = input.model === 'contract' ? 'contract' : 'permanent';
        const billAmount = integer(input.billAmount, 'billAmount', true);
        const payAmount = integer(input.payAmount, 'payAmount', true);
        const loadedCost = integer(input.loadedCost, 'loadedCost', true);
        const feeAmount = integer(input.feeAmount, 'feeAmount', true);
        if (model === 'permanent' && (!feeAmount || feeAmount <= 0)) throw new StaffingDomainError(400, 'fee_required', 'Permanent placements require a positive fee amount');
        if (model === 'contract' && (!billAmount || billAmount <= 0 || loadedCost === null)) throw new StaffingDomainError(400, 'contract_economics_required', 'Contract placements require a positive bill rate and loaded cost');
        const economics = calculateStaffingEconomics({ model, billAmount, payAmount, loadedCost, feeAmount });
        const marginExceptionReason = typeof input.marginExceptionReason === 'string' ? input.marginExceptionReason.trim() : '';
        if (model === 'contract' && economics.grossMarginPercent < MINIMUM_CONTRACT_MARGIN_PERCENT && !marginExceptionReason) {
          throw new StaffingDomainError(409, 'margin_exception_required', `Contract gross margin below ${MINIMUM_CONTRACT_MARGIN_PERCENT}% requires an admin-recorded exception`);
        }
        const placement = await client.query(`INSERT INTO wizmatch_placements (tenant_id,candidate_id,company_id,requirement_id,submission_id,offer_id,placement_type,status,currency,contract_start_date,contract_end_date,bill_rate_hourly,pay_rate_hourly,margin_hourly,perm_fee_amount,perm_ctc_annual) VALUES ($1,$2,$3,$4,$5,$6,$7,'started',$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [actor.tenantId, submission.candidate_id, requirement.company_id, submission.requirement_id, submissionId, offerId, model === 'contract' ? 'contract' : 'permanent', input.currency || offer.currency || 'INR', input.startDate || offer.start_date || null, input.endDate || null, billAmount, payAmount, economics.grossMarginAmount, feeAmount, input.annualCtc || null]);
        await client.query(`INSERT INTO wizmatch_staffing_commercials (tenant_id,placement_id,model,original_amount,original_currency,original_period,bill_amount,pay_amount,loaded_cost,gross_margin_amount,gross_margin_percent,normalized_currency,conversion_rate,conversion_source,conversion_date,replacement_ends_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [actor.tenantId, placement.rows[0].id, model, input.originalAmount ?? feeAmount ?? billAmount, input.currency || offer.currency || 'INR', input.period || offer.period || (model === 'contract' ? 'hourly' : 'annual'), billAmount, payAmount, loadedCost, economics.grossMarginAmount, economics.grossMarginPercent, input.normalizedCurrency || null, input.conversionRate || null, input.conversionSource || null, input.conversionDate || null, input.replacementEndsAt || null, actor.userId]);
        await client.query(`UPDATE wizmatch_submissions SET status='placed',updated_at=NOW() WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, submissionId]);
        await client.query(`UPDATE wizmatch_requirements SET stage='filled',stage_entered_at=NOW(),status='closed',last_activity_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, submission.requirement_id]);
        await submissionEvent(client, actor, submissionId, 'placement_started', { placementId: placement.rows[0].id, offerId, economics, marginExceptionReason: marginExceptionReason || null });
        await staffingEvent(client, actor, 'placement_started', submission.requirement_id, { submissionId, placementId: placement.rows[0].id, candidateId: submission.candidate_id, economics, marginExceptionReason: marginExceptionReason || null });
        return { placement: placement.rows[0], economics };
      });
    },

    async linkInvoice(actor: { tenantId: string; userId: string }, placementId: string, input: Record<string, unknown>) {
      return tx(dbPool, async (client) => {
        const placement = await row(client, 'wizmatch_placements', actor.tenantId, placementId, true);
        const invoiceId = required(input.invoiceId, 'invoiceId');
        const invoice = await row(client, 'invoices', actor.tenantId, invoiceId);
        const billingClientId = input.billingClientId ? required(input.billingClientId, 'billingClientId') : invoice.client_id;
        await row(client, 'billing_clients', actor.tenantId, billingClientId);
        if (invoice.client_id !== billingClientId) throw new StaffingDomainError(400, 'invalid_reference', 'Invoice does not belong to the selected billing client');
        const result = await client.query(`UPDATE wizmatch_placements SET invoice_id=$3,billing_client_id=$4,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [actor.tenantId, placementId, invoice.id, billingClientId]);
        await staffingEvent(client, actor, 'placement_invoice_linked', placement.requirement_id, { placementId, invoiceId });
        return result.rows[0];
      });
    },

    async createAdjustment(actor: { tenantId: string; userId: string }, placementId: string, input: Record<string, unknown>) {
      const type = required(input.type, 'type');
      if (!['dispute', 'replacement', 'refund'].includes(type)) throw new StaffingDomainError(400, 'validation_error', 'Adjustment type is invalid');
      return tx(dbPool, async (client) => {
        const placement = await row(client, 'wizmatch_placements', actor.tenantId, placementId);
        const requestedInvoiceId = input.invoiceId ? required(input.invoiceId, 'invoiceId') : null;
        const paymentId = input.paymentId ? required(input.paymentId, 'paymentId') : null;
        const payment = paymentId ? await row(client, 'payments', actor.tenantId, paymentId) : null;
        const invoiceId = requestedInvoiceId || payment?.invoice_id || placement.invoice_id || null;
        const invoice = invoiceId ? await row(client, 'invoices', actor.tenantId, invoiceId) : null;
        if (placement.invoice_id && invoiceId && placement.invoice_id !== invoiceId) throw new StaffingDomainError(400, 'invalid_reference', 'Adjustment invoice does not match the placement invoice');
        if (payment && invoice && (payment.invoice_id !== invoice.id || payment.client_id !== invoice.client_id)) throw new StaffingDomainError(400, 'invalid_reference', 'Payment does not belong to the adjustment invoice and billing client');
        const result = await client.query(`INSERT INTO wizmatch_staffing_adjustments (tenant_id,placement_id,invoice_id,payment_id,type,status,amount,currency,reason,created_by) VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9) RETURNING *`, [actor.tenantId, placementId, invoiceId, paymentId, type, integer(input.amount, 'amount', true), input.currency || null, required(input.reason, 'reason'), actor.userId]);
        await staffingEvent(client, actor, `placement_${type}_opened`, placement.requirement_id, { placementId, adjustmentId: result.rows[0].id, amount: result.rows[0].amount, currency: result.rows[0].currency });
        return result.rows[0];
      });
    },

    async resolveAdjustment(actor: { tenantId: string; userId: string }, adjustmentId: string) {
      return tx(dbPool, async (client) => {
        const result = await client.query(`UPDATE wizmatch_staffing_adjustments SET status='resolved',resolved_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND status='open' RETURNING *`, [actor.tenantId, adjustmentId]);
        if (!result.rowCount) throw new StaffingDomainError(404, 'not_found', 'Open adjustment was not found');
        const placement = await row(client, 'wizmatch_placements', actor.tenantId, result.rows[0].placement_id);
        await staffingEvent(client, actor, `placement_${result.rows[0].type}_resolved`, placement.requirement_id, { placementId: placement.id, adjustmentId });
        return result.rows[0];
      });
    },

    async deliveryBoard(tenantId: string) {
      const result = await dbPool.query(
        `SELECT s.*,r.title AS requirement_title,comp.name AS company_name,p.first_name,p.last_name,
                cns.status AS consent_status,
                (SELECT COUNT(*)::int FROM wizmatch_interview_rounds ir WHERE ir.tenant_id=s.tenant_id AND ir.submission_id=s.id) AS interview_count,
                latest_interview.id AS latest_interview_id,latest_interview.round_number AS latest_interview_round,
                latest_interview.status AS latest_interview_status,latest_interview.scheduled_at AS latest_interview_scheduled_at,
                latest_interview.outcome AS latest_interview_outcome,
                latest_offer.id AS latest_offer_id,latest_offer.revision AS offer_revision,latest_offer.status AS offer_status,
                latest_offer.amount AS offer_amount,latest_offer.currency AS offer_currency,latest_offer.period AS offer_period
         FROM wizmatch_submissions s
         JOIN wizmatch_requirements r ON r.id=s.requirement_id AND r.tenant_id=s.tenant_id
         LEFT JOIN wizmatch_companies comp ON comp.id=r.company_id AND comp.tenant_id=r.tenant_id
         JOIN wizmatch_candidates c ON c.id=s.candidate_id AND c.tenant_id=s.tenant_id
         JOIN contacts p ON p.id=c.contact_id AND p.tenant_id=c.tenant_id
         LEFT JOIN wizmatch_candidate_consents cns ON cns.id=s.consent_id AND cns.tenant_id=s.tenant_id
         LEFT JOIN LATERAL (SELECT ir.* FROM wizmatch_interview_rounds ir WHERE ir.tenant_id=s.tenant_id AND ir.submission_id=s.id ORDER BY ir.round_number DESC LIMIT 1) latest_interview ON true
         LEFT JOIN LATERAL (SELECT o.* FROM wizmatch_offers o WHERE o.tenant_id=s.tenant_id AND o.submission_id=s.id ORDER BY o.revision DESC LIMIT 1) latest_offer ON true
         WHERE s.tenant_id=$1 ORDER BY s.updated_at DESC LIMIT 300`,
        [tenantId],
      );
      return {
        items: result.rows.map((item) => ({
          ...item,
          nextAllowedActions: submissionNextAllowedActions(item.status),
          latestInterview: item.latest_interview_id ? {
            id: item.latest_interview_id,
            round: item.latest_interview_round,
            status: item.latest_interview_status,
            scheduledAt: item.latest_interview_scheduled_at,
            outcome: item.latest_interview_outcome,
          } : null,
          latestOffer: item.latest_offer_id ? {
            id: item.latest_offer_id,
            revision: item.offer_revision,
            status: item.offer_status,
            amount: item.offer_amount,
            currency: item.offer_currency,
            period: item.offer_period,
          } : null,
        })),
      };
    },

    async listPlacements(tenantId: string) {
      const result = await dbPool.query(
        `SELECT p.*,
                s.id AS linked_submission_id,s.status AS submission_status,
                r.id AS linked_requirement_id,r.title AS requirement_title,
                comp.id AS linked_company_id,comp.name AS company_name,
                cand.id AS linked_candidate_id,person.first_name AS candidate_first_name,person.last_name AS candidate_last_name,
                offer.id AS linked_offer_id,offer.status AS offer_status,
                commercial.model AS commercial_model,commercial.original_amount,commercial.original_currency,commercial.original_period,
                commercial.bill_amount,commercial.pay_amount,commercial.loaded_cost,commercial.gross_margin_amount,commercial.gross_margin_percent,
                invoice.invoice_number,invoice.status AS invoice_status,invoice.total_amount AS invoice_total_amount,
                invoice.amount_paid AS invoice_amount_paid,invoice.amount_due,
                CASE WHEN invoice.id IS NULL THEN 0 ELSE 1 END::int AS invoice_count,
                COALESCE(collections.collection_count,0)::int AS collection_count,
                COALESCE(collections.collection_amount,0)::bigint AS collection_amount,
                COALESCE(adjustments.adjustment_count,0)::int AS adjustment_count,
                COALESCE(adjustments.open_adjustment_count,0)::int AS open_adjustment_count
         FROM wizmatch_placements p
         LEFT JOIN wizmatch_submissions s ON s.id=p.submission_id AND s.tenant_id=p.tenant_id
         LEFT JOIN wizmatch_requirements r ON r.id=p.requirement_id AND r.tenant_id=p.tenant_id
         LEFT JOIN wizmatch_companies comp ON comp.id=p.company_id AND comp.tenant_id=p.tenant_id
         LEFT JOIN wizmatch_candidates cand ON cand.id=p.candidate_id AND cand.tenant_id=p.tenant_id
         LEFT JOIN contacts person ON person.id=cand.contact_id AND person.tenant_id=cand.tenant_id
         LEFT JOIN wizmatch_offers offer ON offer.id=p.offer_id AND offer.tenant_id=p.tenant_id
         LEFT JOIN wizmatch_staffing_commercials commercial ON commercial.placement_id=p.id AND commercial.tenant_id=p.tenant_id
         LEFT JOIN invoices invoice ON invoice.id=p.invoice_id AND invoice.tenant_id=p.tenant_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS collection_count,COALESCE(SUM(pay.amount),0)::bigint AS collection_amount
           FROM payments pay WHERE pay.tenant_id=p.tenant_id AND pay.invoice_id=p.invoice_id
         ) collections ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS adjustment_count,COUNT(*) FILTER (WHERE adj.status='open')::int AS open_adjustment_count
           FROM wizmatch_staffing_adjustments adj WHERE adj.tenant_id=p.tenant_id AND adj.placement_id=p.id
         ) adjustments ON true
         WHERE p.tenant_id=$1 AND p.submission_id IS NOT NULL
         ORDER BY p.updated_at DESC,p.created_at DESC LIMIT 300`,
        [tenantId],
      );
      return {
        items: result.rows.map((item) => ({
          ...item,
          placementId: item.id,
          submissionId: item.linked_submission_id,
          requirementId: item.linked_requirement_id,
          companyId: item.linked_company_id,
          candidateId: item.linked_candidate_id,
          candidateName: [item.candidate_first_name, item.candidate_last_name].filter(Boolean).join(' '),
          economics: item.commercial_model ? {
            model: item.commercial_model,
            originalAmount: item.original_amount,
            originalCurrency: item.original_currency,
            originalPeriod: item.original_period,
            billAmount: item.bill_amount,
            payAmount: item.pay_amount,
            loadedCost: item.loaded_cost,
            grossMarginAmount: item.gross_margin_amount,
            grossMarginPercent: item.gross_margin_percent,
          } : null,
          invoice: item.invoice_id ? {
            id: item.invoice_id,
            number: item.invoice_number,
            status: item.invoice_status,
            totalAmount: item.invoice_total_amount,
            amountPaid: item.invoice_amount_paid,
            amountDue: item.amount_due,
          } : null,
          collections: { count: item.collection_count, amount: item.collection_amount },
          nextAllowedActions: placementNextAllowedActions(item),
        })),
      };
    },

    async analytics(tenantId: string, filterInput: Record<string, unknown> = {}) {
      const filters = normalizeStaffingAnalyticsFilters(filterInput);
      const params = [tenantId, filters.from, filters.to, filters.companyId, filters.recruiterId, filters.skillId, filters.source];
      const requirementScope = requirementAnalyticsScope('requirement', 'COALESCE(requirement.accepted_at,requirement.created_at)');
      const matchScope = requirementAnalyticsScope('requirement', 'candidate_match.recalculated_at', 'candidate');
      const submissionScope = requirementAnalyticsScope('requirement', 'submission.prepared_at', 'candidate');
      const placementScope = requirementAnalyticsScope('requirement', 'placement.created_at', 'candidate');
      const sourcePerformanceScope = requirementAnalyticsScope('requirement', 'COALESCE(submission.prepared_at,candidate.created_at)', 'candidate');
      const signalScope = signalAnalyticsScope('signal');
      const auditRequirement = `LOWER(requirement.title) NOT LIKE 'zz audit test%' AND LOWER(requirement.title) NOT LIKE '%(delete me)%'`;

      const [funnel, acquisition, money, sla, cohorts, timeToFill, aging, rejectionReasons, recruiterPerformance, sourcePerformance, filterOptions] = await Promise.all([
        dbPool.query(
          `SELECT submission.status,COUNT(*)::int AS count
           FROM wizmatch_submissions submission
           JOIN wizmatch_requirements requirement ON requirement.id=submission.requirement_id AND requirement.tenant_id=submission.tenant_id
           JOIN wizmatch_candidates candidate ON candidate.id=submission.candidate_id AND candidate.tenant_id=submission.tenant_id
           WHERE submission.tenant_id=$1 AND ${auditRequirement} ${submissionScope}
           GROUP BY submission.status`,
          params,
        ),
        dbPool.query(
          `SELECT
             (SELECT COUNT(*)::int FROM wizmatch_job_signals signal WHERE signal.tenant_id=$1 ${signalScope}) AS job_leads,
             (SELECT COUNT(DISTINCT signal.id)::int
              FROM wizmatch_job_signals signal
              WHERE signal.tenant_id=$1 ${signalScope} AND (
                signal.contact_id IS NOT NULL
                OR EXISTS (
                  SELECT 1 FROM wizmatch_requirements requirement
                  JOIN wizmatch_requirement_contacts attribution
                    ON attribution.requirement_id=requirement.id AND attribution.tenant_id=requirement.tenant_id
                   AND attribution.active AND attribution.is_primary_source
                  WHERE requirement.tenant_id=signal.tenant_id AND requirement.source_job_signal_id=signal.id
                )
                OR EXISTS (
                  SELECT 1 FROM wizmatch_contact_candidates candidate
                  WHERE candidate.tenant_id=signal.tenant_id AND candidate.company_id=signal.company_id
                    AND candidate.metadata->>'signalId'=signal.id::text
                    AND candidate.status IN ('approved','linked_to_crm')
                )
              )) AS poc_ready,
             (SELECT COUNT(*)::int FROM wizmatch_requirements requirement
              WHERE requirement.tenant_id=$1 AND ${auditRequirement} ${requirementScope}) AS requirements,
             (SELECT COUNT(*)::int FROM wizmatch_candidate_requirement_matches candidate_match
              JOIN wizmatch_requirements requirement ON requirement.id=candidate_match.requirement_id AND requirement.tenant_id=candidate_match.tenant_id
              JOIN wizmatch_candidates candidate ON candidate.id=candidate_match.candidate_id AND candidate.tenant_id=candidate_match.tenant_id
              WHERE candidate_match.tenant_id=$1 AND ${auditRequirement} ${matchScope}) AS matches,
             (SELECT COUNT(*)::int FROM wizmatch_candidate_requirement_matches candidate_match
              JOIN wizmatch_requirements requirement ON requirement.id=candidate_match.requirement_id AND requirement.tenant_id=candidate_match.tenant_id
              JOIN wizmatch_candidates candidate ON candidate.id=candidate_match.candidate_id AND candidate.tenant_id=candidate_match.tenant_id
              WHERE candidate_match.tenant_id=$1 AND candidate_match.human_decision='shortlisted'
                AND ${auditRequirement} ${matchScope}) AS shortlists`,
          params,
        ),
        dbPool.query(
          `WITH filtered_placements AS (
             SELECT placement.id,placement.invoice_id
             FROM wizmatch_placements placement
             JOIN wizmatch_requirements requirement ON requirement.id=placement.requirement_id AND requirement.tenant_id=placement.tenant_id
             JOIN wizmatch_candidates candidate ON candidate.id=placement.candidate_id AND candidate.tenant_id=placement.tenant_id
             WHERE placement.tenant_id=$1 AND ${auditRequirement} ${placementScope}
           )
           SELECT
             COALESCE((SELECT SUM(commercial.gross_margin_amount) FROM wizmatch_staffing_commercials commercial JOIN filtered_placements filtered ON filtered.id=commercial.placement_id WHERE commercial.tenant_id=$1),0)::bigint AS gross_margin,
             (SELECT COUNT(*)::int FROM filtered_placements) AS starts,
             COALESCE((SELECT SUM(invoice.total_amount) FROM invoices invoice WHERE invoice.tenant_id=$1 AND EXISTS (SELECT 1 FROM filtered_placements filtered WHERE filtered.invoice_id=invoice.id)),0)::bigint AS invoiced,
             COALESCE((SELECT SUM(payment.amount) FROM payments payment WHERE payment.tenant_id=$1 AND EXISTS (SELECT 1 FROM filtered_placements filtered WHERE filtered.invoice_id=payment.invoice_id)),0)::bigint AS collected`,
          params,
        ),
        dbPool.query(
          `SELECT
             COUNT(*) FILTER (WHERE submission.next_action_due_at<NOW() AND submission.status NOT IN ('withdrawn','rejected','closed','placed'))::int AS overdue_submissions,
             COUNT(*) FILTER (WHERE submission.next_action_due_at IS NULL AND submission.status NOT IN ('withdrawn','rejected','closed','placed'))::int AS missing_next_action
           FROM wizmatch_submissions submission
           JOIN wizmatch_requirements requirement ON requirement.id=submission.requirement_id AND requirement.tenant_id=submission.tenant_id
           JOIN wizmatch_candidates candidate ON candidate.id=submission.candidate_id AND candidate.tenant_id=submission.tenant_id
           WHERE submission.tenant_id=$1 AND ${auditRequirement} ${submissionScope}`,
          params,
        ),
        dbPool.query(
          `SELECT TO_CHAR(DATE_TRUNC('month',COALESCE(requirement.accepted_at,requirement.created_at)),'YYYY-MM') AS cohort,
                  COUNT(DISTINCT requirement.id)::int AS requirements,COUNT(DISTINCT submission.id)::int AS submissions,
                  COUNT(DISTINCT placement.id)::int AS starts
           FROM wizmatch_requirements requirement
           LEFT JOIN wizmatch_submissions submission ON submission.tenant_id=requirement.tenant_id AND submission.requirement_id=requirement.id
           LEFT JOIN wizmatch_placements placement ON placement.tenant_id=requirement.tenant_id AND placement.requirement_id=requirement.id
           WHERE requirement.tenant_id=$1 AND ${auditRequirement} ${requirementScope}
           GROUP BY 1 ORDER BY 1 DESC LIMIT 18`,
          params,
        ),
        dbPool.query(
          `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (placement.created_at-COALESCE(requirement.accepted_at,requirement.created_at)))/86400)::numeric,1) AS average_days,
                  MIN(EXTRACT(EPOCH FROM (placement.created_at-COALESCE(requirement.accepted_at,requirement.created_at)))/86400)::int AS fastest_days,
                  MAX(EXTRACT(EPOCH FROM (placement.created_at-COALESCE(requirement.accepted_at,requirement.created_at)))/86400)::int AS slowest_days
           FROM wizmatch_placements placement
           JOIN wizmatch_requirements requirement ON requirement.id=placement.requirement_id AND requirement.tenant_id=placement.tenant_id
           JOIN wizmatch_candidates candidate ON candidate.id=placement.candidate_id AND candidate.tenant_id=placement.tenant_id
           WHERE placement.tenant_id=$1 AND ${auditRequirement} ${placementScope}`,
          params,
        ),
        dbPool.query(
          `SELECT CASE WHEN NOW()-submission.updated_at<INTERVAL '2 days' THEN '0-2d'
                       WHEN NOW()-submission.updated_at<INTERVAL '7 days' THEN '3-7d'
                       WHEN NOW()-submission.updated_at<INTERVAL '14 days' THEN '8-14d' ELSE '15d+' END AS bucket,
                  COUNT(*)::int AS count
           FROM wizmatch_submissions submission
           JOIN wizmatch_requirements requirement ON requirement.id=submission.requirement_id AND requirement.tenant_id=submission.tenant_id
           JOIN wizmatch_candidates candidate ON candidate.id=submission.candidate_id AND candidate.tenant_id=submission.tenant_id
           WHERE submission.tenant_id=$1 AND submission.status NOT IN ('withdrawn','rejected','closed','placed')
             AND ${auditRequirement} ${submissionScope}
           GROUP BY 1 ORDER BY MIN(submission.updated_at) DESC`,
          params,
        ),
        dbPool.query(
          `SELECT reason,COUNT(*)::int AS count FROM (
             SELECT COALESCE(NULLIF(submission.withdrawal_reason,''),'No withdrawal reason') AS reason
             FROM wizmatch_submissions submission
             JOIN wizmatch_requirements requirement ON requirement.id=submission.requirement_id AND requirement.tenant_id=submission.tenant_id
             JOIN wizmatch_candidates candidate ON candidate.id=submission.candidate_id AND candidate.tenant_id=submission.tenant_id
             WHERE submission.tenant_id=$1 AND submission.status='withdrawn' AND ${auditRequirement} ${submissionScope}
             UNION ALL
             SELECT COALESCE(NULLIF(candidate_match.decision_reason,''),'No rejection reason')
             FROM wizmatch_candidate_requirement_matches candidate_match
             JOIN wizmatch_requirements requirement ON requirement.id=candidate_match.requirement_id AND requirement.tenant_id=candidate_match.tenant_id
             JOIN wizmatch_candidates candidate ON candidate.id=candidate_match.candidate_id AND candidate.tenant_id=candidate_match.tenant_id
             WHERE candidate_match.tenant_id=$1 AND candidate_match.human_decision='rejected' AND ${auditRequirement} ${matchScope}
           ) reasons GROUP BY reason ORDER BY count DESC LIMIT 20`,
          params,
        ),
        dbPool.query(
          `SELECT COALESCE(recruiter.name,'Unassigned') AS recruiter,COUNT(submission.id)::int AS submissions,
                  COUNT(*) FILTER (WHERE submission.status IN ('interviewing','offered','placed'))::int AS progressed,
                  COUNT(*) FILTER (WHERE submission.status='placed')::int AS starts
           FROM wizmatch_submissions submission
           JOIN wizmatch_requirements requirement ON requirement.id=submission.requirement_id AND requirement.tenant_id=submission.tenant_id
           JOIN wizmatch_candidates candidate ON candidate.id=submission.candidate_id AND candidate.tenant_id=submission.tenant_id
           LEFT JOIN users recruiter ON recruiter.id=submission.prepared_by AND recruiter.tenant_id=submission.tenant_id
           WHERE submission.tenant_id=$1 AND ${auditRequirement} ${submissionScope}
           GROUP BY recruiter.id,recruiter.name ORDER BY starts DESC,progressed DESC,submissions DESC`,
          params,
        ),
        dbPool.query(
          `SELECT COALESCE(candidate.source,'unknown') AS source,COUNT(DISTINCT submission.id)::int AS submissions,
                  COUNT(DISTINCT placement.id)::int AS starts
           FROM wizmatch_candidates candidate
           LEFT JOIN wizmatch_submissions submission ON submission.tenant_id=candidate.tenant_id AND submission.candidate_id=candidate.id
           LEFT JOIN wizmatch_requirements requirement ON requirement.id=submission.requirement_id AND requirement.tenant_id=submission.tenant_id
           LEFT JOIN wizmatch_placements placement ON placement.tenant_id=candidate.tenant_id AND placement.candidate_id=candidate.id
           WHERE candidate.tenant_id=$1 AND (requirement.id IS NULL OR ${auditRequirement}) ${sourcePerformanceScope}
           GROUP BY candidate.source ORDER BY starts DESC,submissions DESC`,
          params,
        ),
        dbPool.query(
          `SELECT
             COALESCE((SELECT jsonb_agg(jsonb_build_object('id',company.id,'label',company.name) ORDER BY company.name)
                       FROM wizmatch_companies company WHERE company.tenant_id=$1),'[]'::jsonb) AS companies,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('id',recruiter.id,'label',recruiter.name) ORDER BY recruiter.name)
                       FROM (SELECT DISTINCT user_row.id,user_row.name
                             FROM wizmatch_requirement_assignments assignment
                             JOIN users user_row ON user_row.id=assignment.user_id AND user_row.tenant_id=assignment.tenant_id
                             WHERE assignment.tenant_id=$1 AND assignment.active AND assignment.role='recruiter') recruiter),'[]'::jsonb) AS recruiters,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('id',skill.id,'label',skill.canonical_label) ORDER BY skill.canonical_label)
                       FROM wizmatch_skills skill WHERE skill.tenant_id=$1 AND skill.active),'[]'::jsonb) AS skills,
             COALESCE((SELECT jsonb_agg(source_row.source ORDER BY source_row.source)
                       FROM (SELECT source FROM wizmatch_job_signals WHERE tenant_id=$1 AND source IS NOT NULL
                             UNION SELECT source FROM wizmatch_candidates WHERE tenant_id=$1 AND source IS NOT NULL) source_row),'[]'::jsonb) AS sources`,
          [tenantId],
        ),
      ]);
      const acquisitionCounts = acquisition.rows[0] || { job_leads: 0, poc_ready: 0, requirements: 0, matches: 0, shortlists: 0 };
      const acquisitionFunnel = [
        { stage: 'job_leads', count: Number(acquisitionCounts.job_leads || 0) },
        { stage: 'poc_ready', count: Number(acquisitionCounts.poc_ready || 0) },
        { stage: 'requirements', count: Number(acquisitionCounts.requirements || 0) },
        { stage: 'matches', count: Number(acquisitionCounts.matches || 0) },
        { stage: 'shortlists', count: Number(acquisitionCounts.shortlists || 0) },
      ];
      return {
        funnel: funnel.rows,
        acquisition: acquisitionCounts,
        acquisitionFunnel,
        commercial: money.rows[0],
        exceptions: sla.rows[0],
        cohorts: cohorts.rows,
        timeToFill: timeToFill.rows[0],
        aging: aging.rows,
        rejectionReasons: rejectionReasons.rows,
        recruiterPerformance: recruiterPerformance.rows,
        sourcePerformance: sourcePerformance.rows,
        filters,
        filterOptions: filterOptions.rows[0] || { companies: [], recruiters: [], skills: [], sources: [] },
      };
    },

    async runDeterministicReminders(tenantId: string) {
      return tx(dbPool, async (client) => {
        const created = { requirementSla: 0, submissionFollowUps: 0, availabilityReviews: 0 };

        const requirementRows = await client.query(`
          SELECT r.id AS requirement_id,r.title,r.next_action,r.next_action_due_at,
                 owner.user_id::text AS assigned_to
          FROM wizmatch_requirements r
          LEFT JOIN LATERAL (
            SELECT a.user_id FROM wizmatch_requirement_assignments a
            WHERE a.tenant_id=r.tenant_id AND a.requirement_id=r.id AND a.active=true
            ORDER BY CASE a.role WHEN 'recruiter' THEN 0 WHEN 'delivery_owner' THEN 1 ELSE 2 END,a.assigned_at DESC LIMIT 1
          ) owner ON true
          WHERE r.tenant_id=$1 AND r.next_action_due_at<NOW()
            AND COALESCE(r.stage,'needs_attribution') NOT IN ('filled','cancelled','closed')
        `, [tenantId]);
        for (const item of requirementRows.rows) {
          const existing = await client.query(`SELECT 1 FROM wizmatch_task_links l JOIN tasks t ON t.id=l.task_id AND t.tenant_id=l.tenant_id WHERE l.tenant_id=$1 AND l.requirement_id=$2 AND l.submission_id IS NULL AND t.status='open' AND t.title='[Wizmatch] Requirement SLA overdue' LIMIT 1`, [tenantId, item.requirement_id]);
          if (existing.rowCount) continue;
          const task = await client.query(`INSERT INTO tasks (tenant_id,title,description,assigned_to,due_at,status) VALUES ($1,'[Wizmatch] Requirement SLA overdue',$2,$3,$4,'open') RETURNING id`, [tenantId, `${item.title}: ${item.next_action || 'Set and complete the next action'}`, item.assigned_to, item.next_action_due_at]);
          await client.query(`INSERT INTO wizmatch_task_links (tenant_id,task_id,requirement_id) VALUES ($1,$2,$3)`, [tenantId, task.rows[0].id, item.requirement_id]);
          await client.query(`INSERT INTO wizmatch_staffing_events (tenant_id,event_type,source,requirement_id,payload) VALUES ($1,'requirement_sla_reminder_created','deterministic_reminder',$2,$3::jsonb)`, [tenantId, item.requirement_id, JSON.stringify({ taskId: task.rows[0].id })]);
          created.requirementSla += 1;
        }

        const submissionRows = await client.query(`
          SELECT s.id AS submission_id,s.requirement_id,s.candidate_id,s.next_action,s.next_action_due_at,
                 COALESCE(owner.user_id::text,s.prepared_by::text) AS assigned_to
          FROM wizmatch_submissions s
          LEFT JOIN LATERAL (
            SELECT a.user_id FROM wizmatch_requirement_assignments a
            WHERE a.tenant_id=s.tenant_id AND a.requirement_id=s.requirement_id AND a.active=true
            ORDER BY CASE a.role WHEN 'recruiter' THEN 0 WHEN 'delivery_owner' THEN 1 ELSE 2 END,a.assigned_at DESC LIMIT 1
          ) owner ON true
          WHERE s.tenant_id=$1 AND s.next_action_due_at<NOW()
            AND s.status NOT IN ('withdrawn','rejected','closed','placed')
        `, [tenantId]);
        for (const item of submissionRows.rows) {
          const existing = await client.query(`SELECT 1 FROM wizmatch_task_links l JOIN tasks t ON t.id=l.task_id AND t.tenant_id=l.tenant_id WHERE l.tenant_id=$1 AND l.submission_id=$2 AND t.status='open' AND t.title='[Wizmatch] Submission follow-up overdue' LIMIT 1`, [tenantId, item.submission_id]);
          if (existing.rowCount) continue;
          const task = await client.query(`INSERT INTO tasks (tenant_id,title,description,assigned_to,due_at,status) VALUES ($1,'[Wizmatch] Submission follow-up overdue',$2,$3,$4,'open') RETURNING id`, [tenantId, item.next_action || 'Record the client follow-up and next dated action', item.assigned_to, item.next_action_due_at]);
          await client.query(`INSERT INTO wizmatch_task_links (tenant_id,task_id,requirement_id,candidate_id,submission_id) VALUES ($1,$2,$3,$4,$5)`, [tenantId, task.rows[0].id, item.requirement_id, item.candidate_id, item.submission_id]);
          await client.query(`INSERT INTO wizmatch_staffing_events (tenant_id,event_type,source,requirement_id,candidate_id,submission_id,payload) VALUES ($1,'submission_follow_up_reminder_created','deterministic_reminder',$2,$3,$4,$5::jsonb)`, [tenantId, item.requirement_id, item.candidate_id, item.submission_id, JSON.stringify({ taskId: task.rows[0].id })]);
          created.submissionFollowUps += 1;
        }

        const candidateRows = await client.query(`
          SELECT c.id AS candidate_id,best.requirement_id,best.assigned_to
          FROM wizmatch_candidates c
          LEFT JOIN LATERAL (
            SELECT m.requirement_id,COALESCE(owner.user_id::text,m.reviewed_by::text) AS assigned_to
            FROM wizmatch_candidate_requirement_matches m
            LEFT JOIN LATERAL (
              SELECT a.user_id FROM wizmatch_requirement_assignments a
              WHERE a.tenant_id=m.tenant_id AND a.requirement_id=m.requirement_id AND a.active=true
              ORDER BY CASE a.role WHEN 'recruiter' THEN 0 WHEN 'delivery_owner' THEN 1 ELSE 2 END,a.assigned_at DESC LIMIT 1
            ) owner ON true
            WHERE m.tenant_id=c.tenant_id AND m.candidate_id=c.id
            ORDER BY m.score DESC,m.updated_at DESC LIMIT 1
          ) best ON true
          WHERE c.tenant_id=$1 AND c.updated_at<NOW()-INTERVAL '30 days'
            AND COALESCE(c.availability_status,'available') IN ('available','benched')
        `, [tenantId]);
        for (const item of candidateRows.rows) {
          const existing = await client.query(`SELECT 1 FROM wizmatch_task_links l JOIN tasks t ON t.id=l.task_id AND t.tenant_id=l.tenant_id WHERE l.tenant_id=$1 AND l.candidate_id=$2 AND t.status='open' AND t.title='[Wizmatch] Confirm candidate availability' LIMIT 1`, [tenantId, item.candidate_id]);
          if (existing.rowCount) continue;
          const task = await client.query(`INSERT INTO tasks (tenant_id,title,description,assigned_to,due_at,status) VALUES ($1,'[Wizmatch] Confirm candidate availability','Availability evidence is older than 30 days. Contact manually, record the result, and refresh the candidate profile.',$2,NOW()+INTERVAL '1 day','open') RETURNING id`, [tenantId, item.assigned_to]);
          await client.query(`INSERT INTO wizmatch_task_links (tenant_id,task_id,requirement_id,candidate_id) VALUES ($1,$2,$3,$4)`, [tenantId, task.rows[0].id, item.requirement_id, item.candidate_id]);
          await client.query(`INSERT INTO wizmatch_staffing_events (tenant_id,event_type,source,requirement_id,candidate_id,payload) VALUES ($1,'candidate_availability_review_created','deterministic_reminder',$2,$3,$4::jsonb)`, [tenantId, item.requirement_id, item.candidate_id, JSON.stringify({ taskId: task.rows[0].id, staleAfterDays: 30 })]);
          created.availabilityReviews += 1;
        }

        return { ...created, total: created.requirementSla + created.submissionFollowUps + created.availabilityReviews };
      });
    },
  };
}

export const wizmatchDeliveryService = createWizmatchDeliveryService();
