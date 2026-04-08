import { pool } from '../db/index';
import logger from '../utils/logger';
import type { AgencyDailyData } from './intelligenceDataCollector';

// ---------------------------------------------------------------------------
// Types — coaching format
// ---------------------------------------------------------------------------

export interface AnalysisScores {
  ads: number;
  seo: number;
  sales: number;
  ops: number;
  overall: number;
}

export interface IssueItem {
  title: string;
  severity: 'critical' | 'high' | 'medium';
  what_is_broken: string;
  business_impact: string;
  owner: string;
  deadline: string;
  fix_steps: string[];
  claude_prompt: string | null;
  claude_code_prompt: string | null;
  terminal_commands: string[];
}

export interface BrokenWorkflowCoaching {
  workflow: string;
  days_overdue: number;
  impact: string;
  fix_prompt: string;
}

export interface SeoCoaching {
  overall_health: 'healthy' | 'warning' | 'critical';
  summary: string;
  broken_workflows: BrokenWorkflowCoaching[];
  keyword_insights: string;
  next_content_action: string;
}

export interface SlackErrorDetected {
  error_pattern: string;
  likely_cause: string;
  claude_fix_prompt: string;
}

export interface Analysis {
  coaching_summary: string;
  wins: string[];
  focus_today: string;
  issues: IssueItem[];
  seo_coaching: SeoCoaching;
  slack_errors_detected: SlackErrorDetected[];
  scores: AnalysisScores;
  tomorrow_focus: string;
  tokensUsed: number;
}

// Keep old types exported so delivery/frontend don't break on import
export type ProblemItem = IssueItem;
export type ActionItem = { action: string; owner: string; priority: string; reason: string };

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
// analyzeWithClaude — coaching mode
// ---------------------------------------------------------------------------

