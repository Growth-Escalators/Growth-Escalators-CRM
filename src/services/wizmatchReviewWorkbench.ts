import type { CandidateIntelligenceResult } from './wizmatchCandidateIntelligence';
import type { ClientDiscoveryResult } from './wizmatchClientDiscovery';
import type { ContactIntelligenceResult } from './wizmatchContactIntelligence';
import { CONTACT_INTELLIGENCE_PHASE1_CAPS } from './wizmatchContactIntelligence';
import type { RequirementPriorityResult } from './wizmatchRequirementPriority';

export type ReviewWorkbenchPriority = 'hot' | 'warm' | 'watch' | 'blocked';
export type ReviewWorkbenchModule =
  | 'client_discovery'
  | 'contact_intelligence'
  | 'candidate_intelligence'
  | 'requirement_priority'
  | 'safety';
export type ReviewWorkbenchActionType =
  | 'send_to_contact_intelligence'
  | 'approve_contact'
  | 'review_candidate'
  | 'prioritize_requirement'
  | 'resolve_safety'
  | 'watch';

export interface ReviewWorkbenchAction {
  id: string;
  module: ReviewWorkbenchModule;
  actionType: ReviewWorkbenchActionType;
  title: string;
  subtitle: string;
  score: number;
  priority: ReviewWorkbenchPriority;
  targetId: string;
  targetType: 'company' | 'contact_candidate' | 'candidate' | 'requirement' | 'safety';
  allowed: boolean;
  endpoint: string | null;
  method: 'GET' | 'POST' | null;
  payload: Record<string, unknown> | null;
  reasons: string[];
  guardrails: string[];
}

export interface ReviewWorkbenchInput {
  clientDiscovery: ClientDiscoveryResult[];
  contactIntelligence: ContactIntelligenceResult[];
  candidates: CandidateIntelligenceResult[];
  requirements: RequirementPriorityResult[];
  metrics?: {
    pausedDomains?: number;
    suppressedContacts?: number;
    paidRunsBlocked?: number;
  };
}

export interface ReviewWorkbenchResult {
  generatedAt: string;
  phase: 'manual_action_workbench';
  summary: {
    totalActions: number;
    hot: number;
    warm: number;
    watch: number;
    blocked: number;
    safeExecutableActions: number;
  };
  actions: ReviewWorkbenchAction[];
  safetyCenter: {
    status: ReviewWorkbenchPriority;
    blockers: string[];
    guardrails: string[];
  };
  guardrails: {
    paidEnrichment: 'disabled';
    sending: 'manual_review_only';
    submissions: 'no_automatic_submission';
    deterministicBeforeAi: true;
    maxPaidDiscoveryPerCompany: 0;
    maxContactCandidatesShown: 3;
  };
}

const PRIORITY_ORDER: Record<ReviewWorkbenchPriority, number> = {
  hot: 0,
  warm: 1,
  blocked: 2,
  watch: 3,
};

function normalizePriority(value: string | undefined): ReviewWorkbenchPriority {
  if (value === 'hot' || value === 'warm' || value === 'blocked') return value;
  return 'watch';
}

function guardrails(...extra: string[]) {
  return [
    'No paid enrichment.',
    'No automatic outreach sending.',
    'No automatic candidate submission.',
    'Manual reviewer remains in control.',
    ...extra,
  ];
}

