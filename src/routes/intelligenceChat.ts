import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index';
import logger from '../utils/logger';

const router = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContent[];
}

interface AnthropicContent {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 5-minute in-memory data cache (keyed by category)
// ---------------------------------------------------------------------------
const dataCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key: string): unknown | null {
  const entry = dataCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { dataCache.delete(key); return null; }
  return entry.data;
}
function setCache(key: string, data: unknown): void {
  dataCache.set(key, { data, ts: Date.now() });
}

// ---------------------------------------------------------------------------
// Live data fetchers (lightweight, return compact objects)
// ---------------------------------------------------------------------------
async function fetchMetaAds(): Promise<Record<string, unknown>> {
  const cached = getCached('meta_ads');
  if (cached) return cached as Record<string, unknown>;

  try {
    const r = await pool.query(`
      SELECT
        COALESCE(SUM((data->>'spend')::numeric), 0) AS spend_today,
        COALESCE(AVG((data->>'purchase_roas')::numeric), 0) AS roas_avg,
        COUNT(DISTINCT account_id) AS accounts
      FROM ads_insights_cache
      WHERE date = CURRENT_DATE
    `);
    const row = r.rows[0] as Record<string, string> ?? {};
    const result = {
      spend_today: Math.round(parseFloat(row.spend_today ?? '0')),
      roas_avg: parseFloat(parseFloat(row.roas_avg ?? '0').toFixed(2)),
      accounts_active: parseInt(row.accounts ?? '0'),
    };
    setCache('meta_ads', result);
    return result;
  } catch {
    return { note: 'Meta Ads data unavailable' };
  }
}

async function fetchPipeline(): Promise<Record<string, unknown>> {
  const cached = getCached('pipeline');
  if (cached) return cached as Record<string, unknown>;

  try {
    const r = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE stage NOT IN ('won','lost','Won','Lost')) AS active_deals,
        COALESCE(SUM(deal_value) FILTER (WHERE stage NOT IN ('won','lost','Won','Lost')), 0) AS pipeline_value,
        COUNT(*) FILTER (WHERE LOWER(stage) = 'proposal') AS in_proposal,
        COUNT(*) FILTER (WHERE updated_at < NOW() - INTERVAL '7 days' AND stage NOT IN ('won','lost','Won','Lost')) AS stale_deals,
        (SELECT COUNT(*) FROM contacts WHERE created_at::date = CURRENT_DATE) AS contacts_today
      FROM deals
    `);
    const row = r.rows[0] as Record<string, string> ?? {};
    const result = {
      active_deals: parseInt(row.active_deals ?? '0'),
      pipeline_value: parseInt(row.pipeline_value ?? '0'),
      in_proposal: parseInt(row.in_proposal ?? '0'),
      stale_deals_7d: parseInt(row.stale_deals ?? '0'),
      contacts_today: parseInt(row.contacts_today ?? '0'),
    };
    setCache('pipeline', result);
    return result;
  } catch {
    return { note: 'Pipeline data unavailable' };
  }
}

async function fetchSEO(): Promise<Record<string, unknown>> {
  const cached = getCached('seo');
  if (cached) return cached as Record<string, unknown>;

  try {
    const r = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE current_position < previous_position) AS improved,
        COUNT(*) FILTER (WHERE current_position > previous_position) AS dropped,
        COUNT(*) FILTER (WHERE checked_at >= NOW() - INTERVAL '7 days') AS tracked_7d,
        (SELECT COUNT(*) FROM seo_alerts_log WHERE created_at >= NOW() - INTERVAL '7 days') AS alerts_7d
      FROM keyword_rankings
    `);
    const row = r.rows[0] as Record<string, string> ?? {};
    const result = {
      keywords_improved: parseInt(row.improved ?? '0'),
      keywords_dropped: parseInt(row.dropped ?? '0'),
      keywords_tracked_7d: parseInt(row.tracked_7d ?? '0'),
      alerts_7d: parseInt(row.alerts_7d ?? '0'),
    };
    setCache('seo', result);
    return result;
  } catch {
    return { note: 'SEO data unavailable' };
  }
}

