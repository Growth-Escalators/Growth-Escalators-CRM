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
  events,
} from '../db/schema';
import { requireInternalToken } from '../middleware/internalAuth';
import { isStaffingPhaseEnabled } from './wizmatchStaffing';
import { scoreSignalById, enrichSignalById, matchSignalById } from '../services/wizmatchSignalPipeline';
import { callClaude, parseClaudeJSON, CLAUDE_MODELS } from '../services/claudeService';
import { findOrCreateContact, normalizeChannelValue } from '../services/contactService';
import { classifyWizmatchClientLead, linkApprovedWizmatchClientLead } from '../services/wizmatchClientLeadLink';
import { sendSlackMessage } from '../services/slackService';
import {
  WIZMATCH_LEADS_CHANNEL,
  WIZMATCH_SYSTEM_CHANNEL,
  WIZMATCH_DAILY_CHANNEL,
  WIZMATCH_UNSUBSCRIBE_HMAC_SECRET,
  WIZMATCH_MEETING_URL,
  WIZMATCH_INDIA_ONLY,
  INDIA_LOCATION_MARKERS,
  US_LOCATION_MARKERS,
} from '../config/constants';
import multer from 'multer';
import { parseRequirement, generateRequirementSheet } from '../services/wizmatchRequirementSheet';
import {
  resolveContactIntelligenceReviewAction,
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
  getWizmatchContactDiscoveryConfig,
  isWizmatchXrayCandidateSourcingEnabled,
} from '../services/wizmatchContactDiscovery';
import { getWizmatchAutomationStatus } from '../services/wizmatchAutomation';
import logger from '../utils/logger';
import { mineGithubCandidates } from '../services/wizmatchGithubMiner';
import { runRequirementXray, runXrayScrape } from '../services/wizmatchXrayScraper';
import { fetchTheirStackPreview, importTheirStackJobs, previewTheirStackImport, validateTheirStackAccount } from '../services/wizmatchTheirStackImporter';
import { getSearchApiRunUsage, validateSearchApiAccount } from '../services/wizmatchSearchApi';
import { detectAtsType, pollAtsBoards } from '../services/wizmatchAtsPoller';
import {
  discoverFreePocsForSignal,
  getWizmatchSourcingConfig,
  ingestWizmatchSignals,
  previewFreePocSearch,
  promoteSignalToRequirement,
  qualifySignalAndCreatePocTask,
  rejectSignal,
  withWizmatchSourceLock,
} from '../services/wizmatchSourcing';
import {
  numeric,
  firstString,
  optionalWizmatchValue,
  optionalWizmatchStatsQuery,
  isOptionalWizmatchSchemaError,
} from '../services/wizmatchOptionalSchema';
import {
  splitName,
  fetchContactIntelligenceCompanyRows,
  buildContactIntelligenceResult,
  withPersistedContactIntelligence,
  fetchInternalContactCandidatesBatch,
  fetchPersistedContactIntelligenceBatch,
  fetchPersistedContactIntelligence,
  persistContactIntelligenceSnapshot,
  buildContactDiscoveryInput,
  buildContactDiscoveryCostGuard,
  buildContactDiscoveryCostControls,
  normalizeDomain,
  seedProspectCompany,
  runManualPaidContactDiscovery,
  type ContactIntelligenceCompanyRow,
  type PersistedContactIntelligence,
} from '../services/wizmatchContactIntelligenceRepo';
import { generateSignalDraftEmails, sendSignalDraftEmail } from '../services/wizmatchOutreachService';

const router = Router();


// In-memory upload for requirement JD files (parsed by Claude, then discarded).
const requirementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});
const ALLOWED_REQ_MEDIA = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

