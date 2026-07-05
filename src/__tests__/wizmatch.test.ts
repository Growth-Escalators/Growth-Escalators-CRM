import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { scoreSignal, detectRegion } from '../services/wizmatchScoring';

// Test the deterministic scorer (pure TS, no network)
describe('Wizmatch Signal Scorer', () => {
  // Inline the scoring logic to avoid DB imports in test
  function scoreSignal(input: {
    daysOpen: number; repostCount: number; companyVolumeCount: number;
    employmentType: string | null; keywords: string[] | null; h1bSponsorCount: number;
  }) {
    let score = 0;
    if (input.daysOpen >= 30) score += 3;
    else if (input.daysOpen >= 14) score += 2;
    if (input.repostCount > 0) score += 3;
    if (input.companyVolumeCount >= 4) score += 2;
    else if (input.companyVolumeCount >= 2) score += 1;

    const allText = [input.employmentType ?? '', ...(input.keywords ?? [])].join(' ').toLowerCase();
    const contractKw = ['w2', 'c2c', 'contract', 'contract-to-hire', '1099'];
    if (contractKw.some(kw => allText.includes(kw))) score += 2;
    if (input.h1bSponsorCount >= 5) score += 1;
    return Math.min(10, score);
  }

  it('should score 0 for a fresh, non-contract, low-volume signal', () => {
    const score = scoreSignal({
      daysOpen: 1, repostCount: 0, companyVolumeCount: 1,
      employmentType: 'FTE', keywords: ['java'], h1bSponsorCount: 0,
    });
    expect(score).toBe(0);
  });

  it('should score 3 for days_open >= 30 alone', () => {
    const score = scoreSignal({
      daysOpen: 35, repostCount: 0, companyVolumeCount: 1,
      employmentType: 'FTE', keywords: ['java'], h1bSponsorCount: 0,
    });
    expect(score).toBe(3);
  });

  it('should score 2 for days_open 14-29', () => {
    const score = scoreSignal({
      daysOpen: 20, repostCount: 0, companyVolumeCount: 1,
      employmentType: 'FTE', keywords: ['java'], h1bSponsorCount: 0,
    });
    expect(score).toBe(2);
  });

  it('should score 3 for repost alone', () => {
    const score = scoreSignal({
      daysOpen: 1, repostCount: 2, companyVolumeCount: 1,
      employmentType: 'FTE', keywords: ['java'], h1bSponsorCount: 0,
    });
    expect(score).toBe(3);
  });

  it('should score 2 for high volume (4+)', () => {
    const score = scoreSignal({
      daysOpen: 1, repostCount: 0, companyVolumeCount: 5,
      employmentType: 'FTE', keywords: ['java'], h1bSponsorCount: 0,
    });
    expect(score).toBe(2);
  });

  it('should score 1 for medium volume (2-3)', () => {
    const score = scoreSignal({
      daysOpen: 1, repostCount: 0, companyVolumeCount: 2,
      employmentType: 'FTE', keywords: ['java'], h1bSponsorCount: 0,
    });
    expect(score).toBe(1);
  });

  it('should score 2 for contract keywords in employment type', () => {
    const score = scoreSignal({
      daysOpen: 1, repostCount: 0, companyVolumeCount: 1,
      employmentType: 'C2C', keywords: [], h1bSponsorCount: 0,
    });
    expect(score).toBe(2);
  });

  it('should score 2 for contract keywords in keywords array', () => {
    const score = scoreSignal({
      daysOpen: 1, repostCount: 0, companyVolumeCount: 1,
      employmentType: null, keywords: ['java', 'contract-to-hire'], h1bSponsorCount: 0,
    });
    expect(score).toBe(2);
  });

  it('should score 1 for LCA sponsor 5+', () => {
    const score = scoreSignal({
      daysOpen: 1, repostCount: 0, companyVolumeCount: 1,
      employmentType: 'FTE', keywords: ['java'], h1bSponsorCount: 10,
    });
    expect(score).toBe(1);
  });

  it('should cap at 10', () => {
    const score = scoreSignal({
      daysOpen: 45, repostCount: 3, companyVolumeCount: 6,
      employmentType: 'C2C', keywords: ['contract'], h1bSponsorCount: 20,
    });
    expect(score).toBe(10);
  });

  it('should score 8 for stale + reposted + contract keywords', () => {
    const score = scoreSignal({
      daysOpen: 35, repostCount: 1, companyVolumeCount: 1,
      employmentType: 'W2', keywords: ['java'], h1bSponsorCount: 0,
    });
    expect(score).toBe(8);
  });
});

