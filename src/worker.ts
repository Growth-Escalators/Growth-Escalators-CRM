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
import { SLACK_SALES_BD_CHANNEL, SLACK_JATIN, SLACK_SAKCHAM, SLACK_PERF_MARKETING_CHANNEL, SLACK_SEO_CHANNEL, SLACK_OUTREACH_CHANNEL, SLACK_SOD_EOD_CHANNEL, DEFAULT_TENANT_SLUG } from './config/constants';

console.log('[worker] Worker process started');

// One-time startup: ensure enrichment columns + reply alert columns
import('./services/outreachEnrichmentService').then(m => m.ensureEnrichmentColumns()).catch(() => {});
import('./services/outreachAlertService').then(m => m.ensureOutreachAlertColumns()).catch(() => {});
pool.query(`
  UPDATE outreach_leads SET status = 'New', updated_at = NOW()
  WHERE status = 'Enriching' AND updated_at < NOW() - INTERVAL '30 minutes'
`).then(r => {
  if (r.rowCount && r.rowCount > 0) console.log(`[worker] Reset ${r.rowCount} stuck Enriching lead(s) to New on startup`);
}).catch(() => {});

// ---------------------------------------------------------------------------
// Background workers
// ---------------------------------------------------------------------------
startStuckJobWorker();
startSequenceWorker();
startSocialPostWorker();

// ---------------------------------------------------------------------------
// safeCron — wraps cron handlers with error catch, logging, overlap protection
// ---------------------------------------------------------------------------
const _cronRunning = new Map<string, boolean>();