type CommandCenterMetricsRow = {
  active_signals: number | string | null;
  priority_signals: number | string | null;
  available_candidates: number | string | null;
  open_requirements: number | string | null;
  active_placements: number | string | null;
  paused_domains: number | string | null;
  suppressed_contacts: number | string | null;
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
       AND LOWER(r.title) NOT LIKE 'zz audit test%'
       AND LOWER(r.title) NOT LIKE '%(delete me)%'
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
       AND EXISTS (SELECT 1 FROM wizmatch_candidate_skills verified_skill
                   WHERE verified_skill.tenant_id=wc.tenant_id AND verified_skill.candidate_id=wc.id AND verified_skill.verified=true)
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
        FROM wizmatch_candidates wc
        WHERE tenant_id = $1 AND availability_status = 'available'
          AND EXISTS (SELECT 1 FROM wizmatch_candidate_skills cs WHERE cs.tenant_id=wc.tenant_id AND cs.candidate_id=wc.id AND cs.verified=true)) AS available_candidates,
       (SELECT COUNT(*)::int
        FROM wizmatch_requirements
        WHERE tenant_id = $1 AND status <> 'closed'
          AND LOWER(title) NOT LIKE 'zz audit test%' AND LOWER(title) NOT LIKE '%(delete me)%') AS open_requirements,
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
    pool.query(`SELECT COUNT(*)::int AS total FROM wizmatch_candidates wc WHERE tenant_id = $1
      AND EXISTS (SELECT 1 FROM wizmatch_candidate_skills cs WHERE cs.tenant_id=wc.tenant_id AND cs.candidate_id=wc.id AND cs.verified=true)`, [tenantId]),
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
       WHERE tenant_id = $1 AND status <> 'closed'
         AND LOWER(title) NOT LIKE 'zz audit test%' AND LOWER(title) NOT LIKE '%(delete me)%'`,
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
  res.json({ ...readiness, costControls, automation: getWizmatchAutomationStatus() });
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
  const result = await runManualPaidContactDiscovery(tenantId, req.user?.id, companyId, confirmPreview);
  switch (result.kind) {
    case 'not_found':
      res.status(404).json({ error: 'Company intelligence source not found' });
      return;
    case 'confirm_required':
      res.status(400).json({
        error: 'Run discovery requires confirmPreview=true after reviewing discovery-preview.',
        preview: result.preview,
      });
      return;
    case 'ineligible':
      res.status(result.httpStatus).json({ error: 'Company is not eligible for paid discovery.', preview: result.preview });
      return;
    case 'locked_out':
      res.status(429).json({
        error: 'Another paid discovery run is already in progress for this company.',
        preview: result.preview,
      });
      return;
    case 'cost_blocked':
      res.status(result.httpStatus).json({
        error: 'Paid discovery is blocked by cost guard.',
        preview: result.preview,
        discoveryRunId: result.discoveryRunId,
      });
      return;
    case 'succeeded':
      res.json(result.body);
      return;
  }
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

// DELETE /api/wizmatch/contact-intelligence/contacts/:candidateId — permanent
// delete, unlinked only. Once linked to a CRM contact, use reject/do-not-contact
// instead — the CRM contact and its history must never be touched by this route.
router.delete('/contact-intelligence/contacts/:candidateId', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const candidateId = String(req.params.candidateId);
  if (!['admin', 'team_lead'].includes(req.user!.role)) {
    res.status(403).json({ error: 'delete_requires_lead' });
    return;
  }
  const existing = await pool.query(
    `SELECT id, name, crm_contact_id, status FROM wizmatch_contact_candidates WHERE tenant_id=$1 AND id=$2`,
    [tenantId, candidateId],
  );
  if (!existing.rowCount) {
    res.status(404).json({ error: 'Contact candidate not found' });
    return;
  }
  const contactCandidate = existing.rows[0];
  if (contactCandidate.crm_contact_id || contactCandidate.status === 'linked_to_crm') {
    res.status(409).json({
      error: 'has_dependencies',
      message: 'Cannot delete — this contact is linked to a CRM contact. Mark it do-not-contact/rejected instead.',
      dependencies: ['linked CRM contact'],
    });
    return;
  }
  await pool.query(`DELETE FROM wizmatch_contact_candidates WHERE id=$1 AND tenant_id=$2`, [candidateId, tenantId]);
  res.json({ deleted: true, id: candidateId });
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

router.get('/sourcing/status', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const config = getWizmatchSourcingConfig();
  const [latest, providers, searchApiAccount, theirStackAccount, searchApiUsage] = await Promise.all([pool.query(
    `SELECT DISTINCT ON (provider) provider,status,started_at,finished_at,fetched_count,inserted_count,updated_count,
            duplicate_count,rejected_count,quota_consumed,error_message
     FROM wizmatch_source_runs WHERE tenant_id=$1 ORDER BY provider,created_at DESC`,
    [tenantId],
  ), pool.query(
    `SELECT provider,
            MAX(finished_at) FILTER (WHERE status IN ('succeeded','partial')) AS last_success_at,
            MAX(finished_at) FILTER (WHERE status='failed') AS last_failure_at,
            COALESCE(SUM(quota_consumed) FILTER (WHERE created_at>=CURRENT_DATE),0)::int AS daily_usage,
            COALESCE(SUM(quota_consumed) FILTER (WHERE created_at>=date_trunc('month',CURRENT_DATE)),0)::int AS monthly_usage,
            COALESCE(SUM(inserted_count),0)::int AS inserted_total,
            COALESCE(SUM(duplicate_count),0)::int AS duplicate_total,
            COALESCE(SUM(rejected_count),0)::int AS rejected_total
     FROM wizmatch_source_runs WHERE tenant_id=$1 GROUP BY provider ORDER BY provider`,
    [tenantId],
  ), validateSearchApiAccount(), validateTheirStackAccount(), getSearchApiRunUsage(tenantId)]);
  res.json({
    config,
    latestRuns: latest.rows,
    providers: providers.rows,
    providerAccounts: { searchapi: searchApiAccount, theirstack: theirStackAccount },
    searchApiUsage: {
      ...searchApiUsage,
      dailyLimit: config.searchApiDailyCap,
      monthlyLimit: config.searchApiMonthlyCap,
      dailyRemaining: Math.max(0, config.searchApiDailyCap - searchApiUsage.daily),
      monthlyRemaining: Math.max(0, config.searchApiMonthlyCap - searchApiUsage.monthly),
    },
  });
});

router.get('/sourcing/runs', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const result = await pool.query(
    `SELECT * FROM wizmatch_source_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [req.user!.tenantId, limit],
  );
  res.json({ items: result.rows, total: result.rows.length });
});

