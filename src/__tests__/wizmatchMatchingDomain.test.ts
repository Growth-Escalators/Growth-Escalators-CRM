import { describe, expect, it } from 'vitest';
import { calculateCandidateRequirementMatch } from '../services/wizmatchMatchingDomain';

const skills = {
  abap: { id: 'abap', family: 'SAP', specialization: 'ABAP', canonicalLabel: 'SAP ABAP' },
  fico: { id: 'fico', family: 'SAP', specialization: 'FICO', canonicalLabel: 'SAP FICO' },
  java: { id: 'java', family: 'Java', specialization: 'Java', canonicalLabel: 'Java' },
  javascript: { id: 'javascript', family: 'JavaScript', specialization: 'JavaScript', canonicalLabel: 'JavaScript' },
};

type TestSkill = typeof skills.abap & { allowBroadFamily?: boolean };
function input(required: TestSkill, candidate: TestSkill) {
  return {
    requirement: { location: 'Pune', workMode: 'hybrid', normalizedBudgetMaxAnnual: 2_000_000, skills: [{ ...required, importance: 'mandatory', minimumYears: 3 }] },
    candidate: { availabilityStatus: 'available', location: 'Pune', normalizedAnnualRate: 1_500_000, skills: [{ ...candidate, experienceYears: 5, evidence: 'Project evidence', lastUsedAt: '2026-06-01', verified: true }] },
  };
}

describe('Gate B matching', () => {
  it('scores a verified exact match with explainable dimensions', () => {
    const result = calculateCandidateRequirementMatch(input(skills.abap, skills.abap));
    expect(result.blockers).toEqual([]);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.dimensions.mandatorySkills).toBe(50);
  });

  it('keeps SAP ABAP and SAP FICO separate by default', () => {
    const result = calculateCandidateRequirementMatch(input(skills.abap, skills.fico));
    expect(result.score).toBe(0);
    expect(result.blockers).toContain('missing_mandatory:SAP ABAP');
  });

  it('keeps Java and JavaScript separate', () => {
    const result = calculateCandidateRequirementMatch(input(skills.java, skills.javascript));
    expect(result.score).toBe(0);
    expect(result.blockers).toContain('missing_mandatory:Java');
  });

  it('allows broad-family matching only when visibly configured', () => {
    const result = calculateCandidateRequirementMatch(input({ ...skills.abap, allowBroadFamily: true }, skills.fico));
    expect(result.blockers).toEqual([]);
  });

  it('blocks location, availability and commercial failures before scoring', () => {
    const data = input(skills.java, skills.java);
    data.candidate.location = 'Delhi';
    data.candidate.availabilityStatus = 'placed';
    data.candidate.normalizedAnnualRate = 3_000_000;
    const result = calculateCandidateRequirementMatch(data);
    expect(result.score).toBe(0);
    expect(result.blockers).toEqual(expect.arrayContaining(['location', 'availability', 'commercial']));
  });

  it('shows missing evidence instead of awarding evidence points', () => {
    const data = input(skills.java, skills.java);
    data.candidate.skills[0].evidence = null as unknown as string;
    data.candidate.skills[0].lastUsedAt = null as unknown as string;
    const result = calculateCandidateRequirementMatch(data);
    expect(result.missingEvidence).toEqual(expect.arrayContaining(['skill_evidence:Java', 'recency:Java']));
    expect(result.dimensions.experienceRecencyEvidence).toBeLessThan(15);
  });
});
