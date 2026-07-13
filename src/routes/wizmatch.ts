/**
 * Wizmatch Staffing Module — API Router
 *
 * All routes under /api/wizmatch/*
 * Groups: signals, candidates, placements, primes, domains, compliance, reply, analytics
 *
 * Auth:
 *   - requireAuth: CRM user JWT (req.user.tenantId)
 *   - requireInternalToken: cron/CI calls (x-internal-secret header)
 *   - Public: /unsubscribe (HMAC verified), Vapi webhook (signature verified)
 *
 * Cost guardrails:
 *   - /score and /match: pure TS ($0)
 *   - /draft: Sonnet on-demand only
 *   - /classify-reply: reuses Haiku classifier
 */

import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { db, pool } from '../db/index';
import { sql } from 'drizzle-orm';
import {
  wizmatchCandidates,
  wizmatchPlacements,
  wizmatchDomainHealth,
  wizmatchSuppressionList,
  messages,
  events,
  sequenceEnrolments,
} from '../db/schema';
import { requireInternalToken } from '../middleware/internalAuth';
import { isStaffingPhaseEnabled } from './wizmatchStaffing';
import { scoreSignalById, enrichSignalById, matchSignalById } from '../services/wizmatchSignalPipeline';
import { scoreSignal } from '../services/wizmatchScoring';
import { callClaude, parseClaudeJSON, CLAUDE_MODELS } from '../services/claudeService';
import { findOrCreateContact, normalizeChannelValue } from '../services/contactService';
import { classifyWizmatchClientLead, linkApprovedWizmatchClientLead } from '../services/wizmatchClientLeadLink';
import { sendSlackMessage } from '../services/slackService';
import {
  WIZMATCH_LEADS_CHANNEL,
  WIZMATCH_SYSTEM_CHANNEL,
  WIZMATCH_DAILY_CHANNEL,
  WIZMATCH_PHYSICAL_ADDRESS,
  WIZMATCH_UNSUBSCRIBE_HMAC_SECRET,
  WIZMATCH_MEETING_URL,
} from '../config/constants';
import multer from 'multer';
import { parseRequirement, generateRequirementSheet } from '../services/wizmatchRequirementSheet';
import {
  CONTACT_INTELLIGENCE_PHASE1_CAPS,
  qualifyCompanyForContactIntelligence,
  resolveContactIntelligenceReviewAction,
  type CompanyIntelligenceStatus,
  type CompanyQualificationTier,
  type ContactCandidateStatus,
  type ContactIntelligenceInput,
  type ContactIntelligenceRegion,
} from '../services/wizmatchContactIntelligence';
import {
  buildWizmatchCommandCenter,
  type CommandCenterCandidateInput,
  type CommandCenterMetricsInput,
  type CommandCenterRequirementInput,
  type CommandCenterSignalInput,
} from '../services/wizmatchCommandCenter';
import {
  CLIENT_DISCOVERY_GUARDRAILS,
  rankClientDiscoveryQueue,
  scoreClientDiscoveryOpportunity,
  selectCompaniesForContactIntelligence,
  type ClientDiscoveryInput,
} from '../services/wizmatchClientDiscovery';
import {
  CANDIDATE_INTELLIGENCE_GUARDRAILS,
  rankCandidateIntelligenceQueue,
  rankCandidatesForRequirement,
  scoreCandidateIntelligence,
  type CandidateIntelligenceInput,
  type CandidateRequirementInput,
  type CandidateSignalInput,
} from '../services/wizmatchCandidateIntelligence';
import {
  buildCandidateIntakeRequest,
  type CandidateIntakeProfile,
} from '../services/wizmatchCandidateIntake';
import {
  buildWizmatchRoiAnalytics,
  type WizmatchRoiAnalyticsInput,
} from '../services/wizmatchRoiAnalytics';
import {
  REQUIREMENT_PRIORITY_GUARDRAILS,
  rankRequirementPriorityQueue,
  scoreRequirementPriority,
  type RequirementPriorityInput,
} from '../services/wizmatchRequirementPriority';
import { buildWizmatchReviewWorkbench, paginateWizmatchReviewWorkbench } from '../services/wizmatchReviewWorkbench';
import { getWizmatchReadiness } from '../services/wizmatchReadiness';
import { wizmatchStaffingService } from '../services/wizmatchStaffingDomain';
import { buildWizmatchEnvReport } from '../services/wizmatchEnvCheck';
import { parseCsv } from './outbound';
import {
  buildWizmatchContactDiscoveryPreview,
  executeWizmatchContactDiscovery,
  getWizmatchContactDiscoveryConfig,
  type WizmatchContactDiscoveryInput,
} from '../services/wizmatchContactDiscovery';
import {
  buildWizmatchDiscoveryProviderEstimate,
  evaluateWizmatchCostGuard,
  fetchWizmatchCostGuardUsage,
  getWizmatchCostGuardConfig,
  getWizmatchProviderEnvStatus,
  type WizmatchCostGuardEvaluation,
} from '../services/wizmatchCostGuard';
import logger from '../utils/logger';
import { isSafeFetchHost } from '../utils/ssrfGuard';
import { mineGithubCandidates } from '../services/wizmatchGithubMiner';
import { runXrayScrape } from '../services/wizmatchXrayScraper';

const router = Router();


// In-memory upload for requirement JD files (parsed by Claude, then discarded).
const requirementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});
const ALLOWED_REQ_MEDIA = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