router.post('/sourcing/:provider/preview', async (req: Request, res: Response) => {
  const provider = String(req.params.provider);
  if (provider === 'theirstack') {
    try { res.json(await fetchTheirStackPreview()); }
    catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : 'TheirStack preview failed' }); }
    return;
  }
  if (provider === 'ats') {
    const count = await pool.query(
      `SELECT COUNT(*)::int AS count FROM wizmatch_companies WHERE tenant_id=$1 AND ats_type IN ('greenhouse','lever','ashby') AND ats_slug IS NOT NULL AND ats_board_url IS NOT NULL`,
      [req.user!.tenantId],
    );
    res.json({ enabled: getWizmatchSourcingConfig().atsEnabled, approvedCompanies: count.rows[0]?.count || 0 });
    return;
  }
  res.status(400).json({ error: 'provider must be theirstack or ats' });
});

router.post('/sourcing/:provider/run', async (req: Request, res: Response) => {
  try {
    const provider = String(req.params.provider);
    if (provider === 'theirstack') {
      if (!getWizmatchSourcingConfig().theirstackEnabled) { res.status(403).json({ error: 'TheirStack sourcing is disabled or not configured' }); return; }
      const result = await withWizmatchSourceLock(req.user!.tenantId, provider, () => importTheirStackJobs({ trigger: 'manual', requestedBy: req.user!.id }));
      if (!result) { res.status(409).json({ error: 'A TheirStack source run is already active' }); return; }
      res.json(result); return;
    }
    if (provider === 'ats') {
      if (!getWizmatchSourcingConfig().atsEnabled) { res.status(403).json({ error: 'ATS polling is disabled' }); return; }
      const result = await withWizmatchSourceLock(req.user!.tenantId, provider, () => pollAtsBoards({ trigger: 'manual', requestedBy: req.user!.id }));
      if (!result) { res.status(409).json({ error: 'An ATS source run is already active' }); return; }
      res.json(result); return;
    }
    res.status(400).json({ error: 'provider must be theirstack or ats' });
  } catch (error) {
    logger.error({ err: error }, '[wizmatch/sourcing] manual run failed');
    res.status(500).json({ error: error instanceof Error ? error.message : 'Sourcing run failed' });
  }
});

router.post('/companies/:id/ats/detect', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const company = await pool.query(
    `SELECT id,domain FROM wizmatch_companies WHERE tenant_id=$1 AND id=$2 LIMIT 1`,
    [tenantId, String(req.params.id)],
  );
  if (!company.rows[0]) { res.status(404).json({ error: 'Company not found' }); return; }
  if (!company.rows[0].domain) { res.status(409).json({ error: 'Company domain is required before ATS detection' }); return; }
  res.json({ detected: await detectAtsType(company.rows[0].domain), confirmed: false });
});

router.post('/companies/:id/ats', async (req: Request, res: Response) => {
  const atsType = firstString(req.body?.atsType);
  const atsSlug = firstString(req.body?.atsSlug);
  const atsBoardUrl = firstString(req.body?.atsBoardUrl);
  if (!['greenhouse', 'lever', 'ashby'].includes(atsType || '') || !atsSlug || !atsBoardUrl) {
    res.status(400).json({ error: 'A supported ATS type, slug, and confirmed board URL are required' }); return;
  }
  const updated = await pool.query(
    `UPDATE wizmatch_companies SET ats_type=$3,ats_slug=$4,ats_board_url=$5,updated_at=NOW()
     WHERE tenant_id=$1 AND id=$2 RETURNING id,name,domain,ats_type,ats_slug,ats_board_url`,
    [req.user!.tenantId, String(req.params.id), atsType, atsSlug, atsBoardUrl],
  );
  if (!updated.rows[0]) { res.status(404).json({ error: 'Company not found' }); return; }
  res.json({ company: updated.rows[0], confirmed: true });
});

router.post('/signals/:id/qualify', async (req: Request, res: Response) => {
  try { res.json(await qualifySignalAndCreatePocTask(req.user!.tenantId, String(req.params.id), req.user!.id)); }
  catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : 'Signal qualification failed' }); }
});

router.post('/signals/:id/reject', async (req: Request, res: Response) => {
  try { res.json(await rejectSignal(req.user!.tenantId, String(req.params.id), req.user!.id, firstString(req.body?.reason) || undefined)); }
  catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : 'Signal rejection failed' }); }
});

