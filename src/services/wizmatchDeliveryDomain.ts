import type { Pool, PoolClient } from 'pg';
import { pool } from '../db';
import { StaffingDomainError } from './wizmatchStaffingDomain';

export const CONSENT_STATUSES = ['requested', 'granted', 'revoked', 'expired'] as const;
export const SUBMISSION_STATUSES = ['draft', 'approved', 'submitted', 'interviewing', 'offered', 'placed', 'rejected', 'withdrawn', 'closed'] as const;

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
async function tx<T>(dbPool: Pool, fn: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function row(client: Pick<PoolClient, 'query'>, table: string, tenantId: string, id: string, lock = false) {
  const allowed = new Set(['wizmatch_requirements', 'wizmatch_candidates', 'wizmatch_candidate_requirement_matches', 'wizmatch_candidate_consents', 'wizmatch_submissions', 'wizmatch_interview_rounds', 'wizmatch_offers', 'wizmatch_placements', 'billing_clients', 'invoices', 'payments']);
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

export function createWizmatchDeliveryService(dbPool: Pool = pool) {
  return {
    async createConsent(actor: { tenantId: string; userId: string }, input: Record<string, unknown>) {
      const candidateId = required(input.candidateId, 'candidateId');
      const requirementId = required(input.requirementId, 'requirementId');
      return tx(dbPool, async (client) => {
        await row(client, 'wizmatch_candidates', actor.tenantId, candidateId);
        await row(client, 'wizmatch_requirements', actor.tenantId, requirementId);
        await client.query(`UPDATE wizmatch_candidate_consents SET status='expired',updated_at=NOW() WHERE tenant_id=$1 AND candidate_id=$2 AND requirement_id=$3 AND status='granted' AND expires_at IS NOT NULL AND expires_at<=NOW()`, [actor.tenantId, candidateId, requirementId]);
        const current = await client.query(`SELECT id,status FROM wizmatch_candidate_consents WHERE tenant_id=$1 AND candidate_id=$2 AND requirement_id=$3 AND status IN ('requested','granted') LIMIT 1`, [actor.tenantId, candidateId, requirementId]);
        if (current.rowCount) throw new StaffingDomainError(409, 'active_consent_exists', 'An active consent record already exists for this candidate and requirement');
        const result = await client.query(`INSERT INTO wizmatch_candidate_consents (tenant_id,candidate_id,requirement_id,consent_type,status,terms,document_reference,requested_by,granted_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,CASE WHEN $5='granted' THEN NOW() ELSE NULL END,$9) RETURNING *`, [actor.tenantId, candidateId, requirementId, input.consentType || 'rtr', input.status === 'granted' ? 'granted' : 'requested', JSON.stringify(input.terms || {}), input.documentReference || null, actor.userId, input.expiresAt || null]);
        await staffingEvent(client, actor, 'candidate_consent_created', requirementId, { consentId: result.rows[0].id, candidateId, status: result.rows[0].status });
        return result.rows[0];
      });
    },

    async grantConsent(actor: { tenantId: string; userId: string }, consentId: string, input: Record<string, unknown>) {
      return tx(dbPool, async (client) => {
        const consent = await row(client, 'wizmatch_candidate_consents', actor.tenantId, consentId, true);
        if (consent.status === 'revoked') throw new StaffingDomainError(409, 'invalid_transition', 'Revoked consent cannot be granted again');
        const result = await client.query(`UPDATE wizmatch_candidate_consents SET status='granted',terms=COALESCE($3::jsonb,terms),document_reference=COALESCE($4,document_reference),granted_at=NOW(),expires_at=$5,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [actor.tenantId, consentId, input.terms ? JSON.stringify(input.terms) : null, input.documentReference || null, input.expiresAt || null]);
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
        for (const recipient of recipients) {
          await client.query(`INSERT INTO wizmatch_submission_recipients (tenant_id,submission_id,company_contact_id,name,email,role,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [actor.tenantId, submissionId, recipient.companyContactId || null, required(recipient.name, 'recipient name'), recipient.email || null, recipient.role || 'recipient', actor.userId]);
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
        for (const participant of (Array.isArray(input.participants) ? input.participants as Record<string, unknown>[] : [])) await client.query(`INSERT INTO wizmatch_interview_participants (tenant_id,interview_round_id,company_contact_id,user_id,name,email,role) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [actor.tenantId, result.rows[0].id, participant.companyContactId || null, participant.userId || null, required(participant.name, 'participant name'), participant.email || null, participant.role || 'participant']);
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
        const submission = await row(client, 'wizmatch_submissions', actor.tenantId, interview.submission_id);
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
        const submission = await row(client, 'wizmatch_submissions', actor.tenantId, offer.submission_id);
        await submissionEvent(client, actor, offer.submission_id, 'offer_status_changed', { offerId, revision: offer.revision, status });
        await staffingEvent(client, actor, 'offer_status_changed', submission.requirement_id, { submissionId: offer.submission_id, offerId, revision: offer.revision, status });
        return result.rows[0];
      });
    },

    async createPlacement(actor: { tenantId: string; userId: string }, submissionId: string, input: Record<string, unknown>) {
      return tx(dbPool, async (client) => {
        const submission = await row(client, 'wizmatch_submissions', actor.tenantId, submissionId, true);
        const offerId = required(input.offerId, 'offerId');
        const offer = await row(client, 'wizmatch_offers', actor.tenantId, offerId);
        if (offer.submission_id !== submissionId || offer.status !== 'accepted') throw new StaffingDomainError(409, 'accepted_offer_required', 'An accepted offer for this submission is required');
        const requirement = await row(client, 'wizmatch_requirements', actor.tenantId, submission.requirement_id);
        const model = input.model === 'contract' ? 'contract' : 'permanent';
        const billAmount = integer(input.billAmount, 'billAmount', true);
        const payAmount = integer(input.payAmount, 'payAmount', true);
        const loadedCost = integer(input.loadedCost, 'loadedCost', true);
        const feeAmount = integer(input.feeAmount, 'feeAmount', true);
        const economics = calculateStaffingEconomics({ model, billAmount, payAmount, loadedCost, feeAmount });
        const placement = await client.query(`INSERT INTO wizmatch_placements (tenant_id,candidate_id,company_id,requirement_id,submission_id,offer_id,placement_type,status,currency,contract_start_date,contract_end_date,bill_rate_hourly,pay_rate_hourly,margin_hourly,perm_fee_amount,perm_ctc_annual) VALUES ($1,$2,$3,$4,$5,$6,$7,'started',$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [actor.tenantId, submission.candidate_id, requirement.company_id, submission.requirement_id, submissionId, offerId, model === 'contract' ? 'contract' : 'permanent', input.currency || offer.currency || 'INR', input.startDate || offer.start_date || null, input.endDate || null, billAmount, payAmount, economics.grossMarginAmount, feeAmount, input.annualCtc || null]);
        await client.query(`INSERT INTO wizmatch_staffing_commercials (tenant_id,placement_id,model,original_amount,original_currency,original_period,bill_amount,pay_amount,loaded_cost,gross_margin_amount,gross_margin_percent,normalized_currency,conversion_rate,conversion_source,conversion_date,replacement_ends_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [actor.tenantId, placement.rows[0].id, model, input.originalAmount ?? feeAmount ?? billAmount, input.currency || offer.currency || 'INR', input.period || offer.period || (model === 'contract' ? 'hourly' : 'annual'), billAmount, payAmount, loadedCost, economics.grossMarginAmount, economics.grossMarginPercent, input.normalizedCurrency || null, input.conversionRate || null, input.conversionSource || null, input.conversionDate || null, input.replacementEndsAt || null, actor.userId]);
        await client.query(`UPDATE wizmatch_submissions SET status='placed',updated_at=NOW() WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, submissionId]);
        await client.query(`UPDATE wizmatch_requirements SET stage='filled',stage_entered_at=NOW(),status='closed',last_activity_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, submission.requirement_id]);
        await submissionEvent(client, actor, submissionId, 'placement_started', { placementId: placement.rows[0].id, offerId, economics });
        await staffingEvent(client, actor, 'placement_started', submission.requirement_id, { submissionId, placementId: placement.rows[0].id, candidateId: submission.candidate_id, economics });
        return { placement: placement.rows[0], economics };
      });
    },

    async linkInvoice(actor: { tenantId: string; userId: string }, placementId: string, input: Record<string, unknown>) {
      return tx(dbPool, async (client) => {
        const placement = await row(client, 'wizmatch_placements', actor.tenantId, placementId, true);
        const invoiceId = required(input.invoiceId, 'invoiceId');
        const invoice = await row(client, 'invoices', actor.tenantId, invoiceId);
        if (input.billingClientId) await row(client, 'billing_clients', actor.tenantId, String(input.billingClientId));
        const result = await client.query(`UPDATE wizmatch_placements SET invoice_id=$3,billing_client_id=COALESCE($4,billing_client_id),updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [actor.tenantId, placementId, invoice.id, input.billingClientId || null]);
        await staffingEvent(client, actor, 'placement_invoice_linked', placement.requirement_id, { placementId, invoiceId });
        return result.rows[0];
      });
    },

    async createAdjustment(actor: { tenantId: string; userId: string }, placementId: string, input: Record<string, unknown>) {
      const type = required(input.type, 'type');
      if (!['dispute', 'replacement', 'refund'].includes(type)) throw new StaffingDomainError(400, 'validation_error', 'Adjustment type is invalid');
      return tx(dbPool, async (client) => {
        const placement = await row(client, 'wizmatch_placements', actor.tenantId, placementId);
        if (input.invoiceId) await row(client, 'invoices', actor.tenantId, String(input.invoiceId));
        if (input.paymentId) await row(client, 'payments', actor.tenantId, String(input.paymentId));
        const result = await client.query(`INSERT INTO wizmatch_staffing_adjustments (tenant_id,placement_id,invoice_id,payment_id,type,status,amount,currency,reason,created_by) VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9) RETURNING *`, [actor.tenantId, placementId, input.invoiceId || null, input.paymentId || null, type, integer(input.amount, 'amount', true), input.currency || null, required(input.reason, 'reason'), actor.userId]);
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
      const result = await dbPool.query(`SELECT s.*,r.title AS requirement_title,comp.name AS company_name,p.first_name,p.last_name,cns.status AS consent_status,(SELECT COUNT(*)::int FROM wizmatch_interview_rounds ir WHERE ir.tenant_id=s.tenant_id AND ir.submission_id=s.id) AS interview_count,latest_offer.id AS latest_offer_id,latest_offer.revision AS offer_revision,latest_offer.status AS offer_status FROM wizmatch_submissions s JOIN wizmatch_requirements r ON r.id=s.requirement_id AND r.tenant_id=s.tenant_id LEFT JOIN wizmatch_companies comp ON comp.id=r.company_id AND comp.tenant_id=r.tenant_id JOIN wizmatch_candidates c ON c.id=s.candidate_id AND c.tenant_id=s.tenant_id JOIN contacts p ON p.id=c.contact_id AND p.tenant_id=c.tenant_id LEFT JOIN wizmatch_candidate_consents cns ON cns.id=s.consent_id AND cns.tenant_id=s.tenant_id LEFT JOIN LATERAL (SELECT o.* FROM wizmatch_offers o WHERE o.tenant_id=s.tenant_id AND o.submission_id=s.id ORDER BY o.revision DESC LIMIT 1) latest_offer ON true WHERE s.tenant_id=$1 ORDER BY s.updated_at DESC LIMIT 300`, [tenantId]);
      return { items: result.rows };
    },

    async analytics(tenantId: string) {
      const [funnel, money, sla, cohorts, timeToFill, aging, rejectionReasons, recruiterPerformance, sourcePerformance] = await Promise.all([
        dbPool.query(`SELECT status,COUNT(*)::int AS count FROM wizmatch_submissions WHERE tenant_id=$1 GROUP BY status`, [tenantId]),
        dbPool.query(`SELECT COALESCE(SUM(c.gross_margin_amount),0)::bigint AS gross_margin,COUNT(DISTINCT p.id)::int AS starts,COALESCE(SUM(i.total_amount),0)::bigint AS invoiced,COALESCE(SUM(pay.amount),0)::bigint AS collected FROM wizmatch_placements p LEFT JOIN wizmatch_staffing_commercials c ON c.placement_id=p.id AND c.tenant_id=p.tenant_id LEFT JOIN invoices i ON i.id=p.invoice_id AND i.tenant_id=p.tenant_id LEFT JOIN payments pay ON pay.invoice_id=i.id AND pay.tenant_id=i.tenant_id WHERE p.tenant_id=$1`, [tenantId]),
        dbPool.query(`SELECT COUNT(*) FILTER (WHERE next_action_due_at<NOW() AND status NOT IN ('withdrawn','rejected','closed','placed'))::int AS overdue_submissions,COUNT(*) FILTER (WHERE next_action_due_at IS NULL AND status NOT IN ('withdrawn','rejected','closed','placed'))::int AS missing_next_action FROM wizmatch_submissions WHERE tenant_id=$1`, [tenantId]),
        dbPool.query(`SELECT TO_CHAR(DATE_TRUNC('month',COALESCE(r.accepted_at,r.created_at)),'YYYY-MM') AS cohort,COUNT(DISTINCT r.id)::int AS requirements,COUNT(DISTINCT s.id)::int AS submissions,COUNT(DISTINCT p.id)::int AS starts FROM wizmatch_requirements r LEFT JOIN wizmatch_submissions s ON s.tenant_id=r.tenant_id AND s.requirement_id=r.id LEFT JOIN wizmatch_placements p ON p.tenant_id=r.tenant_id AND p.requirement_id=r.id WHERE r.tenant_id=$1 GROUP BY 1 ORDER BY 1 DESC LIMIT 18`, [tenantId]),
        dbPool.query(`SELECT ROUND(AVG(EXTRACT(EPOCH FROM (p.created_at-COALESCE(r.accepted_at,r.created_at)))/86400)::numeric,1) AS average_days,MIN(EXTRACT(EPOCH FROM (p.created_at-COALESCE(r.accepted_at,r.created_at)))/86400)::int AS fastest_days,MAX(EXTRACT(EPOCH FROM (p.created_at-COALESCE(r.accepted_at,r.created_at)))/86400)::int AS slowest_days FROM wizmatch_placements p JOIN wizmatch_requirements r ON r.id=p.requirement_id AND r.tenant_id=p.tenant_id WHERE p.tenant_id=$1`, [tenantId]),
        dbPool.query(`SELECT CASE WHEN NOW()-updated_at<INTERVAL '2 days' THEN '0-2d' WHEN NOW()-updated_at<INTERVAL '7 days' THEN '3-7d' WHEN NOW()-updated_at<INTERVAL '14 days' THEN '8-14d' ELSE '15d+' END AS bucket,COUNT(*)::int AS count FROM wizmatch_submissions WHERE tenant_id=$1 AND status NOT IN ('withdrawn','rejected','closed','placed') GROUP BY 1 ORDER BY MIN(updated_at) DESC`, [tenantId]),
        dbPool.query(`SELECT reason,COUNT(*)::int AS count FROM (SELECT COALESCE(NULLIF(withdrawal_reason,''),'No withdrawal reason') AS reason FROM wizmatch_submissions WHERE tenant_id=$1 AND status='withdrawn' UNION ALL SELECT COALESCE(NULLIF(decision_reason,''),'No rejection reason') FROM wizmatch_candidate_requirement_matches WHERE tenant_id=$1 AND human_decision='rejected') reasons GROUP BY reason ORDER BY count DESC LIMIT 20`, [tenantId]),
        dbPool.query(`SELECT COALESCE(u.name,'Unassigned') AS recruiter,COUNT(s.id)::int AS submissions,COUNT(*) FILTER (WHERE s.status IN ('interviewing','offered','placed'))::int AS progressed,COUNT(*) FILTER (WHERE s.status='placed')::int AS starts FROM wizmatch_submissions s LEFT JOIN users u ON u.id=s.prepared_by AND u.tenant_id=s.tenant_id WHERE s.tenant_id=$1 GROUP BY u.id,u.name ORDER BY starts DESC,progressed DESC,submissions DESC`, [tenantId]),
        dbPool.query(`SELECT COALESCE(c.source,'unknown') AS source,COUNT(DISTINCT s.id)::int AS submissions,COUNT(DISTINCT p.id)::int AS starts FROM wizmatch_candidates c LEFT JOIN wizmatch_submissions s ON s.tenant_id=c.tenant_id AND s.candidate_id=c.id LEFT JOIN wizmatch_placements p ON p.tenant_id=c.tenant_id AND p.candidate_id=c.id WHERE c.tenant_id=$1 GROUP BY c.source ORDER BY starts DESC,submissions DESC`, [tenantId]),
      ]);
      return { funnel: funnel.rows, commercial: money.rows[0], exceptions: sla.rows[0], cohorts: cohorts.rows, timeToFill: timeToFill.rows[0], aging: aging.rows, rejectionReasons: rejectionReasons.rows, recruiterPerformance: recruiterPerformance.rows, sourcePerformance: sourcePerformance.rows };
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
