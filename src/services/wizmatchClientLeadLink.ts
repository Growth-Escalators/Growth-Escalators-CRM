import { pool } from '../db/index';
import { findOrCreateContact, normalizeChannelValue } from './contactService';

export interface ApprovedClientLeadCandidate {
  id: string;
  companyId: string;
  companyName?: string | null;
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

function classificationMetadata(candidate: ApprovedClientLeadCandidate) {
  return {
    ...(candidate.metadata || {}),
    title: candidate.title,
    wizmatch_company_id: candidate.companyId,
    contact_intelligence_candidate_id: candidate.id,
  };
}

export async function classifyWizmatchClientLead(
  tenantId: string,
  crmContactId: string,
  candidate: ApprovedClientLeadCandidate,
): Promise<void> {
  const metadata = classificationMetadata(candidate);
  await pool.query(
    `UPDATE contacts
     SET company_name = COALESCE(NULLIF($1, ''), company_name),
         tags = ARRAY(
           SELECT DISTINCT tag
           FROM unnest(COALESCE(tags, ARRAY[]::text[]) || ARRAY['Client Lead']::text[]) AS tag
         ),
         metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
         last_activity_at = NOW(),
         updated_at = NOW()
     WHERE tenant_id = $3 AND id = $4`,
    [candidate.companyName || null, JSON.stringify(metadata), tenantId, crmContactId],
  );
}

function splitName(value: string): { firstName: string; lastName?: string } {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || 'Unknown',
    lastName: parts.length ? parts.join(' ') : undefined,
  };
}

/**
 * Creates/reuses the canonical CRM contact for an approved Contact Intelligence
 * candidate, then applies the client-lead classification on both create and dedup hits.
 */
export async function linkApprovedWizmatchClientLead(
  tenantId: string,
  candidate: ApprovedClientLeadCandidate,
): Promise<{ crmContactId: string; created: boolean }> {
  const channels = [
    candidate.email
      ? { channelType: 'email', channelValue: normalizeChannelValue('email', candidate.email), isPrimary: true }
      : null,
    candidate.phone
      ? { channelType: 'phone', channelValue: normalizeChannelValue('phone', candidate.phone), isPrimary: !candidate.email }
      : null,
    candidate.linkedinUrl
      ? { channelType: 'linkedin', channelValue: normalizeChannelValue('linkedin', candidate.linkedinUrl), isPrimary: !candidate.email && !candidate.phone }
      : null,
  ].filter(Boolean) as Array<{ channelType: string; channelValue: string; isPrimary: boolean }>;

  const name = splitName(candidate.name);
  const metadata = classificationMetadata(candidate);
  const { contact, created } = await findOrCreateContact(tenantId, {
    ...name,
    source: 'wizmatch_contact_intelligence',
    sourceDetail: candidate.title || 'manual review approved contact',
    companyName: candidate.companyName || undefined,
    tags: ['Client Lead'],
    metadata,
    channels,
  });

  // findOrCreateContact intentionally applies classification only on create. This
  // path must also classify a dedup hit and bump activity so repeat coordination
  // returns the contact to the top of the CRM list.
  await classifyWizmatchClientLead(tenantId, contact.id, candidate);

  return { crmContactId: contact.id, created };
}
