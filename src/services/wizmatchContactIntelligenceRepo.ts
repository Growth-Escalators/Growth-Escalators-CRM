/**
 * Wizmatch — Contact Intelligence persistence/orchestration
 *
 * Extracted from src/routes/wizmatch.ts (finding M26). This is the Contact
 * Intelligence Phase 1 read/persist/discovery cluster: computing a company's
 * qualification result (via wizmatchContactIntelligence.ts's pure scoring logic),
 * persisting it as a snapshot, fetching persisted state back out (single + batch
 * variants used by the command-center fan-out), and the manual paid-discovery
 * orchestration used by the `/contact-intelligence/companies/:companyId/discover`
 * route.
 *
 * Dependency direction is one-way: this file imports scoring/types FROM
 * wizmatchContactIntelligence.ts, never the reverse, so that file's existing
 * pure-logic unit tests never need DB mocking.
 */

import { pool } from '../db/index';
import logger from '../utils/logger';
import { normalizeChannelValue } from './contactService';
import { isSafeFetchHost } from '../utils/ssrfGuard';
import { scoreSignal } from './wizmatchScoring';
import {
  CONTACT_INTELLIGENCE_PHASE1_CAPS,
  qualifyCompanyForContactIntelligence,
  type CompanyIntelligenceStatus,
  type CompanyQualificationTier,
  type ContactCandidateStatus,
  type ContactIntelligenceInput,
  type ContactIntelligenceRegion,
} from './wizmatchContactIntelligence';
import {
  buildWizmatchContactDiscoveryPreview,
  executeWizmatchContactDiscovery,
  getWizmatchContactDiscoveryConfig,
  type WizmatchContactDiscoveryInput,
} from './wizmatchContactDiscovery';
import {
  buildWizmatchDiscoveryProviderEstimate,
  evaluateWizmatchCostGuard,
  fetchWizmatchCostGuardUsage,
  getWizmatchCostGuardConfig,
  getWizmatchProviderEnvStatus,
  type WizmatchCostGuardEvaluation,
} from './wizmatchCostGuard';
import { numeric, isOptionalWizmatchSchemaError, optionalWizmatchValue } from './wizmatchOptionalSchema';

export type ContactIntelligenceCompanyRow = {
  company_id: string;
  company_name: string;
  company_domain: string | null;
  company_country: string | null;
  company_industry: string | null;
  is_prime: boolean | null;
  prime_msa_status: string | null;
  h1b_sponsor_count: number | null;
  signal_id: string | null;
  job_title: string | null;
  keywords: string[] | null;
  location: string | null;
  source: string | null;
  signal_score: number | null;
  days_open: number | null;
  signal_status: string | null;
  matched_candidate_count: number | null;
  active_signal_count: number | null;
  positive_reply_count: number | null;
  negative_reply_count: number | null;
  placement_count: number | null;
  domain_status: string | null;
  suppressed_count: number | null;
  active_duplicate_count: number | null;
  signal_contact_ids: string[] | null;
};

export type PersistedContactCandidateRow = {
  id: string;
  crm_contact_id: string | null;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  source: string | null;
  source_url: string | null;
  deliverability_status: string | null;
  ranking_score: number | null;
  relationship_score: number | null;
  confidence_score: number | null;
  status: string | null;
  rejection_reason: string | null;
  metadata: Record<string, unknown> | null;
};

export function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || 'Unknown',
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
  };
}

/**
 * Confidence tier tells us how safely a contact can be emailed. Prefer the tier the
 * discovery cascade already computed (stored in metadata.raw); fall back to deriving
 * it from confidenceScore so older rows still render (>=8 high, >=6 medium, else low).
 */
export function deriveConfidenceTier(raw: Record<string, unknown> | undefined, confidenceScore: number): 'high' | 'medium' | 'low' {
  const stored = raw?.confidenceTier;
  if (stored === 'high' || stored === 'medium' || stored === 'low') return stored;
  if (confidenceScore >= 8) return 'high';
  if (confidenceScore >= 6) return 'medium';
  return 'low';
}

export function mapPersistedCandidate(row: PersistedContactCandidateRow) {
  const status = (row.status || 'needs_review') as ContactCandidateStatus;
  const raw = (row.metadata?.raw ?? undefined) as Record<string, unknown> | undefined;
  const confidenceScore = numeric(row.confidence_score);
  return {
    id: row.id,
    crmContactId: row.crm_contact_id,
    name: row.name,
    title: row.title,
    email: row.email,
    phone: row.phone,
    linkedinUrl: row.linkedin_url,
    source: row.source || 'internal_crm',
    sourceUrl: row.source_url,
    deliverabilityStatus: row.deliverability_status,
    status,
    rankingScore: numeric(row.ranking_score),
    relationshipScore: numeric(row.relationship_score),
    confidenceScore,
    confidenceTier: deriveConfidenceTier(raw, confidenceScore),
    roleCategory: typeof raw?.roleCategory === 'string' ? raw.roleCategory : null,
    team: typeof raw?.team === 'string' ? raw.team : null,
    mxProvider: typeof raw?.mxProvider === 'string' ? raw.mxProvider : null,
    rejectionReason: row.rejection_reason,
    reasons: Array.isArray(row.metadata?.reasons) ? row.metadata.reasons.map(String) : [],
  };
}

