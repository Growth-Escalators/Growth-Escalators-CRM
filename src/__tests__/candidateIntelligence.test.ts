import { describe, expect, it } from 'vitest';
import {
  rankCandidatesForRequirement,
  scoreCandidateIntelligence,
} from '../services/wizmatchCandidateIntelligence';

describe('Wizmatch Candidate Intelligence', () => {
  const requirement = {
    id: 'req-1',
    title: 'Java Backend Developer',
    requiredSkills: ['java', 'spring', 'aws', 'microservices'],
    location: 'Hyderabad, India',
    region: 'india',
    budgetMax: 3000,
    budgetCurrency: 'INR',
    priority: 'urgent',
    status: 'sheet_ready',
  };

  it('scores ready India tech candidates as hot and explainable', () => {
    const result = scoreCandidateIntelligence({
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
    });

    expect(result.region).toBe('india');
    expect(result.priority).toBe('hot');
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.topRequirementMatches[0].requirementId).toBe('req-1');
    expect(result.componentScores.skillFit).toBeLessThanOrEqual(30);
  });

  it('hard-blocks placed candidates and missing contact channels', () => {
    const result = scoreCandidateIntelligence({
      id: 'candidate-2',
      name: 'Placed Candidate',
      skills: ['Java', 'Spring'],
      location: 'Pune, India',
      availabilityStatus: 'placed',
      hasUsableContactChannel: false,
      activePlacementCount: 1,
      requirements: [requirement],
    });

    expect(result.priority).toBe('blocked');
    expect(result.score).toBeLessThan(50);
    expect(result.blockers).toContain('already_placed');
    expect(result.blockers).toContain('missing_contact_channel');
  });

  it('ranks candidates for a requirement without creating submissions', () => {
    const matches = rankCandidatesForRequirement(requirement, [
      {
        id: 'candidate-1',
        name: 'Aarav Kumar',
        skills: ['Java', 'Spring', 'AWS', 'Microservices'],
        location: 'Hyderabad, India',
        availabilityStatus: 'available',
        hasUsableContactChannel: true,
      },
      {
        id: 'candidate-2',
        name: 'Frontend Candidate',
        skills: ['React', 'CSS'],
        location: 'Mumbai, India',
        availabilityStatus: 'available',
        hasUsableContactChannel: true,
      },
    ]);

    expect(matches[0].id).toBe('candidate-1');
    expect(matches[0].topRequirementMatches[0].matchedSkills.length).toBeGreaterThan(matches[1].topRequirementMatches[0].matchedSkills.length);
  });
});