type ContactIntelligenceCompanyRow = {
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

type CommandCenterMetricsRow = {
  active_signals: number | string | null;
  priority_signals: number | string | null;
  available_candidates: number | string | null;
  open_requirements: number | string | null;
  active_placements: number | string | null;
  paused_domains: number | string | null;
  suppressed_contacts: number | string | null;
};

type PersistedContactCandidateRow = {
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

type ClientDiscoverySignalRow = {
  id: string;
  job_title: string;
  company_id: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_industry: string | null;
  company_country: string | null;
  is_prime: boolean | null;
  prime_msa_status: string | null;
  h1b_sponsor_count: number | null;
  source: string | null;
  location: string | null;
  status: string | null;
  signal_score: number | null;
  days_open: number | null;
  repost_count: number | null;
  matched_candidate_count: number | null;
  active_signal_count: number | null;
  positive_reply_count: number | null;
  placement_count: number | null;
  domain_status: string | null;
  suppressed_count: number | null;
  active_duplicate_count: number | null;
};

type CandidateIntelligenceRow = {
  id: string;
  contact_id: string | null;
  name: string | null;
  skills: string[] | null;
  location: string | null;
  visa_status: string | null;
  rate_hourly: number | null;
  rate_currency: string | null;
  availability_date: string | null;
  availability_status: string | null;
  source: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  resume_url: string | null;
  is_wizmatch_certified: boolean | null;
  has_email: boolean | null;
  has_phone: boolean | null;
  contact_do_not_contact: boolean | null;
  is_suppressed: boolean | null;
  active_placement_count: number | null;
  active_submission_count: number | null;
  prior_placement_count: number | null;
};

type CandidateRequirementRow = {
  id: string;
  title: string;
  company_name: string | null;
  required_skills: string[] | null;
  location: string | null;
  region: string | null;
  work_mode: string | null;
  budget_min: number | null;
  budget_max: number | null;
  budget_currency: string | null;
  priority: string | null;
  status: string | null;
};

type CandidateSignalRow = {
  id: string;
  job_title: string;
  company_name: string | null;
  keywords: string[] | null;
  location: string | null;
  score: number | null;
  status: string | null;
};

function numeric(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  return 0;
}

const OPTIONAL_WIZMATCH_SCHEMA_TABLES = [
  'wizmatch_requirements',
  'wizmatch_company_intelligence',
  'wizmatch_contact_candidates',
  'wizmatch_discovery_runs',
] as const;

type OptionalWizmatchSchemaTable = typeof OPTIONAL_WIZMATCH_SCHEMA_TABLES[number];

function isOptionalWizmatchSchemaTable(table: string): table is OptionalWizmatchSchemaTable {
  return (OPTIONAL_WIZMATCH_SCHEMA_TABLES as readonly string[]).includes(table);
}

function optionalTablesFromQuery(query: string): OptionalWizmatchSchemaTable[] {
  const lowerQuery = query.toLowerCase();
  return OPTIONAL_WIZMATCH_SCHEMA_TABLES.filter((table) => lowerQuery.includes(table));
}

export function isOptionalWizmatchSchemaError(
  error: unknown,
  referencedTables: readonly string[] = [],
): boolean {
  const pgError = error as { code?: string; message?: string } | null;
  if (!pgError) return false;
  if (pgError.code !== '42P01' && pgError.code !== '42703') return false;
  return referencedTables.some(isOptionalWizmatchSchemaTable);
}

async function optionalWizmatchStatsQuery<T extends Record<string, unknown>>(
  label: string,
  query: string,
  params: unknown[],
  fallback: T,
): Promise<{ rows: T[] }> {
  const optionalTables = optionalTablesFromQuery(query);
  try {
    return await pool.query(query, params) as { rows: T[] };
  } catch (e) {
    if (!isOptionalWizmatchSchemaError(e, optionalTables)) {
      logger.error({ err: e, label, optionalTables }, `[wizmatch] unexpected stats schema error: ${label}`);
      throw e;
    }
    logger.warn({ err: e }, `[wizmatch] optional stats unavailable: ${label}`);
    return { rows: [fallback] };
  }
}

async function optionalWizmatchValue<T>(
  label: string,
  load: () => Promise<T>,
  fallback: T,
  optionalTables: readonly OptionalWizmatchSchemaTable[] = [],
): Promise<T> {
  try {
    return await load();
  } catch (e) {
    if (!isOptionalWizmatchSchemaError(e, optionalTables)) {
      logger.error({ err: e, label, optionalTables }, `[wizmatch] unexpected optional data schema error: ${label}`);
      throw e;
    }
    logger.warn({ err: e }, `[wizmatch] optional data unavailable: ${label}`);
    return fallback;
  }
}

function firstString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function splitName(name: string) {
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
function deriveConfidenceTier(raw: Record<string, unknown> | undefined, confidenceScore: number): 'high' | 'medium' | 'low' {
  const stored = raw?.confidenceTier;
  if (stored === 'high' || stored === 'medium' || stored === 'low') return stored;
  if (confidenceScore >= 8) return 'high';
  if (confidenceScore >= 6) return 'medium';
  return 'low';
}

function mapPersistedCandidate(row: PersistedContactCandidateRow) {
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

async function fetchInternalContactCandidates(
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

async function buildContactIntelligenceResult(
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

type PersistedContactIntelligence = {
  company: Record<string, any> | null;
  contactCandidates: ReturnType<typeof mapPersistedCandidate>[];
  discoveryRuns: Record<string, any>[];
};

async function fetchPersistedContactIntelligence(
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

async function withPersistedContactIntelligence(
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
async function fetchInternalContactCandidatesBatch(
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
async function fetchPersistedContactIntelligenceBatch(
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

async function persistContactIntelligenceSnapshot(tenantId: string, userId: string | undefined, companyId: string) {
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

async function countPaidDiscoveryRunsInCooldown(
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

async function buildContactDiscoveryInput(
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

async function buildContactDiscoveryCostGuard(
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

async function buildContactDiscoveryCostControls(
  tenantId: string,
  userId: string | null | undefined,
  companyId = 'tenant-summary',
) {
  return {
    ...getWizmatchContactDiscoveryConfig(),
    costGuard: await buildContactDiscoveryCostGuard(tenantId, userId, companyId),
  };
}

async function insertContactDiscoveryRunAudit(input: {
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

async function withContactDiscoveryAdvisoryLock<T>(
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

async function fetchContactIntelligenceCompanyRows(tenantId: string, limit: number, companyId?: string) {
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

async function fetchCommandCenterSignals(tenantId: string, limit: number): Promise<CommandCenterSignalInput[]> {
  const result = await pool.query(
    `SELECT s.id,
            s.job_title,
            s.company_id,
            c.name AS company_name,
            c.domain AS company_domain,
            c.industry AS company_industry,
            c.country AS company_country,
            c.is_prime,
            s.source,
            s.location,
            s.status,
            s.score,
            s.days_open,
            COALESCE(cardinality(s.matched_candidate_ids), 0)::int AS matched_candidate_count,
            dh.status AS domain_status,
            (SELECT COUNT(*)::int
             FROM wizmatch_suppression_list ws
             WHERE ws.tenant_id = s.tenant_id
               AND c.domain IS NOT NULL
               AND LOWER(SPLIT_PART(COALESCE(ws.email, ''), '@', 2)) = LOWER(c.domain)) AS suppressed_count
     FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id
     LEFT JOIN wizmatch_domain_health dh ON dh.tenant_id = s.tenant_id AND dh.domain = c.domain
     WHERE s.tenant_id = $1
       AND s.status NOT IN ('dead', 'placed')
     ORDER BY COALESCE(s.score, 0) DESC, COALESCE(cardinality(s.matched_candidate_ids), 0) DESC, s.created_at DESC
     LIMIT $2`,
    [tenantId, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    jobTitle: row.job_title,
    companyId: row.company_id,
    companyName: row.company_name,
    companyDomain: row.company_domain,
    companyIndustry: row.company_industry,
    companyCountry: row.company_country,
    isPrime: row.is_prime,
    source: row.source,
    location: row.location,
    status: row.status,
    score: numeric(row.score),
    daysOpen: numeric(row.days_open),
    matchedCandidateCount: numeric(row.matched_candidate_count),
    domainStatus: row.domain_status,
    suppressedCount: numeric(row.suppressed_count),
  }));
}

async function fetchCommandCenterCandidates(tenantId: string, limit: number): Promise<CommandCenterCandidateInput[]> {
  const result = await pool.query(
    `SELECT wc.id,
            TRIM(CONCAT(c.first_name, ' ', COALESCE(c.last_name, ''))) AS name,
            wc.skills,
            wc.location,
            wc.visa_status,
            wc.rate_hourly,
            wc.rate_currency,
            wc.availability_status,
            wc.source,
            wc.is_wizmatch_certified
     FROM wizmatch_candidates wc
     JOIN contacts c ON c.id = wc.contact_id
     WHERE wc.tenant_id = $1
     ORDER BY CASE WHEN wc.availability_status = 'available' THEN 0 ELSE 1 END,
              wc.is_wizmatch_certified DESC,
              wc.updated_at DESC
     LIMIT $2`,
    [tenantId, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name || 'Unknown candidate',
    skills: row.skills ?? [],
    location: row.location,
    visaStatus: row.visa_status,
    rateHourly: numeric(row.rate_hourly),
    rateCurrency: row.rate_currency,
    availabilityStatus: row.availability_status,
    source: row.source,
    isWizmatchCertified: row.is_wizmatch_certified,
  }));
}

async function fetchCommandCenterRequirements(tenantId: string, limit: number): Promise<CommandCenterRequirementInput[]> {
  const result = await pool.query(
    `SELECT r.id,
            r.title,
            comp.name AS company_name,
            r.required_skills,
            r.location,
            r.region,
            r.priority,
            r.positions,
            r.status,
            r.budget_min,
            r.budget_max,
            r.budget_currency
     FROM wizmatch_requirements r
     LEFT JOIN wizmatch_companies comp ON comp.id = r.company_id AND comp.tenant_id = r.tenant_id
     WHERE r.tenant_id = $1
       AND r.status <> 'closed'
     ORDER BY CASE r.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
              r.updated_at DESC
     LIMIT $2`,
    [tenantId, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    companyName: row.company_name,
    requiredSkills: row.required_skills ?? [],
    location: row.location,
    region: row.region,
    priority: row.priority,
    positions: numeric(row.positions),
    status: row.status,
    budgetMin: numeric(row.budget_min),
    budgetMax: numeric(row.budget_max),
    budgetCurrency: row.budget_currency,
  }));
}

function mapClientDiscoveryRow(row: ClientDiscoverySignalRow): ClientDiscoveryInput {
  return {
    id: row.id,
    jobTitle: row.job_title,
    companyId: row.company_id,
    companyName: row.company_name,
    companyDomain: row.company_domain,
    companyIndustry: row.company_industry,
    companyCountry: row.company_country,
    isPrime: row.is_prime,
    primeMsaStatus: row.prime_msa_status,
    h1bSponsorCount: numeric(row.h1b_sponsor_count),
    source: row.source,
    location: row.location,
    status: row.status,
    signalScore: numeric(row.signal_score),
    daysOpen: numeric(row.days_open),
    repostCount: numeric(row.repost_count),
    matchedCandidateCount: numeric(row.matched_candidate_count),
    activeSignalCount: numeric(row.active_signal_count),
    positiveReplyCount: numeric(row.positive_reply_count),
    placementCount: numeric(row.placement_count),
    domainStatus: row.domain_status,
    suppressedCount: numeric(row.suppressed_count),
    activeDuplicateCount: numeric(row.active_duplicate_count),
  };
}

async function fetchClientDiscoverySignals(tenantId: string, limit: number, companyId?: string) {
  const params: unknown[] = [tenantId];
  let companyFilter = '';
  if (companyId) {
    params.push(companyId);
    companyFilter = `AND s.company_id = $${params.length}`;
  }
  params.push(limit);

  const result = await pool.query(
    `SELECT s.id,
            s.job_title,
            s.company_id,
            c.name AS company_name,
            c.domain AS company_domain,
            c.industry AS company_industry,
            c.country AS company_country,
            c.is_prime,
            c.prime_msa_status,
            c.h1b_sponsor_count,
            s.source,
            s.location,
            s.status,
            s.score AS signal_score,
            s.days_open,
            s.repost_count,
            COALESCE(cardinality(s.matched_candidate_ids), 0)::int AS matched_candidate_count,
            (SELECT COUNT(*)::int
             FROM wizmatch_job_signals s2
             WHERE s2.tenant_id = s.tenant_id AND s2.company_id = s.company_id AND s2.status NOT IN ('dead', 'placed')) AS active_signal_count,
            (SELECT COUNT(*)::int
             FROM wizmatch_job_signals s3
             WHERE s3.tenant_id = s.tenant_id AND s3.company_id = s.company_id AND s3.status = 'replied_positive') AS positive_reply_count,
            (SELECT COUNT(*)::int
             FROM wizmatch_placements wp
             WHERE wp.tenant_id = s.tenant_id AND (wp.company_id = s.company_id OR wp.prime_company_id = s.company_id)) AS placement_count,
            dh.status AS domain_status,
            (SELECT COUNT(*)::int
             FROM wizmatch_suppression_list ws
             WHERE ws.tenant_id = s.tenant_id
               AND c.domain IS NOT NULL
               AND LOWER(SPLIT_PART(COALESCE(ws.email, ''), '@', 2)) = LOWER(c.domain)) AS suppressed_count,
            (SELECT COUNT(*)::int
             FROM wizmatch_job_signals s4
             WHERE s4.tenant_id = s.tenant_id
               AND s4.company_id = s.company_id
               AND s4.status IN ('drafted', 'sent')) AS active_duplicate_count
     FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id
     LEFT JOIN wizmatch_domain_health dh ON dh.tenant_id = s.tenant_id AND dh.domain = c.domain
     WHERE s.tenant_id = $1
       AND s.status NOT IN ('dead', 'placed')
       ${companyFilter}
     ORDER BY COALESCE(s.score, 0) DESC,
              COALESCE(cardinality(s.matched_candidate_ids), 0) DESC,
              s.created_at DESC
     LIMIT $${params.length}`,
    params,
  );

  return (result.rows as ClientDiscoverySignalRow[]).map(mapClientDiscoveryRow);
}

function mapCandidateRequirement(row: CandidateRequirementRow): CandidateRequirementInput {
  return {
    id: row.id,
    title: row.title,
    companyName: row.company_name,
    requiredSkills: row.required_skills ?? [],
    location: row.location,
    region: row.region,
    workMode: row.work_mode,
    budgetMin: numeric(row.budget_min),
    budgetMax: numeric(row.budget_max),
    budgetCurrency: row.budget_currency,
    priority: row.priority,
    status: row.status,
  };
}

function mapCandidateSignal(row: CandidateSignalRow): CandidateSignalInput {
  return {
    id: row.id,
    jobTitle: row.job_title,
    companyName: row.company_name,
    keywords: row.keywords ?? [],
    location: row.location,
    score: numeric(row.score),
    status: row.status,
  };
}

function mapCandidateIntelligenceRow(
  row: CandidateIntelligenceRow,
  requirements: CandidateRequirementInput[],
  signals: CandidateSignalInput[],
): CandidateIntelligenceInput {
  return {
    id: row.id,
    contactId: row.contact_id,
    name: row.name || 'Unknown candidate',
    skills: row.skills ?? [],
    location: row.location,
    visaStatus: row.visa_status,
    rateHourly: numeric(row.rate_hourly),
    rateCurrency: row.rate_currency,
    availabilityDate: row.availability_date,
    availabilityStatus: row.availability_status,
    source: row.source,
    linkedinUrl: row.linkedin_url,
    githubUrl: row.github_url,
    resumeUrl: row.resume_url,
    isWizmatchCertified: row.is_wizmatch_certified,
    hasUsableContactChannel: Boolean(row.has_email || row.has_phone || row.linkedin_url),
    doNotContact: row.contact_do_not_contact,
    suppressed: row.is_suppressed,
    activePlacementCount: numeric(row.active_placement_count),
    activeSubmissionCount: numeric(row.active_submission_count),
    priorPlacementCount: numeric(row.prior_placement_count),
    requirements,
    signals,
  };
}

async function fetchCandidateIntelligenceRequirements(tenantId: string, limit: number, requirementId?: string) {
  const params: unknown[] = [tenantId];
  let requirementFilter = '';
  if (requirementId) {
    params.push(requirementId);
    requirementFilter = `AND r.id = $${params.length}`;
  }
  params.push(limit);
  const result = await pool.query(
    `SELECT r.id,
            r.title,
            comp.name AS company_name,
            r.required_skills,
            r.location,
            r.region,
            r.work_mode,
            r.budget_min,
            r.budget_max,
            r.budget_currency,
            r.priority,
            r.status,
            ci.qualification_tier AS company_tier
     FROM wizmatch_requirements r
     LEFT JOIN wizmatch_companies comp ON comp.id = r.company_id AND comp.tenant_id = r.tenant_id
     LEFT JOIN wizmatch_company_intelligence ci
       ON ci.company_id = r.company_id AND ci.tenant_id = r.tenant_id
     WHERE r.tenant_id = $1
       AND r.status <> 'closed'
       ${requirementFilter}
     ORDER BY CASE r.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
              r.updated_at DESC
     LIMIT $${params.length}`,
    params,
  );
  // Account-quality priority scoring (see wizmatchRequirementPriority.scoreRequirementPriority)
  // needs the client's qualification tier; carry it alongside the standard mapped fields
  // without touching the shared CandidateRequirementRow/mapCandidateRequirement contract.
  return (result.rows as (CandidateRequirementRow & { company_tier: string | null })[]).map((row) => ({
    ...mapCandidateRequirement(row),
    companyTier: row.company_tier ?? null,
  }));
}

async function fetchCandidateIntelligenceSignals(tenantId: string, limit: number) {
  const result = await pool.query(
    `SELECT s.id,
            s.job_title,
            comp.name AS company_name,
            s.keywords,
            s.location,
            s.score,
            s.status
     FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies comp ON comp.id = s.company_id
     WHERE s.tenant_id = $1
       AND s.status NOT IN ('dead', 'placed')
     ORDER BY COALESCE(s.score, 0) DESC, s.created_at DESC
     LIMIT $2`,
    [tenantId, limit],
  );
  return (result.rows as CandidateSignalRow[]).map(mapCandidateSignal);
}

async function fetchCandidateIntelligenceInputs(tenantId: string, limit: number, candidateId?: string) {
  const [requirements, signals] = await Promise.all([
    fetchCandidateIntelligenceRequirements(tenantId, 30),
    fetchCandidateIntelligenceSignals(tenantId, 30),
  ]);

  const params: unknown[] = [tenantId];
  let candidateFilter = '';
  if (candidateId) {
    params.push(candidateId);
    candidateFilter = `AND wc.id = $${params.length}`;
  }
  params.push(limit);

  const result = await pool.query(
    `SELECT wc.id,
            wc.contact_id,
            TRIM(CONCAT(c.first_name, ' ', COALESCE(c.last_name, ''))) AS name,
            wc.skills,
            wc.location,
            wc.visa_status,
            wc.rate_hourly,
            wc.rate_currency,
            wc.availability_date,
            wc.availability_status,
            wc.source,
            wc.linkedin_url,
            wc.github_url,
            wc.resume_url,
            wc.is_wizmatch_certified,
            c.do_not_contact AS contact_do_not_contact,
            EXISTS (
              SELECT 1 FROM contact_channels cc
              WHERE cc.contact_id = c.id AND cc.channel_type = 'email'
            ) AS has_email,
            EXISTS (
              SELECT 1 FROM contact_channels cc
              WHERE cc.contact_id = c.id AND cc.channel_type IN ('phone', 'whatsapp')
            ) AS has_phone,
            EXISTS (
              SELECT 1 FROM wizmatch_suppression_list ws
              WHERE ws.tenant_id = wc.tenant_id AND ws.contact_id = c.id
            ) AS is_suppressed,
            (SELECT COUNT(*)::int
             FROM wizmatch_placements wp
             WHERE wp.tenant_id = wc.tenant_id AND wp.candidate_id = wc.id AND wp.status IN ('submitted', 'interviewing', 'offered', 'started')) AS active_placement_count,
            (SELECT COUNT(*)::int
             FROM wizmatch_placements wp
             WHERE wp.tenant_id = wc.tenant_id AND wp.candidate_id = wc.id AND wp.status IN ('submitted', 'interviewing')) AS active_submission_count,
            (SELECT COUNT(*)::int
             FROM wizmatch_placements wp
             WHERE wp.tenant_id = wc.tenant_id AND wp.candidate_id = wc.id AND wp.status IN ('started', 'ended')) AS prior_placement_count
     FROM wizmatch_candidates wc
     JOIN contacts c ON c.id = wc.contact_id
     WHERE wc.tenant_id = $1
       ${candidateFilter}
     ORDER BY CASE WHEN wc.availability_status = 'available' THEN 0 ELSE 1 END,
              wc.is_wizmatch_certified DESC,
              wc.updated_at DESC
     LIMIT $${params.length}`,
    params,
  );

  return (result.rows as CandidateIntelligenceRow[]).map((row) =>
    mapCandidateIntelligenceRow(row, requirements, signals),
  );
}

function candidateProfileToIntelligenceInput(
  profile: CandidateIntakeProfile,
  options: {
    id: string;
    contactId?: string | null;
    requirements: CandidateRequirementInput[];
    signals: CandidateSignalInput[];
  },
): CandidateIntelligenceInput {
  return {
    id: options.id,
    contactId: options.contactId,
    name: profile.name,
    skills: profile.skills,
    location: profile.location,
    visaStatus: profile.visaStatus,
    rateHourly: profile.rateHourly,
    rateCurrency: profile.rateCurrency,
    availabilityDate: profile.availabilityDate,
    availabilityStatus: profile.availabilityStatus,
    source: profile.source,
    linkedinUrl: profile.linkedinUrl,
    githubUrl: profile.githubUrl,
    resumeUrl: profile.resumeUrl,
    hasUsableContactChannel: Boolean(profile.email || profile.phone || profile.linkedinUrl),
    requirements: options.requirements,
    signals: options.signals,
  };
}

async function fetchCommandCenterMetrics(tenantId: string): Promise<Omit<CommandCenterMetricsInput, 'reviewReadyCompanies' | 'blockedCompanies'>> {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int
        FROM wizmatch_job_signals
        WHERE tenant_id = $1 AND status NOT IN ('dead', 'placed')) AS active_signals,
       (SELECT COUNT(*)::int
        FROM wizmatch_job_signals
        WHERE tenant_id = $1 AND status NOT IN ('dead', 'placed') AND COALESCE(score, 0) >= 7) AS priority_signals,
       (SELECT COUNT(*)::int
        FROM wizmatch_candidates
        WHERE tenant_id = $1 AND availability_status = 'available') AS available_candidates,
       (SELECT COUNT(*)::int
        FROM wizmatch_requirements
        WHERE tenant_id = $1 AND status <> 'closed') AS open_requirements,
       (SELECT COUNT(*)::int
        FROM wizmatch_placements
        WHERE tenant_id = $1 AND status IN ('submitted', 'interviewing', 'offered', 'started')) AS active_placements,
       (SELECT COUNT(*)::int
        FROM wizmatch_domain_health
        WHERE tenant_id = $1 AND status IN ('paused', 'blacklisted')) AS paused_domains,
       (SELECT COUNT(*)::int
        FROM wizmatch_suppression_list
        WHERE tenant_id = $1) AS suppressed_contacts`,
    [tenantId],
  );
  const row = (result.rows[0] ?? {}) as CommandCenterMetricsRow;
  return {
    activeSignals: numeric(row.active_signals),
    prioritySignals: numeric(row.priority_signals),
    availableCandidates: numeric(row.available_candidates),
    openRequirements: numeric(row.open_requirements),
    activePlacements: numeric(row.active_placements),
    pausedDomains: numeric(row.paused_domains),
    suppressedContacts: numeric(row.suppressed_contacts),
  };
}

// ============================================================
// SECTION -2 — CLIENT DISCOVERY / COMPANY SIGNALS ROUTES
// ============================================================

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

type SeedProspectInput = {
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

type SeedProspectResult = {
  companyId: string;
  companyExisted: boolean;
  signalId: string;
  intelligenceItem: Awaited<ReturnType<typeof persistContactIntelligenceSnapshot>>;
};

async function seedProspectCompany(input: SeedProspectInput): Promise<SeedProspectResult> {
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

// POST /api/wizmatch/client-discovery/seed-company
// Manual entry point: creates (or updates) a prospect hiring company + a manual
// job signal, then runs the Contact Intelligence snapshot so the company appears
// in the Contact Intelligence queue for review. Does NOT send any outreach —
// paid contact discovery still requires a separate manual confirm step.
router.post('/client-discovery/seed-company', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user?.id;

  const companyName = firstString(req.body?.companyName);
  const jobTitle = firstString(req.body?.jobTitle);
  if (!companyName || !jobTitle) {
    res.status(400).json({ error: 'companyName and jobTitle are required' });
    return;
  }

  const website = firstString(req.body?.website);
  const domain = normalizeDomain(website ?? firstString(req.body?.domain));
  const targetRegionRaw = firstString(req.body?.targetRegion)?.toLowerCase();
  const targetRegion =
    targetRegionRaw === 'india' || targetRegionRaw === 'us' ? targetRegionRaw : null;

  const rawKeywords = Array.isArray(req.body?.keywords)
    ? (req.body.keywords as unknown[]).filter((k): k is string => typeof k === 'string')
    : null;
  const keywords =
    rawKeywords && rawKeywords.length > 0
      ? rawKeywords.slice(0, 8)
      : jobTitle.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);

  const employeeCountRaw = req.body?.employeeCount;
  const employeeCount =
    employeeCountRaw != null && Number.isFinite(Number(employeeCountRaw))
      ? Math.max(0, Math.floor(Number(employeeCountRaw)))
      : null;

  try {
    const result = await seedProspectCompany({
      tenantId,
      userId,
      companyName,
      domain,
      jobTitle,
      jobUrl: firstString(req.body?.jobUrl),
      location: firstString(req.body?.location),
      notes: firstString(req.body?.notes),
      targetRegion,
      industry: firstString(req.body?.industry),
      employeeCount,
      linkedinUrl: firstString(req.body?.linkedinUrl),
      keywords,
    });
    res.json({
      ok: true,
      ...result,
      guardrails: CLIENT_DISCOVERY_GUARDRAILS,
    });
  } catch (err) {
    logger.error({ err, tenantId, companyName }, '[wizmatch/seed-company] failed');
    res.status(500).json({
      error: 'Failed to seed prospect company',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

// POST /api/wizmatch/client-discovery/seed-company/csv
// Bulk manual seed via CSV upload. Expected headers:
//   company_name (required), job_title (required),
//   website | domain, job_url, location, notes,
//   target_region, industry, employee_count, linkedin_url, keywords
// Duplicate company names (case-insensitive per tenant) update the existing row
// with any new non-null fields; a fresh manual job signal is still inserted so
// the company re-enters the Contact Intelligence review queue.
router.post(
  '/client-discovery/seed-company/csv',
  requirementUpload.single('file'),
  async (req: Request, res: Response) => {
    const tenantId = req.user!.tenantId;
    const userId = req.user?.id;

    let csvText = '';
    if (req.file?.buffer) {
      csvText = req.file.buffer.toString('utf8');
    } else if (typeof req.body === 'string') {
      csvText = req.body;
    } else if (req.body && typeof req.body === 'object' && 'csv' in req.body) {
      csvText = String((req.body as { csv?: string }).csv ?? '');
    }
    if (!csvText.trim()) {
      res.status(400).json({ error: 'CSV body required (multipart field "file" or { csv } body)' });
      return;
    }

    let rows: string[][];
    try {
      rows = parseCsv(csvText);
    } catch (err) {
      res.status(400).json({ error: 'CSV parse failed', detail: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (rows.length < 2) {
      res.status(400).json({ error: 'CSV must have a header row and at least one data row' });
      return;
    }

    const [headerRow, ...dataRows] = rows;
    const normHeader = headerRow.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const idxOf = (key: string, aliases: string[] = []): number => {
      const all = [key, ...aliases];
      for (const k of all) {
        const i = normHeader.indexOf(k);
        if (i >= 0) return i;
      }
      return -1;
    };
    const columns = {
      name: idxOf('company_name', ['name', 'company']),
      jobTitle: idxOf('job_title', ['title', 'role']),
      website: idxOf('website', ['url', 'domain']),
      jobUrl: idxOf('job_url'),
      location: idxOf('location', ['city']),
      notes: idxOf('notes'),
      region: idxOf('target_region', ['region']),
      industry: idxOf('industry'),
      employees: idxOf('employee_count', ['employees', 'size']),
      linkedin: idxOf('linkedin_url', ['linkedin']),
      keywords: idxOf('keywords', ['tags']),
    };
    if (columns.name < 0 || columns.jobTitle < 0) {
      res.status(400).json({
        error: 'CSV missing required columns',
        required: ['company_name', 'job_title'],
        received: headerRow,
      });
      return;
    }

    const summary = {
      total_rows: dataRows.length,
      inserted: 0,
      updated: 0,
      skipped_invalid: 0,
      errors: [] as Array<{ row: number; reason: string }>,
      seeded: [] as Array<{ row: number; companyId: string; companyName: string; signalId: string }>,
    };

    for (let i = 0; i < dataRows.length; i += 1) {
      const r = dataRows[i];
      const lineNo = i + 2;
      const get = (col: number): string | null => {
        if (col < 0) return null;
        const raw = r[col];
        if (raw == null) return null;
        const s = String(raw).trim();
        return s.length > 0 ? s : null;
      };

      const companyName = get(columns.name);
      const jobTitle = get(columns.jobTitle);
      if (!companyName || !jobTitle) {
        summary.skipped_invalid += 1;
        summary.errors.push({ row: lineNo, reason: 'missing company_name or job_title' });
        continue;
      }

      const targetRegionRaw = get(columns.region)?.toLowerCase() || null;
      const targetRegion =
        targetRegionRaw === 'india' || targetRegionRaw === 'us' ? targetRegionRaw : null;

      const employeesRaw = get(columns.employees);
      const employeeCount =
        employeesRaw && Number.isFinite(Number(employeesRaw))
          ? Math.max(0, Math.floor(Number(employeesRaw)))
          : null;

      const keywordsRaw = get(columns.keywords);
      const keywords =
        keywordsRaw
          ? keywordsRaw.split(/[|,;]/).map((k) => k.trim()).filter(Boolean).slice(0, 8)
          : jobTitle.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);

      try {
        const result = await seedProspectCompany({
          tenantId,
          userId,
          companyName,
          domain: normalizeDomain(get(columns.website)),
          jobTitle,
          jobUrl: get(columns.jobUrl),
          location: get(columns.location),
          notes: get(columns.notes),
          targetRegion,
          industry: get(columns.industry),
          employeeCount,
          linkedinUrl: get(columns.linkedin),
          keywords,
        });
        if (result.companyExisted) summary.updated += 1;
        else summary.inserted += 1;
        summary.seeded.push({
          row: lineNo,
          companyId: result.companyId,
          companyName,
          signalId: result.signalId,
        });
      } catch (err) {
        summary.skipped_invalid += 1;
        summary.errors.push({
          row: lineNo,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    res.json({ ok: true, summary, guardrails: CLIENT_DISCOVERY_GUARDRAILS });
  },
);

router.get('/client-discovery/queue', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const [rows, totalResult] = await Promise.all([
    fetchClientDiscoverySignals(tenantId, limit),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM wizmatch_job_signals
       WHERE tenant_id = $1 AND status NOT IN ('dead', 'placed')`,
      [tenantId],
    ),
  ]);
  const items = rankClientDiscoveryQueue(rows);
  const selected = selectCompaniesForContactIntelligence(items);

  res.json({
    items,
    total: numeric(totalResult.rows[0]?.total),
    returned: items.length,
    selectedForContactIntelligence: selected.length,
    guardrails: CLIENT_DISCOVERY_GUARDRAILS,
  });
});

router.get('/client-discovery/companies/:companyId', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const rows = await fetchClientDiscoverySignals(tenantId, 25, String(req.params.companyId));
  if (rows.length === 0) {
    res.status(404).json({ error: 'Client discovery company not found' });
    return;
  }
  const signals = rankClientDiscoveryQueue(rows);
  res.json({
    companyId: String(req.params.companyId),
    companyName: signals[0]?.companyName,
    companyDomain: signals[0]?.companyDomain,
    bestSignal: signals[0],
    signals,
    guardrails: CLIENT_DISCOVERY_GUARDRAILS,
  });
});

router.post('/client-discovery/companies/:companyId/qualify', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const rows = await fetchClientDiscoverySignals(tenantId, 25, String(req.params.companyId));
  if (rows.length === 0) {
    res.status(404).json({ error: 'Client discovery company not found' });
    return;
  }
  const results = rankClientDiscoveryQueue(rows);
  const selected = selectCompaniesForContactIntelligence(results);
  res.json({
    qualified: selected.length > 0,
    bestSignal: results[0],
    eligibleForContactIntelligence: selected.some((item) => item.companyId === String(req.params.companyId)),
    guardrails: CLIENT_DISCOVERY_GUARDRAILS,
  });
});

router.post('/client-discovery/companies/:companyId/send-to-contact-intelligence', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const companyId = String(req.params.companyId);
  const rows = await fetchClientDiscoverySignals(tenantId, 25, companyId);
  if (rows.length === 0) {
    res.status(404).json({ error: 'Client discovery company not found' });
    return;
  }
  const results = rankClientDiscoveryQueue(rows);
  const selected = selectCompaniesForContactIntelligence(results);
  if (!selected.some((item) => item.companyId === companyId)) {
    res.status(409).json({
      error: 'Company is not eligible for Contact Intelligence handoff',
      bestSignal: results[0],
      guardrails: CLIENT_DISCOVERY_GUARDRAILS,
    });
    return;
  }

  const item = await persistContactIntelligenceSnapshot(tenantId, req.user?.id, companyId);
  if (!item) {
    res.status(404).json({ error: 'Contact Intelligence source not found for company' });
    return;
  }
  res.json({ item, fromClientDiscovery: results[0], guardrails: CLIENT_DISCOVERY_GUARDRAILS });
});

// ============================================================
// SECTION -1 — CANDIDATE INTELLIGENCE ROUTES
// ============================================================

router.post('/candidate-intelligence/intake', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const intake = buildCandidateIntakeRequest({
    candidates: Array.isArray(req.body?.candidates) ? req.body.candidates : undefined,
    rawText: firstString(req.body?.rawText) || undefined,
  });

  if (intake.items.length === 0) {
    res.status(400).json({
      error: 'No candidate profiles found. Paste CSV text with headers or send { candidates: [...] }.',
      expectedHeaders: [
        'name',
        'email',
        'phone',
        'skills',
        'location',
        'visa_status',
        'experience_years',
        'rate_hourly',
        'rate_currency',
        'availability_status',
        'source',
        'linkedin_url',
        'github_url',
        'resume_url',
      ],
    });
    return;
  }

  const [requirements, signals] = await Promise.all([
    fetchCandidateIntelligenceRequirements(tenantId, 30),
    fetchCandidateIntelligenceSignals(tenantId, 30),
  ]);
  const preview = intake.accepted.map((profile, index) => ({
    row: index + 1,
    profile,
    score: scoreCandidateIntelligence(candidateProfileToIntelligenceInput(profile, {
      id: `preview-${index + 1}`,
      requirements,
      signals,
    })),
  }));

  const shouldWrite = req.body?.dryRun === false && req.body?.confirmImport === true;
  if (!shouldWrite) {
    res.json({
      dryRun: true,
      accepted: intake.accepted.length,
      skipped: intake.skipped.length,
      truncated: intake.truncated,
      skippedRows: intake.skipped,
      preview,
      message: 'Preview only. Send dryRun=false and confirmImport=true to create CRM contacts and Wizmatch candidate records.',
      guardrails: {
        noOutreach: true,
        noCandidateSubmission: true,
        maxProfilesPerRequest: 50,
      },
    });
    return;
  }

  const results: Array<Record<string, unknown>> = [];
  let inserted = 0;
  let duplicates = 0;
  let errors = 0;

  for (let index = 0; index < intake.accepted.length; index += 1) {
    const profile = intake.accepted[index];
    try {
      const name = splitName(profile.name);
      const channels = [
        profile.email ? { channelType: 'email', channelValue: profile.email, isPrimary: true } : null,
        profile.phone ? { channelType: 'phone', channelValue: profile.phone, isPrimary: !profile.email } : null,
        profile.linkedinUrl ? {
          channelType: 'linkedin',
          channelValue: profile.linkedinUrl,
          isPrimary: !profile.email && !profile.phone,
        } : null,
      ].filter((channel): channel is { channelType: string; channelValue: string; isPrimary: boolean } => Boolean(channel));

      const { contact, created: contactCreated } = await findOrCreateContact(tenantId, {
        firstName: name.firstName,
        lastName: name.lastName,
        source: 'wizmatch_candidate_intake',
        sourceDetail: profile.source,
        metadata: {
          wizmatch_candidate_intake: true,
          source: profile.source,
          resume_url: profile.resumeUrl,
          github_url: profile.githubUrl,
          warnings: profile.warnings,
        },
        channels,
      });

      const existing = await pool.query(
        `SELECT id
         FROM wizmatch_candidates
         WHERE tenant_id = $1 AND contact_id = $2
         LIMIT 1`,
        [tenantId, contact.id],
      );
      if (existing.rows.length > 0) {
        duplicates += 1;
        results.push({
          row: index + 1,
          status: 'duplicate',
          candidateId: existing.rows[0].id,
          contactId: contact.id,
          contactCreated,
          name: profile.name,
          message: 'Candidate already exists for this CRM contact; no duplicate profile created.',
        });
        continue;
      }

      const score = scoreCandidateIntelligence(candidateProfileToIntelligenceInput(profile, {
        id: `new-${index + 1}`,
        contactId: contact.id,
        requirements,
        signals,
      }));

      const [candidate] = await db
        .insert(wizmatchCandidates)
        .values({
          tenantId,
          contactId: contact.id,
          skills: profile.skills,
          location: profile.location,
          visaStatus: profile.visaStatus,
          experienceYears: profile.experienceYears,
          rateHourly: profile.rateHourly,
          rateCurrency: profile.rateCurrency,
          availabilityDate: profile.availabilityDate,
          availabilityStatus: profile.availabilityStatus,
          source: profile.source,
          linkedinUrl: profile.linkedinUrl,
          githubUrl: profile.githubUrl,
          resumeUrl: profile.resumeUrl,
          matchScore: score.score,
          indiaSpecific: {
            candidateIntake: {
              importedBy: req.user?.id || null,
              importedAt: new Date().toISOString(),
              warnings: profile.warnings,
              dryRun: false,
            },
          },
        })
        .returning();

      inserted += 1;
      results.push({
        row: index + 1,
        status: 'inserted',
        candidateId: candidate.id,
        contactId: contact.id,
        contactCreated,
        score,
        warnings: profile.warnings,
      });
    } catch (error) {
      errors += 1;
      logger.error({ err: error }, '[wizmatch] candidate intelligence intake error');
      results.push({
        row: index + 1,
        status: 'error',
        name: profile.name,
        message: error instanceof Error ? error.message : 'Candidate intake failed',
      });
    }
  }

  res.status(201).json({
    dryRun: false,
    accepted: intake.accepted.length,
    inserted,
    duplicates,
    skipped: intake.skipped.length,
    errors,
    truncated: intake.truncated,
    skippedRows: intake.skipped,
    results,
    message: 'Candidate intake completed. No outreach, submission, placement, provider enrichment, or paid action was performed.',
    guardrails: {
      noOutreach: true,
      noCandidateSubmission: true,
      noPaidEnrichment: true,
    },
  });
});

router.get('/candidate-intelligence/queue', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const [inputs, totalResult] = await Promise.all([
    fetchCandidateIntelligenceInputs(tenantId, limit),
    pool.query('SELECT COUNT(*)::int AS total FROM wizmatch_candidates WHERE tenant_id = $1', [tenantId]),
  ]);
  const items = rankCandidateIntelligenceQueue(inputs);
  res.json({
    items,
    total: numeric(totalResult.rows[0]?.total),
    returned: items.length,
    guardrails: CANDIDATE_INTELLIGENCE_GUARDRAILS,
  });
});

router.get('/candidate-intelligence/candidates/:candidateId', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const inputs = await fetchCandidateIntelligenceInputs(tenantId, 1, String(req.params.candidateId));
  if (inputs.length === 0) {
    res.status(404).json({ error: 'Candidate intelligence record not found' });
    return;
  }
  res.json({
    item: scoreCandidateIntelligence(inputs[0]),
    guardrails: CANDIDATE_INTELLIGENCE_GUARDRAILS,
  });
});

router.get('/candidate-intelligence/requirements/:requirementId/matches', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const [requirements, candidates] = await Promise.all([
    fetchCandidateIntelligenceRequirements(tenantId, 1, String(req.params.requirementId)),
    fetchCandidateIntelligenceInputs(tenantId, Math.min(Number(req.query.limit) || 50, 100)),
  ]);
  if (requirements.length === 0) {
    res.status(404).json({ error: 'Requirement not found' });
    return;
  }
  const matches = rankCandidatesForRequirement(requirements[0], candidates);
  res.json({
    requirement: requirements[0],
    matches,
    total: matches.length,
    guardrails: CANDIDATE_INTELLIGENCE_GUARDRAILS,
  });
});

router.post('/candidate-intelligence/candidates/:candidateId/review', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const action = firstString(req.body?.action) || 'mark_reviewed';
  const notes = firstString(req.body?.notes);
  const allowedActions = new Set(['mark_reviewed', 'shortlist', 'watch', 'reject', 'block']);
  if (!allowedActions.has(action)) {
    res.status(400).json({ error: 'Unsupported candidate review action' });
    return;
  }
  const inputs = await fetchCandidateIntelligenceInputs(tenantId, 1, String(req.params.candidateId));
  if (inputs.length === 0) {
    res.status(404).json({ error: 'Candidate intelligence record not found' });
    return;
  }
  const item = scoreCandidateIntelligence(inputs[0]);
  if (item.priority === 'blocked' && action !== 'block' && action !== 'reject') {
    res.status(409).json({
      error: 'Blocked candidates can only be blocked or rejected until blockers are resolved',
      item,
      guardrails: CANDIDATE_INTELLIGENCE_GUARDRAILS,
    });
    return;
  }
  const reviewState = {
    candidateIntelligenceReview: {
      action,
      notes,
      reviewedBy: req.user?.id || null,
      reviewedAt: new Date().toISOString(),
      score: item.score,
      priority: item.priority,
      topRequirementId: item.topRequirementMatches[0]?.requirementId || null,
      guardrails: CANDIDATE_INTELLIGENCE_GUARDRAILS,
    },
  };
  await pool.query(
    `UPDATE wizmatch_candidates
     SET india_specific = COALESCE(india_specific, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE tenant_id = $2 AND id = $3`,
    [JSON.stringify(reviewState), tenantId, String(req.params.candidateId)],
  );
  res.json({
    persisted: true,
    action,
    notes,
    item,
    reviewState: reviewState.candidateIntelligenceReview,
    message: 'Candidate Intelligence review intent was persisted. No outreach, submission, or placement state was changed.',
    guardrails: CANDIDATE_INTELLIGENCE_GUARDRAILS,
  });
});

// ============================================================
// SECTION -1A — REQUIREMENT PRIORITY / REVIEW PLANNING ROUTES
// ============================================================

async function buildRequirementPriorityInputs(
  tenantId: string,
  limit: number,
  requirementId?: string,
): Promise<RequirementPriorityInput[]> {
  const [requirements, candidates, contactStats] = await Promise.all([
    fetchCandidateIntelligenceRequirements(tenantId, limit, requirementId),
    fetchCandidateIntelligenceInputs(tenantId, 100),
    fetchOptionalContactIntelligenceRoiStats(tenantId),
  ]);

  return requirements.map((requirement) => ({
    ...requirement,
    companyTier: requirement.companyTier ?? null,
    candidateMatches: candidates,
    contactApprovedCount: contactStats.contactsApproved,
    contactBlockedCount: contactStats.paidRunsBlocked,
  }));
}

router.get('/requirement-priority/queue', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const [inputs, totalResult] = await Promise.all([
    buildRequirementPriorityInputs(tenantId, limit),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM wizmatch_requirements
       WHERE tenant_id = $1 AND status <> 'closed'`,
      [tenantId],
    ),
  ]);
  const items = rankRequirementPriorityQueue(inputs);
  res.json({
    items,
    total: numeric(totalResult.rows[0]?.total),
    returned: items.length,
    guardrails: REQUIREMENT_PRIORITY_GUARDRAILS,
  });
});

router.post('/requirement-priority/:requirementId/review-plan', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const action = firstString(req.body?.action) || 'review_candidates';
  const notes = firstString(req.body?.notes);
  const inputs = await buildRequirementPriorityInputs(tenantId, 1, String(req.params.requirementId));
  if (inputs.length === 0) {
    res.status(404).json({ error: 'Requirement not found' });
    return;
  }
  const item = scoreRequirementPriority(inputs[0]);
  const plan = await wizmatchStaffingService.createReviewPlan(
    { tenantId, userId: req.user!.id },
    String(req.params.requirementId),
    { action, notes, dueAt: req.body?.dueAt },
  );
  res.json({
    persisted: true,
    action,
    notes,
    item,
    task: plan.task,
    nextActionUpdated: plan.nextActionUpdated,
    message: plan.nextActionUpdated
      ? 'Review plan saved as a linked task and dated next action. No candidate submission or outreach was performed.'
      : 'Review plan saved as a linked task. Add a due date to make it the requirement next action. No candidate submission or outreach was performed.',
    guardrails: REQUIREMENT_PRIORITY_GUARDRAILS,
  });
});

// ============================================================
// SECTION -1B — UNIFIED REVIEW WORKBENCH / SAFETY CENTER ROUTES
// ============================================================

const REVIEW_WORKBENCH_SOURCE_LIMIT = 75;

async function buildReviewWorkbenchPayload(tenantId: string) {
  const [
    contactRows,
    clientRows,
    candidateInputs,
    requirementInputs,
    baseMetrics,
    contactStats,
  ] = await Promise.all([
    optionalWizmatchValue('workbench contact intelligence companies', () => fetchContactIntelligenceCompanyRows(tenantId, REVIEW_WORKBENCH_SOURCE_LIMIT), [] as ContactIntelligenceCompanyRow[]),
    optionalWizmatchValue('workbench client discovery signals', () => fetchClientDiscoverySignals(tenantId, REVIEW_WORKBENCH_SOURCE_LIMIT), [] as ClientDiscoveryInput[]),
    optionalWizmatchValue('workbench candidate intelligence inputs', () => fetchCandidateIntelligenceInputs(tenantId, REVIEW_WORKBENCH_SOURCE_LIMIT), [] as CandidateIntelligenceInput[], ['wizmatch_requirements']),
    optionalWizmatchValue('workbench requirement priority inputs', () => buildRequirementPriorityInputs(tenantId, REVIEW_WORKBENCH_SOURCE_LIMIT), [] as RequirementPriorityInput[], [
      'wizmatch_requirements',
      'wizmatch_company_intelligence',
      'wizmatch_contact_candidates',
      'wizmatch_discovery_runs',
    ]),
    optionalWizmatchValue('workbench command center metrics', () => fetchCommandCenterMetrics(tenantId), {
      activeSignals: 0,
      prioritySignals: 0,
      availableCandidates: 0,
      openRequirements: 0,
      activePlacements: 0,
      pausedDomains: 0,
      suppressedContacts: 0,
    }, ['wizmatch_requirements']),
    fetchOptionalContactIntelligenceRoiStats(tenantId),
  ]);

  const computedContactIntelligence = await Promise.all(
    contactRows.map((row) => buildContactIntelligenceResult(tenantId, row)),
  );
  const contactIntelligence = await Promise.all(
    computedContactIntelligence.map((item) => withPersistedContactIntelligence(tenantId, item)),
  );

  return buildWizmatchReviewWorkbench({
    clientDiscovery: rankClientDiscoveryQueue(clientRows),
    contactIntelligence,
    candidates: rankCandidateIntelligenceQueue(candidateInputs),
    requirements: rankRequirementPriorityQueue(requirementInputs),
    metrics: {
      pausedDomains: baseMetrics.pausedDomains,
      suppressedContacts: baseMetrics.suppressedContacts,
      paidRunsBlocked: contactStats.paidRunsBlocked,
    },
  });
}

router.get('/review-workbench', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const responseLimit = Number(req.query.limit) || 30;
  const [workbench, readiness, costControls] = await Promise.all([
    buildReviewWorkbenchPayload(tenantId),
    getWizmatchReadiness(pool, tenantId),
    buildContactDiscoveryCostControls(tenantId, req.user?.id),
  ]);
  res.json({
    ...paginateWizmatchReviewWorkbench(workbench, responseLimit),
    readiness: readiness.overall,
    costControls,
  });
});

router.get('/guardrails', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const [workbench, readiness, costControls] = await Promise.all([
    buildReviewWorkbenchPayload(tenantId),
    getWizmatchReadiness(pool, tenantId),
    buildContactDiscoveryCostControls(tenantId, req.user?.id),
  ]);
  res.json({
    generatedAt: workbench.generatedAt,
    safetyCenter: workbench.safetyCenter,
    guardrails: workbench.guardrails,
    costControls,
    readiness: readiness.overall,
    rules: [
      'Paid discovery requires qualification, preview confirmation, and explicit manual execution.',
      'Manual approval is required before outreach.',
      'Candidate review persistence does not create submissions.',
      'Requirement priority planning does not change requirement status.',
      'Safety blockers must be resolved before volume increases.',
    ],
  });
});

router.get('/readiness', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const [readiness, costControls] = await Promise.all([
    getWizmatchReadiness(pool, tenantId),
    buildContactDiscoveryCostControls(tenantId, req.user?.id),
  ]);
  res.json({ ...readiness, costControls });
});

/**
 * Reuses buildWizmatchRoiAnalytics (see wizmatchRoiAnalytics.ts, also used by the
 * GET /analytics/roi route) so the AI Intelligence snapshot gets the same funnel/KPI
 * math instead of a second hand-rolled ROI calculation. Mirrors the ROI route's
 * default 30-day window. Read-only; no writes.
 */
async function buildWizmatchRoiSummaryForSnapshot(tenantId: string) {
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const toEnd = `${to} 23:59:59`;

  const [signalStats, contactIntelligence, candidateStats, requirementStats, placementStats, sourceStats] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE COALESCE(score, 0) >= 7)::int AS priority,
         COUNT(*) FILTER (WHERE LOWER(COALESCE(location, '') || ' ' || COALESCE(source, '')) LIKE ANY (ARRAY['%india%','%bangalore%','%bengaluru%','%hyderabad%','%pune%','%chennai%','%mumbai%','%delhi%','%noida%','%gurgaon%','%gurugram%']))::int AS india,
         COUNT(*) FILTER (WHERE NOT (LOWER(COALESCE(location, '') || ' ' || COALESCE(source, '')) LIKE ANY (ARRAY['%india%','%bangalore%','%bengaluru%','%hyderabad%','%pune%','%chennai%','%mumbai%','%delhi%','%noida%','%gurgaon%','%gurugram%'])))::int AS us,
         COUNT(*) FILTER (WHERE status = 'matched')::int AS matched,
         COUNT(*) FILTER (WHERE status = 'drafted')::int AS drafted,
         COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
         COUNT(*) FILTER (WHERE status = 'replied_positive')::int AS positive_replies
       FROM wizmatch_job_signals
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3`,
      [tenantId, from, toEnd],
    ),
    fetchOptionalContactIntelligenceRoiStats(tenantId),
    pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE availability_status = 'available')::int AS available,
         COUNT(*) FILTER (WHERE is_wizmatch_certified = true)::int AS certified,
         COUNT(*) FILTER (WHERE LOWER(COALESCE(location, '')) LIKE ANY (ARRAY['%india%','%bangalore%','%bengaluru%','%hyderabad%','%pune%','%chennai%','%mumbai%','%delhi%','%noida%','%gurgaon%','%gurugram%']))::int AS india,
         COUNT(*) FILTER (WHERE NOT (LOWER(COALESCE(location, '')) LIKE ANY (ARRAY['%india%','%bangalore%','%bengaluru%','%hyderabad%','%pune%','%chennai%','%mumbai%','%delhi%','%noida%','%gurgaon%','%gurugram%'])))::int AS us
       FROM wizmatch_candidates
       WHERE tenant_id = $1`,
      [tenantId],
    ),
    optionalWizmatchStatsQuery(
      'requirements ROI (ai snapshot)',
      `SELECT
         COUNT(*) FILTER (WHERE status <> 'closed')::int AS open,
         COUNT(*) FILTER (WHERE status <> 'closed' AND priority = 'urgent')::int AS urgent,
         COUNT(*) FILTER (WHERE status = 'sheet_ready')::int AS sheet_ready,
         COUNT(*) FILTER (WHERE status = 'shared')::int AS shared,
         COUNT(*) FILTER (WHERE status = 'closed')::int AS closed
       FROM wizmatch_requirements
       WHERE tenant_id = $1`,
      [tenantId],
      { open: 0, urgent: 0, sheet_ready: 0, shared: 0, closed: 0 },
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('submitted', 'interviewing', 'offered', 'started'))::int AS active,
         COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted,
         COUNT(*) FILTER (WHERE status = 'interviewing')::int AS interviewing,
         COUNT(*) FILTER (WHERE status = 'offered')::int AS offered,
         COUNT(*) FILTER (WHERE status = 'started')::int AS started,
         COUNT(*) FILTER (WHERE status = 'lost')::int AS lost,
         COALESCE(SUM(CASE WHEN status = 'started' THEN margin_hourly * 160 ELSE 0 END), 0)::int AS monthly_margin
       FROM wizmatch_placements
       WHERE tenant_id = $1`,
      [tenantId],
    ),
    pool.query(
      `SELECT source, COUNT(*)::int AS count, COALESCE(AVG(score), 0)::real AS avg_score
       FROM wizmatch_job_signals
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3
       GROUP BY source
       ORDER BY count DESC
       LIMIT 10`,
      [tenantId, from, toEnd],
    ),
  ]);

  const signalsRow = signalStats.rows[0] ?? {};
  const candidatesRow = candidateStats.rows[0] ?? {};
  const requirementsRow = requirementStats.rows[0] ?? {};
  const placementsRow = placementStats.rows[0] ?? {};

  return buildWizmatchRoiAnalytics({
    from,
    to,
    signals: {
      total: numeric(signalsRow.total),
      priority: numeric(signalsRow.priority),
      india: numeric(signalsRow.india),
      us: numeric(signalsRow.us),
      matched: numeric(signalsRow.matched),
      drafted: numeric(signalsRow.drafted),
      sent: numeric(signalsRow.sent),
      positiveReplies: numeric(signalsRow.positive_replies),
    },
    contactIntelligence,
    candidates: {
      total: numeric(candidatesRow.total),
      available: numeric(candidatesRow.available),
      certified: numeric(candidatesRow.certified),
      india: numeric(candidatesRow.india),
      us: numeric(candidatesRow.us),
    },
    requirements: {
      open: numeric(requirementsRow.open),
      urgent: numeric(requirementsRow.urgent),
      sheetReady: numeric(requirementsRow.sheet_ready),
      shared: numeric(requirementsRow.shared),
      closed: numeric(requirementsRow.closed),
    },
    placements: {
      active: numeric(placementsRow.active),
      submitted: numeric(placementsRow.submitted),
      interviewing: numeric(placementsRow.interviewing),
      offered: numeric(placementsRow.offered),
      started: numeric(placementsRow.started),
      lost: numeric(placementsRow.lost),
      monthlyMargin: numeric(placementsRow.monthly_margin),
    },
    sourceBreakdown: sourceStats.rows.map((row) => ({
      source: row.source,
      count: numeric(row.count),
      avgScore: numeric(row.avg_score),
    })),
  });
}