export async function fetchInternalContactCandidates(
  tenantId: string,
  companyName: string,
  companyDomain: string | null,
  signalContactIds: string[],
) {
  const result = await pool.query(
    `SELECT c.id,
            TRIM(CONCAT(c.first_name, ' ', COALESCE(c.last_name, ''))) AS name,
            COALESCE(c.metadata->>'title', c.metadata->>'job_title', c.source_detail) AS title,
            c.do_not_contact,
            c.source,
            email.channel_value AS email,
            email.verified AS email_verified,
            phone.channel_value AS phone,
            linkedin.channel_value AS linkedin_url,
            CASE WHEN c.id = ANY($4::uuid[]) THEN true ELSE false END AS from_signal,
            EXISTS (
              SELECT 1 FROM wizmatch_suppression_list ws
              WHERE ws.tenant_id = c.tenant_id AND ws.contact_id = c.id
            ) AS is_suppressed
     FROM contacts c
     LEFT JOIN LATERAL (
       SELECT channel_value, verified
       FROM contact_channels cc
       WHERE cc.contact_id = c.id AND cc.channel_type = 'email'
       ORDER BY cc.is_primary DESC, cc.created_at DESC
       LIMIT 1
     ) email ON true
     LEFT JOIN LATERAL (
       SELECT channel_value
       FROM contact_channels cc
       WHERE cc.contact_id = c.id AND cc.channel_type IN ('phone', 'whatsapp')
       ORDER BY cc.is_primary DESC, cc.created_at DESC
       LIMIT 1
     ) phone ON true
     LEFT JOIN LATERAL (
       SELECT channel_value
       FROM contact_channels cc
       WHERE cc.contact_id = c.id AND cc.channel_type = 'linkedin'
       ORDER BY cc.is_primary DESC, cc.created_at DESC
       LIMIT 1
     ) linkedin ON true
     WHERE c.tenant_id = $1
       AND (
         c.id = ANY($4::uuid[])
         OR LOWER(COALESCE(c.company_name, '')) = LOWER($2)
         OR ($3::text IS NOT NULL AND LOWER(COALESCE(c.company_name, '')) LIKE '%' || LOWER($3::text) || '%')
         OR ($3::text IS NOT NULL AND LOWER(COALESCE(c.metadata->>'company_domain', '')) = LOWER($3::text))
       )
     ORDER BY from_signal DESC, c.last_activity_at DESC NULLS LAST, c.created_at DESC
     LIMIT 10`,
    [tenantId, companyName, companyDomain, signalContactIds],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name || 'Unknown contact',
    title: row.title,
    email: row.email,
    phone: row.phone,
    linkedinUrl: row.linkedin_url,
    verified: row.email_verified,
    doNotContact: Boolean(row.do_not_contact || row.is_suppressed),
    source: row.from_signal ? 'prior_wizmatch_signal' : (row.source || 'internal_crm'),
    relationshipSignals: [
      row.from_signal ? 'prior_signal_contact' : null,
      row.email_verified ? 'verified_email' : null,
    ].filter(Boolean) as string[],
  }));
}

export async function buildContactIntelligenceResult(
  tenantId: string,
  row: ContactIntelligenceCompanyRow,
  // When the caller has already batch-fetched internal contacts for a page of
  // companies (see fetchInternalContactCandidatesBatch), it passes them in to avoid
  // a per-company query. Omitted → this fetches its own, preserving old behavior.
  internalContactsOverride?: Awaited<ReturnType<typeof fetchInternalContactCandidates>>,
) {
  const signalContactIds = row.signal_contact_ids?.filter(Boolean) ?? [];
  const internalContacts = internalContactsOverride ?? await fetchInternalContactCandidates(
    tenantId,
    row.company_name,
    row.company_domain,
    signalContactIds,
  );

  const input: ContactIntelligenceInput = {
    company: {
      id: row.company_id,
      name: row.company_name,
      domain: row.company_domain,
      country: row.company_country,
      industry: row.company_industry,
      isPrime: row.is_prime,
      primeMsaStatus: row.prime_msa_status,
      h1bSponsorCount: numeric(row.h1b_sponsor_count),
    },
    signal: row.signal_id ? {
      id: row.signal_id,
      jobTitle: row.job_title,
      keywords: row.keywords ?? [],
      location: row.location,
      source: row.source,
      score: numeric(row.signal_score),
      daysOpen: numeric(row.days_open),
      status: row.signal_status,
    } : null,
    candidateSupply: {
      matchedCandidateCount: numeric(row.matched_candidate_count),
      availableCandidateCount: numeric(row.matched_candidate_count),
    },
    relationships: {
      knownContactCount: internalContacts.length,
      positiveReplyCount: numeric(row.positive_reply_count),
      placementCount: numeric(row.placement_count),
      negativeReplyCount: numeric(row.negative_reply_count),
      isPrime: Boolean(row.is_prime),
      hasSignedMsa: row.prime_msa_status === 'signed',
    },
    safety: {
      suppressedCount: numeric(row.suppressed_count),
      domainStatus: row.domain_status,
      activeDuplicateCount: numeric(row.active_duplicate_count),
      inCooldown: false,
    },
    internalContacts,
  };

  return {
    ...qualifyCompanyForContactIntelligence(input),
    latestSignal: row.signal_id ? {
      id: row.signal_id,
      jobTitle: row.job_title,
      source: row.source,
      location: row.location,
      score: numeric(row.signal_score),
      daysOpen: numeric(row.days_open),
      status: row.signal_status,
      matchedCandidateCount: numeric(row.matched_candidate_count),
    } : null,
    relationshipSummary: {
      knownContactCount: internalContacts.length,
      positiveReplyCount: numeric(row.positive_reply_count),
      negativeReplyCount: numeric(row.negative_reply_count),
      placementCount: numeric(row.placement_count),
      activeSignalCount: numeric(row.active_signal_count),
    },
    safetySummary: {
      domainStatus: row.domain_status || 'unknown',
      suppressedCount: numeric(row.suppressed_count),
      activeDuplicateCount: numeric(row.active_duplicate_count),
    },
  };
}

export type PersistedContactIntelligence = {
  company: Record<string, any> | null;
  contactCandidates: ReturnType<typeof mapPersistedCandidate>[];
  discoveryRuns: Record<string, any>[];
};

export async function fetchPersistedContactIntelligence(
  tenantId: string,
  companyId: string,
): Promise<PersistedContactIntelligence> {
  try {
    const [company, candidates, discoveryRuns] = await Promise.all([
      pool.query(
        `SELECT id,
                qualification_tier,
                qualification_score,
                target_region,
                is_it_staffing_fit,
                status,
                review_status,
                review_action,
                reviewed_by,
                reviewed_at,
                rejection_reason,
                review_notes,
                last_qualified_at,
                last_discovered_at,
                next_refresh_at,
                cost_cents_total,
                source_summary,
                metadata
         FROM wizmatch_company_intelligence
         WHERE tenant_id = $1 AND company_id = $2
         LIMIT 1`,
        [tenantId, companyId],
      ),
      pool.query(
        `SELECT id,
                crm_contact_id,
                name,
                title,
                email,
                phone,
                linkedin_url,
                source,
                source_url,
                deliverability_status,
                ranking_score,
                relationship_score,
                confidence_score,
                status,
                rejection_reason,
                metadata
         FROM wizmatch_contact_candidates
         WHERE tenant_id = $1 AND company_id = $2
         ORDER BY CASE status
                    WHEN 'approved' THEN 0
                    WHEN 'needs_review' THEN 1
                    WHEN 'linked_to_crm' THEN 2
                    WHEN 'new' THEN 3
                    ELSE 4
                  END,
                  ranking_score DESC NULLS LAST,
                  created_at DESC
         LIMIT 10`,
        [tenantId, companyId],
      ),
      pool.query(
        `SELECT id,
                run_type,
                source,
                status,
                cost_cents,
                paid_provider,
                started_at,
                finished_at,
                result_counts,
                error_message,
                created_at
         FROM wizmatch_discovery_runs
         WHERE tenant_id = $1 AND company_id = $2
         ORDER BY created_at DESC
         LIMIT 5`,
        [tenantId, companyId],
      ),
    ]);

    return {
      company: company.rows[0] || null,
      contactCandidates: (candidates.rows as PersistedContactCandidateRow[]).map(mapPersistedCandidate),
      discoveryRuns: discoveryRuns.rows,
    };
  } catch (e) {
    if (!isOptionalWizmatchSchemaError(e, [
      'wizmatch_company_intelligence',
      'wizmatch_contact_candidates',
      'wizmatch_discovery_runs',
    ])) {
      logger.error({ err: e }, '[wizmatch] unexpected persisted contact intelligence schema error');
      throw e;
    }
    logger.warn({ err: e }, '[wizmatch] persisted contact intelligence unavailable');
    return { company: null, contactCandidates: [], discoveryRuns: [] };
  }
}

