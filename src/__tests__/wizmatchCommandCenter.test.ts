import { describe, expect, it } from 'vitest';
import {
  buildWizmatchCommandCenter,
  scoreCandidateIntelligence,
  scoreClientDiscoveryOpportunity,
  scoreRequirement,
} from '../services/wizmatchCommandCenter';
import { qualifyCompanyForContactIntelligence } from '../services/wizmatchContactIntelligence';

describe('Wizmatch Command Center Phase 1', () => {
  it('scores India IT client signals as hot when candidates exist', () => {
    const result = scoreClientDiscoveryOpportunity({
      id: 'signal-1',
      jobTitle: 'Senior Java Developer',
      companyId: 'company-1',
      companyName: 'Bengaluru Systems',
      companyDomain: 'bengalurusystems.example',
      companyIndustry: 'IT staffing',
      companyCountry: 'India',
      location: 'Bangalore, India',
      score: 9,
      matchedCandidateCount: 4,
      status: 'matched',
      source: 'naukri',
    });

    expect(result.region).toBe('india');
    expect(result.priority).toBe('hot');
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.reasons).toContain('India-first priority applies.');
  });

  it('blocks non-tech client discovery even when signal score is high', () => {
    const result = scoreClientDiscoveryOpportunity({
      id: 'signal-2',
      jobTitle: 'Payroll Executive',
      companyName: 'People Suite',
      companyIndustry: 'HRMS payroll attendance',
      score: 10,
      matchedCandidateCount: 8,
    });

    expect(result.priority).toBe('blocked');
    expect(result.score).toBeLessThan(40);
    expect(result.blockers).toContain('non_tech_signal');
  });

  it('scores candidate intelligence from active demand terms without AI', () => {
    const result = scoreCandidateIntelligence(
      {
        id: 'candidate-1',
        name: 'Aarav Kumar',
        skills: ['Java', 'Spring', 'Microservices', 'AWS', 'React'],
        location: 'Hyderabad, India',
        availabilityStatus: 'available',
        source: 'naukri',
        rateHourly: 2400,
        rateCurrency: 'INR',
        isWizmatchCertified: true,
      },
      ['java', 'spring', 'microservices', 'aws'],
    );

    expect(result.priority).toBe('hot');
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.bestUse).toContain('java');
  });

  it('scores urgent India requirements as hot and keeps them explainable', () => {
    const result = scoreRequirement({
      id: 'req-1',
      title: 'Java Backend Developer',
      region: 'india',
      priority: 'urgent',
      positions: 3,
      requiredSkills: ['java', 'spring', 'microservices', 'aws'],
      budgetMax: 250000,
      status: 'sheet_ready',
    });

    expect(result.priority).toBe('hot');
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.reasons).toContain('Urgent requirement.');
  });

  it('builds a unified read-only command queue across modules', () => {
    const contactIntelligence = qualifyCompanyForContactIntelligence({
      company: {
        id: 'company-1',
        name: 'Bengaluru Cloud Staffing',
        domain: 'cloud.example',
        country: 'India',
        industry: 'IT staffing',
        isPrime: true,
      },
      signal: {
        jobTitle: 'Senior Java Developer',
        keywords: ['java', 'spring', 'aws'],
        location: 'Bangalore, India',
        score: 9,
        daysOpen: 8,
      },
      candidateSupply: { matchedCandidateCount: 3 },
      relationships: { knownContactCount: 1, isPrime: true },
      safety: { domainStatus: 'healthy' },
      internalContacts: [
        { id: 'contact-1', name: 'Asha Rao', title: 'Head of Talent Acquisition', email: 'asha@example.com', verified: true },
      ],
    });

    const result = buildWizmatchCommandCenter({
      generatedAt: '2026-07-06T00:00:00.000Z',
      metrics: {
        activeSignals: 1,
        prioritySignals: 1,
        availableCandidates: 1,
        openRequirements: 1,
        reviewReadyCompanies: 1,
        blockedCompanies: 0,
        activePlacements: 0,
        pausedDomains: 0,
        suppressedContacts: 0,
      },
      contactIntelligence: [contactIntelligence],
      signals: [{
        id: 'signal-1',
        jobTitle: 'Senior Java Developer',
        companyId: 'company-1',
        companyName: 'Bengaluru Cloud Staffing',
        companyCountry: 'India',
        companyIndustry: 'IT staffing',
        location: 'Bangalore, India',
        score: 9,
        matchedCandidateCount: 3,
      }],
      candidates: [{
        id: 'candidate-1',
        name: 'Aarav Kumar',
        skills: ['java', 'spring', 'aws', 'react'],
        location: 'Hyderabad, India',
        availabilityStatus: 'available',
        source: 'naukri',
      }],
      requirements: [{
        id: 'req-1',
        title: 'Java Backend Developer',
        region: 'india',
        priority: 'urgent',
        requiredSkills: ['java', 'spring', 'aws'],
        positions: 2,
      }],
    });

    expect(result.phase).toBe('phase_1_command_center_read_only');
    expect(result.guardrails.paidEnrichment).toBe('disabled');
    expect(result.commandQueue.length).toBeGreaterThanOrEqual(3);
    expect(result.commandQueue[0].priority).toBe('hot');
  });
});
