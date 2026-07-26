// PRD-005 §14 "Background-job flow" — `prepareCompaniesJob`, PR 7 of the
// WizMatch Outbound Operating System stack (ge/outbound-07-free-prep).
//
// Strictly ₹0. For each tenant company where `preparationAllowed` and prep is
// stale: company normalisation, duplicate detection, the COMPANY-POLICY CHECK
// (hard stop on deny), reuse of existing signal scoring / internal CRM contact
// reuse / free website discovery / contact ranking + confidence grading, then
// two genuinely new deterministic steps — campaign recommendation and draft
// personalisation (template merge, no LLM call). Never sends, never spends,
// never enrols, never selects a provider, never grants permission to contact
// a company. Gated behind `WIZMATCH_AUTO_PREP_ENABLED` (default false).
//
// Zero-spend boundary (contract §3): this module calls ONLY
// `createDefaultWizmatchContactDiscoveryProviders().websitePatternSearch`
// (costCents: 0, no SMTP/DNS-paid step) for new-contact discovery. It never
// calls SearchAPI, Apollo, Snov, Serper, or any paid provider — those live
// behind `discoverFreePocsForSignal`'s rung 3+ and `WIZMATCH_PAID_DISCOVERY_ENABLED`,
// neither of which this module imports.
//
// Tenant-safety and idempotency: every query is `tenant_id`-scoped. The whole
// run is serialised per tenant via the existing `withWizmatchSourceLock`
// Postgres advisory lock (src/services/wizmatchSourcing.ts), so a concurrent
// or retried invocation cannot duplicate work. Per-company writes are
// themselves idempotent: the prep report is a single `jsonb` overwrite on
// `wizmatch_company_intelligence.metadata.prep` (never appended), and a new
// discovered contact candidate is inserted only when no existing
// `wizmatch_contact_candidates` row for that company already carries the same
// (lowercased) email — a rerun with no new facts writes nothing new.
//
// Storage: no migration. `wizmatch_company_intelligence` (1:1 with company)
// already carries a `metadata` jsonb column used elsewhere for free-form
// stamps (`wizmatchContactIntelligenceRepo.ts`); this module reuses it for
// `metadata.prep`, per the PRD's "prefer existing tables" instruction. A row
// is bootstrapped with `ON CONFLICT ... DO NOTHING` if the company has none.

import { pool } from '../../db';
import { isSafeFetchUrl } from '../../utils/ssrfGuard';
import { normalizeDomain, deriveConfidenceTier } from '../../services/wizmatchContactIntelligenceRepo';
import { createDefaultWizmatchContactDiscoveryProviders } from '../../services/wizmatchContactDiscoveryProviders';
import { evaluateWizmatchOutreachGate } from './outreachGate';
import { computeCampaignCompatibility } from './campaignCompatibility';
import type { ExternalHiringPolicy, RelationshipType } from './policyTypes';
import { withWizmatchSourceLock } from '../../services/wizmatchSourcing';

export const PREP_REPORT_VERSION = 1;
export const PREP_RULE_VERSION = 'prepareCompaniesJob@v1';

/** How long a prep report stays fresh before the job reconsiders the company. */
export const DEFAULT_PREP_REFRESH_DAYS = 7;

/** Bound on how many companies one job invocation processes — never unbounded fan-out. */
export const DEFAULT_PREP_BATCH_LIMIT = 25;

/** Bound on how many website-scrape fetches one job invocation performs — the
 * only outbound HTTP surface this module touches, capped independently of the
 * company batch size so a pathological batch cannot fan out unboundedly. */
export const DEFAULT_PREP_MAX_WEBSITE_FETCHES = 25;

export type PrepCompanyStatus = 'prepared' | 'skipped' | 'review_required' | 'failed';

export interface PrepProvenanceEntry {
  kind: 'internal_crm' | 'website_scrape' | 'signal_scoring' | 'policy_gate' | 'campaign_rules' | 'draft_template';
  ref: string | null;
  observedAt: string;
  confidence: 'high' | 'medium' | 'low' | null;
  ruleVersion: string;
}

