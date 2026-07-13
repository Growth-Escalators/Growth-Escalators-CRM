import { describe, expect, it } from 'vitest';
import { scoreClientDiscoveryOpportunity } from '../services/wizmatchClientDiscovery';
import { qualifyCompanyForContactIntelligence } from '../services/wizmatchContactIntelligence';
import { classifyWizmatchRoleRelevance } from '../services/wizmatchRoleRelevance';
import { scoreSignal } from '../services/wizmatchScoring';

describe('Wizmatch role relevance', () => {
  it.each(['SAP ABAP Developer', 'SAP FICO Consultant', 'Java Backend Engineer', 'JavaScript Developer'])(
    'recognizes the staffing specialization %s',
    (title) => expect(classifyWizmatchRoleRelevance({ title })).toBe('relevant'),
  );

  it.each(['Senior Music Editor', 'Legal Counsel, Platform Liability', 'Head of Government Affairs', 'Australian English Voice Actor', 'Mason'])(
    'rejects the known false positive %s',
    (title) => expect(classifyWizmatchRoleRelevance({ title })).toBe('irrelevant'),
  );

  it('does not borrow tech fit from a software company name or industry', () => {
    const result = scoreClientDiscoveryOpportunity({
      id: 'signal-1', companyId: 'company-1', companyName: 'Acme Software',
      companyIndustry: 'Technology', jobTitle: 'Senior Music Editor', location: 'India',
    });
    expect(result.componentScores.itTechFit).toBe(0);
    expect(result.blockers).toContain('non_tech_signal');
  });

  it('keeps company ecosystem evidence separate from role evidence in Contact Intelligence', () => {
    const result = qualifyCompanyForContactIntelligence({
      company: { id: 'company-1', name: 'Acme Software', industry: 'Technology' },
      signal: { jobTitle: 'Legal Counsel, Platform Liability', keywords: ['platform'] },
    });
    expect(result.componentScores.itTechFit).toBe(0);
    expect(result.hardBlocks).toContain('non_tech');
  });

  it('allows a legitimate fresh high-volume contract Java role to reach the priority gate', () => {
    const result = scoreSignal({
      daysOpen: 1, repostCount: 0, companyVolumeCount: 4,
      employmentType: 'contract', keywords: ['java'], h1bSponsorCount: 0,
      location: 'Bengaluru, India', jobTitle: 'Java Backend Developer',
    });
    expect(result.score).toBeGreaterThanOrEqual(7);
  });

  it('keeps every legitimate Client Discovery tier attainable at the documented thresholds', () => {
    const base = {
      companyId: 'company-1', companyName: 'Acme Software', companyIndustry: 'Technology',
      jobTitle: 'Java Backend Developer', domainStatus: 'healthy',
    };
    const watch = scoreClientDiscoveryOpportunity({ id: 'watch', ...base, location: 'New York' });
    const warm = scoreClientDiscoveryOpportunity({
      id: 'warm', ...base, location: 'Bengaluru, India', signalScore: 9, daysOpen: 10,
    });
    const hot = scoreClientDiscoveryOpportunity({
      id: 'hot', ...base, location: 'Bengaluru, India', signalScore: 9, daysOpen: 10,
      activeSignalCount: 3, matchedCandidateCount: 3, isPrime: true,
      positiveReplyCount: 1, placementCount: 1,
    });
    expect(watch.priority).toBe('watch');
    expect(warm.priority).toBe('warm');
    expect(hot.priority).toBe('hot');
  });
});