export async function withPersistedContactIntelligence(
  tenantId: string,
  item: Awaited<ReturnType<typeof buildContactIntelligenceResult>>,
  // When the caller has already batch-fetched persisted intelligence for a page of
  // companies (see fetchPersistedContactIntelligenceBatch), it passes it in to avoid
  // the per-company 3-query fan-out. Omitted → this fetches its own (old behavior).
  persistedOverride?: PersistedContactIntelligence,
) {
  const persisted = persistedOverride ?? await fetchPersistedContactIntelligence(tenantId, item.companyId);
  if (!persisted.company) {
    return { ...item, persisted: null };
  }

  return {
    ...item,
    qualificationTier: (persisted.company.qualification_tier || item.qualificationTier) as CompanyQualificationTier,
    qualificationScore: numeric(persisted.company.qualification_score) || item.qualificationScore,
    targetRegion: (persisted.company.target_region || item.targetRegion) as ContactIntelligenceRegion,
    companyStatus: (persisted.company.status || item.companyStatus) as CompanyIntelligenceStatus,
    contactCandidates: persisted.contactCandidates.length ? persisted.contactCandidates : item.contactCandidates,
    persisted: {
      id: persisted.company.id,
      reviewStatus: persisted.company.review_status,
      reviewAction: persisted.company.review_action,
      reviewedBy: persisted.company.reviewed_by,
      reviewedAt: persisted.company.reviewed_at,
      rejectionReason: persisted.company.rejection_reason,
      reviewNotes: persisted.company.review_notes,
      lastQualifiedAt: persisted.company.last_qualified_at,
      lastDiscoveredAt: persisted.company.last_discovered_at,
      nextRefreshAt: persisted.company.next_refresh_at,
      costCentsTotal: numeric(persisted.company.cost_cents_total),
      sourceSummary: persisted.company.source_summary || {},
      metadata: persisted.company.metadata || {},
      discoveryRuns: persisted.discoveryRuns,
    },
  };
}

/**
 * Batched replacement for the per-company `fetchInternalContactCandidates` fan-out used
 * by the command-center handler. Instead of one query per company (N queries), this issues
 * a SINGLE query: a VALUES list of (company_id, name, domain, signal_contact_ids) joined via
 * CROSS JOIN LATERAL to the exact same per-company top-10 contact subquery — same match
 * predicates, same ORDER BY, same LIMIT 10 — so each company's contacts are byte-for-byte
 * identical to the single-company path, just resolved in one round trip. Returns a map keyed
 * by company_id; every requested company is present (with `[]` when it has no matches).
 */
export async function fetchInternalContactCandidatesBatch(
  tenantId: string,
  rows: ContactIntelligenceCompanyRow[],
): Promise<Map<string, Awaited<ReturnType<typeof fetchInternalContactCandidates>>>> {
  type ContactList = Awaited<ReturnType<typeof fetchInternalContactCandidates>>;
  const map = new Map<string, ContactList>();
  if (rows.length === 0) return map;
  // Seed every company so companies with zero matches still appear with an empty list.
  for (const row of rows) map.set(row.company_id, []);

  const params: unknown[] = [tenantId];
  const valuesClauses: string[] = [];
  for (const row of rows) {
    const signalContactIds = row.signal_contact_ids?.filter(Boolean) ?? [];
    const base = params.length; // params already pushed before this company's 4 values
    params.push(row.company_id, row.company_name, row.company_domain, signalContactIds);
    valuesClauses.push(`($${base + 1}::uuid, $${base + 2}::text, $${base + 3}::text, $${base + 4}::uuid[])`);
  }

  const result = await pool.query(
    `SELECT comp.company_id AS __company_id, ic.*
     FROM (VALUES ${valuesClauses.join(', ')}) AS comp(company_id, company_name, company_domain, signal_contact_ids)
     CROSS JOIN LATERAL (
       SELECT c.id,
              TRIM(CONCAT(c.first_name, ' ', COALESCE(c.last_name, ''))) AS name,
              COALESCE(c.metadata->>'title', c.metadata->>'job_title', c.source_detail) AS title,
              c.do_not_contact,
              c.source,
              email.channel_value AS email,
              email.verified AS email_verified,
              phone.channel_value AS phone,
              linkedin.channel_value AS linkedin_url,
              CASE WHEN c.id = ANY(comp.signal_contact_ids) THEN true ELSE false END AS from_signal,
              EXISTS (
                SELECT 1 FROM wizmatch_suppression_list ws
                WHERE ws.tenant_id = c.tenant_id AND ws.contact_id = c.id
              ) AS is_suppressed
       FROM contacts c
       LEFT JOIN LATERAL (
         SELECT channel_value, verified
         FROM contact_channels cc
         WHERE cc.contact_id = c.id AND cc.channel_type = 'email'
         ORDER BY cc.is_primary DESC, cc.created_at DESC
         LIMIT 1
       ) email ON true
       LEFT JOIN LATERAL (
         SELECT channel_value
         FROM contact_channels cc
         WHERE cc.contact_id = c.id AND cc.channel_type IN ('phone', 'whatsapp')
         ORDER BY cc.is_primary DESC, cc.created_at DESC
         LIMIT 1
       ) phone ON true
       LEFT JOIN LATERAL (
         SELECT channel_value
         FROM contact_channels cc
         WHERE cc.contact_id = c.id AND cc.channel_type = 'linkedin'
         ORDER BY cc.is_primary DESC, cc.created_at DESC
         LIMIT 1
       ) linkedin ON true
       WHERE c.tenant_id = $1
         AND (
           c.id = ANY(comp.signal_contact_ids)
           OR LOWER(COALESCE(c.company_name, '')) = LOWER(comp.company_name)
           OR (comp.company_domain IS NOT NULL AND LOWER(COALESCE(c.company_name, '')) LIKE '%' || LOWER(comp.company_domain) || '%')
           OR (comp.company_domain IS NOT NULL AND LOWER(COALESCE(c.metadata->>'company_domain', '')) = LOWER(comp.company_domain))
         )
       ORDER BY from_signal DESC, c.last_activity_at DESC NULLS LAST, c.created_at DESC
       LIMIT 10
     ) ic`,
    params,
  );

  for (const row of result.rows) {
    const companyId = row.__company_id as string;
    const mapped = {
      id: row.id,
      name: row.name || 'Unknown contact',
      title: row.title,
      email: row.email,
      phone: row.phone,
      linkedinUrl: row.linkedin_url,
      verified: row.email_verified,
      doNotContact: Boolean(row.do_not_contact || row.is_suppressed),
      source: row.from_signal ? 'prior_wizmatch_signal' : (row.source || 'internal_crm'),
      relationshipSignals: [
        row.from_signal ? 'prior_signal_contact' : null,
        row.email_verified ? 'verified_email' : null,
      ].filter(Boolean) as string[],
    };
    const list = map.get(companyId);
    if (list) list.push(mapped);
    else map.set(companyId, [mapped]);
  }

  return map;
}

