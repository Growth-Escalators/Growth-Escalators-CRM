import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
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
import { SLACK_SALES_BD_CHANNEL, SLACK_JATIN, SLACK_SAKCHAM, SLACK_PERF_MARKETING_CHANNEL, SLACK_SEO_CHANNEL, DEFAULT_TENANT_SLUG } from './config/constants';

console.log('[worker] Worker process started');

// ---------------------------------------------------------------------------
// Background workers
// ---------------------------------------------------------------------------
startStuckJobWorker();
startSequenceWorker();
startSocialPostWorker();

// ---------------------------------------------------------------------------
// safeCron — wraps cron handlers with error catch + Slack DM alert to Jatin
// ---------------------------------------------------------------------------
async function safeCron(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[CRON FAIL] ${name}:`, error);
    try {
      const { sendSlackDM } = await import('./services/slackService');
      const ts = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      await sendSlackDM(SLACK_JATIN,
        `🚨 *CRON FAILED: ${name}*\n\nError: ${msg.slice(0, 300)}\nTime: ${ts}\n\nCheck worker logs for details.`
      );
    } catch { /* Slack send failed — already logged to console */ }
  }
}

// ---------------------------------------------------------------------------
// Cron jobs
// ---------------------------------------------------------------------------

// Blocker alerts — 10:15 AM IST (04:45 UTC) + 5:00 PM IST (11:30 UTC), Mon-Sat
cron.schedule('45 4 * * 1-6', () => safeCron('Blocker Alerts (morning)', checkAndAlertBlockers), { timezone: 'UTC' });
cron.schedule('30 11 * * 1-6', () => safeCron('Blocker Alerts (evening)', checkAndAlertBlockers), { timezone: 'UTC' });
console.log('[cron] blocker alerts scheduled — 10:15 AM + 5:00 PM IST Mon-Sat');

// SOD Digest — 10 AM IST (04:30 UTC), Mon-Sat
cron.schedule('30 4 * * 1-6', async () => {
  await safeCron('SOD Digest', sendSODDigest);
  await safeCron('Sakcham Priority SOD', sendSakhamSOD);
}, { timezone: 'UTC' });
console.log('[cron] SOD digest scheduled — 10:00 AM IST Mon-Sat');

// EOD Summary — 7 PM IST (13:30 UTC), Mon-Sat
cron.schedule('30 13 * * 1-6', () => safeCron('EOD Summary', sendEODSummary), { timezone: 'UTC' });
console.log('[cron] EOD summary scheduled — 7:00 PM IST Mon-Sat');

// Spend alert check — every hour
cron.schedule('0 * * * *', () => safeCron('Spend Alert Check', checkSpendAlerts), { timezone: 'UTC' });
console.log('[cron] spend alert check scheduled — hourly');

// Generate monthly draft invoices on the 1st of every month at 9 AM IST (3:30 AM UTC)
cron.schedule('30 3 1 * *', () => safeCron('Monthly Invoice Drafts', async () => {
  const tenantResult = await db.execute(sql`SELECT id FROM tenants WHERE slug = ${DEFAULT_TENANT_SLUG} LIMIT 1`);
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
}), { timezone: 'UTC' });
console.log('[cron] monthly invoice drafts scheduled — 1st of month at 9 AM IST');

// Overdue invoice detection — daily at 10 AM IST (4:30 AM UTC)
cron.schedule('30 4 * * *', () => safeCron('Overdue Invoice Check', async () => {
  const overdueResult = await db.execute(sql`
    SELECT i.id, i.invoice_number, i.total_amount, i.due_date,
           bc.name as client_name
    FROM invoices i
    JOIN billing_clients bc ON bc.id = i.client_id
    WHERE i.status = 'sent'
      AND i.due_date < now()
      AND i.tenant_id = (SELECT id FROM tenants WHERE slug = ${DEFAULT_TENANT_SLUG})
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
}), { timezone: 'UTC' });
console.log('[cron] overdue invoice check scheduled — daily at 10 AM IST');

// Daily AI Intelligence Report — 8:30 AM IST (3:00 UTC)
cron.schedule('0 3 * * *', () => safeCron('Daily Intelligence Report', async () => {
  const data = await collectDailyData();
  const analysis = await analyzeWithClaude(data);
  await deliverDailyIntelligence(analysis, data);
  console.log('[CRON] Intelligence report delivered. Score:', analysis.scores.overall);
}), { timezone: 'UTC' });
console.log('[cron] AI intelligence report scheduled — daily 8:30 AM IST');

