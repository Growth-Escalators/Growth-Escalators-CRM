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
import { sendSODDigest, sendEODSummary, sendSakhamSOD } from './services/sodEodService';
import { placePipelineContact } from './services/pipelineService';
import { checkSpendAlerts } from './services/spendAlertService';
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
  // Sakcham's priority SOD — fires alongside the main digest, sends as DM
  try { await sendSakhamSOD(); console.log('[CRON] Sakcham SOD sent'); }
  catch (e) { console.error('[CRON] Sakcham SOD failed:', e); }
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

// SEO Workflow health check — daily 9:15 AM IST (3:45 UTC)
cron.schedule('45 3 * * *', async () => {
  console.log('[CRON] Checking SEO workflow health...');
  try {
    const { sendSlackMessage } = await import('./services/slackService');
    const health = await (await import('./services/intelligenceDataCollector')).collectSEOWorkflowHealth();

    // If n8n is down — immediate DM to Jatin
    if (!health.n8nAlive) {
      await sendSlackMessage(SLACK_JATIN,
        '🚨 *CRITICAL: n8n is DOWN*\n' +
        'All 12 SEO workflows are not running.\n' +
        'Check: https://primary-production-6c6f5.up.railway.app\n' +
        'Railway dashboard → GE-Backend-Server → Primary service'
      );
    }

    // If any critical workflow broken — DM Jatin
    if (health.brokenCritical.length > 0) {
      const msg = health.brokenCritical.map(wf =>
        `• ${wf.name} — last ran ${wf.daysSince === 999 ? 'NEVER' : `${wf.daysSince} days ago`}`
      ).join('\n');
      await sendSlackMessage(SLACK_JATIN,
        `⚠️ *SEO Workflow Alert*\n\n${health.brokenCritical.length} critical workflow(s) overdue:\n${msg}\n\n` +
        `Fix: /crm/seo → Workflows → Run Now\n` +
        `Or check n8n directly: https://primary-production-6c6f5.up.railway.app`
      );
    }

    // Post summary to #performance-marketing if any issues
    if (!health.allHealthy) {
      const overdueLines = health.workflows
        .filter(w => !w.healthy)
        .map(w => `${w.critical ? '🔴' : '🟡'} ${w.name} — ${w.daysSince === 999 ? 'never run' : `${w.daysSince}d overdue`}`)
        .join('\n');
      await sendSlackMessage(SLACK_PERF_MARKETING_CHANNEL,
        `⚙️ *SEO Workflow Health Check*\n` +
        `Healthy: ${health.healthyCount}/${health.totalCount}\n` +
        `n8n: ${health.n8nAlive ? '🟢 Online' : '🔴 Offline'}\n\n${overdueLines}`
      );
    }

    console.log(`[CRON] SEO health: ${health.healthyCount}/${health.totalCount} healthy`);
  } catch (e) {
    console.error('[CRON] SEO health check failed:', e);
  }
}, { timezone: 'UTC' });
console.log('[cron] SEO workflow health check scheduled — daily 9:15 AM IST');

// ---------------------------------------------------------------------------
// Growth OS — Brand Health Score — Daily 8:00 AM IST (2:30 UTC)
// ---------------------------------------------------------------------------
cron.schedule('30 2 * * *', async () => {
  console.log('[CRON] Running Growth OS health scores...');
  try {
    const { getActiveGrowthOSClients } = await import('./services/growthOSSetup');
    const { calculateBrandHealth, sendHealthScoreWhatsApp } = await import('./services/brandHealthService');
    const clients = await getActiveGrowthOSClients();
    for (const client of clients) {
      const score = await calculateBrandHealth(client);
      if (client.founder_whatsapp) await sendHealthScoreWhatsApp(score, client.founder_whatsapp);
      await new Promise(r => setTimeout(r, 3000));
    }
    console.log('[CRON] Growth OS health scores done');
  } catch (e) {
    console.error('[CRON] Growth OS health scores failed:', e);
  }
}, { timezone: 'UTC' });
console.log('[cron] Growth OS health scores scheduled — daily 8:00 AM IST');

// Growth OS — Money on Table — Every Monday 8:30 AM IST (3:00 UTC)
cron.schedule('0 3 * * 1', async () => {
  console.log('[CRON] Running money on table...');
  try {
    const { getActiveGrowthOSClients } = await import('./services/growthOSSetup');
    const { calculateMoneyOnTable } = await import('./services/opportunityService');
    const clients = await getActiveGrowthOSClients();
    for (const client of clients) {
      await calculateMoneyOnTable(client);
      await new Promise(r => setTimeout(r, 3000));
    }
    console.log('[CRON] Money on table done');
  } catch (e) {
    console.error('[CRON] Money on table failed:', e);
  }
}, { timezone: 'UTC' });
console.log('[cron] Money on table scheduled — Mondays 8:30 AM IST');