// DELETE /signals/:id — permanent delete, unqualified + unlinked only.
// A signal that was promoted into a requirement must never be deleted (it's
// the source-of-truth trace for that requirement); reject it instead.
router.delete('/signals/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const signalId = String(req.params.id);
  if (!['admin', 'team_lead'].includes(req.user!.role)) {
    res.status(403).json({ error: 'delete_requires_lead' });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id, job_title, status, company_id FROM wizmatch_job_signals WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
      [signalId, tenantId],
    );
    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Signal not found' });
      return;
    }
    const signal = existing.rows[0];
    if (['placed'].includes(signal.status)) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'not_deletable_status', message: `Signals with status "${signal.status}" cannot be deleted.` });
      return;
    }
    const linkedRequirement = await client.query(
      `SELECT id, title FROM wizmatch_requirements WHERE tenant_id=$1 AND source_job_signal_id=$2 LIMIT 1`,
      [tenantId, signalId],
    );
    if (linkedRequirement.rowCount) {
      await client.query('ROLLBACK');
      res.status(409).json({
        error: 'has_dependencies',
        message: `Cannot delete — this signal was promoted into requirement "${linkedRequirement.rows[0].title}". Reject it instead if it's no longer relevant.`,
        dependencies: [`requirement: ${linkedRequirement.rows[0].title}`],
      });
      return;
    }
    await client.query(
      `INSERT INTO wizmatch_staffing_events (tenant_id,actor_user_id,event_type,company_id,payload)
       VALUES ($1,$2,'job_signal.deleted',$3,$4::jsonb)`,
      [tenantId, req.user!.id, signal.company_id, JSON.stringify({ deletedJobSignalId: signalId, jobTitle: signal.job_title, reason: firstString(req.body?.reason) || null })],
    );
    await client.query(`UPDATE wizmatch_task_links SET job_signal_id = NULL WHERE tenant_id=$1 AND job_signal_id=$2`, [tenantId, signalId]);
    await client.query(`DELETE FROM wizmatch_job_signals WHERE id=$1 AND tenant_id=$2`, [signalId, tenantId]);
    await client.query('COMMIT');
    res.json({ deleted: true, id: signalId });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

// Read-only dry-run: shows the exact query + remaining SearchAPI allowance +
// cooldown/cost estimate for the free POC search. Calls no provider.
router.post('/signals/:id/discover-poc/preview', async (req: Request, res: Response) => {
  try { res.json(await previewFreePocSearch(req.user!.tenantId, String(req.params.id), req.body?.roles)); }
  catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : 'POC preview failed' }); }
});

router.post('/signals/:id/discover-poc', async (req: Request, res: Response) => {
  try { res.json(await discoverFreePocsForSignal(req.user!.tenantId, String(req.params.id), req.user!.id, req.body?.roles)); }
  catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : 'POC discovery failed' }); }
});

router.post('/signals/:id/promote-to-requirement', async (req: Request, res: Response) => {
  try {
    const result = await promoteSignalToRequirement(req.user!.tenantId, String(req.params.id), req.user!.id);
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : 'Signal promotion failed' }); }
});

router.post('/requirements/:id/source-candidates-xray', async (req: Request, res: Response) => {
  try {
    const result = await withWizmatchSourceLock(req.user!.tenantId, `xray:${String(req.params.id)}`, () => runRequirementXray(req.user!.tenantId, String(req.params.id), req.user!.id));
    if (!result) { res.status(409).json({ error: 'Candidate sourcing is already running for this requirement' }); return; }
    res.json(result);
  }
  catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : 'Requirement X-Ray failed' }); }
});