// SEO Workflow health check — daily 9:15 AM IST (3:45 UTC)
cron.schedule('45 3 * * *', () => safeCron('SEO Workflow Health', async () => {
  const { sendSlackMessage } = await import('./services/slackService');
  const health = await (await import('./services/intelligenceDataCollector')).collectSEOWorkflowHealth();

  if (!health.n8nAlive) {
    const downMsg = '🚨 *CRITICAL: n8n is DOWN*\n' +
      'All 12 SEO workflows are not running.\n' +
      'Check: https://primary-production-6c6f5.up.railway.app\n' +
      'Railway dashboard → GE-Backend-Server → Primary service';
    await sendSlackMessage(SLACK_SEO_CHANNEL, downMsg);
    await sendSlackMessage(SLACK_JATIN, downMsg);
  }

  if (health.brokenCritical.length > 0) {
    const msg = health.brokenCritical.map(wf =>
      `• ${wf.name} — last ran ${wf.daysSince === 999 ? 'NEVER' : `${wf.daysSince} days ago`}`
    ).join('\n');
    const alertMsg = `⚠️ *SEO Workflow Alert*\n\n${health.brokenCritical.length} critical workflow(s) overdue:\n${msg}\n\n` +
      `Fix: /crm/seo → Workflows → Run Now\n` +
      `Or check n8n directly: https://primary-production-6c6f5.up.railway.app`;
    await sendSlackMessage(SLACK_SEO_CHANNEL, alertMsg);
    await sendSlackMessage(SLACK_JATIN, alertMsg);
  }

  if (!health.allHealthy) {
    const overdueLines = health.workflows
      .filter(w => !w.healthy)
      .map(w => `${w.critical ? '🔴' : '🟡'} ${w.name} — ${w.daysSince === 999 ? 'never run' : `${w.daysSince}d overdue`}`)
      .join('\n');
    await sendSlackMessage(SLACK_SEO_CHANNEL,
      `⚙️ *SEO Workflow Health Check*\n` +
      `Healthy: ${health.healthyCount}/${health.totalCount}\n` +
      `n8n: ${health.n8nAlive ? '🟢 Online' : '🔴 Offline'}\n\n${overdueLines}`
    );
  }

  console.log(`[CRON] SEO health: ${health.healthyCount}/${health.totalCount} healthy`);
}), { timezone: 'UTC' });
console.log('[cron] SEO workflow health check scheduled — daily 9:15 AM IST');

