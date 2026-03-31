import { sendSlackMessage } from './slackService';
import logger from '../utils/logger';
import { SLACK_SOD_EOD_CHANNEL, SLACK_JATIN } from '../config/constants';
import type { Analysis } from './intelligenceAnalyzer';
import type { AgencyDailyData } from './intelligenceDataCollector';

function scoreEmoji(score: number): string {
  if (score >= 90) return '🚀';
  if (score >= 75) return '✅';
  if (score >= 60) return '🟡';
  return '🔴';
}

function severityEmoji(severity: string): string {
  if (severity === 'high')   return '🔴';
  if (severity === 'medium') return '🟡';
  return '⚪';
}

function priorityEmoji(priority: string): string {
  if (priority === 'urgent') return '🔥';
  if (priority === 'high')   return '⚡';
  return '•';
}

export async function deliverDailyIntelligence(analysis: Analysis, data: AgencyDailyData): Promise<void> {
  const date = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const emoji = scoreEmoji(analysis.scores.overall);

  const winLines = analysis.wins.map(w => `• ${w}`).join('\n') || '• No wins recorded';

  const problemLines = analysis.problems.length > 0
    ? '\n⚠️ *Issues to Fix:*\n' + analysis.problems.map(p =>
        `${severityEmoji(p.severity)} *${p.issue}*\n   Impact: ${p.impact}\n   Fix: ${p.fix}`
      ).join('\n')
    : '';

  const actionLines = analysis.actions.map(a =>
    `${priorityEmoji(a.priority)} [${a.owner}] ${a.action}`
  ).join('\n') || '• No actions required';

  const anomalyLines = analysis.anomalies.length > 0
    ? '\n🔍 *Anomalies Detected:*\n' + analysis.anomalies.map(a => `• ${a}`).join('\n')
    : '';

  // SEO Workflow health section
  const wfData = data.seoWorkflows;
  let wfLines: string;
  if (wfData.allHealthy) {
    wfLines = '\n\n⚙️ *SEO Workflows:* 🟢 All systems running';
  } else {
    const n8nStatus = wfData.n8nAlive ? '🟢 Online' : '🔴 OFFLINE';
    const wfStatusLines = wfData.workflows.map(wf => {
      const dot = wf.healthy ? '🟢' : (wf.critical ? '🔴' : '🟡');
      const extra = !wf.healthy ? ` — ${wf.daysSince === 999 ? 'never run' : `${wf.daysSince}d overdue`}` : '';
      return `${dot} ${wf.name}${extra}`;
    }).join('\n');
    wfLines = `\n\n⚙️ *SEO Workflow Status:*\nn8n: ${n8nStatus}\n${wfStatusLines}`;
  }

  const message = `🧠 *GE Intelligence Report — ${date}*
Overall Score: *${analysis.scores.overall}/100* ${emoji}

💡 *${analysis.one_thing}*

━━━━━━━━━━━━━━━━
✅ *Today's Wins:*
${winLines}
${problemLines}

🎯 *Priority Actions:*
${actionLines}
${anomalyLines}${wfLines}

📊 *Scores:* Ads ${analysis.scores.ads}/100 | SEO ${analysis.scores.seo}/100 | Sales ${analysis.scores.sales}/100 | Ops ${analysis.scores.ops}/100

_Full report: crm.growthescalators.com/crm/intelligence_`;

  try {
    await sendSlackMessage(SLACK_SOD_EOD_CHANNEL, message);
    logger.info(`[intelligence] Slack report delivered. Score: ${analysis.scores.overall}`);
  } catch (e) {
    logger.error('[intelligence] Slack delivery failed:', e);
    // Try DM to Jatin as fallback
    try {
      await sendSlackMessage(`@${SLACK_JATIN}`, `🧠 Intelligence report ready (channel delivery failed). Score: ${analysis.scores.overall}/100. Check /crm/intelligence`);
    } catch { /* ignore */ }
    throw e;
  }
}