export interface PrepDraft {
  subject: string;
  body: string;
  verifiedFacts: string[];
  hypotheses: string[];
}

export interface PreparedCompanyResult {
  companyId: string;
  status: PrepCompanyStatus;
  reasonCode: string | null;
  decision: 'allow' | 'review' | 'deny' | null;
  preparationAllowed: boolean;
  duplicateSuspected: boolean;
  reused: { internalContact: boolean };
  fetched: { website: boolean };
  contactCandidateId: string | null;
  contactConfidenceTier: 'high' | 'medium' | 'low' | null;
  campaignRecommendation: {
    decision: 'allow' | 'review' | 'deny';
    route: string;
    allowedCampaignTypes: string[];
    allowedOutreachModes: string[];
  } | null;
  draft: PrepDraft | null;
  provenance: PrepProvenanceEntry[];
  error: string | null;
}

export interface PrepareCompaniesReport {
  tenantId: string;
  startedAt: string;
  finishedAt: string;
  lockAcquired: boolean;
  zeroSpend: true;
  attempted: number;
  prepared: number;
  skipped: number;
  reviewRequired: number;
  failed: number;
  websiteFetchesUsed: number;
  results: PreparedCompanyResult[];
}

interface CandidateCompanyRow {
  id: string;
  name: string;
  domain: string | null;
}

/** Companies to consider this run: tenant-scoped, bounded, and — per §7 —
 * stale-or-never-prepared. "Stale" is `metadata.prep` missing, older than the
 * refresh window, or older than the company's own last update (the company
 * changed since the last prep, e.g. domain corrected, name normalised). */
async function selectCandidateCompanies(
  tenantId: string,
  limit: number,
  refreshDays: number,
): Promise<CandidateCompanyRow[]> {
  const result = await pool.query(
    `SELECT c.id, c.name, c.domain
       FROM wizmatch_companies c
       LEFT JOIN wizmatch_company_intelligence ci
         ON ci.tenant_id = c.tenant_id AND ci.company_id = c.id
      WHERE c.tenant_id = $1
        AND (
          ci.id IS NULL
          OR ci.metadata #>> '{prep,lastPreparedAt}' IS NULL
          OR (ci.metadata #>> '{prep,lastPreparedAt}')::timestamptz < NOW() - ($2 || ' days')::interval
          OR (ci.metadata #>> '{prep,lastPreparedAt}')::timestamptz < c.updated_at
        )
      ORDER BY c.updated_at DESC
      LIMIT $3`,
    [tenantId, refreshDays, limit],
  );
  return result.rows as CandidateCompanyRow[];
}

async function ensureCompanyIntelligenceRow(tenantId: string, companyId: string): Promise<void> {
  await pool.query(
    `INSERT INTO wizmatch_company_intelligence (tenant_id, company_id)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id, company_id) DO NOTHING`,
    [tenantId, companyId],
  );
}

async function findPendingDuplicateForCompany(tenantId: string, companyId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM wizmatch_company_duplicates
      WHERE tenant_id = $1 AND resolution = 'pending' AND (company_a_id = $2 OR company_b_id = $2)
      LIMIT 1`,
    [tenantId, companyId],
  );
  return (result.rowCount ?? 0) > 0;
}

interface BestSignalRow {
  jobTitle: string;
  daysOpen: number | null;
  location: string | null;
  score: number | null;
}

async function fetchBestSignal(tenantId: string, companyId: string): Promise<BestSignalRow | null> {
  // Reuse the persisted output of the existing deterministic scorer
  // (wizmatchScoring.ts) — this job never recomputes a score, it only reads
  // the highest one already on file for the company.
  const result = await pool.query(
    `SELECT job_title, days_open, location, score
       FROM wizmatch_job_signals
      WHERE tenant_id = $1 AND company_id = $2 AND status NOT IN ('dead', 'placed')
      ORDER BY score DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [tenantId, companyId],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return { jobTitle: row.job_title, daysOpen: row.days_open, location: row.location, score: row.score };
}