// ---------------------------------------------------------------------------
// Growth OS — Brand Health Score — Daily 8:00 AM IST (2:30 UTC)
// ---------------------------------------------------------------------------
cron.schedule('30 2 * * *', () => safeCron('Growth OS Health Scores', async () => {
  const { getActiveGrowthOSClients } = await import('./services/growthOSSetup');
  const { calculateBrandHealth, sendHealthScoreWhatsApp } = await import('./services/brandHealthService');
  const clients = await getActiveGrowthOSClients();
  for (const client of clients) {
    const score = await calculateBrandHealth(client);
    if (client.founder_whatsapp) await sendHealthScoreWhatsApp(score, client.founder_whatsapp);
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log('[CRON] Growth OS health scores done');
}), { timezone: 'UTC' });
console.log('[cron] Growth OS health scores scheduled — daily 8:00 AM IST');

// ---------------------------------------------------------------------------
// Growth OS — Daily ROAS Report to #performance-marketing — 8:15 AM IST (2:45 UTC)
// ---------------------------------------------------------------------------
cron.schedule('45 2 * * *', () => safeCron('Daily ROAS Report', async () => {
  const { sendSlackMessage } = await import('./services/slackService');
  const { getActiveGrowthOSClients } = await import('./services/growthOSSetup');
  const clients = await getActiveGrowthOSClients();

  if (clients.length === 0) { console.log('[CRON] ROAS report: no active clients'); return; }

    const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    let msg = `📊 *Daily ROAS Report — ${dateStr}*\n\n`;

    const token = process.env.META_ADS_TOKEN;

    for (const client of clients) {
      try {
        let roas = 0, totalSpend = 0, bestCampaign = '', bestRoas = 0, activeCampaigns = 0, biggestIssue = '';

        if (token) {
          const url = `https://graph.facebook.com/v19.0/${client.ad_account_id}/campaigns?fields=name,status,insights.date_preset(last_7d){spend,actions,impressions,clicks}&access_token=${token}&limit=20`;
          const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
          if (res.ok) {
            const data = await res.json() as { data?: Array<Record<string, unknown>> };
            const campaigns = (data.data ?? []).filter((c: Record<string, unknown>) => c.status === 'ACTIVE');
            activeCampaigns = campaigns.length;

            let totalPurchaseValue = 0;
            for (const camp of campaigns) {
              const ins = camp.insights as Record<string, unknown> | undefined;
              const rows = (ins?.data as Array<Record<string, unknown>> | undefined) ?? [];
              let campSpend = 0, campPurchaseValue = 0;
              for (const row of rows) {
                campSpend += parseFloat(String(row.spend ?? 0));
                totalSpend += parseFloat(String(row.spend ?? 0));
                const actions = (row.actions as Array<{ action_type: string; value: string }> | undefined) ?? [];
                for (const a of actions) {
                  if (a.action_type === 'purchase' || a.action_type === 'omni_purchase') {
                    campPurchaseValue += parseFloat(a.value ?? '0');
                    totalPurchaseValue += parseFloat(a.value ?? '0');
                  }
                }
              }
              const campRoas = campSpend > 0 ? campPurchaseValue / campSpend : 0;
              if (campRoas > bestRoas) {
                bestRoas = campRoas;
                bestCampaign = camp.name as string;
              }
            }
            roas = totalSpend > 0 ? totalPurchaseValue / totalSpend : 0;

            if (activeCampaigns === 0) biggestIssue = 'No active campaigns running';
            else if (roas < client.target_roas * 0.6) biggestIssue = `ROAS critically low at ${roas.toFixed(2)}x`;
            else if (totalSpend === 0) biggestIssue = 'Zero spend this period';
          } else {
            biggestIssue = `Meta API error (${res.status})`;
          }
        } else {
          biggestIssue = 'META_ADS_TOKEN not configured';
        }

        const target = client.target_roas;
        let statusEmoji: string;
        if (roas >= target) statusEmoji = '✅ Above target';
        else if (roas >= target * 0.8) statusEmoji = '⚠️ At target';
        else statusEmoji = '🔴 Below target';

        msg += `*${client.client_name}*\n`;
        msg += `   ROAS: *${roas.toFixed(2)}x* (target: ${target}x) — ${statusEmoji}\n`;
        if (totalSpend > 0) msg += `   Spend (7d): ₹${Math.round(totalSpend).toLocaleString('en-IN')} · ${activeCampaigns} active campaign${activeCampaigns !== 1 ? 's' : ''}\n`;
        if (bestCampaign && bestRoas > 0) msg += `   💡 Best: "${bestCampaign}" at ${bestRoas.toFixed(2)}x ROAS\n`;
        if (biggestIssue) msg += `   ⚠️ ${biggestIssue}\n`;
        msg += '\n';
      } catch (e) {
        msg += `*${client.client_name}*\n   ❌ Data fetch failed: ${e instanceof Error ? e.message : String(e)}\n\n`;
      }
    }

    msg += `_Scores refresh daily at 8 AM · Full dashboard: crm.growthescalators.com/crm/growth-os_`;

  await sendSlackMessage(SLACK_PERF_MARKETING_CHANNEL, msg);
  console.log('[CRON] Daily ROAS report sent to #performance-marketing');
}), { timezone: 'UTC' });
console.log('[cron] Daily ROAS report scheduled — 8:15 AM IST');

// Growth OS — Money on Table — Every Monday 8:30 AM IST (3:00 UTC)
cron.schedule('0 3 * * 1', () => safeCron('Money on Table', async () => {
  const { getActiveGrowthOSClients } = await import('./services/growthOSSetup');
  const { calculateMoneyOnTable } = await import('./services/opportunityService');
  const clients = await getActiveGrowthOSClients();
  for (const client of clients) {
    await calculateMoneyOnTable(client);
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log('[CRON] Money on table done');
}), { timezone: 'UTC' });
console.log('[cron] Money on table scheduled — Mondays 8:30 AM IST');

// Growth OS — Creative Intelligence — Every 6 hours
cron.schedule('0 */6 * * *', () => safeCron('Creative Intelligence', async () => {
  const { getActiveGrowthOSClients } = await import('./services/growthOSSetup');
  const { trackCreativePerformance } = await import('./services/creativeIntelligenceService');
  const clients = await getActiveGrowthOSClients();
  for (const client of clients) {
    await trackCreativePerformance(client.ad_account_id);
    await new Promise(r => setTimeout(r, 5000));
  }
  console.log('[CRON] Creative intelligence done');
}), { timezone: 'UTC' });
console.log('[cron] Creative intelligence scheduled — every 6 hours');

// Growth OS — Competitor Pulse — Every Friday 9:00 AM IST (3:30 UTC)
cron.schedule('30 3 * * 5', () => safeCron('Competitor Pulse', async () => {
  const { getActiveGrowthOSClients } = await import('./services/growthOSSetup');
  const { runCompetitorPulse } = await import('./services/competitorService');
  const clients = await getActiveGrowthOSClients();
  for (const client of clients) {
    await runCompetitorPulse(client);
    await new Promise(r => setTimeout(r, 5000));
  }
  console.log('[CRON] Competitor pulse done');
}), { timezone: 'UTC' });
console.log('[cron] Competitor pulse scheduled — Fridays 9:00 AM IST');

// Growth OS — Co-Pilot: poll unprocessed inbound messages from Growth OS founders — every 2 minutes
cron.schedule('*/2 * * * *', () => safeCron('Co-Pilot Poller', async () => {
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
}), { timezone: 'UTC' });
console.log('[cron] Co-pilot message poller scheduled — every 2 minutes');

// ---------------------------------------------------------------------------
// Pipeline placement job — every 5 minutes
// Picks up slo_purchase events whose contacts haven't been placed in a pipeline yet.
// Hooks into the payment flow without touching cashfree.ts or webhooks.ts.
// ---------------------------------------------------------------------------
cron.schedule('*/5 * * * *', () => safeCron('Pipeline Placement', async () => {
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
}), { timezone: 'UTC' });
console.log('[cron] Pipeline placement job scheduled — every 5 minutes');

// ---------------------------------------------------------------------------
// Worker health check HTTP server (for Railway health monitoring)
// ---------------------------------------------------------------------------
const WORKER_PORT = parseInt(process.env.WORKER_PORT ?? '3001', 10);
const healthServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', uptime: Math.round(process.uptime()), ts: Date.now() }));
});
healthServer.listen(WORKER_PORT, () => {
  console.log(`[worker] Health check server listening on port ${WORKER_PORT}`);
});

