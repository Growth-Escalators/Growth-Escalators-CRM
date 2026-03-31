import dotenv from 'dotenv';
dotenv.config();

import cron from 'node-cron';
import { db, pool } from './db/index';
import { sql } from 'drizzle-orm';
import { startStuckJobWorker } from './workers/stuckJobWorker';
import { startSequenceWorker } from './workers/sequenceWorker';
import { startSocialPostWorker } from './workers/socialPostWorker';
import { checkAndAlertBlockers } from './services/blockerAlertService';
import { generateMonthlyDraftInvoices } from './services/recurringInvoiceService';
import { sendSODDigest, sendEODSummary } from './services/sodEodService';
import { checkSpendAlerts } from './services/spendAlertService';
import { checkWorkflowHealth } from './services/seoWorkflowHealthService';
import { collectDailyData } from './services/intelligenceDataCollector';
import { analyzeWithClaude } from './services/intelligenceAnalyzer';
import { deliverDailyIntelligence } from './services/intelligenceDelivery';
import { SLACK_SALES_BD_CHANNEL, SLACK_JATIN, SLACK_SAKCHAM, SLACK_PERF_MARKETING_CHANNEL, DEFAULT_TENANT_SLUG } from './config/constants';

console.log('[worker] Worker process started');

// ---------------------------------------------------------------------------
// Background workers
// ---------------------------------------------------------------------------
startStuckJobWorker();
startSequenceWorker();
startSocialPostWorker();

// ---------------------------------------------------------------------------
// Cron jobs
// ---------------------------------------------------------------------------

// Blocker alerts — 10:15 AM IST (04:45 UTC) + 5:00 PM IST (11:30 UTC), Mon-Sat
cron.schedule('45 4 * * 1-6', async () => {
  console.log('[CRON] Running blocker alerts (morning)...');
  try { await checkAndAlertBlockers(); } catch (e) { console.error('[CRON] Blocker alerts failed:', e); }
}, { timezone: 'UTC' });
cron.schedule('30 11 * * 1-6', async () => {
  console.log('[CRON] Running blocker alerts (evening)...');
  try { await checkAndAlertBlockers(); } catch (e) { console.error('[CRON] Blocker alerts failed:', e); }
}, { timezone: 'UTC' });
console.log('[cron] blocker alerts scheduled — 10:15 AM + 5:00 PM IST Mon-Sat');

// SOD Digest — 10 AM IST (04:30 UTC), Mon-Sat
cron.schedule('30 4 * * 1-6', async () => {
  console.log('[CRON] Running SOD digest...');
  try { await sendSODDigest(); console.log('[CRON] SOD digest sent'); }
  catch (e) { console.error('[CRON] SOD digest failed:', e); }
}, { timezone: 'UTC' });
console.log('[cron] SOD digest scheduled — 10:00 AM IST Mon-Sat');

// EOD Summary — 7 PM IST (13:30 UTC), Mon-Sat
cron.schedule('30 13 * * 1-6', async () => {
  console.log('[CRON] Running EOD summary...');
  try { await sendEODSummary(); console.log('[CRON] EOD summary sent'); }
  catch (e) { console.error('[CRON] EOD summary failed:', e); }
}, { timezone: 'UTC' });
console.log('[cron] EOD summary scheduled — 7:00 PM IST Mon-Sat');

// Spend alert check — every hour
cron.schedule('0 * * * *', async () => {
  console.log('[cron] checking ad account balances…');
  try { await checkSpendAlerts(); }
  catch (e) { console.error('[cron] spend alert check failed:', e); }
}, { timezone: 'UTC' });
console.log('[cron] spend alert check scheduled — hourly');

// Generate monthly draft invoices on the 1st of every month at 9 AM IST (3:30 AM UTC)
cron.schedule('30 3 1 * *', async () => {
  console.log('[cron] generating monthly draft invoices…');
  try {
    const tenantResult = await db.execute(sql`SELECT id FROM tenants WHERE slug = '${DEFAULT_TENANT_SLUG}' LIMIT 1`);
    const tenantId = (tenantResult.rows[0] as { id: string } | undefined)?.id;
    if (!tenantId) return;

    const result = await generateMonthlyDraftInvoices(tenantId);
    console.log(`[cron] monthly invoices: generated=${result.generated}, errors=${result.errors.length}`);

    if (result.generated > 0) {
      const { sendSlackMessage } = await import('./services/slackService');
      const month = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      await sendSlackMessage(SLACK_SALES_BD_CHANNEL,
        `🧾 *Invoice Drafts Ready — ${month}*\n\nDrafts generated for all active billing clients.\nReview and approve at: /crm/billing\n\n<@${SLACK_JATIN}> <@${SLACK_SAKCHAM}> — please review before sending to clients.`);
    }
  } catch (e) {
    console.error('[cron] monthly invoice generation failed:', e);
  }
}, { timezone: 'UTC' });
console.log('[cron] monthly invoice drafts scheduled — 1st of month at 9 AM IST');

