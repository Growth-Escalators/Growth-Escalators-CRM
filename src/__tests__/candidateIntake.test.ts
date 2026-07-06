import { describe, expect, it } from 'vitest';
import {
  buildCandidateIntakeRequest,
  normalizeCandidateIntakeProfile,
  normalizeCandidateSkills,
  parseCandidateIntakeText,
} from '../services/wizmatchCandidateIntake';

describe('Wizmatch Candidate Intake', () => {
  it('parses CSV text with common headers', () => {
    const rows = parseCandidateIntakeText(`name,email,skills,location,rate_hourly
Aarav Kumar,AARAV@EXAMPLE.COM,"Java; Spring; AWS",Hyderabad India,2400`);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Aarav Kumar');
    expect(rows[0].email).toBe('AARAV@EXAMPLE.COM');
    expect(rows[0].skills).toBe('Java; Spring; AWS');
  });

  it('normalizes profile channels, skills, defaults, and warnings', () => {
    const profile = normalizeCandidateIntakeProfile({
      name: 'Neha Shah',
      phone: '98765-43210',
      skills: ['Java', 'java', ' Selenium '],
      location: 'Pune',
    });

    expect(profile?.phone).toBe('919876543210');
    expect(profile?.skills).toEqual(['Java', 'Selenium']);
    expect(profile?.rateCurrency).toBe('INR');
    expect(profile?.availabilityStatus).toBe('available');
    expect(profile?.warnings).toContain('No email supplied; candidate cannot be email-contacted yet.');
  });

  it('requires a name and one usable contact channel', () => {
    expect(normalizeCandidateIntakeProfile({ name: 'No Channel', skills: 'Java' })).toBeNull();
    expect(normalizeCandidateIntakeProfile({ email: 'x@example.com', skills: 'Java' })).toBeNull();
  });

  it('builds accepted and skipped rows with request caps', () => {
    const request = buildCandidateIntakeRequest({
      candidates: [
        { name: 'Aarav Kumar', email: 'aarav@example.com', skills: 'Java,Spring,AWS' },
        { name: 'Missing Channel', skills: 'React' },
      ],
    });

    expect(request.accepted).toHaveLength(1);
    expect(request.skipped).toHaveLength(1);
    expect(request.items[1].reason).toMatch(/name and at least one usable/i);
  });

  it('dedupes and caps skills', () => {
    const skills = normalizeCandidateSkills([
      'Java',
      'java',
      'Spring',
      'AWS',
      'AWS',
    ]);

    expect(skills).toEqual(['Java', 'Spring', 'AWS']);
  });
});