/**
 * Batched replacement for the per-company `fetchPersistedContactIntelligence` 3-query
 * fan-out used by the command-center handler. Issues exactly 3 set-based queries across the
 * whole page of companies (company intelligence, top-10 contact candidates, latest-5 discovery
 * runs) using `company_id = ANY($2)` + window functions to preserve the identical per-company
 * ORDER BY / LIMIT, then groups the rows in JS. Same optional-schema degradation as the
 * single-company version: if any of the optional tables is missing, every company gets an
 * empty result. Returns a map keyed by company_id.
 */
export async function fetchPersistedContactIntelligenceBatch(
  tenantId: string,
  companyIds: string[],
): Promise<Map<string, PersistedContactIntelligence>> {
  const map = new Map<string, PersistedContactIntelligence>();
  if (companyIds.length === 0) return map;

  try {
    const [companyRes, candidateRes, discoveryRes] = await Promise.all([
      pool.query(
        `SELECT company_id,
                id,
                qualification_tier,
                qualification_score,
                target_region,
                is_it_staffing_fit,
                status,
                review_status,
                review_action,
                reviewed_by,
                reviewed_at,
                rejection_reason,
                review_notes,
                last_qualified_at,
                last_discovered_at,
                next_refresh_at,
                cost_cents_total,
                source_summary,
                metadata
         FROM wizmatch_company_intelligence
         WHERE tenant_id = $1 AND company_id = ANY($2::uuid[])`,
        [tenantId, companyIds],
      ),
      pool.query(
        `SELECT company_id, id, crm_contact_id, name, title, email, phone, linkedin_url,
                source, source_url, deliverability_status, ranking_score, relationship_score,
                confidence_score, status, rejection_reason, metadata
         FROM (
           SELECT wcc.*,
                  ROW_NUMBER() OVER (
                    PARTITION BY wcc.company_id
                    ORDER BY CASE wcc.status
                               WHEN 'approved' THEN 0
                               WHEN 'needs_review' THEN 1
                               WHEN 'linked_to_crm' THEN 2
                               WHEN 'new' THEN 3
                               ELSE 4
                             END,
                             wcc.ranking_score DESC NULLS LAST,
                             wcc.created_at DESC
                  ) AS __rn
           FROM wizmatch_contact_candidates wcc
           WHERE wcc.tenant_id = $1 AND wcc.company_id = ANY($2::uuid[])
         ) ranked
         WHERE __rn <= 10
         ORDER BY company_id, __rn`,
        [tenantId, companyIds],
      ),
      pool.query(
        `SELECT company_id, id, run_type, source, status, cost_cents, paid_provider,
                started_at, finished_at, result_counts, error_message, created_at
         FROM (
           SELECT wdr.*,
                  ROW_NUMBER() OVER (PARTITION BY wdr.company_id ORDER BY wdr.created_at DESC) AS __rn
           FROM wizmatch_discovery_runs wdr
           WHERE wdr.tenant_id = $1 AND wdr.company_id = ANY($2::uuid[])
         ) ranked
         WHERE __rn <= 5
         ORDER BY company_id, __rn`,
        [tenantId, companyIds],
      ),
    ]);

    // company intelligence — one row per company (original used LIMIT 1); keep first seen.
    const companyByCompanyId = new Map<string, Record<string, any>>();
    for (const r of companyRes.rows) {
      if (!companyByCompanyId.has(r.company_id)) companyByCompanyId.set(r.company_id, r);
    }
    const candidatesByCompanyId = new Map<string, PersistedContactCandidateRow[]>();
    for (const r of candidateRes.rows as PersistedContactCandidateRow[]) {
      const companyId = (r as unknown as { company_id: string }).company_id;
      const list = candidatesByCompanyId.get(companyId) ?? [];
      list.push(r);
      candidatesByCompanyId.set(companyId, list);
    }
    const discoveryByCompanyId = new Map<string, Record<string, any>[]>();
    for (const r of discoveryRes.rows) {
      const list = discoveryByCompanyId.get(r.company_id) ?? [];
      // Project to exactly the original columns (drop company_id) — discovery rows are
      // serialized verbatim into the response, so the shape must match byte-for-byte.
      list.push({
        id: r.id,
        run_type: r.run_type,
        source: r.source,
        status: r.status,
        cost_cents: r.cost_cents,
        paid_provider: r.paid_provider,
        started_at: r.started_at,
        finished_at: r.finished_at,
        result_counts: r.result_counts,
        error_message: r.error_message,
        created_at: r.created_at,
      });
      discoveryByCompanyId.set(r.company_id, list);
    }

    for (const companyId of companyIds) {
      map.set(companyId, {
        company: companyByCompanyId.get(companyId) || null,
        contactCandidates: (candidatesByCompanyId.get(companyId) ?? []).map(mapPersistedCandidate),
        discoveryRuns: discoveryByCompanyId.get(companyId) ?? [],
      });
    }
    return map;
  } catch (e) {
    if (!isOptionalWizmatchSchemaError(e, [
      'wizmatch_company_intelligence',
      'wizmatch_contact_candidates',
      'wizmatch_discovery_runs',
    ])) {
      logger.error({ err: e }, '[wizmatch] unexpected persisted contact intelligence schema error');
      throw e;
    }
    logger.warn({ err: e }, '[wizmatch] persisted contact intelligence unavailable');
    return new Map();
  }
}

