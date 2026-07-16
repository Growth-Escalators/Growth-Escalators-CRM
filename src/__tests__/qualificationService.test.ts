import { describe, expect, it } from 'vitest';
import { scoreBooking } from '../services/qualificationService';

describe('scoreBooking — ad spend bucket (H14: bounded "above N" match)', () => {
  it('does NOT score "above 10k" as if it were "above 1 lakh" (the exact review failure scenario)', () => {
    const result = scoreBooking({ ad_spend: 'Above 10k', decision_maker: 'yes' });
    // Pre-fix: 'above 10k'.includes('above 1') was true → adSpend=40 →
    // total 70 → tier 'hot'. A ₹10k/month spender should land in the 10k
    // bucket (adSpend=10), not the 1-lakh+ bucket.
    expect(result.breakdown.adSpend).toBe(10);
    expect(result.totalScore).toBe(40); // 10 (spend) + 30 (decision maker)
    expect(result.tier).toBe('warm');
  });

  it('does NOT score "above 15k" as above-1-lakh either', () => {
    const result = scoreBooking({ ad_spend: 'above 15k', decision_maker: 'yes' });
    expect(result.breakdown.adSpend).not.toBe(40);
  });

  it('correctly scores an explicit "above 1 lakh" as the top bucket', () => {
    const result = scoreBooking({ ad_spend: 'above 1 lakh', decision_maker: 'yes' });
    expect(result.breakdown.adSpend).toBe(40);
    expect(result.totalScore).toBe(70);
    expect(result.tier).toBe('hot');
  });

  it('correctly scores bare "above 1" (no unit) as the top bucket', () => {
    const result = scoreBooking({ ad_spend: 'above 1', decision_maker: 'yes' });
    expect(result.breakdown.adSpend).toBe(40);
  });

  it('correctly scores "more than 1 lakh" as the top bucket', () => {
    const result = scoreBooking({ ad_spend: 'more than 1 lakh', decision_maker: 'yes' });
    expect(result.breakdown.adSpend).toBe(40);
  });

  it('does not score "more than 10,000" as the top bucket', () => {
    const result = scoreBooking({ ad_spend: 'more than 10,000', decision_maker: 'yes' });
    expect(result.breakdown.adSpend).not.toBe(40);
  });

  it('still detects explicit numeric lakh notation via detectLakhs (unaffected by the regex fix)', () => {
    const result = scoreBooking({ ad_spend: '1,00,000', decision_maker: 'yes' });
    expect(result.breakdown.adSpend).toBe(40);
  });
});

describe('scoreBooking — revenue bucket (same substring bug existed here too)', () => {
  it('does NOT score "above 100" (hundred, not 10 lakh) as the top revenue bucket', () => {
    const result = scoreBooking({ revenue: 'above 100', decision_maker: 'yes' });
    // Pre-fix: 'above 100'.includes('above 10') was true → revenue=20.
    expect(result.breakdown.revenue).not.toBe(20);
  });

  it('does NOT score "above 1000" as the top revenue bucket', () => {
    const result = scoreBooking({ revenue: 'above 1000', decision_maker: 'yes' });
    expect(result.breakdown.revenue).not.toBe(20);
  });

  it('correctly scores "above 10 lakh" as the top revenue bucket', () => {
    const result = scoreBooking({ revenue: 'above 10 lakh', decision_maker: 'yes' });
    expect(result.breakdown.revenue).toBe(20);
  });

  it('correctly scores bare "above 10" as the top revenue bucket', () => {
    const result = scoreBooking({ revenue: 'above 10', decision_maker: 'yes' });
    expect(result.breakdown.revenue).toBe(20);
  });
});
