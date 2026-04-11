import { pool } from '../db/index';
import logger from '../utils/logger';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { CircuitBreaker } from './circuitBreaker';
import { SEO_WORKFLOWS } from './seoWorkflowHealthService';
import { SLACK_SEO_CHANNEL, SLACK_JATIN } from '../config/constants';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const N8N_BASE = process.env.N8N_BASE_URL ?? 'https://primary-production-6c6f5.up.railway.app';
const N8N_API = `${N8N_BASE}/api/v1`;
const N8N_API_KEY = process.env.N8N_API_KEY;

const MAX_RETRIES = 3;
const BACKOFF_MINUTES = [5, 15, 45];
const POLL_WINDOW_HOURS = 2;

// Circuit breaker for n8n API (5 failures → 5 min cooldown)
export const n8nApiBreaker = new CircuitBreaker('n8n API', 5, 300_000);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface N8nExecution {
  id: string;
  workflowId: string;
  finished: boolean;
  mode: string;
  startedAt: string;
  stoppedAt: string;
  status: string;
  data?: {
    resultData?: {
      error?: { message: string; stack?: string };
    };
  };
}

interface SeoWorkflow {
  id: string;
  name: string;
  schedule: string;
  webhookPath: string;
  critical: boolean;
}

// ---------------------------------------------------------------------------
// Ensure self-healing columns on seo_workflow_logs
// ---------------------------------------------------------------------------
export async function ensureSelfHealingColumns(): Promise<void> {
  const alters = [
    `ALTER TABLE seo_workflow_logs ADD COLUMN IF NOT EXISTS execution_id TEXT`,
    `ALTER TABLE seo_workflow_logs ADD COLUMN IF NOT EXISTS execution_status TEXT`,
    `ALTER TABLE seo_workflow_logs ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0`,
    `ALTER TABLE seo_workflow_logs ADD COLUMN IF NOT EXISTS ai_diagnosis TEXT`,
    `ALTER TABLE seo_workflow_logs ADD COLUMN IF NOT EXISTS healed_at TIMESTAMP`,
  ];
  for (const s of alters) {
    await pool.query(s).catch(e =>
      logger.warn(`[self-healing] column migration: ${e instanceof Error ? e.message : String(e)}`),
    );
  }
}