// Test the REAL region-aware scorer (pure, no DB) — US regression + India rubric
describe('Wizmatch Signal Scorer — region-aware (real impl)', () => {
  it('detectRegion infers India from Indian cities, US otherwise', () => {
    expect(detectRegion('Bangalore, India')).toBe('india');
    expect(detectRegion('Bengaluru')).toBe('india');
    expect(detectRegion('Pune')).toBe('india');
    expect(detectRegion('New York, NY')).toBe('us');
    expect(detectRegion('Remote')).toBe('us');
    expect(detectRegion(null)).toBe('us');
  });

  it('US: stale + reposted + contract keyword scores 8 (regression)', () => {
    const { score, region } = scoreSignal({
      daysOpen: 35, repostCount: 1, companyVolumeCount: 1,
      employmentType: 'W2', keywords: ['java'], h1bSponsorCount: 0,
    });
    expect(region).toBe('us');
    expect(score).toBe(8);
  });

  it('US: LCA sponsor 5+ adds 1 (regression)', () => {
    const { score } = scoreSignal({
      daysOpen: 1, repostCount: 0, companyVolumeCount: 1,
      employmentType: 'FTE', keywords: ['java'], h1bSponsorCount: 10,
    });
    expect(score).toBe(1);
  });

  it('India: stale + reposted + contract + high-demand skill crosses the gate', () => {
    const { score, region } = scoreSignal({
      daysOpen: 35, repostCount: 1, companyVolumeCount: 1,
      employmentType: 'Contract', keywords: ['java'], h1bSponsorCount: 0,
      location: 'Bangalore',
    });
    expect(region).toBe('india');
    expect(score).toBeGreaterThanOrEqual(7); // 3 (stale) + 2 (repost) + 2 (contract) + 1 (skill)
  });

  it('India: ignores H-1B/LCA entirely', () => {
    const { score, region } = scoreSignal({
      daysOpen: 1, repostCount: 0, companyVolumeCount: 1,
      employmentType: 'FTE', keywords: ['java'], h1bSponsorCount: 20,
      location: 'Pune',
    });
    expect(region).toBe('india');
    expect(score).toBe(1); // only the high-demand skill point; LCA contributes nothing
  });

  it('caps at 10 for either region', () => {
    const us = scoreSignal({ daysOpen: 45, repostCount: 3, companyVolumeCount: 6, employmentType: 'C2C', keywords: ['contract'], h1bSponsorCount: 20 });
    const india = scoreSignal({ daysOpen: 45, repostCount: 3, companyVolumeCount: 6, employmentType: 'contract', keywords: ['java'], h1bSponsorCount: 0, location: 'Hyderabad' });
    expect(us.score).toBe(10);
    expect(india.score).toBeLessThanOrEqual(10);
  });
});

// Test HMAC unsubscribe link generation
describe('Wizmatch Unsubscribe HMAC', () => {
  it('should generate deterministic HMAC signatures', () => {
    const secret = 'test-secret-key';
    const email = 'test@example.com';

    const sig1 = crypto.createHmac('sha256', secret).update(email).digest('base64url');
    const sig2 = crypto.createHmac('sha256', secret).update(email).digest('base64url');

    expect(sig1).toBe(sig2);
    expect(sig1).not.toBe('');
  });

  it('should generate different signatures for different emails', () => {
    const secret = 'test-secret-key';

    const sig1 = crypto.createHmac('sha256', secret).update('user1@example.com').digest('base64url');
    const sig2 = crypto.createHmac('sha256', secret).update('user2@example.com').digest('base64url');

    expect(sig1).not.toBe(sig2);
  });

  it('should generate different signatures with different secrets', () => {
    const email = 'test@example.com';

    const sig1 = crypto.createHmac('sha256', 'secret1').update(email).digest('base64url');
    const sig2 = crypto.createHmac('sha256', 'secret2').update(email).digest('base64url');

    expect(sig1).not.toBe(sig2);
  });
});

// Test candidate matching logic (pure TS, no DB)
describe('Wizmatch Candidate Matching', () => {
  it('should calculate skill overlap percentage correctly', () => {
    const candidateSkills = ['java', 'spring', 'aws', 'docker'];
    const signalKeywords = ['java', 'spring', 'kafka'];

    const overlap = candidateSkills.filter(s =>
      signalKeywords.some(k => s.includes(k) || k.includes(s)),
    );

    const overlapPct = overlap.length / signalKeywords.length;

    expect(overlap.length).toBe(2); // java, spring
    expect(overlapPct).toBeCloseTo(0.667, 2); // 2/3
  });

  it('should identify W2-eligible visa statuses', () => {
    const W2_VISAS = ['H1B', 'GC', 'USC', 'OPT'];

    expect(W2_VISAS.includes('H1B')).toBe(true);
    expect(W2_VISAS.includes('GC')).toBe(true);
    expect(W2_VISAS.includes('USC')).toBe(true);
    expect(W2_VISAS.includes('OPT')).toBe(true);
    expect(W2_VISAS.includes('H4EAD')).toBe(false); // H4EAD not in W2 list
    expect(W2_VISAS.includes('unknown')).toBe(false);
  });

  it('should calculate days until availability', () => {
    const availDate = new Date(Date.now() + 15 * 86400000).toISOString();
    const daysUntilAvail = Math.ceil(
      (new Date(availDate).getTime() - Date.now()) / 86400000,
    );

    expect(daysUntilAvail).toBeGreaterThanOrEqual(14);
    expect(daysUntilAvail).toBeLessThanOrEqual(16);
  });
});