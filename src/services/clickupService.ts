import https from 'https';
import { sendSlackMessage } from './slackService';
import logger from '../utils/logger';
import {
  SLACK_SALES_BD_CHANNEL,
  CLICKUP_JATIN, CLICKUP_SAKCHAM, CLICKUP_NIMISHA, CLICKUP_KESHAV,
  SLACK_JATIN, SLACK_SAKCHAM,
} from '../config/constants';

const CLICKUP_TOKEN = process.env.CLICKUP_API_TOKEN;
const CLICKUP_LIST_ID = process.env.CLICKUP_LIST_ID;
const SALES_BD_CHANNEL = SLACK_SALES_BD_CHANNEL;

const CLICKUP_IDS = {
  jatin: CLICKUP_JATIN,
  sakcham: CLICKUP_SAKCHAM,
  nimisha: CLICKUP_NIMISHA,
  keshav: CLICKUP_KESHAV,
};

interface ClickUpTask {
  name: string;
  description?: string;
  assignees?: number[];
  tags?: string[];
  status?: string;
  priority?: number;
  dueDate?: number;
}

async function clickupRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  if (!CLICKUP_TOKEN) { logger.error('[ClickUp] token not set'); return null; }

  return new Promise((resolve) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.clickup.com',
      path: `/api/v2${path}`,
      method,
      headers: {
        Authorization: CLICKUP_TOKEN,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', (e) => { logger.error('[ClickUp] request error:', e.message); resolve(null); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

export async function getWorkspaceInfo(): Promise<unknown> {
  return clickupRequest('GET', '/team');
}

export async function createTask(task: ClickUpTask): Promise<{ id: string; url: string } | null> {
  const listId = CLICKUP_LIST_ID;
  if (!listId) { console.log('[ClickUp] list ID not set — skipped:', task.name); return null; }

  const payload: Record<string, unknown> = { name: task.name, priority: task.priority || 2, notify_all: false };
  if (task.description) payload.description = task.description;
  if (task.assignees?.length) payload.assignees = task.assignees;
  if (task.tags?.length) payload.tags = task.tags;
  if (task.status) payload.status = task.status;
  if (task.dueDate) payload.due_date = task.dueDate;

  const result = await clickupRequest('POST', `/list/${listId}/task`, payload) as { id?: string; url?: string } | null;
  if (result?.id) {
    console.log(`[ClickUp] task created: ${task.name} — ID: ${result.id}`);
    return { id: result.id, url: result.url ?? '' };
  }
  logger.error('[ClickUp] task creation failed:', result);
  return null;
}

export async function getTasksForContact(contactId: string): Promise<unknown[]> {
  if (!CLICKUP_LIST_ID) return [];
  const result = await clickupRequest('GET', `/list/${CLICKUP_LIST_ID}/task?tags[]=${contactId}&include_closed=true`) as { tasks?: unknown[] } | null;
  return result?.tasks || [];
}

export async function updateTaskStatus(taskId: string, status: string): Promise<boolean> {
  const result = await clickupRequest('PUT', `/task/${taskId}`, { status }) as { id?: string } | null;
  return !!(result?.id);
}

async function taskExists(name: string): Promise<boolean> {
  if (!CLICKUP_LIST_ID) return false;
  const result = await clickupRequest('GET', `/list/${CLICKUP_LIST_ID}/task?include_closed=false`) as { tasks?: Array<{ name: string }> } | null;
  return (result?.tasks || []).some(t => t.name === name);
}

function daysFromNow(d: number): number { return Date.now() + d * 86400000; }
function endOfToday(): number { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); }

// Deal Won → Jatin + Sakcham
export async function createOnboardingTask(params: {
  contactName: string; contactId: string; dealValue?: number;
  contactEmail?: string; contactPhone?: string; pipelineName?: string;
}): Promise<{ id: string; url: string } | null> {
  const taskName = `Client Onboarding Setup — ${params.contactName}`;
  if (await taskExists(taskName)) return null;

  const result = await createTask({
    name: taskName,
    description: `New client won. Set up onboarding.\n\nClient: ${params.contactName}\nDeal value: ${params.dealValue ? '₹' + params.dealValue.toLocaleString('en-IN') + '/mo' : 'N/A'}\nContact ID: ${params.contactId}`,
    assignees: [CLICKUP_IDS.jatin, CLICKUP_IDS.sakcham],
    tags: [params.contactId, 'new-client', 'onboarding'],
    priority: 2,
    dueDate: daysFromNow(3),
    status: 'to do',
  });

  sendSlackMessage(SALES_BD_CHANNEL,
    `🎉 *Deal Won!* ${params.contactName} — Onboarding task created for <@${SLACK_JATIN}> + <@${SLACK_SAKCHAM}>`
  ).catch(() => {});

  return result;
}

// Proposal Sent → Sakcham
export async function createFollowUpTask(params: {
  contactName: string; contactId: string; dealValue?: number; proposalDate?: string;
}): Promise<{ id: string; url: string } | null> {
  const taskName = `Follow Up on Proposal — ${params.contactName}`;
  if (await taskExists(taskName)) return null;

  const result = await createTask({
    name: taskName,
    description: `Proposal sent to ${params.contactName}. Follow up within 48 hours.\n\nContact ID: ${params.contactId}`,
    assignees: [CLICKUP_IDS.sakcham],
    tags: [params.contactId, 'proposal', 'follow-up'],
    priority: 2,
    dueDate: daysFromNow(2),
    status: 'to do',
  });

  sendSlackMessage(SALES_BD_CHANNEL,
    `📤 *Proposal sent* to ${params.contactName} — Follow-up task created for <@${SLACK_SAKCHAM}>`
  ).catch(() => {});

  return result;
}

// Deal Lost → Jatin
export async function createLostDealAnalysisTask(params: {
  contactName: string; contactId: string; lostReason: string; dealValue?: number;
}): Promise<{ id: string; url: string } | null> {
  const taskName = `Loss Analysis — ${params.contactName}`;
  if (await taskExists(taskName)) return null;

  const result = await createTask({
    name: taskName,
    description: `Lost: ${params.contactName}. Reason: ${params.lostReason}\nContact ID: ${params.contactId}`,
    assignees: [CLICKUP_IDS.jatin],
    tags: [params.contactId, 'lost-deal', 'analysis'],
    priority: 3,
    dueDate: daysFromNow(7),
    status: 'to do',
  });

  sendSlackMessage(SALES_BD_CHANNEL,
    `📉 *Deal Lost* — ${params.contactName}. Reason: ${params.lostReason}. Analysis task for <@${SLACK_JATIN}>`
  ).catch(() => {});

  return result;
}

// Hot lead → Jatin + Sakcham, Warm → Sakcham
export async function createCallPrepTask(params: {
  contactName: string; contactId: string; score: number; tier: string;
  adSpend?: string; isDecisionMaker?: boolean; scheduledAt?: string;
  phone?: string; revenue?: string;
}): Promise<{ id: string; url: string } | null> {
  const isHot = params.tier === 'hot' || params.score >= 70;
  const taskName = `${isHot ? 'Call Prep — HOT LEAD: ' : 'Call Prep — '}${params.contactName}`;
  if (await taskExists(taskName)) return null;

  const callTime = params.scheduledAt || 'Check calendar';
  const assignees = isHot ? [CLICKUP_IDS.jatin, CLICKUP_IDS.sakcham] : [CLICKUP_IDS.sakcham];

  const result = await createTask({
    name: taskName,
    description: `${isHot ? 'Hot' : 'Warm'} lead. Score: ${params.score}/100.\nName: ${params.contactName}\nPhone: ${params.phone || 'N/A'}\nCall: ${callTime}\nContact ID: ${params.contactId}`,
    assignees,
    tags: [params.contactId, 'strategy-call', params.tier + '-lead'],
    priority: isHot ? 1 : 2,
    dueDate: endOfToday(),
    status: 'to do',
  });

  // Post to #sales-bd
  if (isHot) {
    sendSlackMessage(SALES_BD_CHANNEL,
      `🔥 *Hot Lead Alert!*\n\n*Name:* ${params.contactName}\n*Score:* ${params.score}/100\n*Phone:* ${params.phone || 'N/A'}\n*Ad Spend:* ${params.adSpend || 'N/A'}\n*Revenue:* ${params.revenue || 'N/A'}\n*Call Time:* ${callTime}\n\n<@${SLACK_JATIN}> <@${SLACK_SAKCHAM}> — prep for this call!`
    ).catch(() => {});
  } else {
    sendSlackMessage(SALES_BD_CHANNEL,
      `📞 *Warm Lead Booked*\n\n*Name:* ${params.contactName}\n*Score:* ${params.score}/100\n*Phone:* ${params.phone || 'N/A'}\n*Call Time:* ${callTime}\n\n<@${SLACK_SAKCHAM}> — please prep for this call.`
    ).catch(() => {});
  }

  return result;
}

// New contact → Sakcham
export async function createInitialOutreachTask(params: {
  contactName: string; contactId: string; source?: string; phone?: string; email?: string;
}): Promise<{ id: string; url: string } | null> {
  const taskName = `Initial Outreach — ${params.contactName}`;
  if (await taskExists(taskName)) return null;

  return createTask({
    name: taskName,
    description: `New contact: ${params.contactName}\nSource: ${params.source || 'Direct'}\nPhone: ${params.phone || 'N/A'}\nEmail: ${params.email || 'N/A'}\nContact ID: ${params.contactId}`,
    assignees: [CLICKUP_IDS.sakcham],
    tags: [params.contactId, 'outreach', 'new-contact'],
    priority: 3,
    dueDate: daysFromNow(1),
    status: 'to do',
  });
}
