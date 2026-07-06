export type RoiTrend = 'healthy' | 'watch' | 'blocked';

export interface WizmatchRoiAnalyticsInput {
  from: string;
  to: string;
  signals: {
    total: number;
    priority: number;
    india: number;
    us: number;
    matched: number;
    drafted: number;
    sent: number;
    positiveReplies: number;
  };
  contactIntelligence: {
    companiesQualified: number;
    companiesReviewed: number;
    contactsApproved: number;
    contactsLinked: number;
    paidRunsBlocked: number;
    costCentsTotal: number;
  };
  candidates: {
    total: number;
    available: number;
    certified: number;
    india: number;
    us: number;
  };
  requirements: {
    open: number;
    urgent: number;
    sheetReady: number;
    shared: number;
    closed: number;
  };
  placements: {
    active: number;
    submitted: number;
    interviewing: number;
    offered: number;
    started: number;
    lost: number;
    monthlyMargin: number;
  };
  sourceBreakdown: Array<{
    source: string;
    count: number;
    avgScore: number;
  }>;
}

export interface WizmatchRoiAnalyticsResult {
  generatedAt: string;
  from: string;
  to: string;
  guardrails: {
    paidEnrichment: 'disabled_until_qualified';
    sending: 'manual_review_only';
    deterministicBeforeAi: true;
    scope: 'internal_it_tech_staffing_only';
  };
  kpis: {
    prioritySignalRate: number;
    indiaSignalShare: number;
    matchRate: number;
    draftRate: number;
    sendRate: number;
    positiveReplyRate: number;
    contactApprovalRate: number;
    contactLinkRate: number;
    requirementCoverage: number;
    placementStartRate: number;
    monthlyMargin: number;
    estimatedAnnualRunRate: number;
    costCentsTotal: number;
    costPerApprovedContactCents: number;
  };
  funnel: Array<{
    stage: string;
    count: number;
    conversionFromPrevious: number | null;
    status: RoiTrend;
  }>;
  moduleScorecards: Array<{
    module: string;
    score: number;
    status: RoiTrend;
    summary: string;
  }>;
  sourceBreakdown: WizmatchRoiAnalyticsInput['sourceBreakdown'];
  recommendations: string[];
  risks: string[];
}

