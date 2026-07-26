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
//
// D-32 (owner-ratified 2026-07-26) — multi-company linkage. U-13 fixed: the
// prior version used `.limit(1)` with no `ORDER BY` on each mechanism and
// returned on the FIRST match, so a contact linked to two companies (one
// eligible, one blocked) could have the eligible one picked arbitrarily by
// whatever order Postgres happened to return rows in — an eligible company
// masking a blocked one. `resolveWizmatchLinkage`/`resolveWizmatchLinkageByEmail`
// now collect EVERY tenant-safe linked company across all three mechanisms,
// rank each by its canonical policy decision (deny > review > allow, via
// `resolveCompanyStatus` — the same canonical proxy `legacyEligibilityAdapter.ts`
// uses), and resolve to the MOST RESTRICTIVE company, never an arbitrary one.
// `companiesConsidered` carries provenance for every company examined, not
// only the winner. `resolveCompanyStatus` never throws (it fails closed
// internally, per §8.10 rule 5), so there is no ranking-time error case left
// to separately fail closed on — the worst-decision fold already is that.

import { and, eq, sql } from 'drizzle-orm';
import { db, contactChannels, wizmatchCompanyContacts, wizmatchContactCandidates, wizmatchJobSignals } from '../../db';
import { resolveCompanyStatus } from './outreachGate';

export type WizmatchLinkageMechanism = 'wizmatch_company_contacts' | 'wizmatch_contact_candidates' | 'wizmatch_job_signals';

export interface WizmatchLinkedCompanyProvenance {
  companyId: string;
  mechanism: WizmatchLinkageMechanism;
  relationshipStage?: string;
  /** The canonical decision for this specific company, D-32 provenance. */
  decision: 'allow' | 'review' | 'deny';
  reasonCode: string | null;
}

export interface WizmatchLinkage {
  /** The most-restrictive linked company (D-32). */
  companyId: string;
  /** do_not_contact is a valid wizmatch_company_contacts.relationship_stage value (§10) — surfaced so callers can still reject even when the gate would otherwise allow. */
  relationshipStage?: string;
  /**
   * The CRM contact this linkage resolved to. Callers that started from a raw
   * address MUST pass this into the gate as `contactId`: without it,
   * `findSuppression`'s `contacts.do_not_contact` branch never runs and the
   * §22.3 #5 suppression union degrades to the email grain alone.
   */
  contactId?: string;
  /** Every tenant-safe linked company considered, in mechanism order, D-32 provenance. */
  companiesConsidered: WizmatchLinkedCompanyProvenance[];
}

const DECISION_RESTRICTIVENESS: Record<'allow' | 'review' | 'deny', number> = { allow: 0, review: 1, deny: 2 };

async function collectLinkedCompanyIds(
  tenantId: string,
  contactId: string,
): Promise<Array<{ companyId: string; mechanism: WizmatchLinkageMechanism; relationshipStage?: string }>> {
  const out: Array<{ companyId: string; mechanism: WizmatchLinkageMechanism; relationshipStage?: string }> = [];
  const seen = new Set<string>();

  const canonicalRows = await db
    .select({ companyId: wizmatchCompanyContacts.companyId, relationshipStage: wizmatchCompanyContacts.relationshipStage })
    .from(wizmatchCompanyContacts)
    .where(and(eq(wizmatchCompanyContacts.tenantId, tenantId), eq(wizmatchCompanyContacts.contactId, contactId)));
  for (const row of canonicalRows) {
    if (!row.companyId || seen.has(row.companyId)) continue;
    seen.add(row.companyId);
    out.push({ companyId: row.companyId, mechanism: 'wizmatch_company_contacts', relationshipStage: row.relationshipStage ?? undefined });
  }

  const candidateRows = await db
    .select({ companyId: wizmatchContactCandidates.companyId })
    .from(wizmatchContactCandidates)
    .where(and(eq(wizmatchContactCandidates.tenantId, tenantId), eq(wizmatchContactCandidates.crmContactId, contactId)));
  for (const row of candidateRows) {
    if (!row.companyId || seen.has(row.companyId)) continue;
    seen.add(row.companyId);
    out.push({ companyId: row.companyId, mechanism: 'wizmatch_contact_candidates' });
  }

  const signalRows = await db
    .select({ companyId: wizmatchJobSignals.companyId })
    .from(wizmatchJobSignals)
    .where(and(eq(wizmatchJobSignals.tenantId, tenantId), eq(wizmatchJobSignals.contactId, contactId)));
  for (const row of signalRows) {
    if (!row.companyId || seen.has(row.companyId)) continue;
    seen.add(row.companyId);
    out.push({ companyId: row.companyId, mechanism: 'wizmatch_job_signals' });
  }

  return out;
}

export async function resolveWizmatchLinkage(
  tenantId: string,
  contactId: string,
): Promise<WizmatchLinkage | null> {
  if (!contactId) return null;

  const linked = await collectLinkedCompanyIds(tenantId, contactId);
  if (linked.length === 0) return null;

  const companiesConsidered: WizmatchLinkedCompanyProvenance[] = await Promise.all(
    linked.map(async (entry) => {
      const status = await resolveCompanyStatus(tenantId, entry.companyId);
      return { ...entry, decision: status.decision, reasonCode: status.reasonCode };
    }),
  );

  // D-32: most-restrictive-wins, never an arbitrary pick. Ties (e.g. two
  // companies both `deny`) keep the first-considered order — deterministic,
  // not arbitrary, since every candidate was actually ranked.
  const winner = companiesConsidered.reduce((worst, candidate) =>
    DECISION_RESTRICTIVENESS[candidate.decision] > DECISION_RESTRICTIVENESS[worst.decision] ? candidate : worst,
  );

  return {
    companyId: winner.companyId,
    relationshipStage: winner.relationshipStage,
    companiesConsidered,
  };
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
  const linkage = await resolveWizmatchLinkage(tenantId, contactId);
  // Carry the resolved contactId back to the caller — it is what lets the gate
  // evaluate the contact grain of the suppression union, not just the address.
  return linkage ? { ...linkage, contactId } : null;
}
