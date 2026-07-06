import { describe, expect, it } from 'vitest';
import { buildWizmatchRoiAnalytics } from '../services/wizmatchRoiAnalytics';

describe('Wizmatch ROI Analytics', () => {
  it('builds deterministic funnel, KPI, recommendation, and risk output', () => {
    const result = buildWizmatchRoiAnalytics({
      from: '2026-06-06',
      to: '2026-07-06',
      signals: {
        total: 100,
        priority: 30,
        india: 82,
        us: 18,
        matched: 15,
        drafted: 8,
        sent: 6,
        positiveReplies: 1,
      },
      contactIntelligence: {
        companiesQualified: 10,
        companiesReviewed: 6,
        contactsApproved: 4,
        contactsLinked: 3,
        paidRunsBlocked: 2,
        costCentsTotal: 0,
      },
      candidates: {
        total: 80,
        available: 50,
        certified: 8,
        india: 65,
        us: 15,
      },
      requirements: {
        open: 9,
        urgent: 2,
        sheetReady: 4,
        shared: 2,
        closed: 1,
      },
      placements: {
        active: 2,
        submitted: 3,
        interviewing: 2,
        offered: 1,
        started: 2,
        lost: 1,
        monthlyMargin: 320000,
      },
      sourceBreakdown: [
        { source: 'naukri', count: 70, avgScore: 7.3 },
        { source: 'manual', count: 30, avgScore: 6.4 },
      ],
    });

    expect(result.guardrails.sending).toBe('manual_review_only');
    expect(result.kpis.indiaSignalShare).toBe(82);
    expect(result.kpis.contactApprovalRate).toBeCloseTo(66.7);
    expect(result.kpis.estimatedAnnualRunRate).toBe(3840000);
    expect(result.funnel.map((stage) => stage.stage)).toContain('Positive replies');
    expect(result.moduleScorecards.map((item) => item.module)).toContain('Placement ROI');
    expect(result.risks.join(' ')).toContain('paid discovery');
  });

  it('surfaces India-priority and matching recommendations when metrics drift', () => {
    const result = buildWizmatchRoiAnalytics({
      from: '2026-06-06',
      to: '2026-07-06',
      signals: {
        total: 50,
        priority: 20,
        india: 20,
        us: 30,
        matched: 4,
        drafted: 2,
        sent: 0,
        positiveReplies: 0,
      },
      contactIntelligence: {
        companiesQualified: 0,
        companiesReviewed: 0,
        contactsApproved: 0,
        contactsLinked: 0,
        paidRunsBlocked: 0,
        costCentsTotal: 0,
      },
      candidates: {
        total: 10,
        available: 0,
        certified: 0,
        india: 5,
        us: 5,
      },
      requirements: {
        open: 4,
        urgent: 1,
        sheetReady: 0,
        shared: 0,
        closed: 0,
      },
      placements: {
        active: 0,
        submitted: 0,
        interviewing: 0,
        offered: 0,
        started: 0,
        lost: 0,
        monthlyMargin: 0,
      },
      sourceBreakdown: [],
    });

    expect(result.recommendations.join(' ')).toContain('India-first sourcing');
    expect(result.recommendations.join(' ')).toContain('candidate matching');
    expect(result.risks.join(' ')).toContain('no candidates are marked available');
  });
});