interface ContactCandidateRow {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  source: string;
  rankingScore: number;
  confidenceScore: number;
  status: string;
  metadata: Record<string, unknown> | null;
}

/** Internal CRM / existing-candidate reuse — free, no network call. Prefers
 * whatever is already on file over triggering a fresh discovery. */
async function fetchBestExistingCandidate(tenantId: string, companyId: string): Promise<ContactCandidateRow | null> {
  const result = await pool.query(
    `SELECT id, name, title, email, source, ranking_score, confidence_score, status, metadata
       FROM wizmatch_contact_candidates
      WHERE tenant_id = $1 AND company_id = $2 AND status NOT IN ('rejected', 'do_not_contact')
      ORDER BY ranking_score DESC, confidence_score DESC
      LIMIT 1`,
    [tenantId, companyId],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    email: row.email,
    source: row.source,
    rankingScore: row.ranking_score ?? 0,
    confidenceScore: row.confidence_score ?? 0,
    status: row.status,
    metadata: row.metadata ?? null,
  };
}

async function existingCandidateEmails(tenantId: string, companyId: string): Promise<Set<string>> {
  const result = await pool.query(
    `SELECT LOWER(email) AS email FROM wizmatch_contact_candidates
      WHERE tenant_id = $1 AND company_id = $2 AND email IS NOT NULL`,
    [tenantId, companyId],
  );
  return new Set(result.rows.map((r: { email: string }) => r.email));
}

/** Free-only website discovery. Deliberately calls ONLY
 * `websitePatternSearch` (costCents: 0) — never the SearchAPI/Apollo/Snov
 * rungs of the wider discovery cascade, which live behind
 * `discoverFreePocsForSignal` and `WIZMATCH_PAID_DISCOVERY_ENABLED`. */
async function discoverFreeWebsiteCandidate(
  tenantId: string,
  companyId: string,
  companyName: string,
  domain: string,
): Promise<ContactCandidateRow | null> {
  if (!isSafeFetchUrl(`https://${domain}`)) return null;
  const providers = createDefaultWizmatchContactDiscoveryProviders();
  // Default 'india' — matches the schema default for wizmatch_company_intelligence.target_region;
  // this rung doesn't branch on region (it only scrapes and classifies published emails).
  const found = await providers.websitePatternSearch({ companyName, domain, targetRegion: 'india' });
  if (!found.length) return null;

  const seen = await existingCandidateEmails(tenantId, companyId);
  const best = found.find((c) => c.email && !seen.has(c.email.toLowerCase())) ?? null;
  if (!best) return null;

  const inserted = await pool.query(
    `INSERT INTO wizmatch_contact_candidates
       (tenant_id, company_id, name, title, email, source, source_url,
        deliverability_status, ranking_score, confidence_score, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'needs_review', $11)
     ON CONFLICT DO NOTHING
     RETURNING id, name, title, email, source, ranking_score, confidence_score, status, metadata`,
    [
      tenantId,
      companyId,
      best.name,
      best.title,
      best.email,
      best.source,
      best.sourceUrl,
      best.deliverabilityStatus,
      best.rankingScore,
      best.confidenceScore,
      JSON.stringify(best.raw ?? {}),
    ],
  );
  if (inserted.rowCount === 0) return null;
  const row = inserted.rows[0];
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    email: row.email,
    source: row.source,
    rankingScore: row.ranking_score ?? 0,
    confidenceScore: row.confidence_score ?? 0,
    status: row.status,
    metadata: row.metadata ?? null,
  };
}

/**
 * Deterministic, evidence-grounded draft. No LLM call (PRD §14: "no Anthropic
 * call"). Only facts actually present on the row set are used; nothing is
 * invented. `hypotheses` stays empty in v1 — a future PR may add flagged,
 * clearly-labelled inference, but this module never fabricates a fact.
 */