// Safe ORDER BY builder for the filterable list endpoints. The frontend sends
// `sort=<columnKey>:<asc|desc>`; SQL is only ever emitted from a fixed allowlist
// (values are hard-coded column expressions) and the direction is normalised —
// the user-supplied key/dir are used solely to look things up, never interpolated.
// A stable tiebreaker keeps pagination deterministic across pages.
function wizmatchOrderBy(sortRaw: unknown, allow: Record<string, string>, fallback: string, tiebreak: string): string {
  if (typeof sortRaw === 'string' && sortRaw.includes(':')) {
    const [key, dirRaw] = sortRaw.split(':');
    const col = allow[key];
    if (col) return `ORDER BY ${col} ${dirRaw === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, ${tiebreak}`;
  }
  return fallback;
}

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

  // Comma-separated multi-value support: "a,b" → = ANY(...). Single value works too.
  const csv = (raw: unknown) => String(raw).split(',').map((s) => s.trim()).filter(Boolean);

  if (req.query.q) {
    conditions.push(`(s.job_title ILIKE $${paramIdx} OR c.name ILIKE $${paramIdx})`);
    params.push(`%${String(req.query.q)}%`);
    paramIdx++;
  }
  if (req.query.status) {
    conditions.push(`s.status = ANY($${paramIdx++}::text[])`);
    params.push(csv(req.query.status));
  }
  if (req.query.source) {
    conditions.push(`s.source = ANY($${paramIdx++}::text[])`);
    params.push(csv(req.query.source));
  }
  if (req.query.employment_type) {
    conditions.push(`s.employment_type = ANY($${paramIdx++}::text[])`);
    params.push(csv(req.query.employment_type));
  }
  if (req.query.min_score) {
    conditions.push(`s.score >= $${paramIdx++}`);
    params.push(Number(req.query.min_score));
  }
  if (req.query.score_max) {
    conditions.push(`s.score <= $${paramIdx++}`);
    params.push(Number(req.query.score_max));
  }
  if (req.query.days_open_min) {
    conditions.push(`s.days_open >= $${paramIdx++}`);
    params.push(Number(req.query.days_open_min));
  }
  if (req.query.days_open_max) {
    conditions.push(`s.days_open <= $${paramIdx++}`);
    params.push(Number(req.query.days_open_max));
  }
  if (req.query.has_contact === '1') {
    conditions.push('s.contact_id IS NOT NULL');
  }
  if (req.query.posted_from) {
    conditions.push(`s.posted_at >= $${paramIdx++}`);
    params.push(req.query.posted_from);
  }
  if (req.query.posted_to) {
    conditions.push(`s.posted_at <= $${paramIdx++}`);
    params.push(req.query.posted_to);
  }
  if (req.query.company_id) {
    conditions.push(`s.company_id = $${paramIdx++}`);
    params.push(req.query.company_id);
  }

  // India-only view. Signals have no region column, so we filter on the
  // free-text location: "confident-US" = matches a US marker AND not an India
  // marker. Default (no region param) applies india-only when the tenant flag is
  // on; region=india forces it; region=all bypasses; region=us inverts it. This
  // hides existing US rows without deleting them (they stay queryable via `all`).
  const regionParam = String(req.query.region || '').toLowerCase();
  const usPatterns = US_LOCATION_MARKERS.map((m) => `%${m}%`);
  const indiaPatterns = INDIA_LOCATION_MARKERS.map((m) => `%${m}%`);
  const applyIndiaFilter = regionParam === 'india' || (regionParam === '' && WIZMATCH_INDIA_ONLY);
  if (applyIndiaFilter) {
    conditions.push(`NOT (LOWER(COALESCE(s.location,'')) LIKE ANY($${paramIdx}::text[]) AND LOWER(COALESCE(s.location,'')) NOT LIKE ANY($${paramIdx + 1}::text[]))`);
    params.push(usPatterns, indiaPatterns);
    paramIdx += 2;
  } else if (regionParam === 'us') {
    conditions.push(`(LOWER(COALESCE(s.location,'')) LIKE ANY($${paramIdx}::text[]) AND LOWER(COALESCE(s.location,'')) NOT LIKE ANY($${paramIdx + 1}::text[]))`);
    params.push(usPatterns, indiaPatterns);
    paramIdx += 2;
  }

  const whereClause = conditions.join(' AND ');
  const orderBy = wizmatchOrderBy(req.query.sort, {
    job_title: 's.job_title', company_name: 'c.name', days_open: 's.days_open',
    score: 's.score', source: 's.source', status: 's.status',
  }, 'ORDER BY s.score DESC NULLS LAST, s.created_at DESC', 's.created_at DESC');

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id AND c.tenant_id = s.tenant_id
     WHERE ${whereClause}`,
    params,
  );
  const total = countResult.rows[0]?.total ?? 0;

  const dataResult = await pool.query(
    `SELECT s.*, c.name AS company_name, c.domain AS company_domain,
            cnt.first_name AS contact_first_name, cnt.last_name AS contact_last_name
     FROM wizmatch_job_signals s
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id AND c.tenant_id=s.tenant_id
     LEFT JOIN contacts cnt ON cnt.id = s.contact_id AND cnt.tenant_id=s.tenant_id
     WHERE ${whereClause}
     ${orderBy}
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
     LEFT JOIN wizmatch_companies c ON c.id = s.company_id AND c.tenant_id=s.tenant_id
     LEFT JOIN contacts cnt ON cnt.id = s.contact_id AND cnt.tenant_id=s.tenant_id
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
       JOIN contacts c ON c.id = wc.contact_id AND c.tenant_id=wc.tenant_id
       WHERE wc.id = ANY($1::uuid[]) AND wc.tenant_id=$2`,
      [signal.matched_candidate_ids, tenantId],
    );
    matchedCandidates = candResult.rows;
  }

  // Get draft messages
  const draftsResult = await pool.query(
    `SELECT id, content, metadata, status, sent_at
     FROM messages
     WHERE tenant_id=$3 AND contact_id = $1 AND metadata->>'signal_id' = $2
     ORDER BY sent_at DESC`,
    [signal.contact_id, req.params.id, tenantId],
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

  const result = await ingestWizmatchSignals(tenantId, incomingSignals);
  logger.info(`[wizmatch] ingest: ${result.inserted} new, ${result.updated} updated, ${result.errors} errors`);
  res.json(result);
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
  const signalId = String(req.params.id);
  const result = await generateSignalDraftEmails(tenantId, signalId);
  switch (result.kind) {
    case 'not_found':
      res.status(404).json({ error: 'Signal not found' });
      return;
    case 'no_contact':
      res.status(400).json({ error: 'Signal has no enriched contact — run /enrich first' });
      return;
    case 'failed':
      res.status(500).json({ error: 'draft generation failed', detail: result.detail });
      return;
    case 'succeeded':
      res.json(result.body);
      return;
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
  const { variant_message_id } = req.body as { variant_message_id: string };

  if (!variant_message_id) {
    res.status(400).json({ error: 'variant_message_id required' });
    return;
  }

  const result = await sendSignalDraftEmail(tenantId, variant_message_id);
  switch (result.kind) {
    case 'not_found':
      res.status(404).json({ error: 'Draft message not found' });
      return;
    case 'no_email_channel':
      res.status(400).json({ error: 'Contact has no email channel' });
      return;
    case 'suppressed':
      res.status(400).json({ error: 'Contact is on suppression list' });
      return;
    case 'hmac_secret_unset':
      res.status(500).json({ error: 'unsubscribe signing secret not configured' });
      return;
    case 'failed':
      res.status(500).json({ error: 'send failed', detail: result.detail });
      return;
    case 'succeeded':
      res.json(result.body);
      return;
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

  const csv = (raw: unknown) => String(raw).split(',').map((s) => s.trim()).filter(Boolean);

  if (req.query.q) {
    conditions.push(`(c.first_name ILIKE $${paramIdx} OR c.last_name ILIKE $${paramIdx})`);
    params.push(`%${String(req.query.q)}%`);
    paramIdx++;
  }
  if (req.query.skill) {
    // Multi-skill: candidate has ANY of the requested skills (array overlap).
    conditions.push(`wc.skills && $${paramIdx++}::text[]`);
    params.push(csv(req.query.skill));
  }
  if (req.query.visa_status) {
    conditions.push(`wc.visa_status = ANY($${paramIdx++}::text[])`);
    params.push(csv(req.query.visa_status));
  }
  if (req.query.availability_status) {
    conditions.push(`wc.availability_status = ANY($${paramIdx++}::text[])`);
    params.push(csv(req.query.availability_status));
  }
  if (req.query.source) {
    conditions.push(`wc.source = ANY($${paramIdx++}::text[])`);
    params.push(csv(req.query.source));
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
  const maxExperience = Number(req.query.experience_max);
  if (req.query.experience_max && Number.isFinite(maxExperience)) {
    conditions.push(`wc.experience_years <= $${paramIdx++}`);
    params.push(maxExperience);
  }
  if (req.query.rate_min) {
    conditions.push(`wc.rate_hourly >= $${paramIdx++}`);
    params.push(Number(req.query.rate_min));
  }
  if (req.query.rate_max) {
    conditions.push(`wc.rate_hourly <= $${paramIdx++}`);
    params.push(Number(req.query.rate_max));
  }
  if (req.query.certified === '1') {
    conditions.push('wc.is_wizmatch_certified = true');
  }

  const whereClause = conditions.join(' AND ');
  const orderBy = wizmatchOrderBy(req.query.sort, {
    name: "concat_ws(' ', c.first_name, c.last_name)", location: 'wc.location',
    visa_status: 'wc.visa_status', experience_years: 'wc.experience_years',
    rate_hourly: 'wc.rate_hourly', availability_status: 'wc.availability_status', source: 'wc.source',
  }, 'ORDER BY wc.created_at DESC', 'wc.created_at DESC');
  const dataResult = await pool.query(
    `SELECT wc.*, c.first_name, c.last_name, c.company_name
     FROM wizmatch_candidates wc
     JOIN contacts c ON c.id = wc.contact_id
     WHERE ${whereClause}
     ${orderBy}
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset],
  );

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM wizmatch_candidates wc
     JOIN contacts c ON c.id = wc.contact_id
     WHERE ${whereClause}`,
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

// DELETE /candidates/:id — permanent delete, unlinked only. A candidate with
// any match or submission history must be archived (PUT availability_status)
// instead, never hard-deleted.
router.delete('/candidates/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const candidateId = String(req.params.id);
  if (!['admin', 'team_lead'].includes(req.user!.role)) {
    res.status(403).json({ error: 'delete_requires_lead' });
    return;
  }
  const existing = await pool.query(`SELECT id FROM wizmatch_candidates WHERE id=$1 AND tenant_id=$2`, [candidateId, tenantId]);
  if (!existing.rowCount) {
    res.status(404).json({ error: 'Candidate not found' });
    return;
  }
  const [matches, submissions] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM wizmatch_candidate_requirement_matches WHERE tenant_id=$1 AND candidate_id=$2`, [tenantId, candidateId]),
    pool.query(`SELECT COUNT(*)::int AS n FROM wizmatch_submissions WHERE tenant_id=$1 AND candidate_id=$2`, [tenantId, candidateId]),
  ]);
  const dependencies: string[] = [];
  if (matches.rows[0].n > 0) dependencies.push(`${matches.rows[0].n} requirement match(es)`);
  if (submissions.rows[0].n > 0) dependencies.push(`${submissions.rows[0].n} submission(s)`);
  if (dependencies.length) {
    res.status(409).json({
      error: 'has_dependencies',
      message: `Cannot delete — this candidate has ${dependencies.join(' and ')}. Mark unavailable instead.`,
      dependencies,
    });
    return;
  }
  await pool.query(`UPDATE wizmatch_staffing_events SET candidate_id = NULL WHERE tenant_id=$1 AND candidate_id=$2`, [tenantId, candidateId]);
  await pool.query(`UPDATE wizmatch_task_links SET candidate_id = NULL WHERE tenant_id=$1 AND candidate_id=$2`, [tenantId, candidateId]);
  await pool.query(`DELETE FROM wizmatch_candidate_skills WHERE tenant_id=$1 AND candidate_id=$2`, [tenantId, candidateId]);
  await pool.query(`DELETE FROM wizmatch_candidates WHERE id=$1 AND tenant_id=$2`, [candidateId, tenantId]);
  res.json({ deleted: true, id: candidateId });
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
  const csvReq = (raw: unknown) => String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  const multiReq = (col: string, key: string) => {
    if (req.query[key]) { conditions.push(`${col} = ANY($${paramIdx++}::text[])`); params.push(csvReq(req.query[key])); }
  };
  if (req.query.q) { conditions.push(`r.title ILIKE $${paramIdx++}`); params.push(`%${req.query.q}%`); }
  multiReq('r.status', 'status');
  multiReq('r.stage', 'stage');
  multiReq('r.attribution_status', 'attribution_status');
  multiReq('r.work_mode', 'work_mode');
  multiReq('r.employment_type', 'employment_type');
  multiReq('r.priority', 'priority');
  if (req.query.region) { conditions.push(`r.region = $${paramIdx++}`); params.push(req.query.region); }
  if (req.query.tier) { conditions.push(`ci.qualification_tier = ANY($${paramIdx++}::text[])`); params.push(csvReq(req.query.tier)); }
  if (req.query.company) { conditions.push(`comp.name ILIKE $${paramIdx++}`); params.push(`%${req.query.company}%`); }
  if (req.query.skill) { conditions.push(`$${paramIdx++} = ANY(r.required_skills)`); params.push(req.query.skill); }
  if (req.query.location) { conditions.push(`r.location ILIKE $${paramIdx++}`); params.push(`%${req.query.location}%`); }
  if (req.query.budget_min) { conditions.push(`COALESCE(r.budget_max, r.budget_min) >= $${paramIdx++}`); params.push(Number(req.query.budget_min)); }
  if (req.query.budget_max) { conditions.push(`COALESCE(r.budget_min, r.budget_max) <= $${paramIdx++}`); params.push(Number(req.query.budget_max)); }
  if (req.query.has_matches === '1') { conditions.push('EXISTS (SELECT 1 FROM wizmatch_candidate_requirement_matches m WHERE m.tenant_id=r.tenant_id AND m.requirement_id=r.id)'); }
  if (req.query.created_from) { conditions.push(`r.created_at >= $${paramIdx++}`); params.push(req.query.created_from); }
  if (req.query.created_to) { conditions.push(`r.created_at <= $${paramIdx++}`); params.push(req.query.created_to); }
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
  // Symmetric upper bound so the UI experience range isn't half-dead: keep
  // requirements whose ask starts at/below the cap (window overlaps [min,max]).
  const maxExperienceRaw = req.query.experience_max;
  if (maxExperienceRaw !== undefined && maxExperienceRaw !== '') {
    const maxExperience = Number(maxExperienceRaw);
    if (Number.isFinite(maxExperience)) {
      conditions.push(`COALESCE(r.min_experience, r.max_experience) <= $${paramIdx++}`);
      params.push(maxExperience);
    }
  }

  const whereClause = conditions.join(' AND ');
  const orderBy = wizmatchOrderBy(req.query.sort, {
    title: 'r.title', company_name: 'comp.name', location: 'r.location', positions: 'r.positions',
    budget: 'COALESCE(r.budget_max, r.budget_min)', region: 'r.region', status: 'r.status', candidates: 'match_count',
  }, 'ORDER BY r.created_at DESC', 'r.created_at DESC');
  const dataResult = await pool.query(
    `SELECT r.*, comp.name AS company_name, ci.qualification_tier AS company_tier,
            source_person.company_contact_id AS primary_source_relationship_id,
            source_person.contact_id AS primary_source_contact_id,
            source_person.source_name AS primary_source_name,
            source_person.source_email AS primary_source_email,
            COALESCE(team.assignments, '[]'::jsonb) AS assignments,
            COALESCE(match_rollup.match_count, 0) AS match_count
     FROM wizmatch_requirements r
     LEFT JOIN wizmatch_companies comp ON comp.id = r.company_id AND comp.tenant_id = r.tenant_id
     LEFT JOIN wizmatch_company_intelligence ci
       ON ci.company_id = r.company_id AND ci.tenant_id = r.tenant_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS match_count
       FROM wizmatch_candidate_requirement_matches m
       WHERE m.tenant_id = r.tenant_id AND m.requirement_id = r.id
     ) match_rollup ON true
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
     ${orderBy}
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset],
  );
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM wizmatch_requirements r
     LEFT JOIN wizmatch_companies comp ON comp.id = r.company_id AND comp.tenant_id = r.tenant_id
     LEFT JOIN wizmatch_company_intelligence ci ON ci.company_id = r.company_id AND ci.tenant_id = r.tenant_id
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

// DELETE /requirements/:id — permanent delete, draft + unlinked only.
// Anything with matches, submissions, or active contact attribution must be
// closed/archived (PUT status='closed' or the /transition endpoint) instead.
router.delete('/requirements/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const requirementId = String(req.params.id);
  if (!['admin', 'team_lead'].includes(req.user!.role)) {
    res.status(403).json({ error: 'delete_requires_lead' });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id, title, status, company_id FROM wizmatch_requirements WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
      [requirementId, tenantId],
    );
    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Requirement not found' });
      return;
    }
    const requirement = existing.rows[0];
    if (requirement.status !== 'draft') {
      await client.query('ROLLBACK');
      res.status(409).json({
        error: 'not_draft',
        message: 'Only draft requirements can be permanently deleted. Close or archive this requirement instead.',
      });
      return;
    }
    // A draft requirement's algorithm-computed matches are recomputable and carry
    // no human intent until someone shortlists/watches/rejects them, so a draft
    // with only *undecided* matches (and no submissions) is genuinely disposable —
    // deleting it cascades those match rows. Any human-decided match, or any
    // submission, still blocks: those represent real work that must not vanish.
    const [decidedMatches, submissions] = await Promise.all([
      client.query(`SELECT COUNT(*)::int AS n FROM wizmatch_candidate_requirement_matches WHERE tenant_id=$1 AND requirement_id=$2 AND human_decision IS NOT NULL AND human_decision <> 'unreviewed'`, [tenantId, requirementId]),
      client.query(`SELECT COUNT(*)::int AS n FROM wizmatch_submissions WHERE tenant_id=$1 AND requirement_id=$2`, [tenantId, requirementId]),
    ]);
    const dependencies: string[] = [];
    if (decidedMatches.rows[0].n > 0) dependencies.push(`${decidedMatches.rows[0].n} reviewed candidate match(es)`);
    if (submissions.rows[0].n > 0) dependencies.push(`${submissions.rows[0].n} submission(s)`);
    if (dependencies.length) {
      await client.query('ROLLBACK');
      res.status(409).json({
        error: 'has_dependencies',
        message: `Cannot delete — this requirement has ${dependencies.join(' and ')}. Close or archive it instead.`,
        dependencies,
      });
      return;
    }
    // Record the deletion in the activity log BEFORE removing the row (the FK
    // requires requirement_id to still exist), then detach/remove the rest.
    await client.query(
      `INSERT INTO wizmatch_staffing_events (tenant_id,actor_user_id,event_type,company_id,requirement_id,payload)
       VALUES ($1,$2,'requirement.deleted',$3,$4,$5::jsonb)`,
      [tenantId, req.user!.id, requirement.company_id, requirementId, JSON.stringify({ deletedRequirementId: requirementId, title: requirement.title, reason: firstString(req.body?.reason) || null })],
    );
    await client.query(`UPDATE wizmatch_staffing_events SET requirement_id = NULL WHERE tenant_id=$1 AND requirement_id=$2`, [tenantId, requirementId]);
    await client.query(`UPDATE wizmatch_task_links SET requirement_id = NULL WHERE tenant_id=$1 AND requirement_id=$2`, [tenantId, requirementId]);
    await client.query(`DELETE FROM wizmatch_requirement_contacts WHERE tenant_id=$1 AND requirement_id=$2`, [tenantId, requirementId]);
    await client.query(`DELETE FROM wizmatch_requirement_assignments WHERE tenant_id=$1 AND requirement_id=$2`, [tenantId, requirementId]);
    await client.query(`DELETE FROM wizmatch_requirement_skills WHERE tenant_id=$1 AND requirement_id=$2`, [tenantId, requirementId]);
    // Cascade the recomputable, undecided match rows for this draft. Snapshots
    // FK to the match rows, so they must go first; both FK to the requirement.
    await client.query(`DELETE FROM wizmatch_match_snapshots WHERE tenant_id=$1 AND requirement_id=$2`, [tenantId, requirementId]);
    await client.query(`DELETE FROM wizmatch_candidate_requirement_matches WHERE tenant_id=$1 AND requirement_id=$2`, [tenantId, requirementId]);
    await client.query(`DELETE FROM wizmatch_requirements WHERE id=$1 AND tenant_id=$2`, [requirementId, tenantId]);
    await client.query('COMMIT');
    res.json({ deleted: true, id: requirementId });
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
  if (provider === 'xray' && !isWizmatchXrayCandidateSourcingEnabled()) {
    res.status(403).json({ error: 'LinkedIn X-Ray sourcing is disabled until paid discovery and Google fallback are explicitly enabled' });
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
