import { pool } from '../db/index';
import logger from '../utils/logger';
import type { AgencyDailyData } from './intelligenceDataCollector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProblemItem {
  issue: string;
  severity: 'high' | 'medium' | 'low';
  impact: string;
  fix: string;
}

export interface ActionItem {
  action: string;
  owner: 'Jatin' | 'Sakcham' | 'Vishal' | 'Nimisha' | 'Keshav';
  priority: 'urgent' | 'high' | 'medium';
  reason: string;
}

export interface AnalysisScores {
  ads: number;
  seo: number;
  sales: number;
  ops: number;
  overall: number;
}

export interface Analysis {
  summary: string;
  wins: string[];
  problems: ProblemItem[];
  actions: ActionItem[];
  anomalies: string[];
  predictions: string[];
  scores: AnalysisScores;
  one_thing: string;
  tokensUsed: number;
}

// ---------------------------------------------------------------------------
// Ensure table exists
// ---------------------------------------------------------------------------

export async function ensureIntelligenceTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_intelligence_reports (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      report_date     DATE NOT NULL,
      report_type     TEXT DEFAULT 'daily',
      raw_data        JSONB,
      analysis        TEXT,
      wins            JSONB,
      problems        JSONB,
      actions         JSONB,
      anomalies       JSONB,
      predictions     JSONB,
      ads_score       INTEGER,
      seo_score       INTEGER,
      sales_score     INTEGER,
      ops_score       INTEGER,
      overall_score   INTEGER,
      tokens_used     INTEGER,
      created_at      TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ai_reports_date ON ai_intelligence_reports(report_date DESC);
  `);
}

// ---------------------------------------------------------------------------
// analyzeWithClaude
// ---------------------------------------------------------------------------

export async function analyzeWithClaude(data: AgencyDailyData): Promise<Analysis> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    logger.warn('[intelligence] CLAUDE_API_KEY not set — using fallback analysis');
    return buildFallbackAnalysis(data);
  }

  const prompt = buildPrompt(data);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: `You are the AI operations intelligence for Growth Escalators, a D2C performance marketing agency in Jaipur, India.

Agency context:
- Core service: Meta Ads + CRO for D2C brands
- SEO clients: aarohaom.com, blackpandaenterprises.com, ageddentistry.org
- White label: Meta Ads for UK/AU/CA agencies at $900/month
- Team: Jatin (founder), Sakcham (sales), Vishal (ads), Nimisha (design), Keshav (video)
- Target: ₹50L-10Cr annual revenue D2C brands
- SEO data is collected via 12 n8n workflows running at https://primary-production-6c6f5.up.railway.app

When SEO workflows are broken or overdue, flag this as HIGH priority since it means client data is not being collected. Always mention specific workflow names and how many days overdue they are. A workflow being overdue means client SEO performance is invisible to the team.

Analyze today's agency data and respond ONLY with valid JSON in this exact format:
{
  "summary": "2-3 sentence plain English overview of today",
  "wins": ["specific win 1", "specific win 2", "specific win 3"],
  "problems": [
    {
      "issue": "specific problem",
      "severity": "high|medium|low",
      "impact": "what this affects",
      "fix": "exact action to take"
    }
  ],
  "actions": [
    {
      "action": "specific thing to do",
      "owner": "Jatin|Sakcham|Vishal|Nimisha|Keshav",
      "priority": "urgent|high|medium",
      "reason": "why this matters"
    }
  ],
  "anomalies": ["anything unusual spotted"],
  "predictions": ["what to watch for tomorrow/this week"],
  "scores": {
    "ads": 0,
    "seo": 0,
    "sales": 0,
    "ops": 0,
    "overall": 0
  },
  "one_thing": "The single most important thing to focus on today"
}`,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    logger.error(`[intelligence] Claude API error ${response.status}:`, errBody);
    throw new Error(`Claude API returned ${response.status}`);
  }

  const rawResponse = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const textContent = rawResponse.content.find(c => c.type === 'text')?.text ?? '{}';
  const tokensUsed = (rawResponse.usage?.input_tokens ?? 0) + (rawResponse.usage?.output_tokens ?? 0);

  // Parse JSON — strip markdown code fences if present
  let jsonText = textContent.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  let parsed: Omit<Analysis, 'tokensUsed'>;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    logger.error('[intelligence] Failed to parse Claude response:', jsonText.slice(0, 500));
    throw new Error('Failed to parse Claude JSON response');
  }

  const analysis: Analysis = {
    summary:     parsed.summary     ?? 'No summary available',
    wins:        parsed.wins        ?? [],
    problems:    parsed.problems    ?? [],
    actions:     parsed.actions     ?? [],
    anomalies:   parsed.anomalies   ?? [],
    predictions: parsed.predictions ?? [],
    scores:      parsed.scores      ?? { ads: 50, seo: 50, sales: 50, ops: 50, overall: 50 },
    one_thing:   parsed.one_thing   ?? 'Review today\'s data',
    tokensUsed,
  };

  // Persist to DB
  await saveReport(data, analysis);

  return analysis;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPrompt(data: AgencyDailyData): string {
  const adsSummary = data.ads.map(a => ({
    account: a.accountName,
    client:  a.clientName,
    todaySpend:   a.today.spend.toFixed(0),
    todayRoas:    a.today.roas.toFixed(2),
    spendDeltaPct: a.spendDelta.toFixed(1) + '%',
    roasDeltaPct:  a.roasDelta.toFixed(1) + '%',
    purchases:    a.today.purchases,
    sevenDayAvgRoas: a.sevenDayAvg.roas.toFixed(2),
  }));

  const teamSummary = data.team.map(m => ({
    name:             m.name,
    completedToday:   m.completedToday,
    overdueCount:     m.overdueCount,
    dueTodayCount:    m.dueTodayCount,
    weekCompletionPct: m.weekCompletionRate + '%',
  }));

  const pipelineSummary = {
    stages: Object.entries(data.pipeline.stageBreakdown).map(([stage, d]) => ({
      stage,
      count: d.count,
      value: `₹${Math.round(d.value / 100).toLocaleString('en-IN')}`,
    })),
    newContactsToday:  data.pipeline.newContactsToday,
    dealsCold:         data.pipeline.dealsCold,
    dealsMovedForward: data.pipeline.dealsMovedForward,
    totalPipeline:     `₹${Math.round(data.pipeline.totalPipelineValue / 100).toLocaleString('en-IN')}`,
  };

  const billingSummary = {
    overdueInvoices: data.billing.overdueCount,
    overdueAmount:   `₹${Math.round(data.billing.overdueAmount / 100).toLocaleString('en-IN')}`,
    pendingInvoices: data.billing.pendingCount,
    mrr:             `₹${Math.round(data.billing.mrr / 100).toLocaleString('en-IN')}`,
    paymentsToday:   data.funnel.paymentsToday,
    revenueToday:    `₹${Math.round(data.funnel.revenueToday / 100).toLocaleString('en-IN')}`,
  };

  return `Here is today's agency data for ${new Date().toDateString()}:

META ADS: ${JSON.stringify(adsSummary, null, 2)}

PIPELINE: ${JSON.stringify(pipelineSummary, null, 2)}

TEAM TASKS: ${JSON.stringify(teamSummary, null, 2)}

SEO: ${JSON.stringify({
    keywordsImproved: data.seo.keywordsImproved,
    keywordsDropped:  data.seo.keywordsDropped,
    topGains:         data.seo.topGains,
    topLosses:        data.seo.topLosses,
    alertsToday:      data.seo.alertsToday,
    latestAlerts:     data.seo.latestAlerts,
    mobileScore:      data.seo.mobileScore,
    desktopScore:     data.seo.desktopScore,
  }, null, 2)}

COMMUNICATION: ${JSON.stringify(data.whatsapp, null, 2)}

BILLING: ${JSON.stringify(billingSummary, null, 2)}

SEO WORKFLOW HEALTH:
n8n Status: ${data.seoWorkflows.n8nAlive ? 'Online' : 'OFFLINE ⚠️'}
Workflows healthy: ${data.seoWorkflows.healthyCount}/${data.seoWorkflows.totalCount}
${data.seoWorkflows.brokenCritical.length > 0
  ? 'BROKEN CRITICAL WORKFLOWS: ' + data.seoWorkflows.brokenCritical.map(w => `${w.name} — last ran ${w.daysSince === 999 ? 'NEVER' : w.daysSince + ' days ago'}`).join(', ')
  : 'All critical workflows healthy'}

Individual workflow status:
${data.seoWorkflows.workflows.map(w =>
  `${w.name}: ${w.status} (last run: ${w.lastRun ? new Date(w.lastRun).toDateString() : 'never'}, records: ${w.total ?? 0}${w.keywordsTracked != null ? ', keywords: ' + w.keywordsTracked : ''})`
).join('\n')}

DATA ERRORS (sources unavailable): ${data.errors.join(', ') || 'none'}

Yesterday's overall score was: ${data.yesterdayScore ?? 'No previous data yet'}

Analyze this and provide your intelligence report as JSON.`;
}

async function saveReport(data: AgencyDailyData, analysis: Analysis): Promise<void> {
  try {
    await pool.query(`
      INSERT INTO ai_intelligence_reports
        (report_date, report_type, raw_data, analysis, wins, problems, actions,
         anomalies, predictions, ads_score, seo_score, sales_score, ops_score,
         overall_score, tokens_used)
      VALUES ($1, 'daily', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT DO NOTHING
    `, [
      new Date().toISOString().slice(0, 10),
      JSON.stringify(data),
      analysis.summary,
      JSON.stringify(analysis.wins),
      JSON.stringify(analysis.problems),
      JSON.stringify(analysis.actions),
      JSON.stringify(analysis.anomalies),
      JSON.stringify(analysis.predictions),
      analysis.scores.ads,
      analysis.scores.seo,
      analysis.scores.sales,
      analysis.scores.ops,
      analysis.scores.overall,
      analysis.tokensUsed,
    ]);
  } catch (e) {
    logger.error('[intelligence] Failed to save report to DB:', e);
  }
}

// ---------------------------------------------------------------------------
// Fallback analysis when API key is missing
// ---------------------------------------------------------------------------

function buildFallbackAnalysis(data: AgencyDailyData): Analysis {
  const wins: string[] = [];
  const problems: ProblemItem[] = [];
  const actions: ActionItem[] = [];

  if (data.pipeline.newContactsToday > 0)
    wins.push(`${data.pipeline.newContactsToday} new contacts added today`);
  if (data.ads.length > 0)
    wins.push(`${data.ads.length} Meta Ads account(s) active`);
  if (data.seo.keywordsImproved > 0)
    wins.push(`${data.seo.keywordsImproved} keywords improved in rankings`);

  if (data.billing.overdueCount > 0)
    problems.push({ issue: `${data.billing.overdueCount} overdue invoice(s)`, severity: 'high', impact: 'Cash flow', fix: 'Follow up with clients immediately' });
  if (data.pipeline.dealsCold > 0)
    problems.push({ issue: `${data.pipeline.dealsCold} deal(s) gone cold`, severity: 'medium', impact: 'Pipeline revenue', fix: 'Reach out to re-engage leads' });
  if (data.seo.alertsToday > 0)
    problems.push({ issue: `${data.seo.alertsToday} SEO alert(s) today`, severity: 'medium', impact: 'Search visibility', fix: 'Review SEO alerts dashboard' });

  if (data.billing.overdueCount > 0)
    actions.push({ action: `Follow up on ${data.billing.overdueCount} overdue invoice(s)`, owner: 'Jatin', priority: 'urgent', reason: 'Revenue at risk' });

  const totalOverdue = data.team.reduce((s, m) => s + m.overdueCount, 0);
  if (totalOverdue > 0)
    actions.push({ action: `Clear ${totalOverdue} overdue tasks across team`, owner: 'Jatin', priority: 'high', reason: 'Unblocks client work' });

  const adsScore   = data.ads.length > 0 ? Math.min(100, 60 + data.ads.filter(a => a.today.roas > 2).length * 10) : 50;
  const seoScore   = data.seo.keywordsImproved > data.seo.keywordsDropped ? 70 : 50;
  const salesScore = data.pipeline.newContactsToday > 0 ? 65 : 50;
  const opsScore   = Math.max(30, 80 - totalOverdue * 5);
  const overall    = Math.round((adsScore + seoScore + salesScore + opsScore) / 4);

  return {
    summary:     `Automated analysis (CLAUDE_API_KEY not set). Collected data from ${7 - data.errors.length}/7 sources. Set CLAUDE_API_KEY for full AI analysis.`,
    wins,
    problems,
    actions,
    anomalies:   data.errors.length > 0 ? [`Data collection errors: ${data.errors.join(', ')}`] : [],
    predictions: ['Set CLAUDE_API_KEY to enable AI predictions'],
    scores:      { ads: adsScore, seo: seoScore, sales: salesScore, ops: opsScore, overall },
    one_thing:   data.billing.overdueCount > 0 ? 'Collect overdue invoices today' : 'Review pipeline and push cold deals',
    tokensUsed:  0,
  };
}