function buildDeterministicDraft(input: {
  companyName: string;
  signal: BestSignalRow | null;
  contact: ContactCandidateRow | null;
  contactConfidenceTier: 'high' | 'medium' | 'low' | null;
}): PrepDraft {
  const verifiedFacts: string[] = [`Company: ${input.companyName}`];
  const greetingName =
    input.contactConfidenceTier === 'high' && input.contact?.name ? input.contact.name.split(' ')[0] : null;
  if (greetingName) verifiedFacts.push(`Contact name (high confidence): ${input.contact!.name}`);
  if (input.contact?.title && input.contactConfidenceTier === 'high') {
    verifiedFacts.push(`Contact title: ${input.contact.title}`);
  }
  if (input.signal?.jobTitle) verifiedFacts.push(`Open role: ${input.signal.jobTitle}`);
  if (input.signal?.location) verifiedFacts.push(`Location: ${input.signal.location}`);
  if (typeof input.signal?.daysOpen === 'number') verifiedFacts.push(`Days open: ${input.signal.daysOpen}`);

  const greeting = greetingName ? `Hi ${greetingName},` : 'Hi,';
  const roleLine = input.signal?.jobTitle
    ? `I noticed ${input.companyName} has an open ${input.signal.jobTitle} role${
        input.signal.location ? ` in ${input.signal.location}` : ''
      }.`
    : `I wanted to reach out to ${input.companyName} about your hiring needs.`;
  const subject = input.signal?.jobTitle
    ? `Re: ${input.signal.jobTitle} at ${input.companyName}`
    : `Quick note for ${input.companyName}`;
  const body = [greeting, '', roleLine, '', '[Operator: review and personalise before sending — this draft is deterministic and not spend-triggering.]'].join(
    '\n',
  );

  return { subject, body, verifiedFacts, hypotheses: [] };
}

