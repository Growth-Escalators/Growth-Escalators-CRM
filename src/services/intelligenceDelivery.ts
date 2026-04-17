import { sendSlackMessage, sendSlackDM } from './slackService';
import logger from '../utils/logger';
import { SLACK_SOD_EOD_CHANNEL, SLACK_JATIN } from '../config/constants';
import type { Analysis } from './intelligenceAnalyzer';
import type { AgencyDailyData } from './intelligenceDataCollector';

const SLACK_IDS: Record<string, string> = {
  Jatin:   'U073Y677JBB',
  Sakcham: 'U09TY8RGN30',
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

  // System health section
  try {
    const { checkAllSystems } = await import('./systemHealthMonitor');
    const health = await checkAllSystems();
    const hEmo = health.overallScore >= 80 ? '🟢' : health.overallScore >= 50 ? '🟡' : '🔴';
    msg += `${hEmo} *System Health: ${health.overallScore}/100*\n`;
    const subsystems = [
      { name: 'Outreach', s: health.outreach },
      { name: 'SEO', s: health.seo },
      { name: 'CRM', s: health.crm },
      { name: 'Infra', s: health.infrastructure },
    ];
    for (const sub of subsystems) {
      const icon = sub.s.status === 'HEALTHY' ? '✅' : sub.s.status === 'WARNING' ? '⚠️' : '🔴';
      msg += `   ${icon} ${sub.name}: ${sub.s.status}\n`;
    }
    const failedCrons = health.cronJobs.filter(c => !c.healthy);
    if (failedCrons.length > 0) {
      msg += `   ⏰ ${failedCrons.length} cron job(s) overdue\n`;
    }
    msg += '\n';
  } catch { /* health check non-critical */ }

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
      const days = w.daysSince === 999 ? `not yet run (scheduled: ${w.schedule || 'TBD'})` : `${w.daysSince}d since last run`;
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

  // Creative intelligence section
  if (data.creativeIntel && data.creativeIntel.fatiguingCount > 0) {
    msg += `🎨 *Creative Alert:* ${data.creativeIntel.fatiguingCount} ad(s) fatiguing`;
    if (data.creativeIntel.bestType) {
      msg += ` | Best type: ${data.creativeIntel.bestType}`;
    }
    msg += '\n';
  }

  // Outreach velocity
  if (data.outreachVelocity && data.outreachVelocity.interestedPending > 0) {
    msg += `🚨 *Outreach:* ${data.outreachVelocity.interestedPending} INTERESTED lead(s) awaiting response!\n`;
  } else if (data.outreachVelocity && data.outreachVelocity.repliedToday > 0) {
    msg += `📧 *Outreach:* ${data.outreachVelocity.enrichedToday} enriched, ${data.outreachVelocity.repliedToday} replied today\n`;
  }

  // Content calendar
  if (data.contentCalendar && data.contentCalendar.overdue > 0) {
    msg += `📝 *Content:* ${data.contentCalendar.overdue} piece(s) overdue for publication\n`;
  }

  // Finance
  if (data.financeSnapshot && data.financeSnapshot.overdueInvoices > 0) {
    msg += `💰 *Finance:* ${data.financeSnapshot.overdueInvoices} invoice(s) overdue (₹${data.financeSnapshot.overdueAmount.toLocaleString('en-IN')})\n`;
  }

  // UTM attribution
  if (data.topSources && data.topSources.length > 0) {
    const topSource = data.topSources[0];
    msg += `📊 *Top source:* ${topSource.source} (${topSource.purchases} purchases this week)\n`;
  }

  // Scores summary
  msg += `📊 Ads:${analysis.scores.ads} SEO:${analysis.scores.seo} Sales:${analysis.scores.sales} Ops:${analysis.scores.ops}\n`;
  msg += `_Full coaching report + fix prompts: crm.growthescalators.com/crm/intelligence_`;

  // AI coaching report goes to Jatin DM only — not to #sod-eod channel
  try {
    await sendSlackDM(SLACK_JATIN, msg);
    logger.info(`[intelligence] Coaching report DM sent to Jatin. Score: ${analysis.scores.overall}`);
  } catch (e) {
    logger.error('[intelligence] Jatin DM failed:', e);
  }
}