async function buildWizmatchDashboardSnapshot(tenantId: string, userId?: string) {
  const today = new Date().toISOString().slice(0, 10);
  const [
    readiness,
    workbench,
    costControls,
    stats,
    shared,
    topSignalsResult,
    topRequirementsResult,
    skillSupplyResult,
    companyTierResult,
    recentPlacementsResult,
    roiSummary,
  ] = await Promise.all([
    getWizmatchReadiness(pool, tenantId),
    buildReviewWorkbenchPayload(tenantId),
    buildContactDiscoveryCostControls(tenantId, userId),
    optionalWizmatchStatsQuery(
      'dashboard summary',
      `SELECT
         (SELECT COUNT(*)::int FROM wizmatch_requirements WHERE tenant_id = $1 AND status <> 'closed') AS active_requirements,
         (SELECT COUNT(*)::int FROM wizmatch_requirements WHERE tenant_id = $1 AND status <> 'closed' AND priority = 'urgent') AS urgent_requirements,
         (SELECT COUNT(*)::int FROM wizmatch_candidates WHERE tenant_id = $1 AND availability_status = 'available') AS available_candidates,
         (SELECT COUNT(*)::int FROM wizmatch_candidates WHERE tenant_id = $1) AS total_candidates,
         (SELECT COUNT(*)::int FROM wizmatch_job_signals WHERE tenant_id = $1 AND COALESCE(score, 0) >= 7) AS priority_signals,
         (SELECT COUNT(*)::int FROM wizmatch_job_signals WHERE tenant_id = $1 AND status = 'matched') AS matched_signals,
         (SELECT COUNT(*)::int FROM wizmatch_company_intelligence WHERE tenant_id = $1 AND status IN ('qualified', 'needs_review', 'ready_for_discovery', 'discovery_blocked', 'discovered')) AS qualified_companies,
         (SELECT COUNT(*)::int FROM wizmatch_contact_candidates WHERE tenant_id = $1 AND status IN ('approved', 'linked_to_crm')) AS approved_contacts,
         (SELECT COUNT(*)::int FROM wizmatch_placements WHERE tenant_id = $1 AND status IN ('submitted', 'interviewing', 'offered', 'started')) AS active_placements,
         (SELECT COALESCE(SUM(CASE WHEN status = 'started' THEN margin_hourly * 160 ELSE 0 END), 0)::int FROM wizmatch_placements WHERE tenant_id = $1) AS monthly_margin,
         (SELECT COUNT(*)::int FROM messages WHERE tenant_id = $1 AND sent_at::date = $2 AND channel = 'email' AND direction = 'outbound') AS emails_sent_today,
         (SELECT COUNT(*)::int FROM wizmatch_job_signals WHERE tenant_id = $1 AND status = 'replied_positive') AS positive_replies`,
      [tenantId, today],
      {
        active_requirements: 0,
        urgent_requirements: 0,
        available_candidates: 0,
        total_candidates: 0,
        priority_signals: 0,
        matched_signals: 0,
        qualified_companies: 0,
        approved_contacts: 0,
        active_placements: 0,
        monthly_margin: 0,
        emails_sent_today: 0,
        positive_replies: 0,
      },
    ),
    pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM tasks WHERE tenant_id = $1 AND status <> 'done') AS open_tasks,
         (SELECT COUNT(*)::int FROM messages WHERE tenant_id = $1 AND direction = 'inbound' AND status = 'received') AS unread_inbox,
         (SELECT COUNT(*)::int FROM contacts WHERE tenant_id = $1) AS crm_contacts,
         (SELECT COUNT(*)::int FROM deals WHERE tenant_id = $1 AND stage NOT IN ('won', 'lost', 'Won', 'Lost')) AS open_deals`,
      [tenantId],
    ),
    // --- Row-level enrichment for AI Intelligence (bounded top-N, tenant-scoped, read-only) ---
    pool.query(
      `SELECT
         s.id,
         s.job_title,
         s.score,
         s.employment_type,
         s.keywords,
         s.days_open,
         s.location,
         s.status,
         c.name AS company_name,
         (LOWER(COALESCE(s.employment_type, '')) = 'c2c') AS c2c_friendly
       FROM wizmatch_job_signals s
       LEFT JOIN wizmatch_companies c ON c.id = s.company_id
       WHERE s.tenant_id = $1 AND s.status NOT IN ('dead', 'placed')
       ORDER BY s.score DESC NULLS LAST, s.created_at DESC
       LIMIT 15`,
      [tenantId],
    ),
    optionalWizmatchValue(
      'top requirements snapshot',
      async () => (await pool.query(
        `SELECT id, title, required_skills, budget_min, budget_max, budget_currency, budget_period, positions, region, priority, employment_type, status
         FROM wizmatch_requirements
         WHERE tenant_id = $1 AND status <> 'closed'
         ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at DESC
         LIMIT 15`,
        [tenantId],
      )).rows,
      [] as Array<Record<string, unknown>>,
      ['wizmatch_requirements'],
    ),
    pool.query(
      `SELECT skill, COUNT(*)::int AS candidate_count
       FROM (SELECT UNNEST(skills) AS skill FROM wizmatch_candidates WHERE tenant_id = $1) sub
       WHERE skill IS NOT NULL AND skill <> ''
       GROUP BY skill
       ORDER BY candidate_count DESC
       LIMIT 15`,
      [tenantId],
    ),
    optionalWizmatchValue(
      'company tier counts snapshot',
      async () => (await pool.query(
        `SELECT COALESCE(qualification_tier, 'Unscored') AS tier, COUNT(*)::int AS count
         FROM wizmatch_company_intelligence
         WHERE tenant_id = $1
         GROUP BY qualification_tier
         ORDER BY count DESC`,
        [tenantId],
      )).rows,
      [] as Array<Record<string, unknown>>,
      ['wizmatch_company_intelligence'],
    ),
    pool.query(
      `SELECT p.id, p.placement_type, p.margin_hourly, p.bill_rate_hourly, p.pay_rate_hourly, p.status, p.contract_start_date, c.name AS company_name
       FROM wizmatch_placements p
       LEFT JOIN wizmatch_companies c ON c.id = p.company_id
       WHERE p.tenant_id = $1
       ORDER BY p.created_at DESC
       LIMIT 15`,
      [tenantId],
    ),
    buildWizmatchRoiSummaryForSnapshot(tenantId),
  ]);
  const row = stats.rows[0] ?? {};
  const sharedRow = shared.rows[0] ?? {};
  return {
    generatedAt: new Date().toISOString(),
    readiness: readiness.overall,
    costControls,
    safetyCenter: workbench.safetyCenter,
    summary: {
      activeRequirements: numeric(row.active_requirements),
      urgentRequirements: numeric(row.urgent_requirements),
      availableCandidates: numeric(row.available_candidates),
      totalCandidates: numeric(row.total_candidates),
      prioritySignals: numeric(row.priority_signals),
      matchedSignals: numeric(row.matched_signals),
      qualifiedCompanies: numeric(row.qualified_companies),
      approvedContacts: numeric(row.approved_contacts),
      activePlacements: numeric(row.active_placements),
      monthlyMargin: numeric(row.monthly_margin),
      emailsSentToday: numeric(row.emails_sent_today),
      positiveReplies: numeric(row.positive_replies),
      openTasks: numeric(sharedRow.open_tasks),
      unreadInbox: numeric(sharedRow.unread_inbox),
      crmContacts: numeric(sharedRow.crm_contacts),
      openDeals: numeric(sharedRow.open_deals),
      reviewActions: workbench.summary?.totalActions || 0,
      blockedActions: workbench.summary?.blocked || 0,
      safeActions: workbench.summary?.safeExecutableActions || 0,
    },
    priorityActions: (workbench.actions || []).slice(0, 6),
    guardrails: workbench.guardrails,
    // --- Row-level detail so Claude can reason about actual skills/budgets/margins ---
    topSignals: topSignalsResult.rows.map((r) => ({
      id: r.id,
      jobTitle: r.job_title,
      score: numeric(r.score),
      employmentType: r.employment_type,
      keywords: r.keywords || [],
      daysOpen: numeric(r.days_open),
      location: r.location,
      status: r.status,
      companyName: r.company_name,
      c2cFriendly: Boolean(r.c2c_friendly),
    })),
    topRequirements: topRequirementsResult.map((r) => ({
      id: r.id,
      title: r.title,
      requiredSkills: r.required_skills || [],
      budgetMin: r.budget_min !== null && r.budget_min !== undefined ? numeric(r.budget_min) : null,
      budgetMax: r.budget_max !== null && r.budget_max !== undefined ? numeric(r.budget_max) : null,
      budgetCurrency: r.budget_currency,
      budgetPeriod: r.budget_period,
      positions: numeric(r.positions),
      region: r.region,
      priority: r.priority,
      employmentType: r.employment_type,
      status: r.status,
    })),
    candidateSkillSupply: {
      topSkills: skillSupplyResult.rows.map((r) => ({ skill: r.skill, candidateCount: numeric(r.candidate_count) })),
      availableCandidates: numeric(row.available_candidates),
      totalCandidates: numeric(row.total_candidates),
    },
    companyTierCounts: companyTierResult.map((r) => ({ tier: r.tier, count: numeric(r.count) })),
    recentPlacements: recentPlacementsResult.rows.map((r) => ({
      id: r.id,
      companyName: r.company_name,
      placementType: r.placement_type,
      marginHourly: r.margin_hourly !== null && r.margin_hourly !== undefined ? numeric(r.margin_hourly) : null,
      billRateHourly: r.bill_rate_hourly !== null && r.bill_rate_hourly !== undefined ? numeric(r.bill_rate_hourly) : null,
      payRateHourly: r.pay_rate_hourly !== null && r.pay_rate_hourly !== undefined ? numeric(r.pay_rate_hourly) : null,
      status: r.status,
      contractStartDate: r.contract_start_date,
    })),
    roiSummary,
  };
}

router.get('/dashboard', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  res.json(await buildWizmatchDashboardSnapshot(tenantId, req.user?.id));
});

router.get('/intelligence', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const snapshot = await buildWizmatchDashboardSnapshot(tenantId, req.user?.id);
  res.json({
    snapshot,
    aiEnabled: Boolean(process.env.WIZMATCH_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY),
    guidance: [
      'Use dashboard and readiness first to confirm live Wizmatch data exists.',
      'Generate AI analysis manually when the team needs staffing priorities.',
      'No outreach or candidate submission is triggered from intelligence.',
    ],
  });
});

router.post('/intelligence/generate', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const snapshot = await buildWizmatchDashboardSnapshot(tenantId, req.user?.id);
  const system = `You are the Wizmatch operating analyst for Growth Escalators, an internal IT/Tech staffing CRM copilot.

Rules:
- Focus only on IT/Tech staffing.
- Do not recommend automatic outreach or automatic candidate submission.
- Do not recommend paid enrichment unless readiness, qualification, and cost guards allow it.
- Prioritize India 80% and US 20%.
- Use the exact numbers from the snapshot — never invent figures.
- Reason over the row-level detail in the snapshot (topSignals' skills/employment type/company, topRequirements' requiredSkills/budgets, candidateSkillSupply, companyTierCounts, recentPlacements, roiSummary) to give concrete, specific guidance — e.g. which roles to prioritize and why, which open requirements are unmatched against current candidate skill supply, and where placement margins are healthy or thin. Do not just restate the aggregate counts.
- Respond with concise JSON only, using exactly these keys: summary, risks, next_actions, data_gaps, guardrails.`;
  const compactSnapshot = JSON.stringify(snapshot);
  const prompt = `Analyze this staffing-only CRM snapshot and return your analysis as JSON with keys:
summary, risks, next_actions, data_gaps, guardrails.

Snapshot:
${compactSnapshot.slice(0, 40_000)}`;

  try {
    const response = await callClaude(prompt, CLAUDE_MODELS.SONNET, 1500, system, 20_000);
    let analysis: unknown;
    try {
      analysis = parseClaudeJSON(response.text);
    } catch {
      analysis = { summary: response.text, risks: [], next_actions: [], data_gaps: [], guardrails: [] };
    }
    res.json({ generatedAt: new Date().toISOString(), aiEnabled: true, tokensUsed: response.raw?.usage, snapshot, analysis });
  } catch (e) {
    logger.warn({ err: e }, '[wizmatch] intelligence generation unavailable');
    const message = e instanceof Error ? e.message : '';
    const reasonCode = /abort|timeout/i.test(message)
      ? 'provider_timeout'
      : /No Anthropic API key/i.test(message)
        ? 'provider_not_configured'
        : /Claude API error 4\d\d/i.test(message)
          ? 'provider_request_rejected'
          : 'provider_unavailable';
    const safeDetail = reasonCode === 'provider_timeout'
      ? 'The analysis exceeded the 20-second response limit. Retry once; if it repeats, check provider health.'
      : reasonCode === 'provider_not_configured'
        ? 'No supported Anthropic API key is configured for Wizmatch.'
        : reasonCode === 'provider_request_rejected'
          ? 'The provider rejected the bounded analysis request. Verify the configured model and account access.'
          : 'The provider could not complete the bounded analysis request. No demo analysis was substituted.';
    res.status(503).json({
      error: 'Wizmatch AI Intelligence is not available',
      detail: safeDetail,
      reasonCode,
      snapshot,
    });
  }
});

// ============================================================
// SECTION 0 — CONTACT INTELLIGENCE PHASE 1 ROUTES
// ============================================================

// GET /api/wizmatch/contact-intelligence/queue — read-only Phase 1 queue
router.get('/contact-intelligence/queue', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const [rows, totalResult] = await Promise.all([
    fetchContactIntelligenceCompanyRows(tenantId, limit),
    pool.query(
      `SELECT COUNT(DISTINCT company_id)::int AS total
       FROM wizmatch_job_signals WHERE tenant_id = $1 AND company_id IS NOT NULL`,
      [tenantId],
    ),
  ]);
  const computed = await Promise.all(rows.map((row) => buildContactIntelligenceResult(tenantId, row)));
  const items = await Promise.all(computed.map((item) => withPersistedContactIntelligence(tenantId, item)));

  res.json({
    items,
    total: numeric(totalResult.rows[0]?.total),
    returned: items.length,
    phase: 'phase_3_preview_first_manual_paid_discovery',
    costControls: await buildContactDiscoveryCostControls(tenantId, req.user?.id),
  });
});

// GET /api/wizmatch/contact-intelligence/companies/:companyId — read-only detail
router.get('/contact-intelligence/companies/:companyId', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const rows = await fetchContactIntelligenceCompanyRows(tenantId, 1, String(req.params.companyId));
  if (rows.length === 0) {
    res.status(404).json({ error: 'Company intelligence not found' });
    return;
  }

  const computed = await buildContactIntelligenceResult(tenantId, rows[0]);
  res.json(await withPersistedContactIntelligence(tenantId, computed));
});

// POST /api/wizmatch/contact-intelligence/companies/:companyId/snapshot
// Persists the deterministic qualification result and reusable internal candidates.
router.post('/contact-intelligence/companies/:companyId/snapshot', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const item = await persistContactIntelligenceSnapshot(tenantId, req.user?.id, String(req.params.companyId));
  if (!item) {
    res.status(404).json({ error: 'Company intelligence source not found' });
    return;
  }
  res.json({ item, costControls: await buildContactDiscoveryCostControls(tenantId, req.user?.id, String(req.params.companyId)) });
});

// POST /api/wizmatch/contact-intelligence/companies/:companyId/review
// Updates manual company review state only. Paid discovery requests are persisted as blocked.
router.post('/contact-intelligence/companies/:companyId/review', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const companyId = String(req.params.companyId);
  const action = firstString(req.body?.action) || 'watchlist_company';
  const notes = firstString(req.body?.notes);
  const rejectionReason = firstString(req.body?.rejectionReason);

  const item = await persistContactIntelligenceSnapshot(tenantId, req.user?.id, companyId);
  if (!item?.persisted?.id) {
    res.status(404).json({ error: 'Company intelligence source not found' });
    return;
  }

  const transition = resolveContactIntelligenceReviewAction({
    entity: 'company',
    action: action as any,
    currentCompanyStatus: item.companyStatus as any,
  });
  const nextStatus = transition.nextCompanyStatus || item.companyStatus;
  const reviewStatus =
    action === 'approve_company' ? 'approved'
      : action === 'reject_company' ? 'rejected'
      : 'watchlist';

  await pool.query(
    `UPDATE wizmatch_company_intelligence
     SET status = $1,
         review_status = $2,
         review_action = $3,
         reviewed_by = $4::uuid,
         reviewed_at = NOW(),
         rejection_reason = $5,
         review_notes = $6,
         updated_at = NOW()
     WHERE tenant_id = $7 AND company_id = $8`,
    [nextStatus, reviewStatus, action, req.user?.id || null, rejectionReason, notes, tenantId, companyId],
  );

  if (transition.nextDiscoveryStatus) {
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
         input_snapshot,
         result_counts,
         error_message
       )
       VALUES ($1, $2, $3, $4, $5, $6, 0, false, $7::uuid, $8::jsonb, $9::jsonb, $10)`,
      [
        tenantId,
        item.persisted.id,
        companyId,
        action === 'request_paid_discovery' ? 'paid_discovery' : 'manual_review',
        action === 'request_paid_discovery' ? 'paid_provider_blocked' : 'reviewer',
        transition.nextDiscoveryStatus,
        req.user?.id || null,
        JSON.stringify({ action, companyId }),
        JSON.stringify({ allowed: transition.allowed }),
        transition.allowed ? null : transition.reasons.join(' '),
      ],
    );
  }

  const refreshed = await fetchPersistedContactIntelligence(tenantId, companyId);
  res.json({ transition, persisted: refreshed.company, contactCandidates: refreshed.contactCandidates });
});

