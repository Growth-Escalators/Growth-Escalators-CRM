/**
 * Outreach Alert Service
 *
 * Task 6: Reply speed alert — if Jatin hasn't responded to an INTERESTED
 * lead within 90 minutes, sends a reminder DM once.
 *
 * Task 7: Weekly outreach performance summary — Monday 8 AM IST.
 */

import { pool } from '../db/index';
import logger from '../utils/logger';
import { sendSlackDM } from './slackService';
import { SLACK_JATIN } from '../config/constants';

// ---------------------------------------------------------------------------
// Ensure required columns exist (idempotent)
// ---------------------------------------------------------------------------
export async function ensureOutreachAlertColumns(): Promise<void> {
  const stmts = [
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS reply_time TIMESTAMP`,
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS jatin_responded_at TIMESTAMP`,
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS reply_alerted_at TIMESTAMP`,
  ];
  for (const s of stmts) await pool.query(s).catch(() => {});
}

// ---------------------------------------------------------------------------
// Task 6: Check for INTERESTED leads unanswered >90 minutes
// Called by the enrichment cron (every 5 minutes)
// ---------------------------------------------------------------------------
export async function checkReplySpeedAlerts(): Promise<void> {
  // Find INTERESTED leads where:
  // - Jatin hasn't responded (jatin_responded_at IS NULL)
  // - Lead replied 90+ minutes ago (reply_time set)
  // - We haven't already sent an alert (reply_alerted_at IS NULL)
  const result = await pool.query(`
    SELECT id, company, reply_time
    FROM outreach_leads
    WHERE reply_category = 'INTERESTED'
      AND reply_time IS NOT NULL
      AND jatin_responded_at IS NULL
      AND reply_alerted_at IS NULL
      AND reply_time <= NOW() - INTERVAL '90 minutes'
  `);

  if (result.rows.length === 0) return;

  const leads = result.rows as Array<{ id: number; company: string; reply_time: Date }>;

  for (const lead of leads) {
    const minutesAgo = Math.round((Date.now() - new Date(lead.reply_time).getTime()) / 60000);
    const msg = `⚡ Reminder: ${lead.company} replied ${minutesAgo} min ago — still waiting for your response. Reply now before they go cold.`;

    try {
      await sendSlackDM(SLACK_JATIN, msg);
      await pool.query(
        `UPDATE outreach_leads SET reply_alerted_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [lead.id],
      );
      logger.info(`[reply-alert] Sent 90-min reminder for lead ${lead.id} (${lead.company})`);
    } catch (e) {
      logger.error(`[reply-alert] Failed to send reminder for lead ${lead.id}:`, e instanceof Error ? e.message : String(e));
    }
  }
}

// ---------------------------------------------------------------------------
// Task 7: Weekly outreach performance summary
// Run every Monday at 8 AM IST (2:30 UTC)
// ---------------------------------------------------------------------------
export async function sendWeeklyOutreachSummary(): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10);

    // Pipeline totals
    const statusResult = await pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM outreach_leads
      GROUP BY status
      ORDER BY count DESC
    `);
    const sc: Record<string, number> = {};
    for (const r of statusResult.rows as Array<{ status: string; count: number }>) sc[r.status] = r.count;
    const total = Object.values(sc).reduce((a, b) => a + b, 0);
    const activeInSequence = sc['Active'] ?? 0;

    // Replies this week
    const repliesThisWeek = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM outreach_leads
      WHERE status = 'Replied'
        AND updated_at >= $1
    `, [sevenDaysAgo]);
    const repliedCount = (repliesThisWeek.rows[0] as { count: number }).count;

    // Interested this week
    const interestedThisWeek = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM outreach_leads
      WHERE reply_category = 'INTERESTED'
        AND updated_at >= $1
    `, [sevenDaysAgo]);
    const interestedCount = (interestedThisWeek.rows[0] as { count: number }).count;

    // Leads added this week
    const leadsAddedThisWeek = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM outreach_leads
      WHERE created_at >= $1
    `, [sevenDaysAgo]);
    const newLeadsCount = (leadsAddedThisWeek.rows[0] as { count: number }).count;

    // Unanswered INTERESTED leads
    const unanswered = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM outreach_leads
      WHERE reply_category = 'INTERESTED'
        AND jatin_responded_at IS NULL
    `);
    const unansweredCount = (unanswered.rows[0] as { count: number }).count;

    // Uploaded to Saleshandy
    const uploaded = await pool.query(`
      SELECT COUNT(*)::int AS count FROM outreach_leads WHERE saleshandy_uploaded = true
    `);
    const uploadedCount = (uploaded.rows[0] as { count: number }).count;

    const msg = `📊 *Outreach Week in Review* (${sevenDaysAgo} → ${today})

*Pipeline:*
• Total leads: ${total}
• Active in sequence: ${activeInSequence}
• Uploaded to Saleshandy: ${uploadedCount}
• Replied this week: ${repliedCount}
• Interested this week: ${interestedCount}

*Email performance (last 7 days):*
• Emails sent: ${activeInSequence} (est — check Saleshandy for actual sent/open data)
• Est. open rate: check Saleshandy manually
• Bounces: check Saleshandy manually

*Leads added this week:* ${newLeadsCount} new leads from auto-discovery

*Action needed:*
${repliedCount > 0 ? `• ${repliedCount} lead(s) replied — did you respond to all of them?` : '• No new replies this week'}
${unansweredCount > 0 ? `• ${unansweredCount} lead(s) in "Interested" stage — follow up if no call booked` : '• All Interested leads have been responded to ✅'}`;

    await sendSlackDM(SLACK_JATIN, msg);
    logger.info('[weekly-outreach] Weekly summary sent to Jatin');
  } catch (e) {
    logger.error('[weekly-outreach] Failed to send weekly summary:', e instanceof Error ? e.message : String(e));
  }
}