// ---------------------------------------------------------------------------
// Meta token expiration monitoring — Every Monday 9:30 AM IST (4:00 UTC)
// ---------------------------------------------------------------------------
cron.schedule('0 4 * * 1', () => safeCron('Meta Token Check', async () => {
  const tokens: Array<{ name: string; token: string }> = [];
  if (process.env.META_ADS_TOKEN) tokens.push({ name: 'META_ADS_TOKEN', token: process.env.META_ADS_TOKEN });
  if (process.env.META_ACCESS_TOKEN && process.env.META_ACCESS_TOKEN !== process.env.META_ADS_TOKEN) {
    tokens.push({ name: 'META_ACCESS_TOKEN', token: process.env.META_ACCESS_TOKEN });
  }

  if (tokens.length === 0) {
    console.log('[CRON] Meta Token Check: no tokens configured');
    return;
  }

  const { sendSlackDM } = await import('./services/slackService');
  const issues: string[] = [];

  for (const { name, token } of tokens) {
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${token}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        issues.push(`${name}: HTTP ${res.status} — token may be expired or invalid\n   ${body.slice(0, 100)}`);
      } else {
        // Check token debug info for expiry
        try {
          const debugRes = await fetch(`https://graph.facebook.com/v19.0/debug_token?input_token=${token}&access_token=${token}`, { signal: AbortSignal.timeout(10000) });
          if (debugRes.ok) {
            const debugData = await debugRes.json() as { data?: { expires_at?: number; is_valid?: boolean } };
            const expiresAt = debugData.data?.expires_at;
            if (expiresAt && expiresAt > 0) {
              const daysUntilExpiry = Math.floor((expiresAt * 1000 - Date.now()) / 86400000);
              if (daysUntilExpiry <= 14) {
                issues.push(`${name}: expires in ${daysUntilExpiry} days — renew soon`);
              } else {
                console.log(`[CRON] ${name}: valid, expires in ${daysUntilExpiry} days`);
              }
            }
          }
        } catch { /* debug endpoint non-critical */ }
      }
    } catch (e) {
      issues.push(`${name}: fetch failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (issues.length > 0) {
    await sendSlackDM(SLACK_JATIN,
      `⚠️ *Meta Token Health Check*\n\n${issues.map(i => `• ${i}`).join('\n')}\n\n` +
      `Renew at: developers.facebook.com → Tools → Access Token Tool`
    );
    console.log(`[CRON] Meta Token Check: ${issues.length} issue(s) found`);
  } else {
    console.log('[CRON] Meta Token Check: all tokens healthy');
  }
}), { timezone: 'UTC' });
console.log('[cron] Meta token check scheduled — Mondays 9:30 AM IST');

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