// POST /api/wizmatch/contact-intelligence/companies/:companyId/discovery-preview
// Read-only planning step. It never calls Apollo/Snov/Reacher/Google.
router.post('/contact-intelligence/companies/:companyId/discovery-preview', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const companyId = String(req.params.companyId);
  const discoveryInput = await buildContactDiscoveryInput(tenantId, req.user?.id, companyId);
  if (!discoveryInput) {
    res.status(404).json({ error: 'Company intelligence source not found' });
    return;
  }

  const costGuard = await buildContactDiscoveryCostGuard(tenantId, req.user?.id, companyId);
  const preview = buildWizmatchContactDiscoveryPreview(
    discoveryInput.input,
    getWizmatchContactDiscoveryConfig(),
    costGuard,
  );
  res.json({
    preview,
    item: discoveryInput.item,
    costControls: {
      ...getWizmatchContactDiscoveryConfig(),
      costGuard,
    },
  });
});

// POST /api/wizmatch/contact-intelligence/companies/:companyId/discover
// Manual paid discovery only. Requires an explicit preview confirmation and never sends outreach.
router.post('/contact-intelligence/companies/:companyId/discover', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const companyId = String(req.params.companyId);
  const confirmPreview = req.body?.confirmPreview === true;
  const discoveryInput = await buildContactDiscoveryInput(tenantId, req.user?.id, companyId);
  if (!discoveryInput) {
    res.status(404).json({ error: 'Company intelligence source not found' });
    return;
  }

  const initialCostGuard = await buildContactDiscoveryCostGuard(tenantId, req.user?.id, companyId);
  const preview = buildWizmatchContactDiscoveryPreview(
    discoveryInput.input,
    getWizmatchContactDiscoveryConfig(),
    initialCostGuard,
  );
  if (!confirmPreview) {
    res.status(400).json({
      error: 'Run discovery requires confirmPreview=true after reviewing discovery-preview.',
      preview,
    });
    return;
  }
  if (!preview.eligible) {
    await insertContactDiscoveryRunAudit({
      tenantId,
      companyIntelligenceId: discoveryInput.item!.persisted!.id,
      companyId,
      source: initialCostGuard.blockCode || 'eligibility_guard',
      status: 'blocked_by_cap',
      costCents: 0,
      userId: req.user?.id || null,
      inputSnapshot: { preview, providerOrder: preview.providerOrder },
      resultCounts: { candidates: 0, providerCalls: { apollo: 0, snov: 0, reacher: 0, googleFallback: 0 } },
      errorMessage: preview.blockedReasons.join(' | '),
      metadata: {
        costGuard: initialCostGuard,
        blockReasons: preview.blockedReasons,
      },
    });
    const statusCode = initialCostGuard.blockCode ? initialCostGuard.httpStatus : 409;
    res.status(statusCode).json({ error: 'Company is not eligible for paid discovery.', preview });
    return;
  }

  const locked = await withContactDiscoveryAdvisoryLock(initialCostGuard.idempotencyKey, async () => {
    const costGuard = await buildContactDiscoveryCostGuard(tenantId, req.user?.id, companyId);
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
        userId: req.user?.id || null,
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
        body: {
          error: 'Paid discovery is blocked by cost guard.',
          preview: guardedPreview,
          discoveryRunId: runId,
        },
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
      userId: req.user?.id || null,
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
    res.status(429).json({
      error: 'Another paid discovery run is already in progress for this company.',
      preview,
    });
    return;
  }
  if (locked.result.blocked) {
    res.status(locked.result.httpStatus).json(locked.result.body);
    return;
  }
  res.json(locked.result.body);
});

