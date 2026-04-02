import { sendSlackMessage } from './slackService';
import logger from '../utils/logger';
import { SLACK_SOD_EOD_CHANNEL, SLACK_JATIN } from '../config/constants';
import type { Analysis } from './intelligenceAnalyzer';
import type { AgencyDailyData } from './intelligenceDataCollector';

const SLACK_IDS: Record<string, string> = {
  Jatin:   'U073Y677JBB',
  Sakcham: 'U09TY8RGN30',
  Vishal:  'U0ALC9Z09RA',
  Nimisha: 'U0ALMKD2XFB',
  Keshav:  'U073Y6S4K4H',
};

function slackId(name: string): string {
  return SLACK_IDS[name] ?? SLACK_IDS['Jatin'];
}

function scoreEmoji(s: number): string {
  if (s >= 80) return '🚀';
  if (s >= 60) return '🟡';
  return '🔴';
}

function severityDot(s: string): string {
  if (s === 'critical') return '🔴';
  if (s === 'high')     return '🟠';
  return '🟡';
}

export async function deliverDailyIntelligence(analysis: Analysis, data: AgencyDailyData): Promise<void> {
  const date = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const scoreEmo = scoreEmoji(analysis.scores.overall);

  let msg = `${scoreEmo} *GE Daily Coaching Report — ${date}*\n`;
  msg += `Overall: *${analysis.scores.overall}/100*\n\n`;

  // Focus today — most prominent
  msg += `🎯 *FOCUS TODAY:*\n${analysis.focus_today}\n\n`;

  // Issues first
  if (analysis.issues.length > 0) {
    msg += `⚡ *${analysis.issues.length} Things Need Action:*\n`;
    for (const issue of analysis.issues) {
      const sev = severityDot(issue.severity);
      msg += `${sev} *${issue.title}*\n`;
      msg += `   Owner: <@${slackId(issue.owner)}> | Due: ${issue.deadline}\n`;
      msg += `   Impact: ${issue.business_impact}\n`;
      if (issue.terminal_commands.length > 0) {
        msg += `   Quick fix: \`${issue.terminal_commands[0]}\`\n`;
      }
      if (issue.claude_prompt || issue.claude_code_prompt) {
        msg += `   📋 Fix prompt ready — /crm/intelligence\n`;
      }
      msg += '\n';
    }
  }

  // SEO workflow status
  const wf = data.seoWorkflows;
  if (wf && !wf.allHealthy) {
    msg += `⚙️ *SEO Workflows: ${wf.healthyCount}/${wf.totalCount} healthy*\n`;
    for (const w of wf.workflows.filter(x => !x.healthy)) {
      const days = w.daysSince === 999 ? 'never run' : `${w.daysSince}d overdue`;
      msg += `   ${w.critical ? '🔴' : '🟡'} ${w.name} — ${days}\n`;
    }
    msg += '\n';
  } else if (wf?.allHealthy) {
    msg += `⚙️ *SEO Workflows:* 🟢 All running\n\n`;
  }

  // System errors
  const sysErr = data.systemErrors ?? [];
  if (sysErr.length > 0) {
    msg += `🚨 *System Errors Detected:*\n`;
    for (const e of sysErr) {
      msg += `   • ${e.pattern} (${e.count}×)\n`;
    }
    msg += `   Fix prompts at /crm/intelligence\n\n`;
  }

  // Wins (brief, at end)
  if (analysis.wins.length > 0) {
    msg += `✅ *Wins:* ${analysis.wins.join(' | ')}\n\n`;
  }

  // Scores summary
  msg += `📊 Ads:${analysis.scores.ads} SEO:${analysis.scores.seo} Sales:${analysis.scores.sales} Ops:${analysis.scores.ops}\n`;
  msg += `_Full coaching report + fix prompts: crm.growthescalators.com/crm/intelligence_`;

  try {
    await sendSlackMessage(SLACK_SOD_EOD_CHANNEL, msg);
    logger.info(`[intelligence] Coaching report delivered. Score: ${analysis.scores.overall}`);
  } catch (e) {
    logger.error('[intelligence] Slack delivery failed:', e);
    try {
      await sendSlackMessage(SLACK_JATIN, `🧠 Coaching report ready (channel delivery failed). Score: ${analysis.scores.overall}/100. Check /crm/intelligence`);
    } catch { /* ignore */ }
    throw e;
  }
}