export async function persistContactIntelligenceSnapshot(tenantId: string, userId: string | undefined, companyId: string) {
  const rows = await fetchContactIntelligenceCompanyRows(tenantId, 1, companyId);
  if (rows.length === 0) return null;

  const computed = await buildContactIntelligenceResult(tenantId, rows[0]);
  const sourceSummary = {
    latestSignal: computed.latestSignal,
    relationshipSummary: computed.relationshipSummary,
    safetySummary: computed.safetySummary,
    reasons: computed.reasons,
    hardBlocks: computed.hardBlocks,
    phase: 'manual_review_persistence',
  };
  const nextRefreshAt = new Date(Date.now() + CONTACT_INTELLIGENCE_PHASE1_CAPS.rediscoveryCooldownDays * 24 * 60 * 60 * 1000);

  const companyResult = await pool.query(
    `INSERT INTO wizmatch_company_intelligence (
       tenant_id,
       company_id,
       qualification_tier,
       qualification_score,
       target_region,
       is_it_staffing_fit,
       status,
       review_status,
       last_qualified_at,
       next_refresh_at,
       cost_cents_total,
       source_summary,
       metadata,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'needs_review', NOW(), $8, 0, $9::jsonb, $10::jsonb, NOW())
     ON CONFLICT (tenant_id, company_id)
     DO UPDATE SET qualification_tier = EXCLUDED.qualification_tier,
                   qualification_score = EXCLUDED.qualification_score,
                   target_region = EXCLUDED.target_region,
                   is_it_staffing_fit = EXCLUDED.is_it_staffing_fit,
                   status = CASE
                     WHEN wizmatch_company_intelligence.review_status IN ('approved', 'rejected')
                     THEN wizmatch_company_intelligence.status
                     ELSE EXCLUDED.status
                   END,
                   last_qualified_at = NOW(),
                   next_refresh_at = EXCLUDED.next_refresh_at,
                   source_summary = EXCLUDED.source_summary,
                   metadata = EXCLUDED.metadata,
                   updated_at = NOW()
     RETURNING id`,
    [
      tenantId,
      companyId,
      computed.qualificationTier,
      computed.qualificationScore,
      computed.targetRegion,
      computed.qualificationTier !== 'Reject',
      computed.companyStatus,
      nextRefreshAt,
      JSON.stringify(sourceSummary),
      JSON.stringify({ generatedBy: userId || 'system', costControls: computed.costControls }),
    ],
  );
  const companyIntelligenceId = companyResult.rows[0].id as string;

  for (const candidate of computed.contactCandidates) {
    await pool.query(
      `INSERT INTO wizmatch_contact_candidates (
         tenant_id,
         company_intelligence_id,
         company_id,
         crm_contact_id,
         name,
         title,
         email,
         phone,
         linkedin_url,
         region,
         source,
         deliverability_status,
         ranking_score,
         relationship_score,
         confidence_score,
         status,
         metadata,
         updated_at
       )
       SELECT $1, $2, $3, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, NOW()
       WHERE NOT EXISTS (
         SELECT 1
         FROM wizmatch_contact_candidates existing
         WHERE existing.tenant_id = $1
           AND existing.company_id = $3
           AND (
             ($4::uuid IS NOT NULL AND existing.crm_contact_id = $4::uuid)
             OR ($7::text IS NOT NULL AND LOWER(COALESCE(existing.email, '')) = LOWER($7::text))
           )
       )`,
      [
        tenantId,
        companyIntelligenceId,
        companyId,
        candidate.id,
        candidate.name,
        candidate.title,
        candidate.email,
        candidate.phone,
        candidate.linkedinUrl,
        computed.targetRegion,
        candidate.source,
        candidate.confidenceScore >= 8 ? 'verified' : 'unverified',
        candidate.rankingScore,
        candidate.relationshipScore,
        candidate.confidenceScore,
        candidate.status,
        JSON.stringify({ reasons: candidate.reasons, snapshotGeneratedAt: new Date().toISOString() }),
      ],
    );
  }

  await pool.query(
    `INSERT INTO wizmatch_discovery_runs (
       tenant_id,
       company_intelligence_id,
       company_id,
       run_type,
       source,
       status,
       cost_cents,
       paid_provider,
       requested_by,
       started_at,
       finished_at,
       input_snapshot,
       result_counts
     )
     VALUES ($1, $2, $3, 'internal_reuse', 'internal_crm', $4, 0, false, $5::uuid, NOW(), NOW(), $6::jsonb, $7::jsonb)`,
    [
      tenantId,
      companyIntelligenceId,
      companyId,
      computed.contactCandidates.length > 0 ? 'succeeded' : 'partial',
      userId || null,
      JSON.stringify({ companyId, latestSignal: computed.latestSignal }),
      JSON.stringify({ contactCandidates: computed.contactCandidates.length }),
    ],
  );

  return withPersistedContactIntelligence(tenantId, computed);
}

