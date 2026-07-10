import { describe, expect, it } from 'vitest';
import { scoreSignal } from '../services/wizmatchScoring';

describe('Wizmatch scoring — hiring-urgency ("struggling to hire") signal', () => {
  it('flags low urgency for a fresh, calm signal (and does not change the numeric score)', () => {
    const r = scoreSignal({
      daysOpen: 1, repostCount: 0, companyVolumeCount: 1,
      employmentType: 'FTE', keywords: ['java'], h1bSponsorCount: 0, region: 'us',
    });
    expect(r.score).toBe(0); // score unchanged by the urgency addition
    expect(r.urgencyLevel).toBe('low');
    expect(r.strugglingScore).toBe(0);
  });

  it('flags HIGH urgency when a role is stale + reposted + uses urgent language', () => {
    const r = scoreSignal({
      daysOpen: 35, repostCount: 2, companyVolumeCount: 1,
      employmentType: 'contract', keywords: ['urgent', 'java'], h1bSponsorCount: 0, region: 'us',
    });
    // stale daysOpen(3) + repost(3) + volume(0) + urgency language(2) = 8 => high
    expect(r.urgencyLevel).toBe('high');
    expect(r.strugglingScore).toBeGreaterThanOrEqual(6);
    expect(r.reasoning).toContain('urgent/immediate hiring language');
    expect(r.reasoning).toContain('struggling to hire');
  });

  it('flags MEDIUM urgency for a moderately-open, multi-role signal', () => {
    const r = scoreSignal({
      daysOpen: 20, repostCount: 0, companyVolumeCount: 2,
      employmentType: 'FTE', keywords: ['react'], h1bSponsorCount: 0, region: 'india',
    });
    // daysOpen(2) + repost(0) + volume(1) + no urgency = 3 => medium
    expect(r.urgencyLevel).toBe('medium');
    expect(r.strugglingScore).toBe(3);
  });

  it('does not inflate the numeric score even when urgency language is present', () => {
    const withUrgency = scoreSignal({
      // 'actively hiring' is an urgency marker but NOT one of the scoring keyword lists,
      // so it must raise urgencyLevel without touching the numeric score.
      daysOpen: 35, repostCount: 1, companyVolumeCount: 1,
      employmentType: 'FTE', keywords: ['actively hiring', 'java'], h1bSponsorCount: 0, region: 'india',
    });
    const withoutUrgency = scoreSignal({
      daysOpen: 35, repostCount: 1, companyVolumeCount: 1,
      employmentType: 'FTE', keywords: ['java'], h1bSponsorCount: 0, region: 'india',
    });
    // Urgency language raises urgencyLevel but NOT the score (protects the score>=7 enrich gate).
    expect(withUrgency.score).toBe(withoutUrgency.score);
    expect(withUrgency.urgencyLevel === 'high' || withUrgency.urgencyLevel === 'medium').toBe(true);
  });
});