function pct(numerator: number, denominator: number) {
  if (!denominator || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function safeRatio(numerator: number, denominator: number) {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

function statusForPct(value: number, healthy: number, watch: number): RoiTrend {
  if (value >= healthy) return 'healthy';
  if (value >= watch) return 'watch';
  return 'blocked';
}

function scoreFromPct(value: number, target: number) {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}

function conversionStage(stage: string, count: number, previous: number | null) {
  const conversionFromPrevious = previous === null ? null : pct(count, previous);
  const status: RoiTrend = previous === null
    ? 'healthy'
    : statusForPct(conversionFromPrevious ?? 0, 45, 20);
  return { stage, count, conversionFromPrevious, status };
}

export function buildWizmatchRoiAnalytics(input: WizmatchRoiAnalyticsInput): WizmatchRoiAnalyticsResult {
  const prioritySignalRate = pct(input.signals.priority, input.signals.total);
  const indiaSignalShare = pct(input.signals.india, input.signals.india + input.signals.us);
  const matchRate = pct(input.signals.matched, input.signals.priority);
  const draftRate = pct(input.signals.drafted, input.signals.matched);
  const sendRate = pct(input.signals.sent, input.signals.drafted);
  const positiveReplyRate = pct(input.signals.positiveReplies, input.signals.sent);
  const contactApprovalRate = pct(input.contactIntelligence.contactsApproved, input.contactIntelligence.companiesReviewed);
  const contactLinkRate = pct(input.contactIntelligence.contactsLinked, input.contactIntelligence.contactsApproved);
  const requirementCoverage = pct(input.requirements.sheetReady + input.requirements.shared, input.requirements.open);
  const placementStartRate = pct(input.placements.started, input.placements.submitted + input.placements.interviewing + input.placements.offered + input.placements.started + input.placements.lost);
  const costPerApprovedContactCents = input.contactIntelligence.contactsApproved > 0
    ? Math.round(input.contactIntelligence.costCentsTotal / input.contactIntelligence.contactsApproved)
    : 0;

  const funnel = [
    conversionStage('Signals captured', input.signals.total, null),
    conversionStage('Priority signals', input.signals.priority, input.signals.total),
    conversionStage('Matched signals', input.signals.matched, input.signals.priority),
    conversionStage('Drafted outreach', input.signals.drafted, input.signals.matched),
    conversionStage('Sent outreach', input.signals.sent, input.signals.drafted),
    conversionStage('Positive replies', input.signals.positiveReplies, input.signals.sent),
    conversionStage('Active placements', input.placements.active, Math.max(1, input.signals.positiveReplies)),
  ];

  const moduleScorecards = [
    {
      module: 'Client Discovery',
      score: scoreFromPct(prioritySignalRate, 35),
      status: statusForPct(prioritySignalRate, 35, 15),
      summary: `${input.signals.priority}/${input.signals.total} signals are priority; India share is ${indiaSignalShare}%.`,
    },
    {
      module: 'Contact Intelligence',
      score: scoreFromPct(contactApprovalRate, 60),
      status: statusForPct(contactApprovalRate, 60, 25),
      summary: `${input.contactIntelligence.contactsApproved} approved contacts from ${input.contactIntelligence.companiesReviewed} reviewed companies.`,
    },
    {
      module: 'Candidate Intelligence',
      score: scoreFromPct(pct(input.candidates.available, input.candidates.total), 50),
      status: statusForPct(pct(input.candidates.available, input.candidates.total), 50, 20),
      summary: `${input.candidates.available}/${input.candidates.total} candidates are available; ${input.candidates.certified} certified.`,
    },
    {
      module: 'Requirement Intake',
      score: scoreFromPct(requirementCoverage, 65),
      status: statusForPct(requirementCoverage, 65, 30),
      summary: `${input.requirements.sheetReady + input.requirements.shared}/${input.requirements.open} open requirements have sheet/review coverage.`,
    },
    {
      module: 'Placement ROI',
      score: input.placements.monthlyMargin > 0 ? 100 : scoreFromPct(placementStartRate, 25),
      status: input.placements.monthlyMargin > 0 ? 'healthy' : statusForPct(placementStartRate, 25, 10),
      summary: `${input.placements.active} active placements; estimated monthly margin ${input.placements.monthlyMargin}.`,
    },
  ];

  const recommendations: string[] = [];
  const risks: string[] = [];

  if (indiaSignalShare < 70 && input.signals.total > 0) {
    recommendations.push('Increase India-first sourcing: current signal mix is below the 80% India target.');
  }
  if (matchRate < 40 && input.signals.priority > 0) {
    recommendations.push('Improve candidate matching coverage for priority signals before adding more outreach volume.');
  }
  if (contactApprovalRate < 50 && input.contactIntelligence.companiesReviewed > 0) {
    recommendations.push('Review contact ranking inputs: approved contacts per reviewed company is low.');
  }
  if (input.requirements.urgent > 0 && requirementCoverage < 70) {
    recommendations.push('Push urgent requirements through sheet/review readiness before widening discovery.');
  }
  if (input.contactIntelligence.contactsApproved === 0 && input.signals.priority > 0) {
    recommendations.push('Prioritize manual contact approval so qualified companies can move toward reviewed outreach.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Keep current guardrails: deterministic scoring, manual review, and qualified-only enrichment.');
  }

  if (input.contactIntelligence.paidRunsBlocked > 0) {
    risks.push(`${input.contactIntelligence.paidRunsBlocked} paid discovery request(s) were blocked by Phase 1 caps.`);
  }
  if (input.signals.sent > 0 && positiveReplyRate < 5) {
    risks.push('Positive reply rate is low; review targeting, contact quality, and domain health before increasing sends.');
  }
  if (safeRatio(input.placements.lost, input.placements.lost + input.placements.started) > 0.5) {
    risks.push('Placement loss rate is high compared with starts.');
  }
  if (input.candidates.available === 0 && input.requirements.open > 0) {
    risks.push('Open requirements exist but no candidates are marked available.');
  }
  if (risks.length === 0) {
    risks.push('No critical ROI risks detected from current deterministic metrics.');
  }

  return {
    generatedAt: new Date().toISOString(),
    from: input.from,
    to: input.to,
    guardrails: {
      paidEnrichment: 'disabled_until_qualified',
      sending: 'manual_review_only',
      deterministicBeforeAi: true,
      scope: 'internal_it_tech_staffing_only',
    },
    kpis: {
      prioritySignalRate,
      indiaSignalShare,
      matchRate,
      draftRate,
      sendRate,
      positiveReplyRate,
      contactApprovalRate,
      contactLinkRate,
      requirementCoverage,
      placementStartRate,
      monthlyMargin: input.placements.monthlyMargin,
      estimatedAnnualRunRate: input.placements.monthlyMargin * 12,
      costCentsTotal: input.contactIntelligence.costCentsTotal,
      costPerApprovedContactCents,
    },
    funnel,
    moduleScorecards,
    sourceBreakdown: input.sourceBreakdown,
    recommendations,
    risks,
  };
}