// POST /api/wizmatch/contact-intelligence/companies/:companyId/contacts/manual
// Adds a manually supplied contact candidate for review; it does not create a CRM contact yet.
router.post('/contact-intelligence/companies/:companyId/contacts/manual', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const companyId = String(req.params.companyId);
  const name = firstString(req.body?.name);
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const item = await persistContactIntelligenceSnapshot(tenantId, req.user?.id, companyId);
  if (!item?.persisted?.id) {
    res.status(404).json({ error: 'Company intelligence source not found' });
    return;
  }

  const rawEmail = firstString(req.body?.email);
  const rawPhone = firstString(req.body?.phone);
  const email = rawEmail ? normalizeChannelValue('email', rawEmail) : null;
  const phone = rawPhone ? normalizeChannelValue('phone', rawPhone) : null;
  const title = firstString(req.body?.title);
  const linkedinUrl = firstString(req.body?.linkedinUrl);
  const notes = firstString(req.body?.notes);

  const inserted = await pool.query(
    `INSERT INTO wizmatch_contact_candidates (
       tenant_id,
       company_intelligence_id,
       company_id,
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
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual_seed', 'manual_review', 50, 0, 4, 'needs_review', $10::jsonb, NOW(), NOW())
     RETURNING id`,
    [
      tenantId,
      item.persisted.id,
      companyId,
      name,
      title,
      email,
      phone,
      linkedinUrl,
      item.targetRegion,
      JSON.stringify({ notes, addedBy: req.user?.id || null }),
    ],
  );

  const refreshed = await fetchPersistedContactIntelligence(tenantId, companyId);
  res.status(201).json({ id: inserted.rows[0].id, contactCandidates: refreshed.contactCandidates });
});

// POST /api/wizmatch/contact-intelligence/contacts/:candidateId/review
router.post('/contact-intelligence/contacts/:candidateId/review', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const candidateId = String(req.params.candidateId);
  const action = firstString(req.body?.action) || 'reject_contact';
  const rejectionReason = firstString(req.body?.rejectionReason);
  const transition = resolveContactIntelligenceReviewAction({
    entity: 'contact_candidate',
    action: action as any,
    currentContactStatus: 'needs_review',
  });
  if (!transition.nextContactStatus) {
    res.status(400).json({ error: 'Unsupported contact review action', transition });
    return;
  }

  const result = await pool.query(
    `UPDATE wizmatch_contact_candidates
     SET status = $1,
         approved_by = CASE WHEN $1 = 'approved' THEN $2::uuid ELSE approved_by END,
         approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE approved_at END,
         reviewed_by = $2::uuid,
         reviewed_at = NOW(),
         rejection_reason = $3,
         updated_at = NOW()
     WHERE tenant_id = $4 AND id = $5
     RETURNING company_id`,
    [transition.nextContactStatus, req.user?.id || null, rejectionReason, tenantId, candidateId],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Contact candidate not found' });
    return;
  }

  const refreshed = await fetchPersistedContactIntelligence(tenantId, result.rows[0].company_id);
  res.json({ transition, contactCandidates: refreshed.contactCandidates });
});

// POST /api/wizmatch/contact-intelligence/contacts/:candidateId/link-crm-contact
// Explicitly links/creates a CRM contact after reviewer approval. This does not send outreach.
router.post('/contact-intelligence/contacts/:candidateId/link-crm-contact', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const candidateId = String(req.params.candidateId);
  const result = await pool.query(
    `SELECT cc.id,
            cc.company_id,
            cc.crm_contact_id,
            cc.name,
            cc.title,
            cc.email,
            cc.phone,
            cc.linkedin_url,
            cc.status,
            cc.metadata,
            company.name AS company_name
     FROM wizmatch_contact_candidates cc
     LEFT JOIN wizmatch_companies company
       ON company.tenant_id = cc.tenant_id AND company.id = cc.company_id
     WHERE cc.tenant_id = $1 AND cc.id = $2
     LIMIT 1`,
    [tenantId, candidateId],
  );
  const candidate = result.rows[0];
  if (!candidate) {
    res.status(404).json({ error: 'Contact candidate not found' });
    return;
  }
  if (!['approved', 'linked_to_crm'].includes(candidate.status)) {
    res.status(409).json({ error: 'Contact candidate must be approved before CRM linking' });
    return;
  }
  if (!candidate.email && !candidate.phone && !candidate.linkedin_url) {
    res.status(400).json({ error: 'At least one email, phone, or LinkedIn channel is required to link a CRM contact' });
    return;
  }

  if (candidate.crm_contact_id) {
    await classifyWizmatchClientLead(tenantId, candidate.crm_contact_id, {
      id: candidate.id,
      companyId: candidate.company_id,
      companyName: candidate.company_name,
      name: candidate.name,
      title: candidate.title,
      email: candidate.email,
      phone: candidate.phone,
      linkedinUrl: candidate.linkedin_url,
      metadata: candidate.metadata,
    });
    await pool.query(
      `UPDATE wizmatch_contact_candidates
       SET status = 'linked_to_crm', updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, candidateId],
    );
    res.json({ crmContactId: candidate.crm_contact_id, created: false });
    return;
  }

  const { crmContactId, created } = await linkApprovedWizmatchClientLead(tenantId, {
    id: candidate.id,
    companyId: candidate.company_id,
    companyName: candidate.company_name,
    name: candidate.name,
    title: candidate.title,
    email: candidate.email,
    phone: candidate.phone,
    linkedinUrl: candidate.linkedin_url,
    metadata: candidate.metadata,
  });
  await pool.query(
    `UPDATE wizmatch_contact_candidates
     SET crm_contact_id = $1,
         status = 'linked_to_crm',
         updated_at = NOW()
     WHERE tenant_id = $2 AND id = $3`,
    [crmContactId, tenantId, candidateId],
  );

  res.json({ crmContactId, created });
});

// GET /api/wizmatch/command-center — read-only intelligence operating layer
router.get('/command-center', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const limit = Math.min(Number(req.query.limit) || 25, 75);

  const [contactRows, signals, candidates, requirements, baseMetrics] = await Promise.all([
    fetchContactIntelligenceCompanyRows(tenantId, limit),
    fetchCommandCenterSignals(tenantId, limit),
    fetchCommandCenterCandidates(tenantId, limit),
    fetchCommandCenterRequirements(tenantId, limit),
    fetchCommandCenterMetrics(tenantId),
  ]);

  // Batch the two per-company fan-outs into a fixed number of set-based queries so a page
  // of up to 25 companies costs 2 queries here instead of ~100 (1 + 3 per company) fired in
  // 75-wide bursts against the 20-connection pool. Results are grouped in JS and fed into the
  // unchanged builder helpers, so the response JSON is identical.
  const companyIds = contactRows.map((row) => row.company_id);
  const [internalContactsByCompany, persistedByCompany] = await Promise.all([
    fetchInternalContactCandidatesBatch(tenantId, contactRows),
    fetchPersistedContactIntelligenceBatch(tenantId, companyIds),
  ]);
  const emptyPersisted: PersistedContactIntelligence = { company: null, contactCandidates: [], discoveryRuns: [] };

  const computedContactIntelligence = await Promise.all(
    contactRows.map((row) =>
      buildContactIntelligenceResult(tenantId, row, internalContactsByCompany.get(row.company_id) ?? []),
    ),
  );
  const contactIntelligence = await Promise.all(
    computedContactIntelligence.map((item) =>
      withPersistedContactIntelligence(tenantId, item, persistedByCompany.get(item.companyId) ?? emptyPersisted),
    ),
  );
  const metrics: CommandCenterMetricsInput = {
    ...baseMetrics,
    reviewReadyCompanies: contactIntelligence.filter((item) =>
      item.qualificationTier !== 'Reject' && item.contactCandidates.length > 0,
    ).length,
    blockedCompanies: contactIntelligence.filter((item) => item.hardBlocks.length > 0).length,
  };

  res.json(buildWizmatchCommandCenter({
    metrics,
    contactIntelligence,
    signals,
    candidates,
    requirements,
  }));
});

// ============================================================
// SECTION 1 — SIGNAL ROUTES
// ============================================================

// GET /api/wizmatch/signals — list with filters
router.get('/signals', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  // Columns are qualified with the `s` alias: the data query below joins
  // `contacts` and `wizmatch_companies`, which also have tenant_id/status/
  // source/score columns — bare names would raise "column is ambiguous" (42702).
  const conditions: string[] = ['s.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramIdx = 2;

  if (req.query.status) {
    conditions.push(`s.status = $${paramIdx++}`);
    params.push(req.query.status);
  }
  if (req.query.min_score) {
    conditions.push(`s.score >= $${paramIdx++}`);
    params.push(Number(req.query.min_score));
  }
  if (req.query.source) {
    conditions.push(`s.source = $${paramIdx++}`);
    params.push(req.query.source);
  }
  if (req.query.company_id) {
    conditions.push(`s.company_id = $${paramIdx++}`);
    params.push(req.query.company_id);
  }

  const whereClause = conditions.join(' AND ');

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM wizmatch_job_signals s WHERE ${whereClause}`,
    params,
  );
  const total = countResult.rows[0]?.total ?? 0;

  const dataResult = await pool.query(
    `SELECT s.*, c.name AS company_name, c.domain AS company_domain,
            cnt.first_name AS contact_first_name, cnt.last_name AS contact_last_name
     FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id
     LEFT JOIN contacts cnt ON cnt.id = s.contact_id
     WHERE ${whereClause}
     ORDER BY s.score DESC NULLS LAST, s.created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset],
  );

  res.json({ items: dataResult.rows, total });
});

// GET /api/wizmatch/signals/:id — full detail
router.get('/signals/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const result = await pool.query(
    `SELECT s.*, c.name AS company_name, c.domain AS company_domain, c.ats_type,
            cnt.first_name AS contact_first_name, cnt.last_name AS contact_last_name,
            cnt.id AS contact_id
     FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id
     LEFT JOIN contacts cnt ON cnt.id = s.contact_id
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [req.params.id, tenantId],
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Signal not found' });
    return;
  }

  const signal = result.rows[0];

  // Get matched candidates
  let matchedCandidates: unknown[] = [];
  if (signal.matched_candidate_ids && signal.matched_candidate_ids.length > 0) {
    const candResult = await pool.query(
      `SELECT wc.id, wc.skills, wc.location, wc.visa_status, wc.rate_hourly,
              wc.rate_currency, wc.availability_date, wc.availability_status,
              c.first_name, c.last_name
       FROM wizmatch_candidates wc
       JOIN contacts c ON c.id = wc.contact_id
       WHERE wc.id = ANY($1::uuid[])`,
      [signal.matched_candidate_ids],
    );
    matchedCandidates = candResult.rows;
  }

  // Get draft messages
  const draftsResult = await pool.query(
    `SELECT id, content, metadata, status, created_at
     FROM messages
     WHERE contact_id = $1 AND metadata->>'signal_id' = $2
     ORDER BY created_at DESC`,
    [signal.contact_id, req.params.id],
  );

  res.json({ ...signal, matched_candidates: matchedCandidates, drafts: draftsResult.rows });
});

// POST /api/wizmatch/signals/ingest — internal endpoint for CI/cron scrapers
router.post('/signals/ingest', requireInternalToken, async (req: Request, res: Response) => {
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  if (!tenantId) {
    res.status(500).json({ error: 'WIZMATCH_TENANT_ID not configured' });
    return;
  }

  const incomingSignals = req.body.signals as Array<{
    job_title: string;
    job_url?: string;
    source: string;
    posted_at?: string;
    employment_type?: string;
    keywords?: string[];
    location?: string;
    raw_text?: string;
    company_name?: string;
    company_domain?: string;
    provider_id?: string;
  }>;

  if (!Array.isArray(incomingSignals)) {
    res.status(400).json({ error: 'Expected { signals: [...] }' });
    return;
  }

  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (const sig of incomingSignals) {
    try {
      // Resolve or create company
      let companyId: string | null = null;
      if (sig.company_name || sig.company_domain) {
        const companyResult = await pool.query(
          `INSERT INTO wizmatch_companies (tenant_id, name, domain, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (tenant_id, name) DO UPDATE SET updated_at = NOW()
           RETURNING id`,
          [
            tenantId,
            sig.company_name || sig.company_domain || 'Unknown',
            sig.company_domain || null,
          ],
        );
        companyId = companyResult.rows[0].id;
      }

      const { normalizeProviderId, signalIdentityFingerprint } = await import('../services/wizmatchSignalIdentity');
      const providerId = normalizeProviderId(sig.provider_id);
      const identityFingerprint = signalIdentityFingerprint({ companyName: sig.company_name || sig.company_domain, jobTitle: sig.job_title, location: sig.location });

      // Prefer provider identity, then URL, then normalized company/title/location.
      if (providerId || sig.job_url || identityFingerprint) {
        const existing = await pool.query(
          `UPDATE wizmatch_job_signals
           SET last_seen_at = NOW(),
               days_open = GREATEST(days_open, EXTRACT(EPOCH FROM (NOW() - first_seen_at))/86400)::int
           WHERE tenant_id = $1 AND ((source=$2 AND provider_id=$3 AND $3 IS NOT NULL) OR (job_url=$4 AND $4 IS NOT NULL) OR (identity_fingerprint=$5 AND $5 IS NOT NULL))
           RETURNING id`,
          [tenantId, sig.source, providerId, sig.job_url || null, identityFingerprint],
        );
        if (existing.rows.length > 0) {
          updated++;
          continue;
        }
      }

      await pool.query(
        `INSERT INTO wizmatch_job_signals
         (tenant_id, company_id, job_title, job_url, source, provider_id, identity_fingerprint, posted_at,
          employment_type, keywords, location, raw_text, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'new', NOW())`,
        [
          tenantId,
          companyId,
          sig.job_title,
          sig.job_url || null,
          sig.source,
          providerId,
          identityFingerprint,
          sig.posted_at || null,
          sig.employment_type || null,
          sig.keywords || [],
          sig.location || null,
          sig.raw_text || null,
        ],
      );
      inserted++;
    } catch (e) {
      logger.error({ err: e }, '[wizmatch] ingest error for signal');
      errors++;
    }
  }

  logger.info(`[wizmatch] ingest: ${inserted} new, ${updated} updated, ${errors} errors`);
  res.json({ inserted, updated, errors });
});

// POST /api/wizmatch/signals/:id/score — deterministic TS scorer (internal)
// Thin wrapper over scoreSignalById (src/services/wizmatchSignalPipeline.ts); the
// worker cron calls that same function directly (no HTTP self-request).
router.post('/signals/:id/score', requireInternalToken, async (req: Request, res: Response) => {
  const tenantId = process.env.WIZMATCH_TENANT_ID!;
  const result = await scoreSignalById(tenantId, String(req.params.id));

  if (result.notFound) {
    res.status(404).json({ error: 'Signal not found' });
    return;
  }

  res.json({ signalId: result.signalId, score: result.score, breakdown: result.breakdown, reasoning: result.reasoning });
});

// POST /api/wizmatch/signals/:id/enrich — reuse emailExtractorService (internal)
// Thin wrapper over enrichSignalById; the enrichment try/catch → 500 mapping lives
// here so both the route and the worker cron share the same core logic.
router.post('/signals/:id/enrich', requireInternalToken, async (req: Request, res: Response) => {
  const tenantId = process.env.WIZMATCH_TENANT_ID!;

  try {
    const result = await enrichSignalById(tenantId, String(req.params.id));
    if (result.notFound) {
      res.status(404).json({ error: 'Signal not found' });
      return;
    }
    res.json(result.payload);
  } catch (e) {
    logger.error({ err: e }, '[wizmatch] enrich failed');
    res.status(500).json({ error: 'enrichment failed', detail: e instanceof Error ? e.message : 'unknown' });
  }
});

// POST /api/wizmatch/signals/:id/match — pure SQL+TS matcher (internal)
// Thin wrapper over matchSignalById; the worker cron calls that function directly.
router.post('/signals/:id/match', requireInternalToken, async (req: Request, res: Response) => {
  const tenantId = process.env.WIZMATCH_TENANT_ID!;
  const result = await matchSignalById(tenantId, String(req.params.id));

  if (result.notFound) {
    res.status(404).json({ error: 'Signal not found' });
    return;
  }

  res.json(result.payload);
});

