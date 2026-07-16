import { describe, expect, it } from 'vitest';
import { calculateCandidateRequirementMatch, createWizmatchMatchingService } from '../services/wizmatchMatchingDomain';

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

  it('upserts supplied requirement and candidate skills without deleting omitted evidence', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.startsWith('SELECT id FROM')) return { rowCount: 1, rows: [{ id: 'owned' }] };
        return { rowCount: 1, rows: [] };
      },
      release: () => {},
    };
    const service = createWizmatchMatchingService({ connect: async () => client } as any);
    await expect(service.replaceRequirementSkills(
      { tenantId: 'tenant-a', userId: 'reviewer-a' },
      'requirement-a',
      [{ skillId: 'abap', importance: 'mandatory', minimumYears: 4, evidence: 'Reviewed JD' }],
    )).resolves.toMatchObject({ count: 1, upserted: 1, omittedPreserved: true });
    await expect(service.replaceCandidateSkills(
      { tenantId: 'tenant-a', userId: 'reviewer-a' },
      'candidate-a',
      [{ skillId: 'abap', experienceYears: 5, evidence: 'Project evidence', verified: true }],
    )).resolves.toMatchObject({ count: 1, upserted: 1, omittedPreserved: true });
    expect(statements.some((sql) => /DELETE FROM wizmatch_(requirement|candidate)_skills/.test(sql))).toBe(false);
    expect(statements.filter((sql) => sql.includes('ON CONFLICT (tenant_id,')).length).toBe(2);
    expect(statements.some((sql) => sql.includes('UPDATE wizmatch_requirements requirement SET'))).toBe(true);
    const requirementSync = statements.find((sql) => sql.includes('UPDATE wizmatch_requirements requirement SET')) || '';
    expect(requirementSync).not.toContain('requirement.required_skills');
    expect(requirementSync).not.toContain('requirement.nice_to_have_skills');
    expect(requirementSync.match(/'\{\}'::text\[\]/g)).toHaveLength(2);
    expect(statements.some((sql) => sql.includes('UPDATE wizmatch_candidates candidate SET'))).toBe(true);
    expect(statements.some((sql) => sql.includes("'requirement_skills_upserted'"))).toBe(true);
    expect(statements.some((sql) => sql.includes("'candidate_skills_upserted'"))).toBe(true);
  });
});