function contactActions(items: ContactIntelligenceResult[]): ReviewWorkbenchAction[] {
  return items.flatMap((item) => {
    const actions: ReviewWorkbenchAction[] = [];
    const firstCandidate = item.contactCandidates.find((candidate) => candidate.status === 'needs_review');

    if (firstCandidate) {
      actions.push({
        id: `contact-${firstCandidate.id}`,
        module: 'contact_intelligence',
        actionType: 'approve_contact',
        title: `Approve ${firstCandidate.name}`,
        subtitle: `${item.companyName} - ${firstCandidate.title || 'title needs review'}`,
        score: firstCandidate.rankingScore,
        priority: item.qualificationTier === 'A' ? 'hot' : item.qualificationTier === 'B' ? 'warm' : 'watch',
        targetId: firstCandidate.id,
        targetType: 'contact_candidate',
        allowed: true,
        endpoint: `/api/wizmatch/contact-intelligence/contacts/${firstCandidate.id}/review`,
        method: 'POST',
        payload: { action: 'approve_contact' },
        reasons: firstCandidate.reasons.length ? firstCandidate.reasons : item.reasons.slice(0, 3),
        guardrails: guardrails('Approval only moves the contact toward CRM linking/review; it does not send outreach.'),
      });
    }

    if (item.hardBlocks.length > 0 || ['suppressed', 'cooldown', 'rejected'].includes(item.companyStatus)) {
      actions.push({
        id: `contact-safety-${item.companyId}`,
        module: 'safety',
        actionType: 'resolve_safety',
        title: `Resolve Contact Intelligence blocker for ${item.companyName}`,
        subtitle: item.hardBlocks.join(', ') || item.companyStatus,
        score: item.qualificationScore,
        priority: 'blocked',
        targetId: item.companyId,
        targetType: 'safety',
        allowed: false,
        endpoint: null,
        method: null,
        payload: null,
        reasons: item.reasons.slice(0, 4),
        guardrails: guardrails('Safety blockers require manual review before any outreach path continues.'),
      });
    }

    return actions;
  });
}

function clientActions(items: ClientDiscoveryResult[]): ReviewWorkbenchAction[] {
  return items.slice(0, 10).map((item) => ({
    id: `client-${item.id}`,
    module: item.priority === 'blocked' ? 'safety' : 'client_discovery',
    actionType: item.priority === 'blocked' ? 'resolve_safety' : item.nextAction === 'send_to_contact_intelligence' ? 'send_to_contact_intelligence' : 'watch',
    title: item.priority === 'blocked'
      ? `Resolve client blocker: ${item.companyName}`
      : `Send ${item.companyName} to Contact Intelligence`,
    subtitle: `${item.jobTitle} - ${item.region.toUpperCase()} - ${item.matchedCandidateCount} candidates`,
    score: item.score,
    priority: normalizePriority(item.priority),
    targetId: item.companyId || item.id,
    targetType: 'company',
    allowed: item.nextAction === 'send_to_contact_intelligence' && Boolean(item.companyId),
    endpoint: item.companyId ? `/api/wizmatch/client-discovery/companies/${item.companyId}/send-to-contact-intelligence` : null,
    method: item.companyId ? 'POST' : null,
    payload: {},
    reasons: item.reasons.slice(0, 4),
    guardrails: guardrails('Handoff only creates/refreshes a Contact Intelligence snapshot.'),
  }));
}

function candidateActions(items: CandidateIntelligenceResult[]): ReviewWorkbenchAction[] {
  return items.slice(0, 10).map((item) => ({
    id: `candidate-${item.id}`,
    module: item.priority === 'blocked' ? 'safety' : 'candidate_intelligence',
    actionType: item.priority === 'blocked' ? 'resolve_safety' : 'review_candidate',
    title: item.priority === 'blocked' ? `Resolve candidate blocker: ${item.name}` : `Review candidate: ${item.name}`,
    subtitle: `${item.bestUse} - ${item.region.toUpperCase()} - ${item.availabilityStatus || 'unknown availability'}`,
    score: item.score,
    priority: normalizePriority(item.priority),
    targetId: item.id,
    targetType: 'candidate',
    allowed: item.priority !== 'blocked',
    endpoint: `/api/wizmatch/candidate-intelligence/candidates/${item.id}/review`,
    method: 'POST',
    payload: { action: item.priority === 'hot' ? 'shortlist' : 'mark_reviewed' },
    reasons: [...item.reasons, ...item.concerns].slice(0, 4),
    guardrails: guardrails('Candidate review stores reviewer intent only; it does not create a submission.'),
  }));
}

function requirementActions(items: RequirementPriorityResult[]): ReviewWorkbenchAction[] {
  return items.slice(0, 10).map((item) => ({
    id: `requirement-${item.id}`,
    module: item.priority === 'blocked' ? 'safety' : 'requirement_priority',
    actionType: item.priority === 'blocked' ? 'resolve_safety' : 'prioritize_requirement',
    title: item.priority === 'blocked' ? `Resolve requirement blocker: ${item.title}` : `Prioritize requirement: ${item.title}`,
    subtitle: `${item.companyName || 'No company'} - ${item.region.toUpperCase()} - ${item.topCandidateMatches.length} matches`,
    score: item.score,
    priority: normalizePriority(item.priority),
    targetId: item.id,
    targetType: 'requirement',
    allowed: item.priority !== 'blocked',
    endpoint: `/api/wizmatch/requirement-priority/${item.id}/review-plan`,
    method: 'POST',
    payload: { action: item.nextAction },
    reasons: item.reasons.slice(0, 4),
    guardrails: guardrails('Requirement priority is planning/review only; no candidate is submitted automatically.'),
  }));
}