// ---------------------------------------------------------------------------
// n8n API helper (CircuitBreaker + fetchWithRetry)
// ---------------------------------------------------------------------------
async function n8nFetch(path: string, method = 'GET', body?: unknown): Promise<Response> {
  if (!N8N_API_KEY) throw new Error('N8N_API_KEY not configured');
  return n8nApiBreaker.call(() =>
    fetchWithRetry(`${N8N_API}${path}`, {
      method,
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, 2, 2000),
  );
}

// ---------------------------------------------------------------------------
// Poll for failed executions (last 2 hours, SEO workflows only)
// ---------------------------------------------------------------------------
export async function pollFailedExecutions(): Promise<N8nExecution[]> {
  try {
    const res = await n8nFetch(`/executions?status=error&limit=50`);
    if (!res.ok) {
      logger.error(`[self-healing] poll failed: ${res.status}`);
      return [];
    }
    const body = await res.json() as { data: N8nExecution[] };
    const seoIds = new Set<string>(SEO_WORKFLOWS.map(w => w.id));
    const cutoff = Date.now() - POLL_WINDOW_HOURS * 3600_000;

    return (body.data || []).filter(ex =>
      seoIds.has(ex.workflowId) && new Date(ex.startedAt).getTime() > cutoff,
    );
  } catch (e) {
    logger.error('[self-healing] poll error:', e instanceof Error ? e.message : String(e));
    return [];
  }
}

// ---------------------------------------------------------------------------
// Get full execution details (for error messages)
// ---------------------------------------------------------------------------
async function getExecutionDetails(executionId: string): Promise<N8nExecution | null> {
  try {
    const res = await n8nFetch(`/executions/${executionId}?includeData=true`);
    if (!res.ok) return null;
    return await res.json() as N8nExecution;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Retry a failed execution via n8n API
// ---------------------------------------------------------------------------
export async function retryExecution(executionId: string): Promise<boolean> {
  try {
    const res = await n8nFetch(`/executions/${executionId}/retry`, 'POST', { loadWorkflow: true });
    return res.ok;
  } catch (e) {
    logger.error(`[self-healing] retry failed for ${executionId}:`, e instanceof Error ? e.message : String(e));
    return false;
  }
}

// ---------------------------------------------------------------------------
// AI diagnosis via Claude
// ---------------------------------------------------------------------------
export async function analyzeFailure(
  workflow: SeoWorkflow,
  errorMessage: string,
  errorStack?: string,
): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    return 'AI diagnosis unavailable — CLAUDE_API_KEY not configured';
  }

  const prompt = `You are a DevOps engineer debugging n8n workflow failures for an SEO automation platform.

Workflow: "${workflow.name}" (ID: ${workflow.id})
Schedule: ${workflow.schedule}
Critical: ${workflow.critical ? 'YES' : 'No'}

Error message:
${errorMessage}

${errorStack ? `Stack trace:\n${errorStack.slice(0, 2000)}` : ''}

Provide a concise diagnosis:
1. ROOT CAUSE: (one sentence)
2. FIX: (specific actionable steps, 2-3 bullets max)
3. PREVENTION: (one sentence)
4. SEVERITY: critical | high | medium | low`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) return `AI diagnosis failed (HTTP ${response.status})`;
    const result = await response.json() as { content: Array<{ text: string }> };
    return result.content?.[0]?.text ?? 'No diagnosis returned';
  } catch (e) {
    return `AI diagnosis error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ---------------------------------------------------------------------------
// Log a healing attempt to DB
// ---------------------------------------------------------------------------
async function logHealingAttempt(
  workflow: SeoWorkflow,
  executionId: string,
  status: string,
  retryCount: number,
  errorMessage?: string,
  aiDiagnosis?: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO seo_workflow_logs
     (workflow_id, workflow_name, status, started_at, triggered_by, execution_id, execution_status, retry_count, ai_diagnosis, error_message)
     VALUES ($1, $2, $3, NOW(), 'self-healing', $4, $5, $6, $7, $8)`,
    [workflow.id, workflow.name, status, executionId, status, retryCount, aiDiagnosis ?? null, errorMessage ?? null],
  ).catch(e => logger.error('[self-healing] log insert failed:', e));
}