export async function countPaidDiscoveryRunsInCooldown(
  tenantId: string,
  companyId: string,
  cooldownDays: number,
) {
  return optionalWizmatchValue('paid discovery cooldown', async () => {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM wizmatch_discovery_runs
       WHERE tenant_id = $1
         AND company_id = $2
         AND paid_provider = true
         AND status IN ('queued', 'running', 'succeeded', 'partial')
         AND created_at > NOW() - ($3::int * INTERVAL '1 day')`,
      [tenantId, companyId, cooldownDays],
    );
    return numeric(result.rows[0]?.count);
  }, 0, ['wizmatch_discovery_runs']);
}

export async function buildContactDiscoveryInput(
  tenantId: string,
  userId: string | undefined,
  companyId: string,
): Promise<{ item: Awaited<ReturnType<typeof persistContactIntelligenceSnapshot>>; input: WizmatchContactDiscoveryInput } | null> {
  const item = await persistContactIntelligenceSnapshot(tenantId, userId, companyId);
  if (!item?.persisted?.id) return null;
  const config = getWizmatchContactDiscoveryConfig();
  const paidRunsInCooldown = await countPaidDiscoveryRunsInCooldown(tenantId, companyId, config.rediscoveryCooldownDays);

  return {
    item,
    input: {
      companyId,
      companyName: item.companyName,
      companyDomain: item.companyDomain,
      targetRegion: item.targetRegion,
      qualificationTier: item.qualificationTier,
      qualificationScore: item.qualificationScore,
      companyStatus: item.companyStatus,
      reviewStatus: item.persisted.reviewStatus,
      hardBlocks: item.hardBlocks,
      lastDiscoveredAt: item.persisted.lastDiscoveredAt,
      nextRefreshAt: item.persisted.nextRefreshAt,
      paidRunsInCooldown,
    },
  };
}

export async function buildContactDiscoveryCostGuard(
  tenantId: string,
  userId: string | null | undefined,
  companyId: string,
): Promise<WizmatchCostGuardEvaluation> {
  const discoveryConfig = getWizmatchContactDiscoveryConfig();
  const usage = await fetchWizmatchCostGuardUsage(pool, tenantId, userId);
  return evaluateWizmatchCostGuard({
    tenantId,
    userId,
    companyId,
    estimatedProviderCalls: buildWizmatchDiscoveryProviderEstimate({
      googleFallbackEnabled: discoveryConfig.googleFallbackEnabled,
      enableApollo: discoveryConfig.enableApollo,
      enableSnov: discoveryConfig.enableSnov,
    }),
    usage,
    providerEnv: getWizmatchProviderEnvStatus(process.env, {
      googleFallbackEnabled: discoveryConfig.googleFallbackEnabled,
      enableApollo: discoveryConfig.enableApollo,
      enableSnov: discoveryConfig.enableSnov,
    }),
    config: getWizmatchCostGuardConfig(),
  });
}

export async function buildContactDiscoveryCostControls(
  tenantId: string,
  userId: string | null | undefined,
  companyId = 'tenant-summary',
) {
  return {
    ...getWizmatchContactDiscoveryConfig(),
    costGuard: await buildContactDiscoveryCostGuard(tenantId, userId, companyId),
  };
}

export async function insertContactDiscoveryRunAudit(input: {
  tenantId: string;
  companyIntelligenceId: string;
  companyId: string;
  source: string;
  status: string;
  costCents: number;
  // A run only counts toward the 30-day per-company cooldown when a REAL paid provider
  // (Apollo/Snov) was used. Free runs (website/Serper/Reacher, cost 0) must NOT lock the
  // company out of re-running discovery. Defaults true for backward-compatible callers.
  paidProvider?: boolean;
  userId?: string | null;
  inputSnapshot: Record<string, unknown>;
  resultCounts: Record<string, unknown>;
  errorMessage?: string | null;
  metadata: Record<string, unknown>;
}) {
  const result = await pool.query(
    `INSERT INTO wizmatch_discovery_runs (
       tenant_id,
       company_intelligence_id,
       company_id,
       run_type,
       source,
       status,
       cost_cents,
       paid_provider,
       requested_by,
       started_at,
       finished_at,
       input_snapshot,
       result_counts,
       error_message,
       metadata
     )
     VALUES ($1, $2, $3, 'paid_discovery', $4, $5, $6, $7, $8::uuid, NOW(), NOW(), $9::jsonb, $10::jsonb, $11, $12::jsonb)
     RETURNING id`,
    [
      input.tenantId,
      input.companyIntelligenceId,
      input.companyId,
      input.source,
      input.status,
      input.costCents,
      input.paidProvider ?? true,
      input.userId || null,
      JSON.stringify(input.inputSnapshot),
      JSON.stringify(input.resultCounts),
      input.errorMessage || null,
      JSON.stringify(input.metadata),
    ],
  );
  return String(result.rows[0]?.id || '');
}

export async function withContactDiscoveryAdvisoryLock<T>(
  lockKey: string,
  run: () => Promise<T>,
): Promise<{ locked: true; result: T } | { locked: false }> {
  const client = await pool.connect();
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockKey]);
    if (!lock.rows[0]?.locked) return { locked: false };
    try {
      return { locked: true, result: await run() };
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch((err) => {
        logger.warn({ err, lockKey }, '[wizmatch] failed to release contact discovery advisory lock');
      });
    }
  } finally {
    client.release();
  }
}

export async function fetchContactIntelligenceCompanyRows(tenantId: string, limit: number, companyId?: string) {
  const params: unknown[] = [tenantId];
  let companyFilter = '';
  if (companyId) {
    params.push(companyId);
    companyFilter = `AND c.id = $${params.length}`;
  }
  params.push(limit);

  const result = await pool.query(
    `WITH latest_signals AS (
       SELECT DISTINCT ON (s.company_id)
              s.company_id,
              s.id AS signal_id,
              s.job_title,
              s.keywords,
              s.location,
              s.source,
              s.score AS signal_score,
              s.days_open,
              s.status AS signal_status,
              s.matched_candidate_ids,
              s.contact_id,
              s.created_at
       FROM wizmatch_job_signals s
       WHERE s.tenant_id = $1 AND s.company_id IS NOT NULL
       ORDER BY s.company_id, s.score DESC NULLS LAST, s.created_at DESC
     )
     SELECT c.id AS company_id,
            c.name AS company_name,
            c.domain AS company_domain,
            c.country AS company_country,
            c.industry AS company_industry,
            c.is_prime,
            c.prime_msa_status,
            c.h1b_sponsor_count,
            ls.signal_id,
            ls.job_title,
            ls.keywords,
            ls.location,
            ls.source,
            ls.signal_score,
            ls.days_open,
            ls.signal_status,
            COALESCE(cardinality(ls.matched_candidate_ids), 0)::int AS matched_candidate_count,
            (SELECT COUNT(*)::int
             FROM wizmatch_job_signals s2
             WHERE s2.tenant_id = $1 AND s2.company_id = c.id AND s2.status NOT IN ('dead', 'placed')) AS active_signal_count,
            (SELECT COUNT(*)::int
             FROM wizmatch_job_signals s3
             WHERE s3.tenant_id = $1 AND s3.company_id = c.id AND s3.status = 'replied_positive') AS positive_reply_count,
            (SELECT COUNT(*)::int
             FROM wizmatch_job_signals s4
             WHERE s4.tenant_id = $1 AND s4.company_id = c.id AND s4.status = 'replied_other') AS negative_reply_count,
            (SELECT COUNT(*)::int
             FROM wizmatch_placements wp
             WHERE wp.tenant_id = $1 AND (wp.company_id = c.id OR wp.prime_company_id = c.id)) AS placement_count,
            dh.status AS domain_status,
            (SELECT COUNT(*)::int
             FROM wizmatch_suppression_list ws
             WHERE ws.tenant_id = $1
               AND c.domain IS NOT NULL
               AND LOWER(SPLIT_PART(COALESCE(ws.email, ''), '@', 2)) = LOWER(c.domain)) AS suppressed_count,
            (SELECT COUNT(*)::int
             FROM wizmatch_job_signals s5
             WHERE s5.tenant_id = $1
               AND s5.company_id = c.id
               AND s5.status IN ('drafted', 'sent')) AS active_duplicate_count,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT sig_contacts.contact_id), NULL) AS signal_contact_ids
     FROM wizmatch_companies c
     JOIN latest_signals ls ON ls.company_id = c.id
     LEFT JOIN wizmatch_domain_health dh ON dh.tenant_id = c.tenant_id AND dh.domain = c.domain
     LEFT JOIN wizmatch_job_signals sig_contacts ON sig_contacts.tenant_id = c.tenant_id AND sig_contacts.company_id = c.id
     WHERE c.tenant_id = $1 ${companyFilter}
     GROUP BY c.id, ls.signal_id, ls.job_title, ls.keywords, ls.location, ls.source, ls.signal_score,
              ls.days_open, ls.signal_status, ls.matched_candidate_ids, dh.status
     ORDER BY COALESCE(ls.signal_score, 0) DESC, active_signal_count DESC, c.updated_at DESC
     LIMIT $${params.length}`,
    params,
  );

  return result.rows as ContactIntelligenceCompanyRow[];
}

export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  const stripped = trimmed.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const host = stripped.split(/[\/\?#]/)[0].toLowerCase();
  if (!host) return null;
  // SSRF guard: never store or later fetch an internal/private/obfuscated host.
  // A bad host (localhost, 169.254.169.254, *.railway.internal, user@host, …) is
  // scrubbed to null rather than persisted — normal public domains pass unchanged.
  if (!isSafeFetchHost(host)) return null;
  return host;
}

export type SeedProspectInput = {
  tenantId: string;
  userId: string | undefined;
  companyName: string;
  domain: string | null;
  jobTitle: string;
  jobUrl: string | null;
  location: string | null;
  notes: string | null;
  targetRegion: string | null;
  industry: string | null;
  employeeCount: number | null;
  linkedinUrl: string | null;
  keywords: string[];
};

export type SeedProspectResult = {
  companyId: string;
  companyExisted: boolean;
  signalId: string;
  intelligenceItem: Awaited<ReturnType<typeof persistContactIntelligenceSnapshot>>;
};

export async function seedProspectCompany(input: SeedProspectInput): Promise<SeedProspectResult> {
  const country =
    input.targetRegion === 'india' ? 'IN' :
    input.targetRegion === 'us' ? 'US' :
    null;

  let companyId: string;
  let companyExisted = false;

  const existing = await pool.query(
    `SELECT id FROM wizmatch_companies
     WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)
     LIMIT 1`,
    [input.tenantId, input.companyName],
  );

  if (existing.rows.length > 0) {
    companyId = existing.rows[0].id;
    companyExisted = true;
    await pool.query(
      `UPDATE wizmatch_companies SET
         domain = COALESCE(domain, $1),
         industry = COALESCE(industry, $2),
         employee_count = COALESCE(employee_count, $3),
         country = COALESCE(country, $4),
         linkedin_url = COALESCE(linkedin_url, $5),
         notes = COALESCE(notes, $6),
         updated_at = NOW()
       WHERE id = $7`,
      [
        input.domain,
        input.industry,
        input.employeeCount,
        country,
        input.linkedinUrl,
        input.notes,
        companyId,
      ],
    );
  } else {
    const inserted = await pool.query(
      `INSERT INTO wizmatch_companies
         (tenant_id, name, domain, industry, employee_count, country, linkedin_url, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        input.tenantId,
        input.companyName,
        input.domain,
        input.industry,
        input.employeeCount,
        country || 'US',
        input.linkedinUrl,
        input.notes,
      ],
    );
    companyId = inserted.rows[0].id;
  }

  const manualScore = scoreSignal({
    daysOpen: 0,
    repostCount: 0,
    companyVolumeCount: 1,
    employmentType: null,
    keywords: input.keywords,
    h1bSponsorCount: 0,
    location: input.location,
    jobTitle: input.jobTitle,
    rawText: input.notes,
  });
  const signalInsert = await pool.query(
    `INSERT INTO wizmatch_job_signals
       (tenant_id, company_id, job_title, job_url, source, location, keywords, score, status)
     VALUES ($1, $2, $3, $4, 'manual', $5, $6, $7, 'scored')
     RETURNING id`,
    [
      input.tenantId,
      companyId,
      input.jobTitle,
      input.jobUrl,
      input.location,
      input.keywords,
      manualScore.score,
    ],
  );
  const signalId = signalInsert.rows[0].id;

  const intelligenceItem = await persistContactIntelligenceSnapshot(
    input.tenantId,
    input.userId,
    companyId,
  );

  return { companyId, companyExisted, signalId, intelligenceItem };
}

