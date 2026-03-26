import https from 'https';
import { sendSlackMessage } from './slackService';
import { CLICKUP_IDS, SLACK_CHANNELS } from '../utils/clickupSlack';

const CLICKUP_TOKEN = process.env.CLICKUP_API_TOKEN;
const CLICKUP_LIST_ID = process.env.CLICKUP_LIST_ID;

interface ClickUpTask {
  name: string;
  description?: string;
  assignees?: number[];
  tags?: string[];
  status?: string;
  priority?: number;
  dueDate?: number;
  customFields?: Array<{ id: string; value: unknown }>;
}

async function clickupRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  if (!CLICKUP_TOKEN) {
    console.error('[ClickUp] CLICKUP_API_TOKEN not set');
    return null;
  }

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
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });

    req.on('error', (e) => {
      console.error('[ClickUp] request error:', e.message);
      resolve(null);
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

export async function getWorkspaceInfo(): Promise<unknown> {
  return clickupRequest('GET', '/team');
}

export async function createTask(task: ClickUpTask): Promise<{ id: string; url: string } | null> {
  const listId = CLICKUP_LIST_ID;
  if (!listId || listId === 'placeholder_will_update') {
    console.log('[ClickUp] list ID not configured yet — task skipped:', task.name);
    return null;
  }

  const payload: Record<string, unknown> = {
    name: task.name,
    priority: task.priority || 2,
    notify_all: false,
  };

  if (task.description) payload.description = task.description;
  if (task.assignees && task.assignees.length > 0) payload.assignees = task.assignees;
  if (task.tags && task.tags.length > 0) payload.tags = task.tags;
  if (task.status) payload.status = task.status;
  if (task.dueDate) payload.due_date = task.dueDate;

  const result = await clickupRequest('POST', `/list/${listId}/task`, payload) as { id?: string; url?: string } | null;

  if (result && result.id) {
    console.log(`[ClickUp] task created: ${task.name} — ID: ${result.id}`);
    return { id: result.id, url: result.url ?? '' };
  }

  console.error('[ClickUp] task creation failed:', result);
  return null;
}

export async function getTasksForContact(contactId: string): Promise<unknown[]> {
  const listId = CLICKUP_LIST_ID;
  if (!listId || listId === 'placeholder_will_update') return [];
  const result = await clickupRequest('GET', `/list/${listId}/task?tags[]=${contactId}&include_closed=true`) as { tasks?: unknown[] } | null;
  return result?.tasks || [];
}

export async function updateTaskStatus(taskId: string, status: string): Promise<boolean> {
  const result = await clickupRequest('PUT', `/task/${taskId}`, { status }) as { id?: string } | null;
  return !!(result?.id);
}

// Check for duplicate tasks by name
async function taskExists(name: string): Promise<boolean> {
  const listId = CLICKUP_LIST_ID;
  if (!listId) return false;
  const result = await clickupRequest('GET', `/list/${listId}/task?include_closed=false`) as { tasks?: Array<{ name: string }> } | null;
  return (result?.tasks || []).some(t => t.name === name);
}

function daysFromNow(days: number): number {
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

function endOfToday(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

// -----------------------------------------------------------------------
// Deal Won → Onboarding task
// Assigned to: Sanskriti + Jatin | Due: 3 days | Priority: HIGH
// -----------------------------------------------------------------------
export async function createOnboardingTask(params: {
  contactName: string;
  contactId: string;
  dealValue?: number;
  contactEmail?: string;
  contactPhone?: string;
  pipelineName?: string;
}): Promise<{ id: string; url: string } | null> {
  const taskName = `Client Onboarding Setup — ${params.contactName}`;
  if (await taskExists(taskName)) { console.log('[ClickUp] duplicate skipped:', taskName); return null; }

  const dealValueStr = params.dealValue ? `₹${params.dealValue.toLocaleString('en-IN')}/mo` : 'Not set';

  const result = await createTask({
    name: taskName,
    description: `New client won. Set up onboarding process, welcome sequence, and initial campaign structure.\n\nClient: ${params.contactName}\nDeal value: ${dealValueStr}\nEmail: ${params.contactEmail || 'N/A'}\nPhone: ${params.contactPhone || 'N/A'}\nPipeline: ${params.pipelineName || 'D2C Prospects'}\nContact ID: ${params.contactId}`,
    assignees: [CLICKUP_IDS.sanskriti, CLICKUP_IDS.jatin],
    tags: [params.contactId, 'new-client', 'onboarding'],
    priority: 2, // HIGH
    dueDate: daysFromNow(3),
    status: 'to do',
  });

  // Post to #sales-bd
  sendSlackMessage(SLACK_CHANNELS.salesBd,
    `🎉 *Deal Won!* ${params.contactName} — Onboarding task created and assigned to Sanskriti + Jatin`
  ).catch(() => {});

  return result;
}

// -----------------------------------------------------------------------
// Proposal Sent → Follow-up task
// Assigned to: Sakcham | Due: 2 days | Priority: HIGH
// -----------------------------------------------------------------------
export async function createFollowUpTask(params: {
  contactName: string;
  contactId: string;
  dealValue?: number;
  proposalDate?: string;
  assignedTo?: 'jatin' | 'saksham';
}): Promise<{ id: string; url: string } | null> {
  const taskName = `Follow Up on Proposal — ${params.contactName}`;
  if (await taskExists(taskName)) { console.log('[ClickUp] duplicate skipped:', taskName); return null; }

  const result = await createTask({
    name: taskName,
    description: `Proposal sent to ${params.contactName}. Follow up within 48 hours. Check in on questions, handle objections, push for decision.\n\nProposal date: ${params.proposalDate || new Date().toLocaleDateString('en-IN')}\nDeal value: ${params.dealValue ? '₹' + params.dealValue.toLocaleString('en-IN') + '/month' : 'Not set'}\nContact ID: ${params.contactId}`,
    assignees: [CLICKUP_IDS.sakcham],
    tags: [params.contactId, 'proposal', 'follow-up'],
    priority: 2, // HIGH
    dueDate: daysFromNow(2),
    status: 'to do',
  });

  sendSlackMessage(SLACK_CHANNELS.salesBd,
    `📤 *Proposal sent* to ${params.contactName} — Follow-up task created for Sakcham`
  ).catch(() => {});

  return result;
}

// -----------------------------------------------------------------------
// Deal Lost → Loss Analysis task
// Assigned to: Jatin | Due: 7 days | Priority: NORMAL
// -----------------------------------------------------------------------
export async function createLostDealAnalysisTask(params: {
  contactName: string;
  contactId: string;
  lostReason: string;
  dealValue?: number;
}): Promise<{ id: string; url: string } | null> {
  const taskName = `Loss Analysis — ${params.contactName}`;
  if (await taskExists(taskName)) { console.log('[ClickUp] duplicate skipped:', taskName); return null; }

  const result = await createTask({
    name: taskName,
    description: `Analyse why ${params.contactName} was lost. Lost reason: ${params.lostReason}. Document learnings and update pitch/process accordingly.\n\nDeal value: ${params.dealValue ? '₹' + params.dealValue.toLocaleString('en-IN') + '/month' : 'Not set'}\nContact ID: ${params.contactId}`,
    assignees: [CLICKUP_IDS.jatin],
    tags: [params.contactId, 'lost-deal', 'analysis'],
    priority: 3, // NORMAL
    dueDate: daysFromNow(7),
    status: 'to do',
  });

  sendSlackMessage(SLACK_CHANNELS.salesBd,
    `📉 *Deal Lost* — ${params.contactName}. Reason: ${params.lostReason}. Analysis task created for Jatin.`
  ).catch(() => {});

  return result;
}

// -----------------------------------------------------------------------
// Hot lead books call (score ≥ 70) → Call prep for Jatin
// Assigned to: Jatin | Due: end of today | Priority: URGENT
// -----------------------------------------------------------------------
export async function createCallPrepTask(params: {
  contactName: string;
  contactId: string;
  score: number;
  tier: string;
  adSpend?: string;
  isDecisionMaker?: boolean;
  scheduledAt?: string;
  phone?: string;
  revenue?: string;
  assignedTo?: 'jatin' | 'saksham';
}): Promise<{ id: string; url: string } | null> {
  const isHot = params.tier === 'hot' || params.score >= 70;
  const prefix = isHot ? 'Call Prep — HOT LEAD: ' : 'Call Prep — ';
  const taskName = `${prefix}${params.contactName}`;
  if (await taskExists(taskName)) { console.log('[ClickUp] duplicate skipped:', taskName); return null; }

  const callTime = params.scheduledAt || 'Check calendar';
  const assignee = isHot ? CLICKUP_IDS.jatin : CLICKUP_IDS.sakcham;

  const result = await createTask({
    name: taskName,
    description: isHot
      ? `Hot lead booked! Score: ${params.score}/100.\n\nName: ${params.contactName}\nPhone: ${params.phone || 'N/A'}\nAd spend: ${params.adSpend || 'N/A'}\nRevenue: ${params.revenue || 'N/A'}\nCall time: ${callTime}\n\nPrepare tailored pitch.\nContact ID: ${params.contactId}`
      : `Warm lead booked. Score: ${params.score}/100.\n\nName: ${params.contactName}\nPhone: ${params.phone || 'N/A'}\nCall time: ${callTime}\n\nReview their profile and prepare standard pitch.\nContact ID: ${params.contactId}`,
    assignees: [assignee],
    tags: [params.contactId, 'strategy-call', params.tier + '-lead'],
    priority: isHot ? 1 : 2, // URGENT for hot, HIGH for warm
    dueDate: endOfToday(),
    status: 'to do',
  });

  const assigneeName = isHot ? 'Jatin' : 'Sakcham';
  const emoji = isHot ? '🔥' : '📞';
  const label = isHot ? 'HOT LEAD' : 'Warm lead';
  sendSlackMessage(SLACK_CHANNELS.salesBd,
    `${emoji} *${label} booked* — ${params.contactName} scored ${params.score}/100. Call prep task created for ${assigneeName}. Call at ${callTime}`
  ).catch(() => {});

  return result;
}

// -----------------------------------------------------------------------
// New contact created → Initial outreach task
// Assigned to: Sakcham | Due: 1 day | Priority: NORMAL
// -----------------------------------------------------------------------
export async function createInitialOutreachTask(params: {
  contactName: string;
  contactId: string;
  source?: string;
  phone?: string;
  email?: string;
}): Promise<{ id: string; url: string } | null> {
  const taskName = `Initial Outreach — ${params.contactName}`;
  if (await taskExists(taskName)) { console.log('[ClickUp] duplicate skipped:', taskName); return null; }

  const result = await createTask({
    name: taskName,
    description: `New contact added: ${params.contactName}\nSource: ${params.source || 'Direct'}\nPhone: ${params.phone || 'N/A'}\nEmail: ${params.email || 'N/A'}\n\nMake initial contact and qualify.\nContact ID: ${params.contactId}`,
    assignees: [CLICKUP_IDS.sakcham],
    tags: [params.contactId, 'outreach', 'new-contact'],
    priority: 3, // NORMAL
    dueDate: daysFromNow(1),
    status: 'to do',
  });

  sendSlackMessage(SLACK_CHANNELS.salesBd,
    `👤 *New contact:* ${params.contactName} from ${params.source || 'Direct'}. Outreach task created for Sakcham.`
  ).catch(() => {});

  return result;
}
