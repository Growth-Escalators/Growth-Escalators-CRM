import { sendSlackMessage } from '../services/slackService';
import {
  SLACK_JATIN, SLACK_SAKCHAM, SLACK_NIMISHA, SLACK_KESHAV,
  CLICKUP_JATIN, CLICKUP_SAKCHAM, CLICKUP_NIMISHA, CLICKUP_KESHAV,
  SLACK_SOD_EOD_CHANNEL, SLACK_GENERAL_CHANNEL, SLACK_SALES_BD_CHANNEL, SLACK_PERF_MARKETING_CHANNEL,
} from '../config/constants';

export interface TeamMember {
  name: string;
  clickupId: string;
  slackId: string;
  email: string;
}

export const TEAM_MEMBERS: TeamMember[] = [
  { name: 'Jatin', clickupId: String(CLICKUP_JATIN), slackId: SLACK_JATIN, email: 'jatin@growthescalators.com' },
  { name: 'Sakcham', clickupId: String(CLICKUP_SAKCHAM), slackId: SLACK_SAKCHAM, email: 'sakcham@growthescalators.com' },
  { name: 'Nimisha', clickupId: String(CLICKUP_NIMISHA), slackId: SLACK_NIMISHA, email: 'nimisha.daiya@growthescalators.com' },
  { name: 'Keshav', clickupId: String(CLICKUP_KESHAV), slackId: SLACK_KESHAV, email: 'keshav.growthescalators@gmail.com' },
];

export const CLICKUP_IDS = {
  jatin: CLICKUP_JATIN,
  sakcham: CLICKUP_SAKCHAM,
  nimisha: CLICKUP_NIMISHA,
  keshav: CLICKUP_KESHAV,
};

export const SLACK_IDS = {
  jatin: SLACK_JATIN,
  sakcham: SLACK_SAKCHAM,
  nimisha: SLACK_NIMISHA,
  keshav: SLACK_KESHAV,
};

export const SLACK_CHANNELS = {
  sodEod: SLACK_SOD_EOD_CHANNEL,
  general: SLACK_GENERAL_CHANNEL,
  salesBd: SLACK_SALES_BD_CHANNEL,
  performanceMarketing: SLACK_PERF_MARKETING_CHANNEL,
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
      const days = Math.floor((Date.now() - Number(t.due_date)) / 86400000);
      return `• ${name} — due ${days === 1 ? 'yesterday' : `${days} days ago`}`;
    }
    if (category === 'upcoming' && t.due_date) {
      const days = Math.ceil((Number(t.due_date) - Date.now()) / 86400000);
      return days <= 1 ? `• ${name} — tomorrow` : `• ${name} — in ${days} days`;
    }
    if (category === 'completed') return `✓ ${name}`;
    if (category === 'open' && t.due_date && Number(t.due_date) < Date.now()) {
      const days = Math.floor((Date.now() - Number(t.due_date)) / 86400000);
      return `• ${name} — ${days} day${days === 1 ? '' : 's'} overdue ⚠️`;
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