// ---------------------------------------------------------------------------
// Get retry count for a specific execution
// ---------------------------------------------------------------------------
async function getRetryCount(workflowId: string, executionId: string): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COALESCE(MAX(retry_count), 0) AS cnt FROM seo_workflow_logs
       WHERE workflow_id = $1 AND execution_id = $2 AND triggered_by = 'self-healing'`,
      [workflowId, executionId],
    );
    return parseInt((result.rows[0] as { cnt: string })?.cnt ?? '0');
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Heal a single workflow (retry loop → diagnose → escalate)
// ---------------------------------------------------------------------------
export async function healWorkflow(workflow: SeoWorkflow, execution: N8nExecution): Promise<void> {
  const retryCount = await getRetryCount(workflow.id, execution.id);

  if (retryCount >= MAX_RETRIES) {
    return; // Already exhausted retries
  }

  const nextRetry = retryCount + 1;
  const backoffMs = BACKOFF_MINUTES[Math.min(retryCount, BACKOFF_MINUTES.length - 1)] * 60_000;

  logger.info(`[self-healing] ${workflow.name}: attempt ${nextRetry}/${MAX_RETRIES} (backoff ${BACKOFF_MINUTES[retryCount]}min)`);

  // Wait for backoff
  await new Promise(r => setTimeout(r, backoffMs));

  // Attempt retry
  const success = await retryExecution(execution.id);

  if (success) {
    await logHealingAttempt(workflow, execution.id, 'retry_success', nextRetry);
    logger.info(`[self-healing] ${workflow.name} retry ${nextRetry} succeeded`);

    const { sendSlackMessage } = await import('./slackService');
    await sendSlackMessage(SLACK_SEO_CHANNEL,
      `✅ *Self-Healed:* ${workflow.name}\nRetry ${nextRetry}/${MAX_RETRIES} succeeded.\nExecution: \`${execution.id}\``,
    ).catch(() => {});
    return;
  }

  // Retry failed
  await logHealingAttempt(workflow, execution.id, 'retry_failed', nextRetry);
  logger.warn(`[self-healing] ${workflow.name} retry ${nextRetry} failed`);

  if (nextRetry >= MAX_RETRIES) {
    // Exhausted retries — get AI diagnosis and escalate
    const details = await getExecutionDetails(execution.id);
    const errorMsg = details?.data?.resultData?.error?.message ?? 'Unknown error';
    const errorStack = details?.data?.resultData?.error?.stack;

    const diagnosis = await analyzeFailure(workflow, errorMsg, errorStack);
    await logHealingAttempt(workflow, execution.id, 'escalated', nextRetry, errorMsg, diagnosis);

    const criticalTag = workflow.critical ? ' 🔴 *CRITICAL*' : '';
    const escalationMsg =
      `🚨 *WORKFLOW FAILED — Auto-Recovery Exhausted*${criticalTag}\n\n` +
      `*Workflow:* ${workflow.name}\n` +
      `*Execution:* \`${execution.id}\`\n` +
      `*Retries:* ${nextRetry}/${MAX_RETRIES} all failed\n` +
      `*Error:* ${errorMsg.slice(0, 300)}\n\n` +
      `*AI Diagnosis:*\n${diagnosis}\n\n` +
      `*Manual fix:* ${N8N_BASE}/workflow/${workflow.id}/executions`;

    const { sendSlackMessage, sendSlackDM } = await import('./slackService');
    await sendSlackMessage(SLACK_SEO_CHANNEL, escalationMsg).catch(() => {});
    if (workflow.critical) {
      await sendSlackDM(SLACK_JATIN, escalationMsg).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Main cycle — called by cron every 30 min
// ---------------------------------------------------------------------------
export async function runSelfHealingCycle(): Promise<void> {
  if (!N8N_API_KEY) {
    logger.warn('[self-healing] N8N_API_KEY not set — self-healing disabled');
    return;
  }

  if (n8nApiBreaker.getState() === 'open') {
    logger.warn('[self-healing] n8n circuit breaker is OPEN — skipping cycle');
    return;
  }

  const failures = await pollFailedExecutions();
  if (failures.length === 0) {
    logger.debug('[self-healing] no failed executions in last 2h');
    return;
  }

  logger.info(`[self-healing] found ${failures.length} failed execution(s)`);

  // Deduplicate: only handle the LATEST failure per workflow
  const latestByWorkflow = new Map<string, N8nExecution>();
  for (const ex of failures) {
    const existing = latestByWorkflow.get(ex.workflowId);
    if (!existing || new Date(ex.startedAt) > new Date(existing.startedAt)) {
      latestByWorkflow.set(ex.workflowId, ex);
    }
  }

  // Process each failed workflow (critical first)
  const sorted = [...latestByWorkflow.entries()].sort(([idA], [idB]) => {
    const wfA = SEO_WORKFLOWS.find(w => w.id === idA);
    const wfB = SEO_WORKFLOWS.find(w => w.id === idB);
    return (wfB?.critical ? 1 : 0) - (wfA?.critical ? 1 : 0);
  });

  for (const [workflowId, execution] of sorted) {
    const workflow = SEO_WORKFLOWS.find(w => w.id === workflowId);
    if (!workflow) continue;

    try {
      await healWorkflow(workflow as SeoWorkflow, execution);
    } catch (e) {
      logger.error(`[self-healing] heal error for ${workflow.name}:`, e);
    }
  }
}