// POST /api/wizmatch/signals/:id/draft — Sonnet on-demand email drafts
router.post('/signals/:id/draft', async (req: Request, res: Response) => {
  // Allow both JWT (from UI) and internal token
  const tenantId = req.user?.tenantId || process.env.WIZMATCH_TENANT_ID!;
  const signalId = req.params.id;

  const signalResult = await pool.query(
    `SELECT s.*, c.name AS company_name, c.domain AS company_domain, c.h1b_sponsor_count,
            cnt.first_name AS contact_first_name, cnt.last_name AS contact_last_name
     FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id
     LEFT JOIN contacts cnt ON cnt.id = s.contact_id
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [signalId, tenantId],
  );

  if (signalResult.rows.length === 0) {
    res.status(404).json({ error: 'Signal not found' });
    return;
  }

  const signal = signalResult.rows[0];
  if (!signal.contact_id) {
    res.status(400).json({ error: 'Signal has no enriched contact — run /enrich first' });
    return;
  }

  // Get matched candidates with full detail
  let candidatesDetail = '';
  if (signal.matched_candidate_ids?.length > 0) {
    const candsResult = await pool.query(
      `SELECT wc.skills, wc.visa_status, wc.rate_hourly, wc.rate_currency,
              wc.availability_date, c.first_name, c.last_name
       FROM wizmatch_candidates wc
       JOIN contacts c ON c.id = wc.contact_id
       WHERE wc.id = ANY($1::uuid[])`,
      [signal.matched_candidate_ids],
    );
    candidatesDetail = candsResult.rows
      .map((c: { first_name: string; last_name: string; skills: string[]; visa_status: string; rate_hourly: number; rate_currency: string; availability_date: string }, i: number) =>
        `Candidate ${String.fromCharCode(65 + i)}: ${c.first_name} ${c.last_name}, ${c.skills.join(', ')}, ${c.visa_status}, $${c.rate_hourly}/${c.rate_currency}, available ${c.availability_date || 'immediate'}`,
      )
      .join('\n');
  }

  const contactName = `${signal.contact_first_name || 'Hiring'} ${signal.contact_last_name || 'Manager'}`.trim();

  const prompt = `You are writing cold outreach emails for Wizmatch, a US + India IT staffing firm. Write 3 variants of a cold email to a decision-maker who has a job open that we have candidates for.

Context:
- Recipient: ${contactName} at ${signal.company_name || 'the company'}
- Job: ${signal.job_title}, posted ${signal.days_open} days ago, ${signal.employment_type || 'unknown'} in ${signal.location || 'unspecified'}
- Recipient company files H-1B LCAs: ${signal.h1b_sponsor_count || 0} in last year

Available candidates:
${candidatesDetail || 'No specific candidates matched — focus on our bench of certified IT professionals.'}

Rules (NON-NEGOTIABLE):
- Under 120 words per email
- Lead with proof: name 2 specific candidates with their skills + rates
- Reference the specific role + how long it's been open (if 7+ days)
- One ask: "Want profiles in 30 minutes?"
- Sign as: "— Archit, Wizmatch"
- NO service bundles, NO "we're a staffing firm" language, NO "can we connect"
- NO buzzwords (synergy, leverage, partner, solutions)
- Plain text only, no HTML, no markdown
- Include exactly: [UNSUBSCRIBE_LINK] placeholder
- Include exactly: [PHYSICAL_ADDRESS] placeholder

Return JSON only:
{
  "variant_a": { "subject": "<under 60 chars>", "body": "<email body>" },
  "variant_b": { "subject": "<different angle>", "body": "<different angle body>" },
  "variant_c": { "subject": "<different angle>", "body": "<different angle body>" }
}

Variant A: Direct pitch — lead with candidates + rates.
Variant B: Pain-point angle — reference days open + repost, then offer candidates.
Variant C: Social proof angle — reference similar past placements, then offer candidates.`;

  try {
    const response = await callClaude(prompt, CLAUDE_MODELS.SONNET, 1500);
    const drafts = parseClaudeJSON<Record<string, { subject: string; body: string }>>(response.text);

    // Insert 3 draft messages — body in content, subject in metadata
    const insertedDrafts = [];
    for (const [variantKey, draft] of Object.entries(drafts)) {
      const bodyWithFooter = `${draft.body}\n\n[UNSUBSCRIBE_LINK]\n[PHYSICAL_ADDRESS]`;
      const [msg] = await db
        .insert(messages)
        .values({
          tenantId,
          contactId: signal.contact_id,
          channel: 'email',
          direction: 'outbound',
          content: bodyWithFooter,
          status: 'draft',
          metadata: {
            subject: draft.subject,
            signal_id: signalId,
            variant: variantKey,
          },
        })
        .returning();
      insertedDrafts.push(msg);
    }

    await pool.query(
      `UPDATE wizmatch_job_signals SET status = 'drafted' WHERE id = $1 AND tenant_id = $2`,
      [signalId, tenantId],
    );

    res.json({ signalId, drafts: insertedDrafts });
  } catch (e) {
    logger.error({ err: e }, '[wizmatch] draft generation failed');
    res.status(500).json({ error: 'draft generation failed', detail: e instanceof Error ? e.message : 'unknown' });
  }
});

// POST /api/wizmatch/signals/:id/send — send via multi-domain mailer
router.post('/signals/:id/send', async (req: Request, res: Response) => {
  // Master send kill-switch. Cold outreach stays OFF until it is deliberately
  // turned on: no real email leaves the system unless WIZMATCH_SENDING_ENABLED
  // === 'true'. This makes "sending is off" a code-level guarantee rather than
  // an accident of absent SMTP creds or an unrouted UI — flip the env var (and
  // only then) to go live, one supervised send at a time.
  if (process.env.WIZMATCH_SENDING_ENABLED !== 'true') {
    res.status(403).json({
      error: 'sending_disabled',
      message: 'Wizmatch cold sending is disabled. Set WIZMATCH_SENDING_ENABLED=true to enable.',
    });
    return;
  }
  const tenantId = req.user!.tenantId;
  const signalId = req.params.id;
  const { variant_message_id } = req.body as { variant_message_id: string };

  if (!variant_message_id) {
    res.status(400).json({ error: 'variant_message_id required' });
    return;
  }

  // Get the draft message
  const msgResult = await pool.query(
    `SELECT m.*, cnt.first_name, cnt.last_name
     FROM messages m
     JOIN contacts cnt ON cnt.id = m.contact_id
     WHERE m.id = $1 AND m.tenant_id = $2`,
    [variant_message_id, tenantId],
  );

  if (msgResult.rows.length === 0) {
    res.status(404).json({ error: 'Draft message not found' });
    return;
  }

  const draft = msgResult.rows[0] as {
    id: string; contact_id: string; content: string; metadata: { subject: string; signal_id: string };
    first_name: string; last_name: string;
  };

  // Get contact email
  const emailResult = await pool.query(
    `SELECT channel_value FROM contact_channels WHERE contact_id = $1 AND channel_type = 'email' LIMIT 1`,
    [draft.contact_id],
  );

  if (emailResult.rows.length === 0) {
    res.status(400).json({ error: 'Contact has no email channel' });
    return;
  }

  const toEmail = emailResult.rows[0].channel_value;

  // Suppression check
  const suppressed = await pool.query(
    `SELECT id FROM wizmatch_suppression_list WHERE tenant_id = $1 AND email = $2`,
    [tenantId, toEmail],
  );
  if (suppressed.rows.length > 0) {
    res.status(400).json({ error: 'Contact is on suppression list' });
    return;
  }

  // Generate unsubscribe link with HMAC. Fail closed: with no configured secret
  // we must NOT mint a link signed with a public default (that is forgeable), so
  // refuse to send rather than embed a bogus-signed / unverifiable link. Mirrors
  // the fail-closed posture of src/middleware/internalAuth.ts.
  const unsubSecret = WIZMATCH_UNSUBSCRIBE_HMAC_SECRET;
  if (!unsubSecret) {
    logger.error('[wizmatch] WIZMATCH_UNSUBSCRIBE_HMAC_SECRET not set — refusing to embed a forgeable unsubscribe link');
    res.status(500).json({ error: 'unsubscribe signing secret not configured' });
    return;
  }
  const unsubSig = crypto
    .createHmac('sha256', unsubSecret)
    .update(toEmail)
    .digest('base64url');

  const unsubLink = `https://api.growthescalators.com/api/wizmatch/unsubscribe?email=${encodeURIComponent(toEmail)}&sig=${unsubSig}`;

  // Render email body
  const renderedBody = draft.content
    .replace('[UNSUBSCRIBE_LINK]', unsubLink)
    .replace('[PHYSICAL_ADDRESS]', WIZMATCH_PHYSICAL_ADDRESS);

  // Send via multi-domain mailer
  try {
    const { sendColdEmail } = await import('../services/multiDomainMailer');
    const sendResult = await sendColdEmail({
      to: toEmail,
      subject: draft.metadata.subject,
      body: renderedBody,
      fromName: 'Archit',
      tenantId,
    });

    // Update message status to sent
    await pool.query(
      `UPDATE messages SET status = 'sent', sent_at = NOW(), metadata = metadata || $3::jsonb WHERE id = $1 AND tenant_id = $2`,
      [draft.id, tenantId, JSON.stringify({ ...draft.metadata, sent_from: sendResult.from, domain: sendResult.domain })],
    );

    // Update signal status
    await pool.query(
      `UPDATE wizmatch_job_signals SET status = 'sent' WHERE id = $1 AND tenant_id = $2`,
      [draft.metadata.signal_id, tenantId],
    );

    // Enroll in follow-up sequence (find the Wizmatch sequence)
    const seqResult = await pool.query(
      `SELECT id FROM sequences WHERE tenant_id = $1 AND name LIKE '%Wizmatch%' AND is_active = true LIMIT 1`,
      [tenantId],
    );
    if (seqResult.rows.length > 0) {
      const seqId = seqResult.rows[0].id;
      const nextStepAt = new Date(Date.now() + 3 * 86400000); // Day 3 follow-up
      await db.insert(sequenceEnrolments).values({
        tenantId,
        contactId: draft.contact_id,
        sequenceId: seqId,
        currentStep: 0,
        status: 'active',
        nextStepAt,
      }).onConflictDoNothing();
    }

    res.json({ messageId: draft.id, sent: true, from: sendResult.from, domain: sendResult.domain });
  } catch (e) {
    logger.error({ err: e }, '[wizmatch] send failed');
    res.status(500).json({ error: 'send failed', detail: e instanceof Error ? e.message : 'unknown' });
  }
});

// ============================================================
// SECTION 2 — CANDIDATE ROUTES
// ============================================================

router.get('/candidates', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const conditions: string[] = ['wc.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramIdx = 2;

  if (req.query.skill) {
    conditions.push(`$${paramIdx++}::text = ANY(wc.skills)`);
    params.push(req.query.skill);
  }
  if (req.query.visa_status) {
    conditions.push(`wc.visa_status = $${paramIdx++}`);
    params.push(req.query.visa_status);
  }
  if (req.query.availability_status) {
    conditions.push(`wc.availability_status = $${paramIdx++}`);
    params.push(req.query.availability_status);
  }
  if (req.query.source) {
    conditions.push(`wc.source = $${paramIdx++}`);
    params.push(req.query.source);
  }
  if (req.query.location) {
    conditions.push(`wc.location ILIKE '%' || $${paramIdx++} || '%'`);
    params.push(req.query.location);
  }
  const minExperience = Number(req.query.min_experience);
  if (req.query.min_experience && Number.isFinite(minExperience)) {
    conditions.push(`wc.experience_years >= $${paramIdx++}`);
    params.push(minExperience);
  }

  const whereClause = conditions.join(' AND ');
  const dataResult = await pool.query(
    `SELECT wc.*, c.first_name, c.last_name, c.company_name
     FROM wizmatch_candidates wc
     JOIN contacts c ON c.id = wc.contact_id
     WHERE ${whereClause}
     ORDER BY wc.created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset],
  );

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM wizmatch_candidates wc WHERE ${whereClause}`,
    params,
  );

  res.json({ items: dataResult.rows, total: countResult.rows[0]?.total ?? 0 });
});

router.post('/candidates', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const body = req.body as {
    name: string; email: string; skills: string[]; location?: string;
    visa_status?: string; rate_hourly?: number; availability_date?: string;
    source?: string; linkedin_url?: string; github_url?: string;
    experience_years?: number;
  };

  // Create contact via findOrCreateContact
  const [firstName, ...lastNameParts] = body.name.split(' ');
  const { contact } = await findOrCreateContact(tenantId, {
    firstName,
    lastName: lastNameParts.join(' ') || undefined,
    source: 'wizmatch_manual',
    channels: [{ channelType: 'email', channelValue: body.email, isPrimary: true }],
  });

  const [candidate] = await db
    .insert(wizmatchCandidates)
    .values({
      tenantId,
      contactId: contact.id,
      skills: body.skills,
      location: body.location,
      visaStatus: body.visa_status,
      experienceYears: body.experience_years,
      rateHourly: body.rate_hourly,
      availabilityDate: body.availability_date,
      source: body.source || 'manual',
      linkedinUrl: body.linkedin_url,
      githubUrl: body.github_url,
    })
    .returning();

  res.json(candidate);
});

// POST /api/wizmatch/candidates/ingest — batch create from scrapers (internal).
// Dedupes by contact + skips placeholder emails so junk rows don't land.
router.post('/candidates/ingest', requireInternalToken, async (req: Request, res: Response) => {
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  if (!tenantId) {
    res.status(500).json({ error: 'WIZMATCH_TENANT_ID not configured' });
    return;
  }

  const incoming = req.body.candidates as Array<{
    name: string; email: string; skills?: string[]; location?: string;
    visa_status?: string; rate_hourly?: number; rate_currency?: string;
    source?: string; linkedin_url?: string; github_url?: string;
    india_specific?: Record<string, unknown>;
  }>;

  if (!Array.isArray(incoming)) {
    res.status(400).json({ error: 'Expected { candidates: [...] }' });
    return;
  }

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const c of incoming) {
    try {
      const email = (c.email || '').toLowerCase().trim();
      // Reject junk: missing name/email, obvious placeholders, malformed addresses.
      if (!c.name || !email || !email.includes('@') || email.endsWith('@placeholder.com')) {
        skipped++;
        continue;
      }

      const [firstName, ...rest] = c.name.trim().split(' ');
      const { contact } = await findOrCreateContact(tenantId, {
        firstName,
        lastName: rest.join(' ') || undefined,
        source: `wizmatch_${c.source || 'scrape'}`,
        channels: [{ channelType: 'email', channelValue: email, isPrimary: true }],
      });

      // One candidate per contact — skip if we already have one.
      const existing = await pool.query(
        `SELECT id FROM wizmatch_candidates WHERE tenant_id = $1 AND contact_id = $2`,
        [tenantId, contact.id],
      );
      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      await db.insert(wizmatchCandidates).values({
        tenantId,
        contactId: contact.id,
        skills: c.skills || [],
        location: c.location,
        visaStatus: c.visa_status,
        rateHourly: c.rate_hourly,
        rateCurrency: c.rate_currency,
        source: c.source || 'scrape',
        linkedinUrl: c.linkedin_url,
        githubUrl: c.github_url,
        indiaSpecific: c.india_specific || {},
      });
      inserted++;
    } catch (e) {
      logger.error({ err: e }, '[wizmatch] candidate ingest error');
      errors++;
    }
  }

  logger.info(`[wizmatch] candidate ingest: ${inserted} new, ${skipped} skipped, ${errors} errors`);
  res.json({ inserted, skipped, errors });
});

router.get('/candidates/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const result = await pool.query(
    `SELECT wc.*, c.first_name, c.last_name, c.company_name
     FROM wizmatch_candidates wc
     JOIN contacts c ON c.id = wc.contact_id
     WHERE wc.id = $1 AND wc.tenant_id = $2`,
    [req.params.id, tenantId],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Candidate not found' });
    return;
  }
  res.json(result.rows[0]);
});

router.put('/candidates/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const updates = req.body;

  // Build SET clause dynamically
  const allowedFields = [
    'skills', 'location', 'visa_status', 'rate_hourly', 'rate_currency',
    'availability_date', 'availability_status', 'source', 'linkedin_url',
    'github_url', 'resume_url', 'is_wizmatch_certified', 'india_specific',
  ];

  const setClauses: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [req.params.id, tenantId];
  let paramIdx = 3;

  for (const [key, value] of Object.entries(updates)) {
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (allowedFields.includes(snakeKey)) {
      setClauses.push(`${snakeKey} = $${paramIdx++}`);
      params.push(value);
    }
  }

  const result = await pool.query(
    `UPDATE wizmatch_candidates SET ${setClauses.join(', ')}
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    params,
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Candidate not found' });
    return;
  }
  res.json(result.rows[0]);
});

// ============================================================
// SECTION 3 — PLACEMENT ROUTES
// ============================================================

// Pipeline stages mirror wizmatch_placements.status exactly, so a placement's
// status maps 1:1 onto its linked deal's stage — no translation table needed.
const WIZMATCH_PLACEMENT_STAGES = ['submitted', 'interviewing', 'offered', 'started', 'ended', 'lost'];

// Idempotently ensure the Wizmatch placements pipeline exists and return its id.
// Called on every placement create so the deal is never orphaned with a NULL
// pipeline_id (previously the slug was looked up but never created).
async function ensureWizmatchPipeline(tenantId: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO pipelines (tenant_id, name, slug, stages, color, is_active)
     VALUES ($1, 'Wizmatch Placements', 'wizmatch-placements', $2::jsonb, '#3b82f6', true)
     ON CONFLICT (tenant_id, slug) DO UPDATE SET stages = EXCLUDED.stages
     RETURNING id`,
    [tenantId, JSON.stringify(WIZMATCH_PLACEMENT_STAGES)],
  );
  return result.rows[0].id;
}

router.get('/placements', async (req: Request, res: Response) => {
  if (!['admin', 'team_lead'].includes(req.user!.role)) {
    res.status(403).json({ error: 'commercial_access_requires_lead' });
    return;
  }
  const tenantId = req.user!.tenantId;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const conditions: string[] = ['wp.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramIdx = 2;

  if (req.query.status) {
    conditions.push(`wp.status = $${paramIdx++}`);
    params.push(req.query.status);
  }
  if (req.query.candidate_id) {
    conditions.push(`wp.candidate_id = $${paramIdx++}`);
    params.push(req.query.candidate_id);
  }
  if (req.query.company_id) {
    conditions.push(`wp.company_id = $${paramIdx++}`);
    params.push(req.query.company_id);
  }

  const whereClause = conditions.join(' AND ');
  const result = await pool.query(
    `SELECT wp.*, c.first_name AS candidate_first, c.last_name AS candidate_last,
            comp.name AS company_name, js.job_title
     FROM wizmatch_placements wp
     LEFT JOIN wizmatch_candidates wc ON wc.id = wp.candidate_id
     LEFT JOIN contacts c ON c.id = wc.contact_id
     LEFT JOIN wizmatch_companies comp ON comp.id = wp.company_id
     LEFT JOIN wizmatch_job_signals js ON js.id = wp.job_signal_id
     WHERE ${whereClause}
     ORDER BY wp.created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset],
  );

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM wizmatch_placements wp WHERE ${whereClause}`,
    params,
  );

  res.json({ items: result.rows, total: countResult.rows[0]?.total ?? 0 });
});

router.post('/placements', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const body = req.body as {
    candidate_id: string; job_signal_id?: string; company_id?: string;
    prime_company_id?: string; placement_type: string;
    bill_rate_hourly?: number; pay_rate_hourly?: number;
    contract_start_date?: string; contract_end_date?: string;
    contract_length_months?: number; perm_fee_percentage?: number; perm_ctc_annual?: number;
  };

  // Compute margin or perm fee
  let marginHourly: number | null = null;
  let permFeeAmount: number | null = null;
  if (body.bill_rate_hourly && body.pay_rate_hourly) {
    marginHourly = body.bill_rate_hourly - body.pay_rate_hourly;
  }
  if (body.perm_ctc_annual && body.perm_fee_percentage) {
    permFeeAmount = Math.round(body.perm_ctc_annual * body.perm_fee_percentage / 100);
  }

  // Get candidate's contact_id for the deal
  const candResult = await pool.query(
    `SELECT contact_id FROM wizmatch_candidates WHERE id = $1 AND tenant_id = $2`,
    [body.candidate_id, tenantId],
  );
  if (candResult.rows.length === 0) {
    res.status(404).json({ error: 'Candidate not found' });
    return;
  }
  const contactId = candResult.rows[0].contact_id;

  // Ensure the Wizmatch placements pipeline exists (idempotent) so the deal is
  // never orphaned with a NULL pipeline_id.
  const pipelineId = await ensureWizmatchPipeline(tenantId);

  // Monthly economic value: contract margin annualised to a month (160 hrs) or
  // the one-off perm fee. Both deal columns receive the same figure so finance
  // rollups (which read `value`) and the pipeline card (`deal_value`) agree.
  const dealValue = permFeeAmount ?? (marginHourly ? marginHourly * 160 : 0);

  // Create deal
  const dealResult = await pool.query(
    `INSERT INTO deals (tenant_id, contact_id, pipeline_id, title, stage, value, deal_value, service_type, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'submitted', $5, $6, 'staffing', NOW(), NOW())
     RETURNING id`,
    [
      tenantId,
      contactId,
      pipelineId,
      `Placement: ${body.placement_type}`,
      String(dealValue),
      dealValue,
    ],
  );
  const dealId = dealResult.rows[0].id;

  const [placement] = await db
    .insert(wizmatchPlacements)
    .values({
      tenantId,
      dealId,
      candidateId: body.candidate_id,
      jobSignalId: body.job_signal_id,
      companyId: body.company_id,
      primeCompanyId: body.prime_company_id,
      placementType: body.placement_type,
      billRateHourly: body.bill_rate_hourly,
      payRateHourly: body.pay_rate_hourly,
      marginHourly,
      contractStartDate: body.contract_start_date,
      contractEndDate: body.contract_end_date,
      contractLengthMonths: body.contract_length_months,
      permFeePercentage: body.perm_fee_percentage?.toString(),
      permCtcAnnual: body.perm_ctc_annual,
      permFeeAmount,
      status: 'submitted',
    })
    .returning();

  res.json(placement);
});