export async function analyzeWithClaude(data: AgencyDailyData): Promise<Analysis> {
  const apiKey = process.env.CLAUDE_API_KEY;
  const hasApiKey = apiKey && apiKey.length > 10 && apiKey.startsWith('sk-ant-');
  if (!hasApiKey) {
    logger.warn('[intelligence] CLAUDE_API_KEY not set or invalid — using fallback analysis');
    return buildFallbackAnalysis(data);
  }

  const prompt = buildPrompt(data);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(90000), // 90s max for Claude API
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: `You are a strict but supportive operations coach for Growth Escalators, a D2C performance marketing agency in Jaipur, India.

Your job is NOT to summarize what happened.
Your job is to identify the 3-5 highest leverage actions and give exact instructions to fix each one.

Coaching philosophy:
- Be direct and specific — no vague advice
- Focus 80% on problems and fixes, 20% on wins
- Every problem must have an exact fix with owner and deadline
- If something needs a Claude prompt to fix, generate that ready-to-paste prompt
- If something needs a Claude Code prompt to fix, generate that ready-to-paste prompt
- Treat the team like professionals who need clarity, not praise

Agency context:
- Core service: Meta Ads + CRO for D2C brands
- SEO clients: aarohaom.com, blackpandaenterprises.com, ageddentistry.org
- White label: Meta Ads for UK/AU/CA agencies at $900/month
- Team: Jatin (founder/admin), Sakcham (sales), Vishal (ads manager), Nimisha (designer), Keshav (video editor)
- Production repo: ~/repo-comparison/v2 on Railway (GE-Backend-Server)
- n8n SEO workflows: primary-production-6c6f5.up.railway.app
- CRM: web-production-311da.up.railway.app/crm

When SEO workflows are broken or overdue, flag as CRITICAL since client data collection has stopped. Name specific workflows and days overdue.

When generating Claude Code prompts:
- Start with: cd ~/repo-comparison/v2
- Include NEVER TOUCH list: src/db/schema.ts, src/db/migrations/, src/middleware/auth.ts, src/middleware/rbac.ts, src/routes/cashfree.ts, src/routes/webhooks.ts
- Be specific about what to diagnose and fix

Respond ONLY with valid JSON in this exact format:
{
  "coaching_summary": "2-3 sentences brutally honest overview, coach voice",
  "wins": ["only real wins, maximum 2, be brief"],
  "focus_today": "The ONE most critical thing. Be specific and actionable.",
  "issues": [
    {
      "title": "specific problem title",
      "severity": "critical|high|medium",
      "what_is_broken": "exactly what is wrong",
      "business_impact": "what this costs in revenue/clients/time",
      "owner": "Jatin|Sakcham|Vishal|Nimisha|Keshav",
      "deadline": "today|tomorrow|this week",
      "fix_steps": ["step 1", "step 2", "step 3"],
      "claude_prompt": "If this needs Claude chat to fix: exact ready-to-paste prompt with full context. Otherwise null.",
      "claude_code_prompt": "If this needs Claude Code: exact prompt starting with cd ~/repo-comparison/v2. Otherwise null.",
      "terminal_commands": ["exact commands if any, otherwise empty array"]
    }
  ],
  "seo_coaching": {
    "overall_health": "healthy|warning|critical",
    "summary": "1-2 sentences on SEO status",
    "broken_workflows": [
      {
        "workflow": "workflow name",
        "days_overdue": 0,
        "impact": "what data is missing",
        "fix_prompt": "exact Claude Code prompt to diagnose and fix"
      }
    ],
    "keyword_insights": "what rankings are telling us right now",
    "next_content_action": "specific content to create next with exact topic"
  },
  "slack_errors_detected": [
    {
      "error_pattern": "description of error pattern",
      "likely_cause": "what is probably causing it",
      "claude_fix_prompt": "exact prompt to paste in Claude to diagnose and fix"
    }
  ],
  "scores": {
    "ads": 0,
    "seo": 0,
    "sales": 0,
    "ops": 0,
    "overall": 0
  },
  "tomorrow_focus": "One specific thing to prepare for tomorrow"
}`,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    logger.error(`[intelligence] Claude API error ${response.status}:`, errBody);
    logger.warn('[intelligence] Falling back to rule-based analysis after Claude API error');
    return buildFallbackAnalysis(data);
  }

  const rawResponse = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const textContent = rawResponse.content.find(c => c.type === 'text')?.text ?? '{}';
  const tokensUsed = (rawResponse.usage?.input_tokens ?? 0) + (rawResponse.usage?.output_tokens ?? 0);

  let jsonText = textContent.trim();

  // Strip markdown code fences if present
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  // Extract the outermost JSON object — handles any leading/trailing text or truncation
  const firstBrace = jsonText.indexOf('{');
  const lastBrace  = jsonText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonText = jsonText.slice(firstBrace, lastBrace + 1);
  }

  let parsed: Omit<Analysis, 'tokensUsed'>;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    logger.error('[intelligence] Failed to parse Claude response:', jsonText.slice(0, 800));
    logger.error('[intelligence] Response length was:', textContent.length, 'chars');
    // Fall back to rule-based analysis rather than crashing
    logger.warn('[intelligence] Falling back to rule-based analysis after JSON parse failure');
    return { ...buildFallbackAnalysis(data), tokensUsed };
  }

  const analysis: Analysis = {
    coaching_summary:     parsed.coaching_summary     ?? 'No summary available',
    wins:                 parsed.wins                 ?? [],
    focus_today:          parsed.focus_today          ?? 'Review today\'s data',
    issues:               parsed.issues               ?? [],
    seo_coaching:         parsed.seo_coaching         ?? { overall_health: 'warning', summary: '', broken_workflows: [], keyword_insights: '', next_content_action: '' },
    slack_errors_detected: parsed.slack_errors_detected ?? [],
    scores:               parsed.scores               ?? { ads: 50, seo: 50, sales: 50, ops: 50, overall: 50 },
    tomorrow_focus:       parsed.tomorrow_focus       ?? '',
    tokensUsed,
  };

  await saveReport(data, analysis);
  return analysis;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(data: AgencyDailyData): string {
  const adsSummary = data.ads.map(a => ({
    account: a.accountName, client: a.clientName,
    todaySpend: a.today.spend.toFixed(0), todayRoas: a.today.roas.toFixed(2),
    spendDeltaPct: a.spendDelta.toFixed(1) + '%', roasDeltaPct: a.roasDelta.toFixed(1) + '%',
    purchases: a.today.purchases, sevenDayAvgRoas: a.sevenDayAvg.roas.toFixed(2),
  }));

  const teamSummary = data.team.map(m => ({
    name: m.name, completedToday: m.completedToday,
    overdueCount: m.overdueCount, dueTodayCount: m.dueTodayCount,
    weekCompletionPct: m.weekCompletionRate + '%',
  }));

  const pipelineSummary = {
    stages: Object.entries(data.pipeline.stageBreakdown).map(([stage, d]) => ({
      stage, count: d.count, value: `₹${Math.round(d.value / 100).toLocaleString('en-IN')}`,
    })),
    newContactsToday: data.pipeline.newContactsToday,
    dealsCold: data.pipeline.dealsCold,
    dealsMovedForward: data.pipeline.dealsMovedForward,
    totalPipeline: `₹${Math.round(data.pipeline.totalPipelineValue / 100).toLocaleString('en-IN')}`,
  };

  const billingSummary = {
    overdueInvoices: data.billing.overdueCount,
    overdueAmount: `₹${Math.round(data.billing.overdueAmount / 100).toLocaleString('en-IN')}`,
    pendingInvoices: data.billing.pendingCount,
    mrr: `₹${Math.round(data.billing.mrr / 100).toLocaleString('en-IN')}`,
    paymentsToday: data.funnel.paymentsToday,
    revenueToday: `₹${Math.round(data.funnel.revenueToday / 100).toLocaleString('en-IN')}`,
  };

  const wf = data.seoWorkflows;
  const wfSummary = wf.brokenCritical.length > 0
    ? `BROKEN CRITICAL: ${wf.brokenCritical.map(w => `${w.name} (${w.daysSince === 999 ? 'never run' : w.daysSince + ' days ago'}`).join(', ')}`
    : 'All critical workflows healthy';

  const syserrSummary = (data.systemErrors ?? []).length > 0
    ? JSON.stringify(data.systemErrors, null, 2)
    : 'No errors detected';

  return `Today's agency data for Growth Escalators — ${new Date().toDateString()}:

META ADS: ${JSON.stringify(adsSummary, null, 2)}

PIPELINE: ${JSON.stringify(pipelineSummary, null, 2)}

TEAM TASKS: ${JSON.stringify(teamSummary, null, 2)}

SEO DATA: ${JSON.stringify({
    keywordsImproved: data.seo.keywordsImproved,
    keywordsDropped: data.seo.keywordsDropped,
    topGains: data.seo.topGains,
    topLosses: data.seo.topLosses,
    alertsToday: data.seo.alertsToday,
    latestAlerts: data.seo.latestAlerts,
    mobileScore: data.seo.mobileScore,
    desktopScore: data.seo.desktopScore,
  }, null, 2)}

COMMUNICATION: ${JSON.stringify(data.whatsapp, null, 2)}

BILLING: ${JSON.stringify(billingSummary, null, 2)}

SEO WORKFLOW HEALTH:
n8n Status: ${wf.n8nAlive ? 'Online' : 'OFFLINE ⚠️'}
Workflows healthy: ${wf.healthyCount}/${wf.totalCount}
${wfSummary}
${wf.workflows.map(w =>
    `${w.name}: ${w.status} (last run: ${w.lastRun ? new Date(w.lastRun).toDateString() : 'never'}, records: ${w.total ?? 0}${w.keywordsTracked != null ? ', keywords: ' + w.keywordsTracked : ''})`
  ).join('\n')}

SYSTEM ERRORS (last 24h): ${syserrSummary}

DATA COLLECTION ERRORS (sources down): ${data.errors.join(', ') || 'none'}

Yesterday's overall score: ${data.yesterdayScore ?? 'No previous data'}

Provide your coaching report as JSON.`;
}

// ---------------------------------------------------------------------------
// Persist to DB
// ---------------------------------------------------------------------------

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
      analysis.focus_today,                               // analysis col = focus_today (used by frontend)
      JSON.stringify(analysis.wins),
      JSON.stringify(analysis.issues),                    // problems col = new issues array
      JSON.stringify({                                    // actions col = meta block
        focus_today: analysis.focus_today,
        tomorrow_focus: analysis.tomorrow_focus,
        coaching_summary: analysis.coaching_summary,
      }),
      JSON.stringify(analysis.slack_errors_detected),    // anomalies col = slack errors
      JSON.stringify(analysis.seo_coaching),             // predictions col = seo coaching
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
// Fallback — no API key
// ---------------------------------------------------------------------------

function buildFallbackAnalysis(data: AgencyDailyData): Analysis {
  const wins: string[] = [];
  const issues: IssueItem[] = [];

  if (data.pipeline.newContactsToday > 0)
    wins.push(`${data.pipeline.newContactsToday} new contacts added`);
  if (data.ads.length > 0)
    wins.push(`${data.ads.length} Meta Ads account(s) monitored`);

  if (data.billing.overdueCount > 0) {
    issues.push({
      title: `${data.billing.overdueCount} overdue invoice(s)`,
      severity: 'critical',
      what_is_broken: `${data.billing.overdueCount} invoices unpaid past due date`,
      business_impact: `₹${Math.round(data.billing.overdueAmount / 100).toLocaleString('en-IN')} locked in unpaid invoices`,
      owner: 'Jatin', deadline: 'today',
      fix_steps: ['Pull overdue invoice list from /crm/billing', 'Call each client directly', 'Send payment reminder via WhatsApp'],
      claude_prompt: null, claude_code_prompt: null, terminal_commands: [],
    });
  }

  const brokenWfs = data.seoWorkflows.brokenCritical;
  if (brokenWfs.length > 0) {
    issues.push({
      title: `${brokenWfs.length} critical SEO workflow(s) not running`,
      severity: 'critical',
      what_is_broken: brokenWfs.map(w => `${w.name} — ${w.daysSince === 999 ? 'never run' : `${w.daysSince}d overdue`}`).join('; '),
      business_impact: 'Client SEO performance is invisible — no data being collected',
      owner: 'Jatin', deadline: 'today',
      fix_steps: ['Go to /crm/seo → Workflows', 'Click Run Now on each broken workflow', 'Check n8n logs if workflow fails'],
      claude_prompt: null,
      claude_code_prompt: `cd ~/repo-comparison/v2\n\nNEVER TOUCH: src/db/schema.ts, src/db/migrations/, src/middleware/auth.ts, src/middleware/rbac.ts, src/routes/cashfree.ts, src/routes/webhooks.ts\n\nPROBLEM: SEO workflows not running. Broken: ${brokenWfs.map(w => w.name).join(', ')}\n\nCheck seoWorkflowHealthService.ts and seoWorkflows.ts route. Diagnose why data is not being populated in SEO tables. Check if the webhook triggers are working. Fix and commit.`,
      terminal_commands: [],
    });
  }

  const totalOverdue = data.team.reduce((s, m) => s + m.overdueCount, 0);
  if (totalOverdue > 5) {
    issues.push({
      title: `${totalOverdue} overdue tasks across team`,
      severity: 'high',
      what_is_broken: `Team has ${totalOverdue} tasks past deadline`,
      business_impact: 'Client deliverables delayed, team velocity down',
      owner: 'Jatin', deadline: 'today',
      fix_steps: ['Review ClickUp board', 'Identify blockers', 'Reassign or defer non-critical tasks'],
      claude_prompt: null, claude_code_prompt: null, terminal_commands: [],
    });
  }

  const adsScore   = data.ads.length > 0 ? Math.min(100, 50 + data.ads.filter(a => a.today.roas > 2).length * 15) : 30;
  const seoScore   = data.seoWorkflows.healthyCount > 0 ? Math.round((data.seoWorkflows.healthyCount / Math.max(data.seoWorkflows.totalCount, 1)) * 70) : 10;
  const salesScore = data.pipeline.newContactsToday > 0 ? 65 : 40;
  const opsScore   = Math.max(20, 80 - totalOverdue * 4);
  const overall    = Math.round((adsScore + seoScore + salesScore + opsScore) / 4);

  const seoHealth: 'healthy' | 'warning' | 'critical' =
    data.seoWorkflows.healthyCount === data.seoWorkflows.totalCount ? 'healthy'
    : data.seoWorkflows.brokenCritical.length > 0 ? 'critical' : 'warning';

  return {
    coaching_summary: `Automated analysis (CLAUDE_API_KEY not set). ${issues.length} issue(s) detected across ${7 - data.errors.length} monitored sources. Set CLAUDE_API_KEY for AI coaching with fix prompts.`,
    wins,
    focus_today: issues[0]?.title ?? 'Review pipeline and push cold deals',
    issues,
    seo_coaching: {
      overall_health: seoHealth,
      summary: `${data.seoWorkflows.healthyCount}/${data.seoWorkflows.totalCount} SEO workflows healthy.`,
      broken_workflows: data.seoWorkflows.brokenCritical.map(w => ({
        workflow: w.name,
        days_overdue: w.daysSince === 999 ? -1 : w.daysSince,
        impact: 'Data not collected — client visibility gap',
        fix_prompt: `cd ~/repo-comparison/v2\nDiagnose why ${w.name} (${w.id}) is not running. Check the n8n webhook endpoint and output table freshness.`,
      })),
      keyword_insights: data.seo.keywordsImproved > data.seo.keywordsDropped
        ? `${data.seo.keywordsImproved} keywords improving — maintain current strategy`
        : `${data.seo.keywordsDropped} keywords dropping — review recent content changes`,
      next_content_action: 'Run Content Gap Analysis workflow to identify opportunities',
    },
    slack_errors_detected: (data.systemErrors ?? []).map(e => ({
      error_pattern: e.pattern ?? String(e),
      likely_cause: 'Check service logs for root cause',
      claude_fix_prompt: `cd ~/repo-comparison/v2\n\nNEVER TOUCH: src/db/schema.ts, src/db/migrations/, src/middleware/auth.ts, src/middleware/rbac.ts, src/routes/cashfree.ts, src/routes/webhooks.ts\n\nInvestigate and fix: ${e.pattern ?? String(e)}\nCheck relevant service files, fix root cause, test, commit.`,
    })),
    scores: { ads: adsScore, seo: seoScore, sales: salesScore, ops: opsScore, overall },
    tomorrow_focus: 'Set CLAUDE_API_KEY to enable AI coaching with specific fix prompts',
    tokensUsed: 0,
  };
}