/**
 * Outcome of a manual paid-discovery attempt against a single company. Extracted from the
 * `POST /contact-intelligence/companies/:companyId/discover` route body verbatim — see that
 * route in src/routes/wizmatch.ts for the HTTP-status mapping per kind.
 */
export type ManualDiscoveryOutcome =
  | { kind: 'not_found' }
  | { kind: 'confirm_required'; preview: unknown }
  | { kind: 'ineligible'; httpStatus: number; preview: unknown }
  | { kind: 'locked_out'; preview: unknown }
  | { kind: 'cost_blocked'; httpStatus: number; preview: unknown; discoveryRunId: string }
  | { kind: 'succeeded'; body: Record<string, unknown> };

/**
 * Manual paid discovery only. Requires an explicit preview confirmation and never sends
 * outreach. Moved verbatim out of the `/contact-intelligence/companies/:companyId/discover`
 * route handler (finding M26) — an advisory-lock wrapper, a cost-guard re-check with a
 * blocked-audit-insert branch, the executeWizmatchContactDiscovery call plus a candidate
 * INSERT loop, and a company-intelligence status UPDATE.
 */
export async function runManualPaidContactDiscovery(
  tenantId: string,
  userId: string | undefined,
  companyId: string,
  confirmPreview: boolean,
): Promise<ManualDiscoveryOutcome> {
  const discoveryInput = await buildContactDiscoveryInput(tenantId, userId, companyId);
  if (!discoveryInput) {
    return { kind: 'not_found' };
  }

  const initialCostGuard = await buildContactDiscoveryCostGuard(tenantId, userId, companyId);
  const preview = buildWizmatchContactDiscoveryPreview(
    discoveryInput.input,
    getWizmatchContactDiscoveryConfig(),
    initialCostGuard,
  );
  if (!confirmPreview) {
    return { kind: 'confirm_required', preview };
  }
  if (!preview.eligible) {
    await insertContactDiscoveryRunAudit({
      tenantId,
      companyIntelligenceId: discoveryInput.item!.persisted!.id,
      companyId,
      source: initialCostGuard.blockCode || 'eligibility_guard',
      status: 'blocked_by_cap',
      costCents: 0,
      userId: userId || null,
      inputSnapshot: { preview, providerOrder: preview.providerOrder },
      resultCounts: { candidates: 0, providerCalls: { apollo: 0, snov: 0, reacher: 0, googleFallback: 0 } },
      errorMessage: preview.blockedReasons.join(' | '),
      metadata: {
        costGuard: initialCostGuard,
        blockReasons: preview.blockedReasons,
      },
    });
    const httpStatus = initialCostGuard.blockCode ? initialCostGuard.httpStatus : 409;
    return { kind: 'ineligible', httpStatus, preview };
  }

  const locked = await withContactDiscoveryAdvisoryLock(initialCostGuard.idempotencyKey, async () => {
    const costGuard = await buildContactDiscoveryCostGuard(tenantId, userId, companyId);
    const guardedPreview = buildWizmatchContactDiscoveryPreview(
      discoveryInput.input,
      getWizmatchContactDiscoveryConfig(),
      costGuard,
    );
    if (!costGuard.allowed) {
      const runId = await insertContactDiscoveryRunAudit({
        tenantId,
        companyIntelligenceId: discoveryInput.item!.persisted!.id,
        companyId,
        source: costGuard.blockCode || 'cost_guard',
        status: 'blocked_by_cap',
        costCents: 0,
        userId: userId || null,
        inputSnapshot: { preview: guardedPreview, providerOrder: guardedPreview.providerOrder },
        resultCounts: { candidates: 0, providerCalls: { apollo: 0, snov: 0, reacher: 0, googleFallback: 0 } },
        errorMessage: costGuard.blockReasons.join(' | '),
        metadata: {
          costGuard,
          budgetSnapshot: costGuard.budget,
          blockReasons: costGuard.blockReasons,
        },
      });
      return {
        blocked: true as const,
        httpStatus: costGuard.httpStatus,
        preview: guardedPreview,
        discoveryRunId: runId,
      };
    }

    const discovery = await executeWizmatchContactDiscovery(
      discoveryInput.input,
      undefined,
      getWizmatchContactDiscoveryConfig(),
      { costGuardToken: costGuard.idempotencyKey },
    );
    const sourceSummary = discovery.candidates.length
      ? Array.from(new Set(discovery.candidates.map((candidate) => candidate.source))).join(',')
      : 'provider_discovery';
    // Only a genuine PAID provider (Apollo/Snov) locks the company into the 30-day
    // cooldown. A free run (website/Serper/Reacher) must stay re-runnable.
    const usedPaidProvider = (discovery.providerCalls.apollo || 0) > 0 || (discovery.providerCalls.snov || 0) > 0;
    const runId = await insertContactDiscoveryRunAudit({
      tenantId,
      companyIntelligenceId: discoveryInput.item!.persisted!.id,
      companyId,
      source: sourceSummary,
      status: discovery.status,
      costCents: discovery.costCents,
      paidProvider: usedPaidProvider,
      userId: userId || null,
      inputSnapshot: { preview: { ...discovery.preview, costGuard }, providerOrder: discovery.preview.providerOrder },
      resultCounts: { candidates: discovery.candidates.length, providerCalls: discovery.providerCalls },
      errorMessage: discovery.errors.length ? discovery.errors.join(' | ') : null,
      metadata: {
        errors: discovery.errors,
        providerCalls: discovery.providerCalls,
        costGuard,
        budgetSnapshot: costGuard.budget,
      },
    });

    for (const candidate of discovery.candidates) {
      const email = candidate.email ? normalizeChannelValue('email', candidate.email) : null;
      await pool.query(
        `INSERT INTO wizmatch_contact_candidates (
         tenant_id,
         company_intelligence_id,
         company_id,
         name,
         title,
         email,
         linkedin_url,
         region,
         source,
         source_url,
         deliverability_status,
         ranking_score,
         relationship_score,
         confidence_score,
         status,
         metadata,
         created_at,
         updated_at
       )
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, $13, $14, $15::jsonb, NOW(), NOW()
       WHERE NOT EXISTS (
         SELECT 1
         FROM wizmatch_contact_candidates existing
         WHERE existing.tenant_id = $1
           AND existing.company_id = $3
           AND (
             ($6::text IS NOT NULL AND LOWER(COALESCE(existing.email, '')) = LOWER($6::text))
             OR ($7::text IS NOT NULL AND LOWER(COALESCE(existing.linkedin_url, '')) = LOWER($7::text))
           )
       )`,
        [
          tenantId,
          discoveryInput.item!.persisted!.id,
          companyId,
          candidate.name,
          candidate.title,
          email,
          candidate.linkedinUrl,
          discoveryInput.input.targetRegion,
          candidate.source,
          candidate.sourceUrl,
          candidate.deliverabilityStatus,
          candidate.rankingScore,
          candidate.confidenceScore,
          candidate.status,
          JSON.stringify({
            reasons: candidate.reasons,
            providerCostCents: candidate.costCents,
            discoveryRunId: runId,
            raw: candidate.raw || {},
          }),
        ],
      );
    }

    await pool.query(
      `UPDATE wizmatch_company_intelligence
     SET status = CASE WHEN $1 IN ('succeeded', 'partial') THEN 'discovered' ELSE status END,
         last_discovered_at = NOW(),
         next_refresh_at = NOW() + ($2::int * INTERVAL '1 day'),
         cost_cents_total = COALESCE(cost_cents_total, 0) + $3,
         metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
         updated_at = NOW()
     WHERE tenant_id = $5 AND company_id = $6`,
      [
        discovery.status,
        getWizmatchContactDiscoveryConfig().rediscoveryCooldownDays,
        discovery.costCents,
        JSON.stringify({ lastPaidDiscoveryRunId: runId, lastPaidDiscoveryStatus: discovery.status }),
        tenantId,
        companyId,
      ],
    );

    const refreshed = await fetchPersistedContactIntelligence(tenantId, companyId);
    return {
      blocked: false as const,
      body: {
        preview: { ...discovery.preview, costGuard },
        discoveryRunId: runId,
        status: discovery.status,
        providerCalls: discovery.providerCalls,
        costCents: discovery.costCents,
        errors: discovery.errors,
        contactCandidates: refreshed.contactCandidates,
        persisted: refreshed.company,
      },
    };
  });

  if (!locked.locked) {
    return { kind: 'locked_out', preview };
  }
  if (locked.result.blocked) {
    return {
      kind: 'cost_blocked',
      httpStatus: locked.result.httpStatus,
      preview: locked.result.preview,
      discoveryRunId: locked.result.discoveryRunId,
    };
  }
  return { kind: 'succeeded', body: locked.result.body };
}