async function fetchBilling(): Promise<Record<string, unknown>> {
  const cached = getCached('billing');
  if (cached) return cached as Record<string, unknown>;

  try {
    const r = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'overdue') AS overdue_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'overdue'), 0) AS overdue_amount,
        (SELECT COALESCE(SUM(monthly_amount), 0) FROM retainers WHERE status = 'active') AS mrr,
        COUNT(*) FILTER (WHERE status = 'sent' AND due_date > NOW()) AS pending_count
      FROM invoices
    `);
    const row = r.rows[0] as Record<string, string> ?? {};
    const result = {
      overdue_invoices: parseInt(row.overdue_count ?? '0'),
      overdue_amount_paise: parseInt(row.overdue_amount ?? '0'),
      mrr_paise: parseInt(row.mrr ?? '0'),
      pending_invoices: parseInt(row.pending_count ?? '0'),
    };
    setCache('billing', result);
    return result;
  } catch {
    return { note: 'Billing data unavailable' };
  }
}

async function fetchCronHealth(): Promise<Record<string, unknown>> {
  const cached = getCached('cron_health');
  if (cached) return cached as Record<string, unknown>;

  try {
    const r = await pool.query(`
      SELECT DISTINCT ON (job_name) job_name, status, started_at, error_message
      FROM cron_job_logs
      ORDER BY job_name, started_at DESC
      LIMIT 30
    `);
    const rows = r.rows as Array<{ job_name: string; status: string; started_at: Date; error_message: string | null }>;
    const failed = rows.filter(row => row.status === 'failed').map(row => ({
      job: row.job_name,
      error: row.error_message?.slice(0, 80),
      at: row.started_at,
    }));
    const result = {
      total_tracked: rows.length,
      failed_jobs: failed,
      failed_count: failed.length,
      last_check: new Date().toISOString(),
    };
    setCache('cron_health', result);
    return result;
  } catch {
    return { note: 'Cron health data unavailable' };
  }
}

async function fetchSEOWorkflows(): Promise<Record<string, unknown>> {
  const cached = getCached('seo_workflows');
  if (cached) return cached as Record<string, unknown>;

  try {
    const { collectSEOWorkflowHealth } = await import('../services/intelligenceDataCollector');
    const health = await collectSEOWorkflowHealth();
    const result = {
      n8n_alive: health.n8nAlive,
      healthy: health.healthyCount,
      total: health.totalCount,
      broken_critical: health.brokenCritical.map(w => ({ name: w.name, days_overdue: w.daysSince })),
    };
    setCache('seo_workflows', result);
    return result;
  } catch {
    return { note: 'SEO workflow data unavailable' };
  }
}

async function fetchTasksOverview(): Promise<Record<string, unknown>> {
  const cached = getCached('tasks');
  if (cached) return cached as Record<string, unknown>;

  try {
    const { pool } = await import('../db/index');
    const r = await pool.query(
      `SELECT id, title FROM tasks
       WHERE status != 'done' AND due_at IS NOT NULL AND due_at < NOW()
       ORDER BY due_at ASC LIMIT 20`,
    );
    const tasks = r.rows as Array<{ id: string; title: string }>;
    const result = {
      overdue_tasks: tasks.length,
      sample_overdue: tasks.slice(0, 3).map(t => t.title),
    };
    setCache('tasks', result);
    return result;
  } catch {
    return { note: 'Tasks data unavailable' };
  }
}

// ---------------------------------------------------------------------------
// Build compact data snapshot for system prompt (injected once per message)
// ---------------------------------------------------------------------------
async function buildDataSnapshot(): Promise<Record<string, unknown>> {
  const [metaAds, pipeline, seo, billing, cronHealth] = await Promise.allSettled([
    fetchMetaAds(),
    fetchPipeline(),
    fetchSEO(),
    fetchBilling(),
    fetchCronHealth(),
  ]);

  return {
    date: new Date().toISOString().slice(0, 10),
    meta_ads: metaAds.status === 'fulfilled' ? metaAds.value : { note: 'unavailable' },
    pipeline: pipeline.status === 'fulfilled' ? pipeline.value : { note: 'unavailable' },
    seo: seo.status === 'fulfilled' ? seo.value : { note: 'unavailable' },
    billing: billing.status === 'fulfilled' ? billing.value : { note: 'unavailable' },
    cron_health: cronHealth.status === 'fulfilled' ? cronHealth.value : { note: 'unavailable' },
  };
}

// ---------------------------------------------------------------------------
// Claude Tool Use — tool definitions
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: 'get_live_data',
    description: 'Fetch fresh live data for a specific category. Use this to answer data questions.',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['meta_ads', 'seo', 'pipeline', 'tasks', 'billing', 'cron_health', 'seo_workflows'],
          description: 'The data category to fetch',
        },
      },
      required: ['category'],
    },
  },
  {
    name: 'generate_intelligence_report',
    description: 'Generate today\'s AI coaching report. ALWAYS confirm with user before calling this.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'trigger_seo_workflow',
    description: 'Trigger a specific n8n SEO workflow. ALWAYS confirm with user before calling this.',
    input_schema: {
      type: 'object',
      properties: {
        workflow_name: {
          type: 'string',
          enum: ['rank_tracking', 'gsc_ga4_pull', 'alert_triggers', 'pageSpeed', 'backlink_monitor', 'content_decay', 'weekly_digest'],
        },
      },
      required: ['workflow_name'],
    },
  },
  {
    name: 'run_growth_os',
    description: 'Run a Growth OS analysis. ALWAYS confirm with user before calling this.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['health_scores', 'money_on_table', 'creative_scan', 'competitor_pulse'],
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'generate_invoices',
    description: 'Generate draft invoices for all active retainer clients. ALWAYS confirm with user before calling this.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'publish_seo_pages',
    description: 'Publish pending programmatic SEO pages to WordPress. ALWAYS confirm with user before calling this.',
    input_schema: { type: 'object', properties: {} },
  },
];

// SEO workflow ID map
const SEO_WORKFLOW_IDS: Record<string, string> = {
  gsc_ga4_pull:    'YXmClFSKZB9DMkyu',
  alert_triggers:  '5FVX2kEjuD7vWD0e',
  pageSpeed:       'z21W6MDWBF0dukkT',
  rank_tracking:   'BwO187curjMMA60i',
  backlink_monitor:'19R3BStSY2S1N9H1',
  content_decay:   'Ss2Bfps5lXBWUUs4',
  weekly_digest:   'M4rbRZL5jh0jJHku',
};

// ---------------------------------------------------------------------------
// Execute a tool call (called by the backend after Claude returns tool_use)
// ---------------------------------------------------------------------------
async function executeTool(
  name: string,
  input: Record<string, unknown>,
  req: Request,
): Promise<string> {
  const authHeader = req.headers.authorization ?? '';

  try {
    switch (name) {
      case 'get_live_data': {
        const category = input.category as string;
        let data: Record<string, unknown>;
        switch (category) {
          case 'meta_ads': data = await fetchMetaAds(); break;
          case 'seo': data = await fetchSEO(); break;
          case 'pipeline': data = await fetchPipeline(); break;
          case 'tasks': data = await fetchTasksOverview(); break;
          case 'billing': data = await fetchBilling(); break;
          case 'cron_health': data = await fetchCronHealth(); break;
          case 'seo_workflows': data = await fetchSEOWorkflows(); break;
          default: data = { error: `Unknown category: ${category}` };
        }
        return JSON.stringify(data);
      }

      case 'generate_intelligence_report': {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const resp = await fetch(`${baseUrl}/api/intelligence/generate`, {
          method: 'POST',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
        const data = await resp.json() as { status?: string; reportId?: string; error?: string };
        await logAction('generate_intelligence_report', {}, req);
        return JSON.stringify({ status: data.status, reportId: data.reportId, message: 'Report generation started. It takes 1-2 minutes to complete.' });
      }

      case 'trigger_seo_workflow': {
        const workflowName = input.workflow_name as string;
        const workflowId = SEO_WORKFLOW_IDS[workflowName];
        if (!workflowId) return JSON.stringify({ error: `Unknown workflow: ${workflowName}` });

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const resp = await fetch(`${baseUrl}/api/seo/trigger/${workflowId}`, {
          method: 'POST',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
        const data = await resp.json() as { success?: boolean; error?: string };
        await logAction('trigger_seo_workflow', { workflow: workflowName, id: workflowId }, req);
        return JSON.stringify({ success: data.success, workflow: workflowName, message: resp.ok ? 'Workflow triggered successfully' : `Failed: ${data.error}` });
      }

      case 'run_growth_os': {
        const action = input.action as string;
        const actionMap: Record<string, string> = {
          health_scores: '/api/growth-os/health/generate',
          money_on_table: '/api/growth-os/opportunity/generate',
          creative_scan: '/api/growth-os/creatives/scan',
          competitor_pulse: '/api/growth-os/competitor/run',
        };
        const endpoint = actionMap[action];
        if (!endpoint) return JSON.stringify({ error: `Unknown Growth OS action: ${action}` });

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const resp = await fetch(`${baseUrl}${endpoint}`, {
          method: 'POST',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
        await logAction('run_growth_os', { action }, req);
        return JSON.stringify({ success: resp.ok, action, message: resp.ok ? `${action} triggered successfully` : 'Trigger failed' });
      }

      case 'generate_invoices': {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const resp = await fetch(`${baseUrl}/api/billing/generate-monthly`, {
          method: 'POST',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
        const data = await resp.json() as { generated?: number; errors?: string[] };
        await logAction('generate_invoices', {}, req);
        return JSON.stringify({ success: resp.ok, generated: data.generated, message: resp.ok ? `Generated ${data.generated ?? 0} draft invoices` : 'Invoice generation failed' });
      }

      case 'publish_seo_pages': {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const resp = await fetch(`${baseUrl}/api/seo/publish-pending-pages`, {
          method: 'POST',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(30000),
        });
        const data = await resp.json() as { published?: number; errors?: number };
        await logAction('publish_seo_pages', {}, req);
        return JSON.stringify({ success: resp.ok, published: data.published, errors: data.errors, message: resp.ok ? `Published ${data.published ?? 0} pages` : 'Publish failed' });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`[intel-chat] tool ${name} failed:`, e);
    return JSON.stringify({ error: msg });
  }
}

// ---------------------------------------------------------------------------
// Audit log helper
// ---------------------------------------------------------------------------
async function logAction(action: string, details: Record<string, unknown>, req: Request): Promise<void> {
  const user = (req as Request & { user?: { id: string; email: string } }).user;
  try {
    await pool.query(
      `INSERT INTO audit_events (actor_id, actor_email, action, resource_type, details, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [user?.id ?? 'unknown', user?.email ?? 'unknown', `copilot:${action}`, 'intelligence_chat', JSON.stringify(details)],
    ).catch(() => {
      // If audit_events schema differs, log to cron_job_logs as fallback
      pool.query(
        `INSERT INTO cron_job_logs (job_name, status, records_processed) VALUES ($1, 'success', 1)`,
        [`copilot:${action}`],
      ).catch(() => {});
    });
  } catch { /* audit logging is non-critical */ }
}

