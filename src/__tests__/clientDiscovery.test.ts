import { describe, expect, it } from 'vitest';
import {
  scoreClientDiscoveryOpportunity,
  selectCompaniesForContactIntelligence,
} from '../services/wizmatchClientDiscovery';

describe('Wizmatch Client Discovery', () => {
  it('scores India IT signals as hot with exact deterministic components', () => {
    const result = scoreClientDiscoveryOpportunity({
      id: 'signal-1',
      jobTitle: 'Senior Java Developer',
      companyId: 'company-1',
      companyName: 'Bengaluru Systems',
      companyDomain: 'bengalurusystems.example',
      companyIndustry: 'IT staffing',
      companyCountry: 'India',
      location: 'Bangalore, India',
      signalScore: 9,
      daysOpen: 12,
      activeSignalCount: 3,
      matchedCandidateCount: 4,
      positiveReplyCount: 1,
      domainStatus: 'healthy',
    });

    expect(result.region).toBe('india');
    expect(result.priority).toBe('hot');
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.componentScores.itTechFit).toBeLessThanOrEqual(25);
    expect(result.componentScores.signalStrength).toBeLessThanOrEqual(20);
    expect(result.componentScores.regionPriority).toBeLessThanOrEqual(15);
    expect(result.componentScores.candidateSupply).toBeLessThanOrEqual(15);
    expect(result.nextAction).toBe('send_to_contact_intelligence');
  });

  it('blocks non-tech opportunities even with strong signal inputs', () => {
    const result = scoreClientDiscoveryOpportunity({
      id: 'signal-2',
      jobTitle: 'Payroll Executive',
      companyId: 'company-2',
      companyName: 'People Suite',
      companyIndustry: 'HRMS payroll attendance',
      companyCountry: 'India',
      signalScore: 10,
      matchedCandidateCount: 5,
      domainStatus: 'healthy',
    });

    expect(result.priority).toBe('blocked');
    expect(result.score).toBeLessThan(40);
    expect(result.blockers).toContain('non_tech_signal');
  });

  it('selects only hot/warm unblocked companies for Contact Intelligence handoff', () => {
    const results = [
      scoreClientDiscoveryOpportunity({
        id: 'signal-1',
        jobTitle: 'DevOps Engineer',
        companyId: 'company-1',
        companyName: 'Cloud Prime',
        companyIndustry: 'technology',
        signalScore: 9,
        matchedCandidateCount: 3,
        isPrime: true,
        domainStatus: 'healthy',
      }),
      scoreClientDiscoveryOpportunity({
        id: 'signal-2',
        jobTitle: 'Warehouse Manager',
        companyId: 'company-2',
        companyName: 'Warehouse People',
        companyIndustry: 'warehouse staffing',
        signalScore: 9,
        matchedCandidateCount: 3,
      }),
    ];

    expect(selectCompaniesForContactIntelligence(results).map((item) => item.companyId)).toEqual(['company-1']);
  });
});
