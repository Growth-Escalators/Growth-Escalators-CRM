// PRD-005 §8.10.2 — resolving "is this contact WizMatch-linked?"
//
// Four real mechanisms exist; a sound gate needs 1 ∨ 3 ∨ 4 (mechanism 2, the
// unindexed contacts.metadata jsonb marker, is a convenience marker nothing
// reads back and is intentionally NOT consulted here).
//
//   1. wizmatch_company_contacts (tenant_id, company_id, contact_id) — canonical
//   3. wizmatch_contact_candidates.crm_contact_id + .company_id — fallback
//   4. wizmatch_job_signals.contact_id + .company_id — fallback (no index on
//      contact_id; accepted as a bounded scan per §8.10.2 note)
//
// Used by every §8.10.1 "must call the gate or reject" shared-CRM-path row
// (19-24) to decide whether a generic contacts/sequences/email action must be
// routed through the WizMatch outreach gate.

import { and, eq, sql } from 'drizzle-orm';
import { db, contactChannels, wizmatchCompanyContacts, wizmatchContactCandidates, wizmatchJobSignals } from '../../db';

export interface WizmatchLinkage {
  companyId: string;
  /** do_not_contact is a valid wizmatch_company_contacts.relationship_stage value (§10) — surfaced so callers can still reject even when the gate would otherwise allow. */
  relationshipStage?: string;
}

export async function resolveWizmatchLinkage(
  tenantId: string,
  contactId: string,
): Promise<WizmatchLinkage | null> {
  if (!contactId) return null;

  const canonical = await db
    .select({ companyId: wizmatchCompanyContacts.companyId, relationshipStage: wizmatchCompanyContacts.relationshipStage })
    .from(wizmatchCompanyContacts)
    .where(and(eq(wizmatchCompanyContacts.tenantId, tenantId), eq(wizmatchCompanyContacts.contactId, contactId)))
    .limit(1);
  if (canonical.length > 0 && canonical[0].companyId) {
    return { companyId: canonical[0].companyId, relationshipStage: canonical[0].relationshipStage ?? undefined };
  }

  const candidate = await db
    .select({ companyId: wizmatchContactCandidates.companyId })
    .from(wizmatchContactCandidates)
    .where(and(eq(wizmatchContactCandidates.tenantId, tenantId), eq(wizmatchContactCandidates.crmContactId, contactId)))
    .limit(1);
  if (candidate.length > 0 && candidate[0].companyId) {
    return { companyId: candidate[0].companyId };
  }

  const signal = await db
    .select({ companyId: wizmatchJobSignals.companyId })
    .from(wizmatchJobSignals)
    .where(and(eq(wizmatchJobSignals.tenantId, tenantId), eq(wizmatchJobSignals.contactId, contactId)))
    .limit(1);
  if (signal.length > 0 && signal[0].companyId) {
    return { companyId: signal[0].companyId };
  }

  return null;
}

/**
 * For routes that only have a raw recipient address (no contactId), e.g.
 * emailTemplates.ts send-test. Resolves the contact by the email channel
 * first, then delegates to resolveWizmatchLinkage.
 */
export async function resolveWizmatchLinkageByEmail(tenantId: string, email: string): Promise<WizmatchLinkage | null> {
  if (!email) return null;
  const normalised = email.trim().toLowerCase();
  const channelRows = await db
    .select({ contactId: contactChannels.contactId })
    .from(contactChannels)
    .where(and(eq(contactChannels.tenantId, tenantId), eq(contactChannels.channelType, 'email'), eq(sql`lower(${contactChannels.channelValue})`, normalised)))
    .limit(1);
  const contactId = channelRows[0]?.contactId;
  if (!contactId) return null;
  return resolveWizmatchLinkage(tenantId, contactId);
}
