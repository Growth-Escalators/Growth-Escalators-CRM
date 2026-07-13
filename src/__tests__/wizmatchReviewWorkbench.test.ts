import { describe, expect, it } from 'vitest';
import { scoreCandidateIntelligence } from '../services/wizmatchCandidateIntelligence';
import { scoreClientDiscoveryOpportunity } from '../services/wizmatchClientDiscovery';
import { qualifyCompanyForContactIntelligence } from '../services/wizmatchContactIntelligence';
import { buildWizmatchReviewWorkbench } from '../services/wizmatchReviewWorkbench';
import { scoreRequirementPriority } from '../services/wizmatchRequirementPriority';

describe('Wizmatch Review Workbench', () => {
  const requirement = {
    id: 'req-1',
    title: 'Java Backend Developer',
    companyName: 'Bengaluru Cloud Staffing',
    requiredSkills: ['java', 'spring', 'aws', 'microservices'],
    location: 'Hyderabad, India',
    region: 'india',
    workMode: 'hybrid',
    budgetMax: 3000,
    budgetCurrency: 'INR',
    priority: 'urgent',
    status: 'sheet_ready',
  };

  const candidate = {
    id: 'candidate-1',
    contactId: 'contact-1',
    name: 'Aarav Kumar',
    skills: ['Java', 'Spring', 'AWS', 'Microservices', 'React'],
    location: 'Hyderabad, India',
    rateHourly: 2400,
    rateCurrency: 'INR',
    availabilityStatus: 'available',
    source: 'naukri',
    resumeUrl: 'https://example.com/resume.pdf',
    hasUsableContactChannel: true,
    isWizmatchCertified: true,
    requirements: [requirement],
  };

  it('prioritizes requirements with exact guardrails and no automatic submission', () => {
    const result = scoreRequirementPriority({
      ...requirement,
      candidateMatches: [candidate],
      contactApprovedCount: 1,
    });

    expect(result.priority).toBe('hot');
    expect(result.score).toBeGreaterThanOrEqual(82);
    expect(result.nextAction).toBe('review_candidates');
    expect(result.componentScores.candidateCoverage).toBeLessThanOrEqual(25);
    expect(result.topCandidateMatches[0].candidateId).toBe('candidate-1');
  });

  it('builds one safe manual queue across client, contact, candidate, requirement, and safety modules', () => {
    const contactIntelligence = qualifyCompanyForContactIntelligence({
      company: {
        id: 'company-1',
        name: 'Bengaluru Cloud Staffing',
        domain: 'bengalurucloud.example',
        country: 'India',
        industry: 'IT staffing',
      },
      signal: {
        jobTitle: 'Senior Java Developer',
        keywords: ['java', 'spring', 'aws'],
        location: 'Bangalore, India',
        score: 9,
        daysOpen: 8,
      },
      candidateSupply: { matchedCandidateCount: 3 },
      relationships: { knownContactCount: 1 },
      safety: { domainStatus: 'healthy' },
      internalContacts: [
        { id: 'contact-1', name: 'Asha Rao', title: 'Head of Talent Acquisition', email: 'asha@example.com', verified: true },
      ],
    });

    const clientDiscovery = scoreClientDiscoveryOpportunity({
      id: 'signal-1',
      jobTitle: 'Senior Java Developer',
      companyId: 'company-1',
      companyName: 'Bengaluru Cloud Staffing',
      companyIndustry: 'IT staffing',
      companyCountry: 'India',
      location: 'Bangalore, India',
      signalScore: 9,
      matchedCandidateCount: 3,
      domainStatus: 'healthy',
    });

    const candidateIntelligence = scoreCandidateIntelligence(candidate);
    const requirementPriority = scoreRequirementPriority({
      ...requirement,
      candidateMatches: [candidate],
      contactApprovedCount: 1,
    });

    const result = buildWizmatchReviewWorkbench({
      clientDiscovery: [clientDiscovery],
      contactIntelligence: [contactIntelligence],
      candidates: [candidateIntelligence],
      requirements: [requirementPriority],
      metrics: { pausedDomains: 1, suppressedContacts: 0, paidRunsBlocked: 2 },
    });

    expect(result.phase).toBe('manual_action_workbench');
    expect(result.guardrails.paidEnrichment).toBe('disabled');
    expect(result.guardrails.submissions).toBe('no_automatic_submission');
    expect(result.summary.safeExecutableActions).toBeGreaterThanOrEqual(3);
    expect(result.actions[0].priority).toBe('hot');
    expect(result.safetyCenter.status).toBe('blocked');
    expect(result.safetyCenter.blockers).toContain('1 paused/blacklisted sending domain(s).');
  });

  it('keeps only executable actions in the workbench and moves blockers to the safety center', () => {
    const safeRequirement = scoreRequirementPriority({
      ...requirement,
      candidateMatches: [candidate],
      contactApprovedCount: 1,
    });
    const blockedRequirement = scoreRequirementPriority({
      ...requirement,
      id: 'req-blocked',
      title: 'Payroll Coordinator',
      requiredSkills: [],
      candidateMatches: [],
      hasSuppression: true,
    });
    const hotCandidate = scoreCandidateIntelligence(candidate);
    const blockedCandidate = scoreCandidateIntelligence({
      ...candidate,
      id: 'candidate-blocked',
      name: 'Blocked Candidate',
      hasUsableContactChannel: false,
      availabilityStatus: 'placed',
      activePlacementCount: 1,
    });

    const result = buildWizmatchReviewWorkbench({
      clientDiscovery: [],
      contactIntelligence: [],
      candidates: [hotCandidate, blockedCandidate],
      requirements: [safeRequirement, blockedRequirement],
      metrics: { pausedDomains: 0, suppressedContacts: 0, paidRunsBlocked: 0 },
    });

    const blocked = result.actions.filter((action) => action.priority === 'blocked');

    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.actions.every((action) => action.allowed)).toBe(true);
    expect(result.actions.every((action) => action.method === 'POST' && action.endpoint?.startsWith('/api/wizmatch/'))).toBe(true);
    expect(result.actions.every((action) => action.guardrails.some((guardrail) => /No automatic|Manual reviewer|No paid/.test(guardrail)))).toBe(true);
    expect(blocked).toHaveLength(0);
    expect(result.summary.blocked).toBe(0);
    expect(result.summary.safeExecutableActions).toBe(result.actions.length);
    expect(result.safetyCenter.status).toBe('blocked');
    expect(result.safetyCenter.blockers.some((reason) => reason.includes('Candidate Intelligence'))).toBe(true);
    expect(result.safetyCenter.blockers.some((reason) => reason.includes('requirement priority'))).toBe(true);
  });
});