// ---------------------------------------------------------------------------
// POST /api/intelligence/chat — the main chat endpoint
// ---------------------------------------------------------------------------
router.post('/chat', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string; id: string; email: string } }).user;
  if (user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' });
    return;
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    res.status(503).json({ error: 'CLAUDE_API_KEY not configured' });
    return;
  }

  const { message, history = [] } = req.body as {
    message: string;
    history: ChatMessage[];
  };

  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message required' });
    return;
  }

  try {
    // Build compact data snapshot (used in system prompt)
    const snapshot = await buildDataSnapshot();

    const systemPrompt = `You are the Growth Escalators Operations Co-Pilot — Jatin's private AI assistant.
You have access to live business data and can take real actions via tools.

BUSINESS: Performance marketing agency, Jaipur, India.
TEAM: Jatin (founder/admin), Sakcham (sales/ads manager), Keshav (video editor).
CLIENTS: SEO — aarohaom.com, blackpandaenterprises.com, ageddentistry.org.

PERSONALITY: Direct. Concise. Metric-focused. No filler words. Lead with numbers.
FORMAT: Use bullet points for lists. Bold for key numbers. Single sentences per point.

RULES FOR ACTIONS:
- For Tier 1 read-only tools (get_live_data): execute immediately, no confirmation needed.
- For Tier 2 action tools: you MUST ask "Should I [specific action] now?" and wait for Jatin to confirm before calling. The UI will show a Confirm/Cancel button.
- Never guess deal IDs or contact IDs — ask Jatin to specify.
- Amounts in billing are in paise (divide by 100 for INR).

TODAY'S DATA SNAPSHOT (as of ${snapshot.date}):
${JSON.stringify(snapshot, null, 1)}

If data shows "unavailable", use get_live_data tool to fetch fresh data for that category.`;

    // Build message history for Claude (last 10 turns max)
    const recentHistory = history.slice(-10);
    const messages: AnthropicMessage[] = [
      ...recentHistory.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    // ---------------------------------------------------------------------------
    // First Claude call — may return text or tool_use
    // ---------------------------------------------------------------------------
    let response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('[intel-chat] Claude API error:', errText);
      res.status(502).json({ error: 'Claude API error', detail: errText.slice(0, 200) });
      return;
    }

    let claudeResp = await response.json() as {
      content: AnthropicContent[];
      stop_reason: string;
    };

    // ---------------------------------------------------------------------------
    // Agentic loop — handle tool_use turns (max 3 tool calls to avoid runaway)
    // ---------------------------------------------------------------------------
    const updatedMessages = [...messages];
    let loopCount = 0;

    while (claudeResp.stop_reason === 'tool_use' && loopCount < 3) {
      loopCount++;
      const toolUseBlocks = claudeResp.content.filter(
        (b): b is ToolUseBlock => b.type === 'tool_use',
      );

      // Add Claude's response (with tool_use) to message history
      updatedMessages.push({ role: 'assistant', content: claudeResp.content });

      // Execute each tool and collect results
      const toolResults: AnthropicMessage = {
        role: 'user',
        content: await Promise.all(
          toolUseBlocks.map(async (block) => {
            const result = await executeTool(block.name, block.input, req);
            return {
              type: 'tool_result' as const,
              tool_use_id: block.id,
              content: result,
            };
          }),
        ),
      };

      updatedMessages.push(toolResults);

      // Second Claude call with tool results
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: AbortSignal.timeout(60000),
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          system: systemPrompt,
          tools: TOOLS,
          messages: updatedMessages,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.error('[intel-chat] Claude API error (tool loop):', errText);
        res.status(502).json({ error: 'Claude API error', detail: errText.slice(0, 200) });
        return;
      }

      claudeResp = await response.json() as { content: AnthropicContent[]; stop_reason: string };
    }

    // Extract final text reply
    const textBlock = claudeResp.content.find(b => b.type === 'text');
    const reply = textBlock?.text ?? 'No response generated.';

    // Detect if this reply is asking for confirmation before an action
    const isConfirmRequest = /should i|shall i|want me to|confirm|go ahead|proceed/i.test(reply);

    res.json({ reply, isConfirmRequest });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[intel-chat] chat handler error:', e);
    res.status(500).json({ error: 'Chat failed', detail: msg.slice(0, 200) });
  }
});

export default router;