// Overdue invoice detection — daily at 10 AM IST (4:30 AM UTC)
cron.schedule('30 4 * * *', async () => {
  console.log('[cron] checking overdue invoices…');
  try {
    const overdueResult = await db.execute(sql`
      SELECT i.id, i.invoice_number, i.total_amount, i.due_date,
             bc.name as client_name
      FROM invoices i
      JOIN billing_clients bc ON bc.id = i.client_id
      WHERE i.status = 'sent'
        AND i.due_date < now()
        AND i.tenant_id = (SELECT id FROM tenants WHERE slug = '${DEFAULT_TENANT_SLUG}')
    `);

    for (const inv of overdueResult.rows as Array<Record<string, unknown>>) {
      await db.execute(sql`UPDATE invoices SET status = 'overdue', updated_at = now() WHERE id = ${inv.id}`);
      try {
        const { sendSlackMessage } = await import('./services/slackService');
        const amount = ((inv.total_amount as number) / 100).toLocaleString('en-IN');
        const dueDate = new Date(inv.due_date as string).toLocaleDateString('en-IN');
        const daysOverdue = Math.floor((Date.now() - new Date(inv.due_date as string).getTime()) / 86400000);
        await sendSlackMessage(SLACK_SALES_BD_CHANNEL,
          `⚠️ *Overdue Invoice Alert*\n\n*Client:* ${inv.client_name}\n*Invoice:* ${inv.invoice_number}\n*Amount:* ₹${amount}\n*Due Date:* ${dueDate}\n*Overdue by:* ${daysOverdue} days\n\n<@${SLACK_JATIN}> <@${SLACK_SAKCHAM}> — please follow up with the client.`);
      } catch { /* slack error non-critical */ }
    }
    if ((overdueResult.rows as unknown[]).length > 0) {
      console.log(`[cron] marked ${(overdueResult.rows as unknown[]).length} invoice(s) as overdue`);
    }
  } catch (e) {
    console.error('[cron] overdue check failed:', e);
  }
}, { timezone: 'UTC' });
console.log('[cron] overdue invoice check scheduled — daily at 10 AM IST');

// Daily AI Intelligence Report — 8:30 AM IST (3:00 UTC)
cron.schedule('0 3 * * *', async () => {
  console.log('[CRON] Running daily intelligence report...');
  try {
    const data = await collectDailyData();
    const analysis = await analyzeWithClaude(data);
    await deliverDailyIntelligence(analysis, data);
    console.log('[CRON] Intelligence report delivered. Score:', analysis.scores.overall);
  } catch (e) {
    console.error('[CRON] Intelligence report failed:', e);
    const msg = e instanceof Error ? e.message : String(e);
    try {
      const { sendSlackMessage } = await import('./services/slackService');
      await sendSlackMessage(`@${SLACK_JATIN}`,
        `⚠️ *Daily Intelligence Report Failed*\nError: ${msg}\nCheck worker logs for details.`);
    } catch { /* ignore */ }
  }
}, { timezone: 'UTC' });
console.log('[cron] AI intelligence report scheduled — daily 8:30 AM IST');

// SEO workflow health check — daily 9 AM IST (3:30 UTC)
cron.schedule('30 3 * * *', async () => {
  console.log('[cron] checking SEO workflow health…');
  try {
    const { sendSlackMessage } = await import('./services/slackService');
    const { workflows } = await checkWorkflowHealth();

    const broken = workflows.filter(w => w.critical && w.status === 'error');
    const warned = workflows.filter(w => w.critical && w.status === 'warning');

    if (broken.length === 0 && warned.length === 0) {
      console.log('[cron] SEO workflow health: all critical workflows OK');
      return;
    }

    // DM Jatin for each broken critical workflow
    for (const wf of broken) {
      const lastRunStr = wf.lastRun
        ? new Date(wf.lastRun).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'Never';
      await sendSlackMessage(`@${SLACK_JATIN}`,
        `🔴 *SEO Workflow Alert — ${wf.name}*\nStatus: Overdue / Not running\nLast run: ${lastRunStr}\nExpected schedule: ${wf.schedule}\n\nTrigger manually: click Run Now in CRM → SEO → Workflows\nOr check n8n: https://primary-production-6c6f5.up.railway.app`
      );
    }

    // Also post summary to #performance-marketing if any critical issues
    const allIssues = [...broken, ...warned];
    const lines = allIssues.map(wf => {
      const icon = wf.status === 'error' ? '🔴' : '🟡';
      const lastRunStr = wf.lastRun
        ? new Date(wf.lastRun).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
        : 'Never';
      return `${icon} *${wf.name}* — Last run: ${lastRunStr}`;
    }).join('\n');

    await sendSlackMessage(SLACK_PERF_MARKETING_CHANNEL,
      `🔴 *SEO Workflow Issue Detected*\n\n${lines}\n\nFix: Go to /crm/seo → Workflows → Run Now`
    );

    console.log(`[cron] SEO health alerts sent — ${broken.length} broken, ${warned.length} warning`);
  } catch (e) {
    console.error('[cron] SEO workflow health check failed:', e);
  }
}, { timezone: 'UTC' });
console.log('[cron] SEO workflow health check scheduled — daily 9 AM IST');

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
const shutdown = async (signal: string) => {
  console.log(`[worker-shutdown] ${signal} received — stopping workers…`);
  try {
    await pool.end();
    console.log('[worker-shutdown] database pool closed');
  } catch (e) {
    console.error('[worker-shutdown] error closing database pool:', e);
  }
  console.log('[worker-shutdown] graceful shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