async function safeCron(name: string, fn: () => Promise<unknown>): Promise<void> {
  // Overlap protection — skip if already running
  if (_cronRunning.get(name)) {
    console.log(`[CRON] ${name} already running — skipping`);
    return;
  }
  _cronRunning.set(name, true);
  let logId = 0;
  const start = Date.now();
  try {
    const { logCronStart } = await import('./services/systemHealthMonitor');
    logId = await logCronStart(name).catch(() => 0);
  } catch { /* logging non-critical */ }

  try {
    await fn();
    if (logId) {
      const { logCronSuccess } = await import('./services/systemHealthMonitor');
      await logCronSuccess(logId, Date.now() - start).catch(() => {});
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[CRON FAIL] ${name}:`, error);
    if (logId) {
      const { logCronFailure } = await import('./services/systemHealthMonitor');
      await logCronFailure(logId, Date.now() - start, msg).catch(() => {});
    }
    try {
      const { sendSlackDM } = await import('./services/slackService');
      const ts = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      await sendSlackDM(SLACK_JATIN,
        `🚨 *CRON FAILED: ${name}*\n\nError: ${msg.slice(0, 300)}\nTime: ${ts}\n\nCheck worker logs for details.`
      );
    } catch { /* Slack send failed */ }
  } finally {
    _cronRunning.set(name, false);
  }
}

// ---------------------------------------------------------------------------
// Cron jobs
// ---------------------------------------------------------------------------

// Blocker alerts — 10:15 AM IST (04:45 UTC), Mon-Sat, ONCE per day
cron.schedule('45 4 * * 1-6', () => safeCron('Blocker Alerts', checkAndAlertBlockers), { timezone: 'UTC' });
console.log('[cron] blocker alerts scheduled — 10:15 AM IST Mon-Sat (once daily)');

// SOD Digest — 10 AM IST (04:30 UTC), Mon-Sat
cron.schedule('30 4 * * 1-6', async () => {
  await safeCron('SOD Digest', sendSODDigest);
  await safeCron('Sakcham Priority SOD', sendSakhamSOD);
}, { timezone: 'UTC' });
console.log('[cron] SOD digest scheduled — 10:00 AM IST Mon-Sat');

// EOD Summary — 7:15 PM IST (13:45 UTC), Mon-Sat
cron.schedule('45 13 * * 1-6', () => safeCron('EOD Summary', sendEODSummary), { timezone: 'UTC' });
console.log('[cron] EOD summary scheduled — 7:15 PM IST Mon-Sat');

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
    const { sendSlackMessage, sendSlackDM } = await import('./services/slackService');
    const month = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    await sendSlackMessage(SLACK_SALES_BD_CHANNEL,
      `🧾 *Invoice Drafts Ready — ${month}*\n\nDrafts generated for all active billing clients.\nReview and approve at: /crm/billing\n\n<@${SLACK_JATIN}> <@${SLACK_SAKCHAM}> — please review before sending to clients.`);
    // DM Jatin with details
    await sendSlackDM(SLACK_JATIN,
      `🧾 *${result.generated} Invoice Drafts Generated — ${month}*\n\n` +
      `${result.errors.length > 0 ? `⚠️ ${result.errors.length} error(s): ${result.errors.join(', ')}\n\n` : ''}` +
      `Review and send: https://web-production-311da.up.railway.app/crm/billing`
    ).catch(() => {});
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
  // Insert placeholder row so failures are visible in history
  let reportId: string | null = null;
  try {
    const ins = await pool.query(`
      INSERT INTO ai_intelligence_reports (report_date, report_type, status, overall_score, tokens_used)
      VALUES (CURRENT_DATE, 'daily', 'generating', 0, 0)
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    reportId = (ins.rows[0] as { id: string } | undefined)?.id ?? null;
    if (!reportId) {
      // Already a row for today — skip to avoid duplicates
      console.log('[CRON] Intelligence: row already exists for today, skipping generation');
      return;
    }
  } catch (e) {
    console.error('[CRON] Intelligence: could not insert placeholder row:', e);
  }

  try {
    const data = await collectDailyData();
    const analysis = await analyzeWithClaude(data);
    await deliverDailyIntelligence(analysis, data);
    if (reportId) {
      await pool.query(`UPDATE ai_intelligence_reports SET status='complete' WHERE id=$1`, [reportId]).catch(() => {});
    }
    console.log('[CRON] Intelligence report delivered. Score:', analysis.scores.overall);
  } catch (e) {
    console.error('[CRON] Intelligence report generation failed:', e);
    const msg = e instanceof Error ? e.message : String(e);
    if (reportId) {
      await pool.query(
        `UPDATE ai_intelligence_reports SET status='failed', error_message=$1 WHERE id=$2`,
        [msg.slice(0, 500), reportId],
      ).catch(() => {});
    }
    throw e; // re-throw so safeCron logs it
  }
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
// Meta Ads Daily Report — 9:30 AM IST (4:00 UTC), Mon-Sat
// Uses dedicated Meta Ads service with circuit breaker + proper API parsing
// ---------------------------------------------------------------------------
import('./services/metaAdsService').then(m => m.ensureAdAccountsTable()).catch(() => {});
cron.schedule('0 4 * * 1-6', () => safeCron('Meta Ads Daily Report', async () => {
  const { sendSlackMessage } = await import('./services/slackService');
  const { fetchAccountInsights, buildDailyReport } = await import('./services/metaAdsService');

  const token = process.env.META_ADS_TOKEN || process.env.META_ACCESS_TOKEN;
  if (!token) {
    await sendSlackMessage(SLACK_PERF_MARKETING_CHANNEL, '📊 *Meta Ads Daily Report*\n\n⚠️ META_ADS_TOKEN not configured — cannot fetch data.');
    return;
  }

  const accounts = await pool.query(`SELECT account_id, client_name, currency, exchange_rate FROM ad_accounts WHERE is_active = true`);
  if (accounts.rows.length === 0) {
    // Fallback: use growth_os_clients if no ad_accounts configured
    const clients = await pool.query(`SELECT ad_account_id AS account_id, client_name FROM growth_os_clients WHERE is_active = true`);
    if (clients.rows.length === 0) { console.log('[CRON] Meta Ads: no active accounts'); return; }
    for (const c of clients.rows as Array<{ account_id: string; client_name: string }>) {
      accounts.rows.push({ account_id: c.account_id, client_name: c.client_name, currency: 'INR', exchange_rate: 1 });
    }
  }

  const insights = [];
  for (const acct of accounts.rows as Array<{ account_id: string; client_name: string; currency: string; exchange_rate: number }>) {
    const data = await fetchAccountInsights(acct.account_id, token, acct.client_name, acct.currency, Number(acct.exchange_rate ?? 1));
    insights.push(data);
  }

  const report = buildDailyReport(insights);
  await sendSlackMessage(SLACK_PERF_MARKETING_CHANNEL, report);
  console.log('[CRON] Meta Ads report sent');
}), { timezone: 'UTC' });
console.log('[cron] Meta Ads daily report scheduled — 9:30 AM IST Mon-Sat');

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
// Runs every 30 seconds for fast asset delivery after purchase
const PLACEMENT_INTERVAL = setInterval(() => safeCron('Pipeline Placement', async () => {
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
        const result = await placePipelineContact({ contactId: contact_id, segment, amount, bump1, bump2, tenantId: tenant_id });

        // Deliver purchase assets (WhatsApp + email) after successful pipeline placement
        if (result.success) {
          try {
            const { deliverPurchaseAssets } = await import('./services/assetDeliveryService');
            const contactInfo = await pool.query(
              `SELECT c.first_name,
                      (SELECT channel_value FROM contact_channels WHERE contact_id = c.id AND channel_type = 'whatsapp' LIMIT 1) AS phone,
                      (SELECT channel_value FROM contact_channels WHERE contact_id = c.id AND channel_type = 'email' AND is_primary = true LIMIT 1) AS email
               FROM contacts c WHERE c.id = $1 LIMIT 1`,
              [contact_id],
            );
            if (contactInfo.rows.length > 0) {
              const info = contactInfo.rows[0] as { first_name: string; phone: string | null; email: string | null };
              await deliverPurchaseAssets({
                contactId: contact_id, firstName: info.first_name,
                phone: info.phone, email: info.email,
                bump1, bump2, segment,
              });
            }
          } catch (ae) {
            console.error('[CRON] Asset delivery failed for contact', contact_id, ':', ae);
          }
        }
      } catch (e) {
        console.error('[CRON] Pipeline placement failed for contact', contact_id, ':', e);
      }
    }
}), 30_000);
console.log('[cron] Pipeline placement job scheduled — every 30 seconds');

// ---------------------------------------------------------------------------
// Outreach Daily Digest — 8:00 PM IST (14:30 UTC), Mon-Sat
// Posts pipeline stats to #outreach / #sales-bd channel
// ---------------------------------------------------------------------------
cron.schedule('30 14 * * 1-6', () => safeCron('Outreach Daily Digest', async () => {
  const { sendSlackMessage } = await import('./services/slackService');
  const today = new Date().toISOString().slice(0, 10);
  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  const statusResult = await pool.query(
    `SELECT status, COUNT(*)::int AS count FROM outreach_leads GROUP BY status ORDER BY count DESC`,
  );
  const sc: Record<string, number> = {};
  for (const row of statusResult.rows as Array<{ status: string; count: number }>) {
    sc[row.status] = row.count;
  }

  const todayResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM outreach_leads WHERE created_at::date = $1`, [today],
  );
  const leadsToday = (todayResult.rows[0] as { count: number }).count;

  const ownerResult = await pool.query(
    `SELECT LOWER(assigned_to) AS owner, COUNT(*)::int AS count
     FROM outreach_leads WHERE status IN ('New','Enriching','Active')
     GROUP BY LOWER(assigned_to)`,
  );
  const owners: Record<string, number> = {};
  for (const row of ownerResult.rows as Array<{ owner: string; count: number }>) {
    owners[row.owner || 'unassigned'] = row.count;
  }

  const repliesResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM outreach_leads WHERE status = 'Replied' AND updated_at::date = $1`, [today],
  );
  const repliesToday = (repliesResult.rows[0] as { count: number }).count;

  const total = Object.values(sc).reduce((a, b) => a + b, 0);

  let msg = `📬 *Outreach Daily Digest — ${dateStr}*\n\n`;
  msg += `*Pipeline Status*\n`;
  msg += `New: ${sc.New ?? 0} · Enriching: ${sc.Enriching ?? 0} · Active: ${sc.Active ?? 0} · Replied: ${sc.Replied ?? 0}\n`;
  msg += `Closed: ${sc.Closed ?? 0} · Not Found: ${sc.Not_Found ?? 0} · Duplicate: ${sc.Duplicate ?? 0}\n\n`;
  msg += `*By Owner*\n`;
  msg += `Jatin: ${owners.jatin ?? 0} active · Sakcham: ${owners.saksham ?? owners.sakcham ?? 0} active\n\n`;
  msg += `*Today*\n`;
  msg += `Leads added: ${leadsToday} · Replies: ${repliesToday}\n`;
  msg += `Total in pipeline: ${total}\n`;

  await sendSlackMessage(SLACK_OUTREACH_CHANNEL, msg);
  console.log('[CRON] Outreach digest sent');
}), { timezone: 'UTC' });
console.log('[cron] Outreach daily digest scheduled — 8:00 PM IST Mon-Sat');

// ---------------------------------------------------------------------------
// Outreach: backend enrichment — every 10 minutes
// Bypasses n8n WF-01 and enriches leads directly from backend
// ---------------------------------------------------------------------------
setInterval(() => safeCron('Outreach Enrichment', async () => {
  const { enrichStuckLeads } = await import('./services/outreachEnrichmentService');
  await enrichStuckLeads();
  // Task 6: check for INTERESTED leads unanswered >90 minutes
  const { checkReplySpeedAlerts } = await import('./services/outreachAlertService');
  await checkReplySpeedAlerts();
}), 5 * 60_000); // every 5 minutes
console.log('[cron] Outreach enrichment scheduled — every 5 minutes');

// ---------------------------------------------------------------------------
// Outreach: reset stuck Enriching leads — every 2 hours
// Leads stuck in Enriching for >1 hour get reset to New for WF-01 retry
// ---------------------------------------------------------------------------
cron.schedule('0 */2 * * *', () => safeCron('Reset Stuck Enriching Leads', async () => {
  const result = await pool.query(`
    UPDATE outreach_leads
    SET status = 'New', updated_at = NOW()
    WHERE status = 'Enriching'
      AND updated_at < NOW() - INTERVAL '1 hour'
    RETURNING id, company
  `);
  if (result.rows.length > 0) {
    console.log(`[CRON] Reset ${result.rows.length} stuck Enriching lead(s) to New`);
    const { sendSlackMessage } = await import('./services/slackService');
    await sendSlackMessage(SLACK_OUTREACH_CHANNEL,
      `🔄 Reset ${result.rows.length} stuck lead(s) from Enriching → New for retry:\n` +
      result.rows.slice(0, 10).map((r: { company: string }) => `• ${r.company}`).join('\n'),
    ).catch(() => {});
  }
}), { timezone: 'UTC' });
console.log('[cron] Outreach stuck lead reset scheduled — every 2 hours');

// ---------------------------------------------------------------------------
// Audit booking follow-up check — every 6 hours
// Alerts Jatin if bump2 buyers haven't booked within 48 hours
// ---------------------------------------------------------------------------
cron.schedule('0 */6 * * *', () => safeCron('Audit Booking Follow-up', async () => {
  const { checkUnbookedAuditCalls } = await import('./services/assetDeliveryService');
  await checkUnbookedAuditCalls();
}), { timezone: 'UTC' });
console.log('[cron] Audit booking follow-up scheduled — every 6 hours');

// ---------------------------------------------------------------------------
// Saleshandy auto-upload — every 15 minutes
// ---------------------------------------------------------------------------
setInterval(() => safeCron('Saleshandy Auto-Upload', async () => {
  const { uploadToSaleshandy } = await import('./services/outreachEnrichmentService');
  await uploadToSaleshandy();
}), 15 * 60_000);
console.log('[cron] Saleshandy auto-upload scheduled — every 15 minutes');

// ---------------------------------------------------------------------------
// Outreach → CRM Sync — every 30 minutes
// Creates CRM contacts + deals from Active outreach leads
// ---------------------------------------------------------------------------
import('./services/outreachCrmSyncService').then(m => m.ensureOutreachCrmSetup()).catch(() => {});
import('./services/systemHealthMonitor').then(m => m.ensureCronJobLogsTable()).catch(() => {});
setInterval(() => safeCron('Outreach CRM Sync', async () => {
  const { syncOutreachToCrm } = await import('./services/outreachCrmSyncService');
  await syncOutreachToCrm();
}), 30 * 60_000);
console.log('[cron] Outreach CRM sync scheduled — every 30 minutes');

// ---------------------------------------------------------------------------
// Daily Lead Discovery — 7:00 AM IST (1:30 UTC)
// Runs 3 searches per day, rotating through the list
// ---------------------------------------------------------------------------
const DISCOVERY_QUERIES = [
  { query: 'performance marketing agency', location: 'Birmingham', country: 'UK' },
  { query: 'performance marketing agency', location: 'Leeds', country: 'UK' },
  { query: 'performance marketing agency', location: 'Bristol', country: 'UK' },
  { query: 'digital marketing agency', location: 'Edinburgh', country: 'UK' },
  { query: 'ppc agency', location: 'Liverpool', country: 'UK' },
  { query: 'performance marketing agency', location: 'Sydney', country: 'AU' },
  { query: 'digital marketing agency', location: 'Brisbane', country: 'AU' },
  { query: 'ppc agency', location: 'Perth', country: 'AU' },
  { query: 'performance marketing agency', location: 'Vancouver', country: 'CA' },
  { query: 'digital marketing agency', location: 'Calgary', country: 'CA' },
  { query: 'meta ads agency', location: 'New York', country: 'US' },
  { query: 'performance marketing agency', location: 'Austin', country: 'US' },
  { query: 'digital advertising agency', location: 'Chicago', country: 'US' },
  { query: 'ecommerce marketing agency', location: 'Miami', country: 'US' },
];

cron.schedule('30 1 * * *', () => safeCron('Daily Lead Discovery', async () => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) { console.log('[CRON] Discovery: GOOGLE_PLACES_API_KEY not set'); return; }

  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const startIdx = (dayOfYear * 3) % DISCOVERY_QUERIES.length;
  const todayQueries = [0, 1, 2].map(i => DISCOVERY_QUERIES[(startIdx + i) % DISCOVERY_QUERIES.length]);

  let totalInserted = 0;
  const countryCounts: Record<string, number> = {};
  const { insertOutreachLead } = await import('./services/outreachLeadsService');

  for (const q of todayQueries) {
    try {
      const fullQuery = encodeURIComponent(`${q.query} ${q.location}`);
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${fullQuery}&key=${apiKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const data = await res.json() as { results?: Array<{ name: string; formatted_address?: string; rating?: number; user_ratings_total?: number }> };
      const places = data.results ?? [];

      for (const p of places.slice(0, 20)) {
        const fitScore = Math.min(100, 50 + (p.rating ?? 0) * 5 + Math.min((p.user_ratings_total ?? 0), 10) * 2);
        if (fitScore < 60) continue;

        const result = await insertOutreachLead({
          company: p.name,
          address: p.formatted_address ?? null,
          country: q.country,
          fitScore,
          sourceDetail: `auto_discovery: ${q.query} in ${q.location}`,
        });
        if (result.inserted) {
          totalInserted++;
          countryCounts[q.country] = (countryCounts[q.country] ?? 0) + 1;
        }
      }
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.error(`[discovery] ${q.query} ${q.location} failed:`, e instanceof Error ? e.message : String(e));
    }
  }

  if (totalInserted > 0) {
    const { sendSlackMessage } = await import('./services/slackService');
    const totalPipeline = await pool.query(`SELECT COUNT(*)::int AS c FROM outreach_leads`);
    const parts = Object.entries(countryCounts).map(([c, n]) => `${c}: ${n}`).join(', ');
    await sendSlackMessage(SLACK_OUTREACH_CHANNEL,
      `🔍 *Discovery*: Found ${totalInserted} new leads today (${parts}). Total pipeline: ${(totalPipeline.rows[0] as { c: number }).c} leads.`,
    ).catch(() => {});
  }
  console.log(`[CRON] Daily discovery: ${totalInserted} new leads`);
}), { timezone: 'UTC' });
console.log('[cron] Daily lead discovery scheduled — 7:00 AM IST');

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Retainer Invoice Generator — daily 9:00 AM IST (3:30 UTC)
// ---------------------------------------------------------------------------
import('./services/retainerService').then(m => m.ensureRetainerTables()).catch(() => {});
cron.schedule('30 3 * * *', () => safeCron('Retainer Invoice Generator', async () => {
  const tenantResult = await db.execute(sql`SELECT id FROM tenants WHERE slug = ${DEFAULT_TENANT_SLUG} LIMIT 1`);
  const tenantId = (tenantResult.rows[0] as { id: string } | undefined)?.id;
  if (!tenantId) return;

  const { generatePendingInvoices } = await import('./services/retainerService');
  const result = await generatePendingInvoices(tenantId, 'system');

  if (result.generated > 0) {
    const { sendSlackMessage } = await import('./services/slackService');
    await sendSlackMessage(SLACK_SOD_EOD_CHANNEL,
      `🧾 *Auto-generated ${result.generated} retainer invoice(s)*\nReview at: /crm/billing`,
    ).catch(() => {});
  }
  console.log(`[CRON] Retainer invoices: ${result.generated} generated, ${result.errors.length} errors`);
}), { timezone: 'UTC' });
console.log('[cron] Retainer invoice generator scheduled — daily 9:00 AM IST');

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// SEO Weekly Email — Thursday 10:30 AM IST (5:00 UTC)
// ---------------------------------------------------------------------------
cron.schedule('0 5 * * 4', () => safeCron('SEO Weekly Email', async () => {
  const { sendSEOWeeklyEmail } = await import('./services/seoWeeklyEmailService');
  await sendSEOWeeklyEmail();
}), { timezone: 'UTC' });
console.log('[cron] SEO weekly email scheduled — Thursdays 10:30 AM IST');

// ---------------------------------------------------------------------------
// Task 7: Weekly Outreach Performance Summary — Monday 8:00 AM IST (2:30 UTC)
// Posts pipeline stats + reply activity to Jatin's Slack DM
// ---------------------------------------------------------------------------
cron.schedule('30 2 * * 1', () => safeCron('Weekly Outreach Summary', async () => {
  const { sendWeeklyOutreachSummary } = await import('./services/outreachAlertService');
  await sendWeeklyOutreachSummary();
}), { timezone: 'UTC' });
console.log('[cron] Weekly outreach summary scheduled — Mondays 8:00 AM IST (2:30 UTC)');

// ---------------------------------------------------------------------------
// Backend PageSpeed Monitor — Sunday 7:30 AM IST (2:00 UTC)
// Bypasses n8n WF-SEO-05 which has a connection issue
// ---------------------------------------------------------------------------
cron.schedule('0 2 * * 0', () => safeCron('PageSpeed Monitor', async () => {
  const { runPageSpeedChecks } = await import('./services/pagespeedService');
  const result = await runPageSpeedChecks();
  console.log(`[CRON] PageSpeed: ${result.checked} checked, ${result.errors} errors`);
}), { timezone: 'UTC' });
console.log('[cron] PageSpeed monitor scheduled — Sundays 7:30 AM IST');

// Weekly Data Cleanup — Sunday 2:00 AM IST (Saturday 20:30 UTC)
// ---------------------------------------------------------------------------
cron.schedule('30 20 * * 6', () => safeCron('Weekly Data Cleanup', async () => {
  let totalDeleted = 0;

  const r1 = await pool.query(`DELETE FROM cron_job_logs WHERE started_at < NOW() - INTERVAL '90 days'`);
  totalDeleted += r1.rowCount ?? 0;

  const r2 = await pool.query(`DELETE FROM ai_intelligence_reports WHERE created_at < NOW() - INTERVAL '180 days'`);
  totalDeleted += r2.rowCount ?? 0;

  const r3 = await pool.query(`DELETE FROM outreach_errors WHERE created_at < NOW() - INTERVAL '30 days'`);
  totalDeleted += r3.rowCount ?? 0;

  console.log(`[CRON] Weekly cleanup: deleted ${totalDeleted} old records`);

  if (totalDeleted > 100) {
    const { sendSlackMessage } = await import('./services/slackService');
    await sendSlackMessage(SLACK_SOD_EOD_CHANNEL,
      `🧹 *Weekly cleanup*: deleted ${totalDeleted} old records. Database stays lean.`,
    ).catch(() => {});
  }
}), { timezone: 'UTC' });
console.log('[cron] Weekly data cleanup scheduled — Sundays 2:00 AM IST');

// ---------------------------------------------------------------------------
// Daily Archive — 3:00 AM IST (21:30 UTC previous day)
// ---------------------------------------------------------------------------
cron.schedule('30 21 * * *', () => safeCron('Daily Archive', async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS outreach_leads_archive (LIKE outreach_leads INCLUDING ALL)`).catch(() => {});
  const r = await pool.query(`
    WITH moved AS (
      DELETE FROM outreach_leads
      WHERE status = 'Closed' AND updated_at < NOW() - INTERVAL '365 days'
      RETURNING *
    )
    INSERT INTO outreach_leads_archive SELECT * FROM moved
    RETURNING id
  `).catch(() => ({ rowCount: 0 }));
  const archived = r.rowCount ?? 0;
  if (archived > 0) console.log(`[CRON] Archived ${archived} closed outreach leads`);
}), { timezone: 'UTC' });
console.log('[cron] Daily archive scheduled — 3:00 AM IST');

// ---------------------------------------------------------------------------
// System Health Monitor — every 30 minutes
// ---------------------------------------------------------------------------
setInterval(() => safeCron('System Health Check', async () => {
  const { checkAllSystems, sendCriticalAlerts } = await import('./services/systemHealthMonitor');
  const report = await checkAllSystems();
  await sendCriticalAlerts(report);
  console.log(`[health] System score: ${report.overallScore}/100`);
}), 30 * 60_000);
console.log('[cron] System health monitor scheduled — every 30 minutes');

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
