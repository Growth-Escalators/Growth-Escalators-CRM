import { sendSlackMessage } from '../services/slackService';

export interface TeamMember {
  name: string;
  clickupId: string;
  slackId: string;
  email: string;
}

export const TEAM_MEMBERS: TeamMember[] = [
  { name: 'Jatin', clickupId: '88911769', slackId: 'U073Y677JBB', email: 'jatin@growthescalators.com' },
  { name: 'Vishal', clickupId: '100972806', slackId: 'U0ALC9Z09RA', email: 'vishal.malakar@growthescalators.com' },
  { name: 'Sanskriti', clickupId: '100860514', slackId: 'U09TXBW2XPX', email: 'gupta13sanskriti@gmail.com' },
  { name: 'Sakcham', clickupId: '242618940', slackId: 'U09TY8RGN30', email: 'sakcham@growthescalators.com' },
  { name: 'Nimisha', clickupId: '100972807', slackId: 'U0ALMKD2XFB', email: 'nimisha.daiya@growthescalators.com' },
  { name: 'Keshav', clickupId: '4800274', slackId: 'U073Y6S4K4H', email: 'keshav.growthescalators@gmail.com' },
];

export const CLICKUP_IDS = {
  jatin: 88911769,
  vishal: 100972806,
  sanskriti: 100860514,
  sakcham: 242618940,
  nimisha: 100972807,
  keshav: 4800274,
};

export const SLACK_IDS = {
  jatin: 'U073Y677JBB',
  vishal: 'U0ALC9Z09RA',
  sanskriti: 'U09TXBW2XPX',
  sakcham: 'U09TY8RGN30',
  nimisha: 'U0ALMKD2XFB',
  keshav: 'U073Y6S4K4H',
};

export const SLACK_CHANNELS = {
  sodEod: 'sod-eod',
  general: 'C07489V0RB2',
  salesBd: 'sales-bd',
  performanceMarketing: 'performance-marketing',
};

export function getSlackIdFromClickup(clickupId: string): string {
  const member = TEAM_MEMBERS.find(m => m.clickupId === clickupId);
  return member?.slackId || SLACK_IDS.jatin;
}

export function getClickupIdFromSlack(slackId: string): string {
  const member = TEAM_MEMBERS.find(m => m.slackId === slackId);
  return member?.clickupId || CLICKUP_IDS.jatin.toString();
}

export function getNameFromClickup(clickupId: string | number): string {
  const member = TEAM_MEMBERS.find(m => m.clickupId === String(clickupId));
  return member?.name || 'Unknown';
}

interface ClickUpTaskItem {
  name: string;
  due_date?: string | null;
  [key: string]: unknown;
}

export function formatTaskList(tasks: ClickUpTaskItem[], category: 'overdue' | 'today' | 'upcoming' | 'completed' | 'open'): string {
  if (tasks.length === 0) return '';

  return tasks.map(t => {
    const name = t.name || 'Untitled';
    if (category === 'overdue' && t.due_date) {
      const days = Math.floor((Date.now() - Number(t.due_date)) / (1000 * 60 * 60 * 24));
      return `• ${name} — due ${days === 1 ? 'yesterday' : `${days} days ago`}`;
    }
    if (category === 'upcoming' && t.due_date) {
      const days = Math.ceil((Number(t.due_date) - Date.now()) / (1000 * 60 * 60 * 24));
      if (days <= 1) return `• ${name} — tomorrow`;
      return `• ${name} — in ${days} days`;
    }
    if (category === 'completed') return `✓ ${name}`;
    if (category === 'open' && t.due_date) {
      const dueMs = Number(t.due_date);
      if (dueMs < Date.now()) {
        const days = Math.floor((Date.now() - dueMs) / (1000 * 60 * 60 * 24));
        return `• ${name} — ${days} day${days === 1 ? '' : 's'} overdue ⚠️`;
      }
    }
    return `• ${name}`;
  }).join('\n');
}

export async function postToChannel(channel: string, text: string): Promise<void> {
  await sendSlackMessage(channel, text);
}

export function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