function buildSafetyCenter(input: ReviewWorkbenchInput): ReviewWorkbenchResult['safetyCenter'] {
  const blockers: string[] = [];
  const pausedDomains = input.metrics?.pausedDomains ?? 0;
  const suppressedContacts = input.metrics?.suppressedContacts ?? 0;
  const paidRunsBlocked = input.metrics?.paidRunsBlocked ?? 0;
  const blockedContacts = input.contactIntelligence.filter((item) => item.hardBlocks.length > 0).length;
  const blockedClients = input.clientDiscovery.filter((item) => item.priority === 'blocked').length;
  const blockedCandidates = input.candidates.filter((item) => item.priority === 'blocked').length;
  const blockedRequirements = input.requirements.filter((item) => item.priority === 'blocked').length;

  if (pausedDomains > 0) blockers.push(`${pausedDomains} paused/blacklisted sending domain(s).`);
  if (suppressedContacts > 0) blockers.push(`${suppressedContacts} suppression record(s) are active.`);
  if (paidRunsBlocked > 0) blockers.push(`${paidRunsBlocked} paid discovery request(s) were blocked by caps.`);
  if (blockedContacts > 0) blockers.push(`${blockedContacts} Contact Intelligence company blocker(s).`);
  if (blockedClients > 0) blockers.push(`${blockedClients} Client Discovery blocker(s).`);
  if (blockedCandidates > 0) blockers.push(`${blockedCandidates} Candidate Intelligence blocker(s).`);
  if (blockedRequirements > 0) blockers.push(`${blockedRequirements} requirement priority blocker(s).`);

  return {
    status: blockers.length > 0 ? 'blocked' : 'hot',
    blockers,
    guardrails: guardrails('Resolve blockers manually before increasing volume.'),
  };
}

export function buildWizmatchReviewWorkbench(input: ReviewWorkbenchInput): ReviewWorkbenchResult {
  const actions = [
    ...contactActions(input.contactIntelligence),
    ...clientActions(input.clientDiscovery),
    ...candidateActions(input.candidates),
    ...requirementActions(input.requirements),
  ]
    // The workbench is an action queue. Non-executable qualification outcomes and
    // safety conditions belong in safetyCenter; rendering them as disabled cards
    // creates permanent dead ends that consume the operator's limited queue.
    .filter((action) => action.allowed && Boolean(action.endpoint))
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.score - a.score)
    .slice(0, 30);

  return {
    generatedAt: new Date().toISOString(),
    phase: 'manual_action_workbench',
    summary: {
      totalActions: actions.length,
      hot: actions.filter((action) => action.priority === 'hot').length,
      warm: actions.filter((action) => action.priority === 'warm').length,
      watch: actions.filter((action) => action.priority === 'watch').length,
      blocked: actions.filter((action) => action.priority === 'blocked').length,
      safeExecutableActions: actions.length,
    },
    actions,
    safetyCenter: buildSafetyCenter(input),
    guardrails: {
      paidEnrichment: 'disabled',
      sending: 'manual_review_only',
      submissions: 'no_automatic_submission',
      deterministicBeforeAi: true,
      maxPaidDiscoveryPerCompany: CONTACT_INTELLIGENCE_PHASE1_CAPS.maxPaidDiscoveryPerCompany,
      maxContactCandidatesShown: CONTACT_INTELLIGENCE_PHASE1_CAPS.maxContactCandidatesShown,
    },
  };
}

export function paginateWizmatchReviewWorkbench(result: ReviewWorkbenchResult, requestedLimit: number) {
  const limit = Math.min(Math.max(Math.trunc(requestedLimit) || 30, 1), 30);
  const actions = result.actions.slice(0, limit);
  return { ...result, actions, returnedActions: actions.length };
}