// POST /api/wizmatch/placements/:id/rtr — generate RTR PDF and upload to R2
router.post('/placements/:id/rtr', async (req: Request, res: Response) => {
  const { generateRtrPdf } = await import('../services/wizmatchRtrGenerator');
  const result = await generateRtrPdf(String(req.params.id));
  if (!result.success) {
    res.status(500).json({ error: result.error });
    return;
  }

  // Slack alert
  if (WIZMATCH_LEADS_CHANNEL) {
    await sendSlackMessage(
      WIZMATCH_LEADS_CHANNEL,
      `📄 RTR generated for placement ${req.params.id}: ${result.rtr_url}`,
    ).catch(() => {});
  }

  res.json({ rtr_url: result.rtr_url });
});

router.put('/placements/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { status } = req.body as { status: string };

  if (status) {
    const result = await pool.query(
      `UPDATE wizmatch_placements SET status = $3, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, tenantId, status],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Placement not found' });
      return;
    }

    const placement = result.rows[0];

    // Keep the linked CRM deal's stage in lockstep with the placement status
    // (identical vocabulary) so the Placements kanban and the deals pipeline
    // never diverge. Stamp closed_at on terminal stages for close-rate reporting.
    if (placement.deal_id) {
      await pool.query(
        `UPDATE deals
         SET stage = $3, updated_at = NOW(),
             closed_at = CASE WHEN $3 IN ('ended','lost') THEN COALESCE(closed_at, NOW()) ELSE NULL END,
             lost_reason = CASE WHEN $3 = 'lost' THEN COALESCE(lost_reason, 'placement lost') ELSE lost_reason END
         WHERE id = $1 AND tenant_id = $2`,
        [placement.deal_id, tenantId, status],
      );
    }

    // Log status change event
    await pool.query(
      `INSERT INTO events (tenant_id, event_type, payload, source_id, occurred_at)
       VALUES ($1, 'placement_status_change', $2::jsonb, $3, NOW())`,
      [tenantId, JSON.stringify({ placementId: req.params.id, newStatus: status }), req.params.id],
    );

    res.json(placement);
  } else {
    res.status(400).json({ error: 'Only status updates supported' });
  }
});

// ============================================================
// SECTION 4 — PRIME ROUTES
// ============================================================

router.get('/primes', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const result = await pool.query(
    `SELECT wc.*,
            (SELECT COUNT(*)::int FROM wizmatch_placements wp WHERE wp.prime_company_id = wc.id AND wp.status NOT IN ('lost','ended')) AS active_placements,
            (SELECT COALESCE(SUM(margin_hourly * 160), 0)::int FROM wizmatch_placements wp WHERE wp.prime_company_id = wc.id AND wp.status IN ('started')) AS monthly_margin
     FROM wizmatch_companies wc
     WHERE wc.tenant_id = $1 AND wc.is_prime = true
     ORDER BY wc.name`,
    [tenantId],
  );
  res.json({ items: result.rows });
});

router.post('/primes', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { company_id } = req.body as { company_id: string };

  const result = await pool.query(
    `UPDATE wizmatch_companies SET is_prime = true, updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [company_id, tenantId],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Company not found' });
    return;
  }
  res.json(result.rows[0]);
});

// ============================================================
// SECTION 5 — DOMAIN HEALTH ROUTES
// ============================================================

router.get('/domains', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const result = await pool.query(
    `SELECT * FROM wizmatch_domain_health WHERE tenant_id = $1 ORDER BY domain`,
    [tenantId],
  );
  res.json({ items: result.rows });
});

router.post('/domains/:id/pause', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { reason } = req.body as { reason: string };
  const result = await pool.query(
    `UPDATE wizmatch_domain_health SET status = 'paused', paused_reason = $3, paused_at = NOW()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [req.params.id, tenantId, reason],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Domain not found' });
    return;
  }

  if (WIZMATCH_SYSTEM_CHANNEL) {
    await sendSlackMessage(WIZMATCH_SYSTEM_CHANNEL, `⏸️ Domain *${result.rows[0].domain}* paused: ${reason}`).catch(() => {});
  }

  res.json(result.rows[0]);
});

router.post('/domains/:id/resume', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const result = await pool.query(
    `UPDATE wizmatch_domain_health SET status = 'healthy', paused_reason = NULL, paused_at = NULL
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [req.params.id, tenantId],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Domain not found' });
    return;
  }

  if (WIZMATCH_SYSTEM_CHANNEL) {
    await sendSlackMessage(WIZMATCH_SYSTEM_CHANNEL, `▶️ Domain *${result.rows[0].domain}* resumed`).catch(() => {});
  }

  res.json(result.rows[0]);
});

// ============================================================
// SECTION 6 — COMPLIANCE ROUTES
// ============================================================

router.get('/suppression', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramIdx = 2;

  if (req.query.email) {
    conditions.push(`email = $${paramIdx++}`);
    params.push(req.query.email);
  }
  if (req.query.reason) {
    conditions.push(`reason = $${paramIdx++}`);
    params.push(req.query.reason);
  }

  const whereClause = conditions.join(' AND ');
  const result = await pool.query(
    `SELECT * FROM wizmatch_suppression_list WHERE ${whereClause}
     ORDER BY suppressed_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset],
  );

  res.json({ items: result.rows });
});

router.post('/suppression', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { email, reason, source_channel, notes } = req.body as {
    email: string; reason: string; source_channel?: string; notes?: string;
  };

  try {
    const [entry] = await db
      .insert(wizmatchSuppressionList)
      .values({
        tenantId,
        email: email.toLowerCase().trim(),
        reason,
        sourceChannel: source_channel || 'email',
        notes,
      })
      .onConflictDoNothing()
      .returning();

    // Also set contact_channels email_opt_out if contact exists
    await pool.query(
      `UPDATE contacts SET do_not_contact = true, opted_in_email = false
       WHERE tenant_id = $1 AND id IN (
         SELECT contact_id FROM contact_channels WHERE channel_type = 'email' AND channel_value = $2
       )`,
      [tenantId, email.toLowerCase().trim()],
    ).catch(() => {});

    res.json(entry || { suppressed: true, already_existed: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to suppress', detail: e instanceof Error ? e.message : 'unknown' });
  }
});

// GET /api/wizmatch/env-check — read-only diagnostics for the System page's
// "System Health / Env" tab. Presence-only: never returns secret values, only
// which alias (if any) satisfied each check.
router.get('/env-check', async (req: Request, res: Response) => {
  const checks = buildWizmatchEnvReport();
  const groups = Array.from(new Set(checks.map((c) => c.group)));
  let sourceRows: Array<{ source: string; count: number; lastSeen: string | null }> = [];
  let sourceHealthError: string | null = null;
  try {
    const tenantId = req.user?.tenantId;
    if (tenantId) {
      const sourceResult = await pool.query(
        `SELECT source,COUNT(*)::int AS count,MAX(created_at) AS last_seen
         FROM wizmatch_job_signals WHERE tenant_id=$1 GROUP BY source ORDER BY source`,
        [tenantId],
      );
      sourceRows = sourceResult.rows.map((row) => ({ source: row.source, count: Number(row.count || 0), lastSeen: row.last_seen || null }));
    }
  } catch {
    sourceHealthError = 'Source counts are temporarily unavailable';
  }
  const sourceByName = new Map(sourceRows.map((row) => [String(row.source).toLowerCase(), row]));
  const diceEvidence = sourceByName.get('dice');
  const theirStackEvidence = sourceByName.get('theirstack');
  const sourceHealth = [
    { source: 'dice', configuration: 'external_ci_secret_unverifiable', count: diceEvidence?.count || 0, lastSeen: diceEvidence?.lastSeen || null },
    { source: 'theirstack', configuration: process.env.THEIRSTACK_API_KEY ? 'configured' : 'not_configured', count: theirStackEvidence?.count || 0, lastSeen: theirStackEvidence?.lastSeen || null },
    ...sourceRows.filter((row) => !['dice', 'theirstack'].includes(String(row.source).toLowerCase())).map((row) => ({ ...row, configuration: 'observed_rows' })),
  ];
  res.json({
    checks,
    groups,
    staffingPhases: {
      gateA: isStaffingPhaseEnabled('A'),
      gateB: isStaffingPhaseEnabled('B'),
      gateC: isStaffingPhaseEnabled('C'),
    },
    documentAccess: 'private_signed_urls',
    sourceHealth,
    sourceHealthError,
    generatedAt: new Date().toISOString(),
  });
});

// GET /api/wizmatch/unsubscribe — public, HMAC-verified
router.get('/unsubscribe', async (req: Request, res: Response) => {
  const email = (req.query.email as string)?.toLowerCase().trim();
  const sig = req.query.sig as string;

  if (!email || !sig) {
    res.status(400).type('html').send('<h1>Invalid unsubscribe link</h1>');
    return;
  }

  // Verify HMAC. Fail closed when no secret is configured (never fall back to the
  // public 'default-secret'), and compare in constant time — never `!==`, which
  // short-circuits and leaks length/prefix via timing. Mirrors src/middleware/internalAuth.ts.
  const unsubSecret = WIZMATCH_UNSUBSCRIBE_HMAC_SECRET;
  if (!unsubSecret) {
    logger.error('[wizmatch] WIZMATCH_UNSUBSCRIBE_HMAC_SECRET not set — rejecting unsubscribe as invalid');
    res.status(403).type('html').send('<h1>Invalid signature</h1>');
    return;
  }

  const expectedSig = crypto
    .createHmac('sha256', unsubSecret)
    .update(email)
    .digest('base64url');

  const providedBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  // Length-guard first because timingSafeEqual throws on unequal-length buffers.
  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    res.status(403).type('html').send('<h1>Invalid signature</h1>');
    return;
  }

  // Get tenant from any wizmatch_suppression matching — fall back to WIZMATCH_TENANT_ID
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  if (!tenantId) {
    res.status(500).type('html').send('<h1>Server misconfigured</h1>');
    return;
  }

  await db
    .insert(wizmatchSuppressionList)
    .values({
      tenantId,
      email,
      reason: 'unsubscribe',
      sourceChannel: 'email',
    })
    .onConflictDoNothing();

  // Also set do_not_contact on any matching contact
  await pool.query(
    `UPDATE contacts SET do_not_contact = true, opted_in_email = false
     WHERE tenant_id = $1 AND id IN (
       SELECT contact_id FROM contact_channels WHERE channel_type = 'email' AND channel_value = $2
     )`,
    [tenantId, email],
  ).catch(() => {});

  if (WIZMATCH_SYSTEM_CHANNEL) {
    await sendSlackMessage(WIZMATCH_SYSTEM_CHANNEL, `🚫 Unsubscribe: ${email}`).catch(() => {});
  }

  res.type('html').send(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>Unsubscribed — Wizmatch</title></head>
    <body style="font-family: system-ui; max-width: 500px; margin: 80px auto; text-align: center; color: #333;">
      <h1>You've been unsubscribed</h1>
      <p>You will no longer receive outreach emails from Wizmatch.</p>
      <p style="color: #888; font-size: 14px;">${email}</p>
    </body>
    </html>
  `);
});

// ============================================================
// SECTION 7 — REPLY CLASSIFICATION (internal)
// ============================================================

router.post('/classify-reply', requireInternalToken, async (req: Request, res: Response) => {
  const tenantId = process.env.WIZMATCH_TENANT_ID!;
  const { signal_id, reply_text, contact_email } = req.body as {
    signal_id: string; reply_text: string; contact_email: string;
  };

  if (!reply_text || !contact_email) {
    res.status(400).json({ error: 'reply_text and contact_email required' });
    return;
  }

  try {
    // Reuse the existing Haiku classifier from outreachEnrichmentService
    // Signature: classifyReplyWithAI(replyBody, originalIcebreaker, companyName)
    // Returns: { category, confidence, summary, draftReply }
    // Categories: INTERESTED | NOT_NOW | NOT_INTERESTED | UNSUBSCRIBE | UNCATEGORIZED
    const { classifyReplyWithAI } = await import('../services/outreachEnrichmentService');
    const result = await classifyReplyWithAI(reply_text, '', contact_email);

    // Map outreach categories to Wizmatch signal status
    if (result.category === 'INTERESTED') {
      await pool.query(
        `UPDATE wizmatch_job_signals SET status = 'replied_positive' WHERE id = $1 AND tenant_id = $2`,
        [signal_id, tenantId],
      );

      // Positive reply: Slack alert + create SDR task
      if (WIZMATCH_LEADS_CHANNEL) {
        await sendSlackMessage(
          WIZMATCH_LEADS_CHANNEL,
          `🔥 *POSITIVE REPLY* from ${contact_email}\nCategory: ${result.category} (${result.confidence}%)\nSummary: ${result.summary}`,
          undefined,
          { allowDuringPause: true }, // client-acquisition alert — fires even while routine Slack is paused
        ).catch(() => {});
      }

      // Create SDR task
      await pool.query(
        `INSERT INTO tasks (tenant_id, title, description, status, due_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'open', NOW() + INTERVAL '2 hours', NOW(), NOW())`,
        [
          tenantId,
          `Call ${contact_email} re: positive reply`,
          `Signal: ${signal_id}\nSummary: ${result.summary}\nReply: ${reply_text.slice(0, 500)}`,
        ],
      );
    } else if (result.category === 'NOT_INTERESTED' || result.category === 'UNSUBSCRIBE') {
      await pool.query(
        `UPDATE wizmatch_job_signals SET status = 'dead' WHERE id = $1 AND tenant_id = $2`,
        [signal_id, tenantId],
      );

      // Auto-suppress
      await db.insert(wizmatchSuppressionList).values({
        tenantId,
        email: contact_email,
        reason: result.category === 'UNSUBSCRIBE' ? 'unsubscribe' : 'do_not_contact',
        sourceChannel: 'email',
      }).onConflictDoNothing();
    } else if (result.category === 'NOT_NOW') {
      // Reschedule — set status back to sent for sequence to handle nurture
      await pool.query(
        `UPDATE wizmatch_job_signals SET status = 'sent' WHERE id = $1 AND tenant_id = $2`,
        [signal_id, tenantId],
      );
    }

    res.json({ signal_id, classification: result });
  } catch (e) {
    logger.error({ err: e }, '[wizmatch] classify-reply failed');
    res.status(500).json({ error: 'classification failed', detail: e instanceof Error ? e.message : 'unknown' });
  }
});

// ============================================================
// SECTION 8 — ANALYTICS + DIGEST
// ============================================================

router.get('/digest', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);

  const stats = await optionalWizmatchStatsQuery(
    'daily digest',
    `SELECT
       (SELECT COUNT(*)::int FROM wizmatch_job_signals WHERE tenant_id = $1 AND created_at::date = $2) AS signals_captured,
       (SELECT COUNT(*)::int FROM wizmatch_job_signals WHERE tenant_id = $1 AND created_at::date = $2 AND score >= 7) AS signals_priority,
       (SELECT COUNT(*)::int FROM messages WHERE tenant_id = $1 AND sent_at::date = $2 AND channel = 'email' AND direction = 'outbound') AS sends,
       (SELECT COUNT(*)::int FROM wizmatch_job_signals WHERE tenant_id = $1 AND status = 'replied_positive' AND created_at::date = $2) AS positive_replies,
       (SELECT COUNT(*)::int FROM wizmatch_candidates WHERE tenant_id = $1 AND created_at::date = $2) AS candidates_sourced,
       (SELECT COUNT(*)::int FROM wizmatch_job_signals WHERE tenant_id = $1 AND status = 'matched' AND created_at::date = $2) AS matches_made,
       (SELECT COUNT(*)::int FROM wizmatch_placements WHERE tenant_id = $1 AND updated_at::date = $2) AS placements_updated
    `,
    [tenantId, date],
    {
      signals_captured: 0,
      signals_priority: 0,
      sends: 0,
      positive_replies: 0,
      candidates_sourced: 0,
      matches_made: 0,
      placements_updated: 0,
    },
  );

  res.json({ date, stats: stats.rows[0] });
});

router.get('/analytics', async (req: Request, res: Response) => {
  if (!['admin', 'team_lead'].includes(req.user!.role)) {
    res.status(403).json({ error: 'commercial_access_requires_lead' });
    return;
  }
  const tenantId = req.user!.tenantId;
  const from = (req.query.from as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);

  // Reply rate by domain
  const domainStats = await pool.query(
    `SELECT
       d.domain,
       d.sends_7d,
       d.reply_rate_7d,
       d.bounce_rate_7d,
       d.status
     FROM wizmatch_domain_health d
     WHERE d.tenant_id = $1
     ORDER BY d.domain`,
    [tenantId],
  );

  // Pipeline value by stage
  const pipelineStats = await pool.query(
    `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(margin_hourly * 160), 0)::int AS monthly_value
     FROM wizmatch_placements
     WHERE tenant_id = $1
     GROUP BY status
     ORDER BY status`,
    [tenantId],
  );

  // Signal source breakdown
  const sourceStats = await pool.query(
    `SELECT source, COUNT(*)::int AS count, AVG(score)::real AS avg_score
     FROM wizmatch_job_signals
     WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3
     GROUP BY source
     ORDER BY count DESC`,
    [tenantId, from, to + ' 23:59:59'],
  );

  res.json({
    from,
    to,
    domains: domainStats.rows,
    pipeline: pipelineStats.rows,
    sources: sourceStats.rows,
  });
});