async function prepareOneCompany(
  tenantId: string,
  company: CandidateCompanyRow,
  websiteFetchBudget: { remaining: number },
): Promise<PreparedCompanyResult> {
  const provenance: PrepProvenanceEntry[] = [];
  const now = new Date().toISOString();

  try {
    // Step 1 — company normalisation (free, pure).
    const domain = normalizeDomain(company.domain);

    // Step 2 — duplicate detection (free). Per §8.2 L5 a pending duplicate
    // blocks queue/export/send only — preparation still runs.
    const duplicateSuspected = await findPendingDuplicateForCompany(tenantId, company.id);

    // Step 3 — COMPANY-POLICY CHECK, hard stop on deny (§14 step 3).
    const decision = await evaluateWizmatchOutreachGate({ tenantId, companyId: company.id, action: 'enrol' });
    provenance.push({
      kind: 'policy_gate',
      ref: company.id,
      observedAt: now,
      confidence: null,
      ruleVersion: PREP_RULE_VERSION,
    });

    if (!decision.preparationAllowed) {
      return {
        companyId: company.id,
        status: 'skipped',
        reasonCode: decision.reasonCodes[0] ?? null,
        decision: decision.decision,
        preparationAllowed: false,
        duplicateSuspected,
        reused: { internalContact: false },
        fetched: { website: false },
        contactCandidateId: null,
        contactConfidenceTier: null,
        campaignRecommendation: null,
        draft: null,
        provenance,
        error: null,
      };
    }

    await ensureCompanyIntelligenceRow(tenantId, company.id);

    // Step 4 — signal scoring reuse (free, read-only).
    const signal = await fetchBestSignal(tenantId, company.id);
    if (signal) {
      provenance.push({
        kind: 'signal_scoring',
        ref: company.id,
        observedAt: now,
        confidence: null,
        ruleVersion: 'wizmatchScoring.ts',
      });
    }

    // Step 5 — internal CRM / existing-candidate reuse (free, read-only).
    let contact = await fetchBestExistingCandidate(tenantId, company.id);
    let reusedInternal = Boolean(contact);
    let fetchedWebsite = false;

    // Step 6 — website/public email discovery (free — rungs 1-2 only, never
    // SearchAPI/Apollo/Snov), only when nothing is already on file and the
    // per-run fetch budget allows it.
    if (!contact && domain && websiteFetchBudget.remaining > 0) {
      websiteFetchBudget.remaining -= 1;
      fetchedWebsite = true;
      contact = await discoverFreeWebsiteCandidate(tenantId, company.id, company.name, domain);
      if (contact) {
        provenance.push({
          kind: 'website_scrape',
          ref: `https://${domain}`,
          observedAt: now,
          confidence: 'low',
          ruleVersion: PREP_RULE_VERSION,
        });
      }
    }
    if (contact) {
      provenance.push({
        kind: 'internal_crm',
        ref: contact.id,
        observedAt: now,
        confidence: null,
        ruleVersion: PREP_RULE_VERSION,
      });
    }

    // Step 7 — contact ranking + confidence grading (reuse
    // deriveConfidenceTier). Cold-start gate (§7): low/unverified is never
    // surfaced as a candidate at all — the report records it happened but
    // does not offer it for outreach.
    let confidenceTier: 'high' | 'medium' | 'low' | null = null;
    let surfacedContactId: string | null = null;
    if (contact) {
      confidenceTier = deriveConfidenceTier(contact.metadata ?? undefined, contact.confidenceScore);
      if (confidenceTier === 'high' || confidenceTier === 'medium') {
        surfacedContactId = contact.id;
      }
      // low/unverified: contact stays recorded in wizmatch_contact_candidates
      // for operator visibility, but is not surfaced here — mirrors §7's
      // "not surfaced for outreach — hard block".
    }

    // Step 8 — campaign recommendation (NEW, deterministic, advisory-only).
    const hiringPolicy = (decision.effective.externalHiringPolicy?.value ?? 'unknown') as ExternalHiringPolicy;
    const relationshipType = (decision.effective.relationshipType?.value ?? 'new_prospect') as RelationshipType;
    const campaign = computeCampaignCompatibility(hiringPolicy, relationshipType);
    provenance.push({
      kind: 'campaign_rules',
      ref: null,
      observedAt: now,
      confidence: null,
      ruleVersion: 'campaignCompatibility.ts',
    });

    // Step 9 — draft personalisation (NEW, deterministic template merge, no LLM).
    const draft = buildDeterministicDraft({
      companyName: company.name,
      signal,
      contact,
      contactConfidenceTier: confidenceTier,
    });
    provenance.push({
      kind: 'draft_template',
      ref: null,
      observedAt: now,
      confidence: null,
      ruleVersion: PREP_RULE_VERSION,
    });

    const status: PrepCompanyStatus =
      decision.decision === 'review' || duplicateSuspected || confidenceTier === 'low' || !surfacedContactId
        ? 'review_required'
        : 'prepared';

    const report = {
      version: PREP_REPORT_VERSION,
      lastPreparedAt: now,
      ruleVersion: PREP_RULE_VERSION,
      policySnapshot: { decision: decision.decision, reasonCodes: decision.reasonCodes, effectiveLevel: decision.effectiveLevel },
      duplicateSuspected,
      contactCandidateId: surfacedContactId,
      contactConfidenceTier: confidenceTier,
      campaignRecommendation: campaign,
      draft,
      status,
      provenance,
    };

    await pool.query(
      `UPDATE wizmatch_company_intelligence
          SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{prep}', $3::jsonb, true),
              updated_at = NOW()
        WHERE tenant_id = $1 AND company_id = $2`,
      [tenantId, company.id, JSON.stringify(report)],
    );

    return {
      companyId: company.id,
      status,
      reasonCode: decision.reasonCodes[0] ?? null,
      decision: decision.decision,
      preparationAllowed: true,
      duplicateSuspected,
      reused: { internalContact: reusedInternal },
      fetched: { website: fetchedWebsite },
      contactCandidateId: surfacedContactId,
      contactConfidenceTier: confidenceTier,
      campaignRecommendation: {
        decision: campaign.decision,
        route: campaign.route,
        allowedCampaignTypes: campaign.allowedCampaignTypes,
        allowedOutreachModes: campaign.allowedOutreachModes,
      },
      draft,
      provenance,
      error: null,
    };
  } catch (error) {
    return {
      companyId: company.id,
      status: 'failed',
      reasonCode: null,
      decision: null,
      preparationAllowed: false,
      duplicateSuspected: false,
      reused: { internalContact: false },
      fetched: { website: false },
      contactCandidateId: null,
      contactConfidenceTier: null,
      campaignRecommendation: null,
      draft: null,
      provenance,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface PrepareCompaniesOptions {
  limit?: number;
  refreshDays?: number;
  maxWebsiteFetches?: number;
}

/**
 * The job entry point. Advisory-locked per tenant via the existing
 * `withWizmatchSourceLock` helper — a concurrent or retried invocation for
 * the same tenant returns `lockAcquired: false` immediately rather than
 * racing. Every per-company failure is isolated (caught inside
 * `prepareOneCompany`); one company's failure never aborts the batch or
 * hides another company's result.
 */
export async function prepareCompaniesJob(
  tenantId: string,
  options: PrepareCompaniesOptions = {},
): Promise<PrepareCompaniesReport> {
  const startedAt = new Date().toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_PREP_BATCH_LIMIT, 200));
  const refreshDays = options.refreshDays ?? DEFAULT_PREP_REFRESH_DAYS;
  const maxWebsiteFetches = options.maxWebsiteFetches ?? DEFAULT_PREP_MAX_WEBSITE_FETCHES;

  const outcome = await withWizmatchSourceLock(tenantId, 'prepare_companies', async () => {
    const companies = await selectCandidateCompanies(tenantId, limit, refreshDays);
    const websiteFetchBudget = { remaining: maxWebsiteFetches };
    const results: PreparedCompanyResult[] = [];
    // Sequential, not parallel fan-out — bounds per-domain concurrency to 1
    // and keeps the run's total outbound HTTP surface easy to reason about.
    for (const company of companies) {
      results.push(await prepareOneCompany(tenantId, company, websiteFetchBudget));
    }
    return results;
  });

  const results = outcome ?? [];
  const finishedAt = new Date().toISOString();
  return {
    tenantId,
    startedAt,
    finishedAt,
    lockAcquired: outcome !== null,
    zeroSpend: true,
    attempted: results.length,
    prepared: results.filter((r) => r.status === 'prepared').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    reviewRequired: results.filter((r) => r.status === 'review_required').length,
    failed: results.filter((r) => r.status === 'failed').length,
    websiteFetchesUsed: results.filter((r) => r.fetched.website).length,
    results,
  };
}

/** Single-company variant for the synchronous `POST /companies/:id/prepare`
 * route — same rules, no batch selection, still lock-serialised per tenant so
 * it cannot race the background job. */
export async function prepareSingleCompany(tenantId: string, companyId: string): Promise<PreparedCompanyResult | null> {
  const outcome = await withWizmatchSourceLock(tenantId, 'prepare_companies', async () => {
    const result = await pool.query(`SELECT id, name, domain FROM wizmatch_companies WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      companyId,
    ]);
    if (result.rowCount === 0) return null;
    const company = result.rows[0] as CandidateCompanyRow;
    return prepareOneCompany(tenantId, company, { remaining: 1 });
  });
  return outcome ?? null;
}

/** Read-only status lookup for `GET /companies/:id/prepare/status`. */
export async function getPrepStatus(tenantId: string, companyId: string): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `SELECT metadata #> '{prep}' AS prep
       FROM wizmatch_company_intelligence
      WHERE tenant_id = $1 AND company_id = $2`,
    [tenantId, companyId],
  );
  if (result.rowCount === 0) return null;
  return result.rows[0].prep ?? null;
}