// Growth OS — Creative Intelligence — Every 6 hours
cron.schedule('0 */6 * * *', async () => {
  console.log('[CRON] Running creative intelligence...');
  try {
    const { getActiveGrowthOSClients } = await import('./services/growthOSSetup');
    const { trackCreativePerformance } = await import('./services/creativeIntelligenceService');
    const clients = await getActiveGrowthOSClients();
    for (const client of clients) {
      await trackCreativePerformance(client.ad_account_id);
      await new Promise(r => setTimeout(r, 5000));
    }
    console.log('[CRON] Creative intelligence done');
  } catch (e) {
    console.error('[CRON] Creative intelligence failed:', e);
  }
}, { timezone: 'UTC' });
console.log('[cron] Creative intelligence scheduled — every 6 hours');

// Growth OS — Competitor Pulse — Every Friday 9:00 AM IST (3:30 UTC)
cron.schedule('30 3 * * 5', async () => {
  console.log('[CRON] Running competitor pulse...');
  try {
    const { getActiveGrowthOSClients } = await import('./services/growthOSSetup');
    const { runCompetitorPulse } = await import('./services/competitorService');
    const clients = await getActiveGrowthOSClients();
    for (const client of clients) {
      await runCompetitorPulse(client);
      await new Promise(r => setTimeout(r, 5000));
    }
    console.log('[CRON] Competitor pulse done');
  } catch (e) {
    console.error('[CRON] Competitor pulse failed:', e);
  }
}, { timezone: 'UTC' });
console.log('[cron] Competitor pulse scheduled — Fridays 9:00 AM IST');

// Growth OS — Co-Pilot: poll unprocessed inbound messages from Growth OS founders — every 2 minutes
cron.schedule('*/2 * * * *', async () => {
  try {
    const { pool: dbPool } = await import('./db/index');
    const { isCopilotMessage, handleCopilotMessage } = await import('./services/copilotService');

    // Find messages from Growth OS founder phones in last 5 minutes not yet replied to
    const founderPhones = await dbPool.query(
      `SELECT DISTINCT replace(founder_whatsapp, '+', '') AS phone FROM growth_os_clients WHERE is_active = true AND founder_whatsapp IS NOT NULL`
    ).catch(() => ({ rows: [] }));

    if ((founderPhones.rows as unknown[]).length === 0) return;

    const phones = (founderPhones.rows as Array<{ phone: string }>).map(r => r.phone);

    // Check each phone for recent unhandled inbound messages
    for (const phone of phones) {
      const msgs = await dbPool.query(
        `SELECT m.id, m.content, cc.channel_value AS phone
         FROM messages m
         JOIN contact_channels cc ON cc.contact_id = m.contact_id AND cc.channel_type = 'whatsapp'
         WHERE m.direction = 'inbound'
           AND m.channel = 'whatsapp'
           AND replace(cc.channel_value, '+', '') = $1
           AND m.created_at >= NOW() - INTERVAL '3 minutes'
           AND NOT EXISTS (
             SELECT 1 FROM copilot_conversations cp
             WHERE cp.wa_phone = $1
               AND cp.created_at >= m.created_at
           )
         ORDER BY m.created_at ASC LIMIT 5`,
        [phone]
      ).catch(() => ({ rows: [] }));

      for (const msg of msgs.rows as Array<{ id: string; content: string; phone: string }>) {
        if (isCopilotMessage(msg.content)) {
          await handleCopilotMessage(phone, msg.content).catch(e =>
            console.error('[CRON] Co-pilot message handling failed:', e)
          );
        }
      }
    }
  } catch { /* non-critical */ }
}, { timezone: 'UTC' });
console.log('[cron] Co-pilot message poller scheduled — every 2 minutes');

// ---------------------------------------------------------------------------
// Pipeline placement job — every 5 minutes
// Picks up slo_purchase events whose contacts haven't been placed in a pipeline yet.
// Hooks into the payment flow without touching cashfree.ts or webhooks.ts.
// ---------------------------------------------------------------------------
cron.schedule('*/5 * * * *', async () => {
  try {
    const { rows } = await pool.query(`
      SELECT e.id, e.contact_id, e.payload, e.tenant_id
      FROM events e
      WHERE e.event_type = 'slo_purchase'
        AND e.contact_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM pipeline_contacts pc
          WHERE pc.contact_id = e.contact_id
        )
      ORDER BY e.created_at ASC
      LIMIT 20
    `);

    if (rows.length === 0) return;

    console.log(`[CRON] Pipeline placement: processing ${rows.length} unplaced contact(s)`);
    for (const row of rows as Array<{ id: string; contact_id: string; payload: Record<string, unknown>; tenant_id: string }>) {
      const { contact_id, payload, tenant_id } = row;
      const segment = (payload.segment as string) || 'd2c';
      const amount  = typeof payload.amount === 'number' ? payload.amount : 9;
      const bump1   = Boolean(payload.bump1);
      const bump2   = Boolean(payload.bump2);
      try {
        await placePipelineContact({ contactId: contact_id, segment, amount, bump1, bump2, tenantId: tenant_id });
      } catch (e) {
        console.error('[CRON] Pipeline placement failed for contact', contact_id, ':', e);
      }
    }
  } catch (e) {
    // pipeline_contacts table may not exist yet on first deploy — non-fatal
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('pipeline_contacts')) {
      console.error('[CRON] Pipeline placement job failed:', e);
    }
  }
}, { timezone: 'UTC' });
console.log('[cron] Pipeline placement job scheduled — every 5 minutes');

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