async function fetchOptionalContactIntelligenceRoiStats(tenantId: string): Promise<WizmatchRoiAnalyticsInput['contactIntelligence']> {
  try {
    const result = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int
          FROM wizmatch_company_intelligence
          WHERE tenant_id = $1 AND status IN ('qualified', 'needs_review', 'ready_for_discovery', 'discovery_blocked', 'discovered')) AS companies_qualified,
         (SELECT COUNT(*)::int
          FROM wizmatch_company_intelligence
          WHERE tenant_id = $1 AND reviewed_at IS NOT NULL) AS companies_reviewed,
         (SELECT COUNT(*)::int
          FROM wizmatch_contact_candidates
          WHERE tenant_id = $1 AND status IN ('approved', 'linked_to_crm')) AS contacts_approved,
         (SELECT COUNT(*)::int
          FROM wizmatch_contact_candidates
          WHERE tenant_id = $1 AND status = 'linked_to_crm') AS contacts_linked,
         (SELECT COUNT(*)::int
          FROM wizmatch_discovery_runs
          WHERE tenant_id = $1 AND status = 'blocked_by_cap') AS paid_runs_blocked,
         (SELECT COALESCE(SUM(cost_cents), 0)::int
          FROM wizmatch_discovery_runs
          WHERE tenant_id = $1) AS cost_cents_total`,
      [tenantId],
    );
    const row = result.rows[0] ?? {};
    return {
      companiesQualified: numeric(row.companies_qualified),
      companiesReviewed: numeric(row.companies_reviewed),
      contactsApproved: numeric(row.contacts_approved),
      contactsLinked: numeric(row.contacts_linked),
      paidRunsBlocked: numeric(row.paid_runs_blocked),
      costCentsTotal: numeric(row.cost_cents_total),
    };
  } catch (e) {
    if (!isOptionalWizmatchSchemaError(e, [
      'wizmatch_company_intelligence',
      'wizmatch_contact_candidates',
      'wizmatch_discovery_runs',
    ])) {
      logger.error({ err: e }, '[wizmatch] unexpected contact intelligence ROI stats schema error');
      throw e;
    }
    logger.warn({ err: e }, '[wizmatch] contact intelligence ROI stats unavailable');
    return {
      companiesQualified: 0,
      companiesReviewed: 0,
      contactsApproved: 0,
      contactsLinked: 0,
      paidRunsBlocked: 0,
      costCentsTotal: 0,
    };
  }
}

router.get('/analytics/roi', async (req: Request, res: Response) => {
  if (!['admin', 'team_lead'].includes(req.user!.role)) {
    res.status(403).json({ error: 'commercial_access_requires_lead' });
    return;
  }
  const tenantId = req.user!.tenantId;
  const from = (req.query.from as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
  const toEnd = `${to} 23:59:59`;

  const [
    signalStats,
    contactIntelligence,
    candidateStats,
    requirementStats,
    placementStats,
    sourceStats,
  ] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE COALESCE(score, 0) >= 7)::int AS priority,
         COUNT(*) FILTER (WHERE LOWER(COALESCE(location, '') || ' ' || COALESCE(source, '')) LIKE ANY (ARRAY['%india%','%bangalore%','%bengaluru%','%hyderabad%','%pune%','%chennai%','%mumbai%','%delhi%','%noida%','%gurgaon%','%gurugram%']))::int AS india,
         COUNT(*) FILTER (WHERE NOT (LOWER(COALESCE(location, '') || ' ' || COALESCE(source, '')) LIKE ANY (ARRAY['%india%','%bangalore%','%bengaluru%','%hyderabad%','%pune%','%chennai%','%mumbai%','%delhi%','%noida%','%gurgaon%','%gurugram%'])))::int AS us,
         COUNT(*) FILTER (WHERE status = 'matched')::int AS matched,
         COUNT(*) FILTER (WHERE status = 'drafted')::int AS drafted,
         COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
         COUNT(*) FILTER (WHERE status = 'replied_positive')::int AS positive_replies
       FROM wizmatch_job_signals
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3`,
      [tenantId, from, toEnd],
    ),
    fetchOptionalContactIntelligenceRoiStats(tenantId),
    pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE availability_status = 'available')::int AS available,
         COUNT(*) FILTER (WHERE is_wizmatch_certified = true)::int AS certified,
         COUNT(*) FILTER (WHERE LOWER(COALESCE(location, '')) LIKE ANY (ARRAY['%india%','%bangalore%','%bengaluru%','%hyderabad%','%pune%','%chennai%','%mumbai%','%delhi%','%noida%','%gurgaon%','%gurugram%']))::int AS india,
         COUNT(*) FILTER (WHERE NOT (LOWER(COALESCE(location, '')) LIKE ANY (ARRAY['%india%','%bangalore%','%bengaluru%','%hyderabad%','%pune%','%chennai%','%mumbai%','%delhi%','%noida%','%gurgaon%','%gurugram%'])))::int AS us
       FROM wizmatch_candidates
       WHERE tenant_id = $1`,
      [tenantId],
    ),
    optionalWizmatchStatsQuery(
      'requirements ROI',
      `SELECT
         COUNT(*) FILTER (WHERE status <> 'closed')::int AS open,
         COUNT(*) FILTER (WHERE status <> 'closed' AND priority = 'urgent')::int AS urgent,
         COUNT(*) FILTER (WHERE status = 'sheet_ready')::int AS sheet_ready,
         COUNT(*) FILTER (WHERE status = 'shared')::int AS shared,
         COUNT(*) FILTER (WHERE status = 'closed')::int AS closed
       FROM wizmatch_requirements
       WHERE tenant_id = $1`,
      [tenantId],
      {
        open: 0,
        urgent: 0,
        sheet_ready: 0,
        shared: 0,
        closed: 0,
      },
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('submitted', 'interviewing', 'offered', 'started'))::int AS active,
         COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted,
         COUNT(*) FILTER (WHERE status = 'interviewing')::int AS interviewing,
         COUNT(*) FILTER (WHERE status = 'offered')::int AS offered,
         COUNT(*) FILTER (WHERE status = 'started')::int AS started,
         COUNT(*) FILTER (WHERE status = 'lost')::int AS lost,
         COALESCE(SUM(CASE WHEN status = 'started' THEN margin_hourly * 160 ELSE 0 END), 0)::int AS monthly_margin
       FROM wizmatch_placements
       WHERE tenant_id = $1`,
      [tenantId],
    ),
    pool.query(
      `SELECT source, COUNT(*)::int AS count, COALESCE(AVG(score), 0)::real AS avg_score
       FROM wizmatch_job_signals
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3
       GROUP BY source
       ORDER BY count DESC`,
      [tenantId, from, toEnd],
    ),
  ]);

  const signalsRow = signalStats.rows[0] ?? {};
  const candidatesRow = candidateStats.rows[0] ?? {};
  const requirementsRow = requirementStats.rows[0] ?? {};
  const placementsRow = placementStats.rows[0] ?? {};

  res.json(buildWizmatchRoiAnalytics({
    from,
    to,
    signals: {
      total: numeric(signalsRow.total),
      priority: numeric(signalsRow.priority),
      india: numeric(signalsRow.india),
      us: numeric(signalsRow.us),
      matched: numeric(signalsRow.matched),
      drafted: numeric(signalsRow.drafted),
      sent: numeric(signalsRow.sent),
      positiveReplies: numeric(signalsRow.positive_replies),
    },
    contactIntelligence,
    candidates: {
      total: numeric(candidatesRow.total),
      available: numeric(candidatesRow.available),
      certified: numeric(candidatesRow.certified),
      india: numeric(candidatesRow.india),
      us: numeric(candidatesRow.us),
    },
    requirements: {
      open: numeric(requirementsRow.open),
      urgent: numeric(requirementsRow.urgent),
      sheetReady: numeric(requirementsRow.sheet_ready),
      shared: numeric(requirementsRow.shared),
      closed: numeric(requirementsRow.closed),
    },
    placements: {
      active: numeric(placementsRow.active),
      submitted: numeric(placementsRow.submitted),
      interviewing: numeric(placementsRow.interviewing),
      offered: numeric(placementsRow.offered),
      started: numeric(placementsRow.started),
      lost: numeric(placementsRow.lost),
      monthlyMargin: numeric(placementsRow.monthly_margin),
    },
    sourceBreakdown: sourceStats.rows.map((row) => ({
      source: row.source || 'unknown',
      count: numeric(row.count),
      avgScore: numeric(row.avg_score),
    })),
  }));
});

// ============================================================
// SECTION 9 — REQUIREMENTS (client JD → branded vendor sheet)
// ============================================================

// POST /requirements/parse — parse pasted text or an uploaded JD file into
// structured fields (no persistence). If a file is uploaded, also store it to
// R2 and return source_file_url so the create step can persist it.
router.post('/requirements/parse', requirementUpload.single('file'), async (req: Request, res: Response) => {
  const text = (req.body?.text as string) || undefined;
  const file = req.file;

  if (!text && !file) {
    res.status(400).json({ error: 'Provide requirement text or a file' });
    return;
  }
  if (file && !ALLOWED_REQ_MEDIA.includes(file.mimetype)) {
    res.status(400).json({ error: `Unsupported file type ${file.mimetype}. Allowed: PDF, PNG, JPEG, WEBP` });
    return;
  }

  try {
    const parsed = await parseRequirement({
      text,
      fileBase64: file ? file.buffer.toString('base64') : undefined,
      mediaType: file?.mimetype,
    });

    // Persist the source file so it can be attached to the requirement record.
    let sourceFileUrl: string | null = null;
    if (file) {
      try {
        const { uploadPrivateToR2 } = await import('../utils/r2');
        sourceFileUrl = await uploadPrivateToR2(file.buffer, `wizmatch/requirements/sources/${Date.now()}-${file.originalname || 'jd'}`, file.mimetype);
      } catch (e) {
        logger.warn(`[wizmatch-req] source file upload skipped: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }

    res.json({ parsed, source_file_url: sourceFileUrl });
  } catch (e) {
    logger.error({ err: e }, '[wizmatch] requirement parse failed');
    res.status(500).json({ error: 'parse failed', detail: e instanceof Error ? e.message : 'unknown' });
  }
});

// GET /requirements — list
router.get('/requirements', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const conditions: string[] = ['r.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramIdx = 2;
  if (req.query.status) { conditions.push(`r.status = $${paramIdx++}`); params.push(req.query.status); }
  if (req.query.stage) { conditions.push(`r.stage = $${paramIdx++}`); params.push(req.query.stage); }
  if (req.query.attribution_status) { conditions.push(`r.attribution_status = $${paramIdx++}`); params.push(req.query.attribution_status); }
  if (req.query.region) { conditions.push(`r.region = $${paramIdx++}`); params.push(req.query.region); }
  if (req.query.company) { conditions.push(`comp.name ILIKE $${paramIdx++}`); params.push(`%${req.query.company}%`); }
  if (req.query.skill) { conditions.push(`$${paramIdx++} = ANY(r.required_skills)`); params.push(req.query.skill); }
  if (req.query.location) { conditions.push(`r.location ILIKE $${paramIdx++}`); params.push(`%${req.query.location}%`); }
  if (req.query.work_mode) { conditions.push(`r.work_mode = $${paramIdx++}`); params.push(req.query.work_mode); }
  if (req.query.employment_type) { conditions.push(`r.employment_type = $${paramIdx++}`); params.push(req.query.employment_type); }
  if (req.query.priority) { conditions.push(`r.priority = $${paramIdx++}`); params.push(req.query.priority); }
  if (req.query.source_contact) {
    conditions.push(`EXISTS (SELECT 1 FROM wizmatch_requirement_contacts src_rc JOIN wizmatch_company_contacts src_cc ON src_cc.id=src_rc.company_contact_id JOIN contacts src_c ON src_c.id=src_cc.contact_id WHERE src_rc.tenant_id=r.tenant_id AND src_rc.requirement_id=r.id AND src_rc.active AND concat_ws(' ',src_c.first_name,src_c.last_name) ILIKE $${paramIdx++})`);
    params.push(`%${req.query.source_contact}%`);
  }
  if (req.query.assigned_user_id) {
    conditions.push(`EXISTS (SELECT 1 FROM wizmatch_requirement_assignments ra_filter WHERE ra_filter.tenant_id=r.tenant_id AND ra_filter.requirement_id=r.id AND ra_filter.active AND ra_filter.user_id=$${paramIdx++})`);
    params.push(req.query.assigned_user_id);
  }
  const minExperienceRaw = req.query.min_experience;
  if (minExperienceRaw !== undefined && minExperienceRaw !== '') {
    const minExperience = Number(minExperienceRaw);
    if (Number.isFinite(minExperience)) {
      conditions.push(`COALESCE(r.max_experience, r.min_experience) >= $${paramIdx++}`);
      params.push(minExperience);
    }
  }

  const whereClause = conditions.join(' AND ');
  const dataResult = await pool.query(
    `SELECT r.*, comp.name AS company_name, ci.qualification_tier AS company_tier,
            source_person.company_contact_id AS primary_source_relationship_id,
            source_person.contact_id AS primary_source_contact_id,
            source_person.source_name AS primary_source_name,
            source_person.source_email AS primary_source_email,
            COALESCE(team.assignments, '[]'::jsonb) AS assignments
     FROM wizmatch_requirements r
     LEFT JOIN wizmatch_companies comp ON comp.id = r.company_id AND comp.tenant_id = r.tenant_id
     LEFT JOIN wizmatch_company_intelligence ci
       ON ci.company_id = r.company_id AND ci.tenant_id = r.tenant_id
     LEFT JOIN LATERAL (
       SELECT cc.id AS company_contact_id,c.id AS contact_id,concat_ws(' ',c.first_name,c.last_name) AS source_name,
              (SELECT channel_value FROM contact_channels ch WHERE ch.tenant_id=r.tenant_id AND ch.contact_id=c.id AND ch.channel_type='email' ORDER BY ch.is_primary DESC,ch.created_at LIMIT 1) AS source_email
       FROM wizmatch_requirement_contacts rc
       JOIN wizmatch_company_contacts cc ON cc.id=rc.company_contact_id AND cc.tenant_id=rc.tenant_id
       JOIN contacts c ON c.id=cc.contact_id AND c.tenant_id=rc.tenant_id
       WHERE rc.tenant_id=r.tenant_id AND rc.requirement_id=r.id AND rc.active AND rc.is_primary_source LIMIT 1
     ) source_person ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object('id',a.id,'user_id',u.id,'name',u.name,'email',u.email,'role',a.role) ORDER BY a.role,u.name) AS assignments
       FROM wizmatch_requirement_assignments a JOIN users u ON u.id=a.user_id AND u.tenant_id=a.tenant_id
       WHERE a.tenant_id=r.tenant_id AND a.requirement_id=r.id AND a.active
     ) team ON true
     WHERE ${whereClause}
     ORDER BY r.created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset],
  );
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM wizmatch_requirements r
     LEFT JOIN wizmatch_companies comp ON comp.id = r.company_id AND comp.tenant_id = r.tenant_id
     WHERE ${whereClause}`,
    params,
  );
  res.json({ items: dataResult.rows, total: countResult.rows[0]?.total ?? 0 });
});

// GET /requirements/:id
router.get('/requirements/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const result = await pool.query(
    `SELECT r.*, comp.name AS company_name
     FROM wizmatch_requirements r
     LEFT JOIN wizmatch_companies comp ON comp.id = r.company_id AND comp.tenant_id = r.tenant_id
     WHERE r.id = $1 AND r.tenant_id = $2`,
    [req.params.id, tenantId],
  );
  if (result.rows.length === 0) { res.status(404).json({ error: 'Requirement not found' }); return; }
  res.json(result.rows[0]);
});

// POST /requirements — create from the confirmed form
router.post('/requirements', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const b = req.body as Record<string, unknown>;

  if (!b.title) { res.status(400).json({ error: 'title required' }); return; }
  if (!b.company_id) { res.status(400).json({ error: 'company_id required' }); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const company = await client.query(`SELECT id FROM wizmatch_companies WHERE id=$1 AND tenant_id=$2`, [b.company_id, tenantId]);
    if (!company.rowCount) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'invalid company_id' });
      return;
    }
    const result = await client.query(
      `INSERT INTO wizmatch_requirements
     (tenant_id, company_id, title, raw_jd, required_skills, nice_to_have_skills,
      min_experience, max_experience, location, work_mode, employment_type, region,
      budget_min, budget_max, budget_currency, budget_period, positions, priority,
      mask_client, source_file_url, vendor_notes, created_by, received_at, last_activity_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW(),NOW(),NOW(),NOW())
     RETURNING *`,
      [
      tenantId,
      b.company_id,
      b.title,
      b.raw_jd || null,
      (b.required_skills as string[]) || [],
      (b.nice_to_have_skills as string[]) || [],
      b.min_experience ?? null,
      b.max_experience ?? null,
      b.location || null,
      b.work_mode || null,
      b.employment_type || null,
      b.region || 'india',
      b.budget_min ?? null,
      b.budget_max ?? null,
      b.budget_currency || 'INR',
      b.budget_period || 'monthly',
      b.positions ?? 1,
      b.priority || 'normal',
      b.mask_client === false ? false : true,
      b.source_file_url || null,
      b.vendor_notes || null,
      req.user!.id || null,
      ],
    );
    await client.query(
      `INSERT INTO wizmatch_staffing_events (tenant_id,actor_user_id,event_type,company_id,requirement_id,payload)
       VALUES ($1,$2,'requirement.created',$3,$4,$5::jsonb)`,
      [tenantId, req.user!.id, b.company_id, result.rows[0].id, JSON.stringify({ title: b.title, stage: 'draft' })],
    );
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

// PUT /requirements/:id — edit fields / status (allowlist, like PUT /candidates)
router.put('/requirements/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const updates = req.body as Record<string, unknown>;

  const allowed = [
    'title', 'raw_jd', 'required_skills', 'nice_to_have_skills', 'min_experience',
    'max_experience', 'location', 'work_mode', 'employment_type', 'region',
    'budget_min', 'budget_max', 'budget_currency', 'budget_period', 'positions',
    'priority', 'mask_client', 'vendor_notes', 'status', 'company_id',
  ];
  const setClauses: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [req.params.id, tenantId];
  let paramIdx = 3;
  for (const [key, value] of Object.entries(updates)) {
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (allowed.includes(snakeKey)) {
      setClauses.push(`${snakeKey} = $${paramIdx++}`);
      params.push(value);
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (updates.company_id) {
      const company = await client.query(`SELECT id FROM wizmatch_companies WHERE id=$1 AND tenant_id=$2`, [updates.company_id, tenantId]);
      if (!company.rowCount) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'invalid company_id' });
        return;
      }
      const current = await client.query(`SELECT company_id FROM wizmatch_requirements WHERE id=$1 AND tenant_id=$2`, [req.params.id, tenantId]);
      if (current.rowCount && current.rows[0].company_id !== updates.company_id) {
        const attributed = await client.query(`SELECT 1 FROM wizmatch_requirement_contacts WHERE tenant_id=$1 AND requirement_id=$2 AND active LIMIT 1`, [tenantId, req.params.id]);
        if (attributed.rowCount) {
          await client.query('ROLLBACK');
          res.status(409).json({ error: 'active attribution exists', message: 'Deactivate or reassign requirement contacts before changing the company' });
          return;
        }
      }
    }
    const result = await client.query(
      `UPDATE wizmatch_requirements SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      params,
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Requirement not found' });
      return;
    }
    await client.query(
      `INSERT INTO wizmatch_staffing_events (tenant_id,actor_user_id,event_type,company_id,requirement_id,payload)
       VALUES ($1,$2,'requirement.updated',$3,$4,$5::jsonb)`,
      [tenantId, req.user!.id, result.rows[0].company_id, req.params.id, JSON.stringify({ fields: Object.keys(updates) })],
    );
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

// POST /requirements/:id/sheet — generate the branded PDF
router.post('/requirements/:id/sheet', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const result = await generateRequirementSheet(String(req.params.id), tenantId);
  if (!result.success) { res.status(500).json({ error: result.error }); return; }
  res.json({ sheet_url: result.sheet_url });
});

// ── On-demand candidate sourcing ─────────────────────────────────────────────
// POST /candidates/source-now — recruiter-triggered "Source now" button. Runs the
// GitHub miner or LinkedIn X-ray scraper live for one skill+location instead of
// waiting for the daily cron (see worker.ts, which still calls these with no
// adhoc arg on its own schedule — unaffected by this route).
//
// SAFETY: this spends real external API quota — GitHub is 5000/hr with a token,
// but SerpAPI's free tier is only ~100 searches/MONTH. Never loop this; each
// call below runs exactly one query and returns the miner's own result counts.
router.post('/candidates/source-now', async (req: Request, res: Response) => {
  const body = req.body as { provider?: string; skill?: string; location?: string };
  const { provider } = body;
  const skill = typeof body.skill === 'string' ? body.skill.trim() : '';
  const location = typeof body.location === 'string' ? body.location.trim() : '';

  if (provider !== 'github' && provider !== 'xray') {
    res.status(400).json({ error: "provider must be 'github' or 'xray'" });
    return;
  }
  if (!skill || !location) {
    res.status(400).json({ error: 'skill and location are required' });
    return;
  }

  try {
    if (provider === 'github') {
      const result = await mineGithubCandidates(1, { skill, location });
      res.json({
        ok: true,
        provider,
        created: result.candidates_created,
        found: result.users_found,
        skipped: result.skipped_exists,
      });
      return;
    }

    const result = await runXrayScrape(1, { skill, location });
    res.json({
      ok: true,
      provider,
      created: result.candidates_created,
      found: result.candidates_found,
      skipped: result.skipped_exists,
    });
  } catch (e) {
    logger.error('[wizmatch] candidates/source-now failed:', e instanceof Error ? e.message : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'On-demand sourcing failed' });
  }
});

export default router;
