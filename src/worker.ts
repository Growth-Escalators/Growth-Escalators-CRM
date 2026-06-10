import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import cron from 'node-cron';
import { db, pool } from './db/index';
import { sql } from 'drizzle-orm';
import { startStuckJobWorker } from './workers/stuckJobWorker';
import { startSequenceWorker } from './workers/sequenceWorker';
import { startSocialPostWorker } from './workers/socialPostWorker';
import { startEdgeQueueDrainer, stopEdgeQueueDrainer } from './services/edgeQueueDrainer';
import { checkAndAlertBlockers } from './services/blockerAlertService';
import { generateMonthlyDraftInvoices } from './services/recurringInvoiceService';
import { sendSODDigest, sendEODSummary, sendSakhamSOD } from './services/sodEodService';
import { sendTeamSODPrompt, sendTeamEODPrompt, sendSocialMediaPrompt } from './services/dailyPromptsService';
import { placePipelineContact } from './services/pipelineService';
import { checkSpendAlerts } from './services/spendAlertService';
import { collectDailyData } from './services/intelligenceDataCollector';
import { analyzeWithClaude } from './services/intelligenceAnalyzer';
import { deliverDailyIntelligence } from './services/intelligenceDelivery';
import { SLACK_SALES_BD_CHANNEL, SLACK_JATIN, SLACK_SAKCHAM, SLACK_PERF_MARKETING_CHANNEL, SLACK_SEO_CHANNEL, SLACK_OUTREACH_CHANNEL, SLACK_SOD_EOD_CHANNEL, DEFAULT_TENANT_SLUG } from './config/constants';
import { isPaused } from './config/featureFlags';

// True when this file is run directly (`node dist/worker.js`).
// False when imported by `src/index.ts` so background jobs run inside `web`.
// Health server + signal handlers are gated on this so they don't collide
// with web's own port/handlers when running in-process.
const RUNNING_STANDALONE = require.main === module;

console.log(RUNNING_STANDALONE
  ? '[worker] Worker process started (standalone)'
  : '[scheduler] Background jobs starting inside web process');

// Startup: validate critical environment variables
const _missingEnvVars: string[] = [];
if (!process.env.SERPER_API_KEY) _missingEnvVars.push('SERPER_API_KEY (SEO rank tracking, backlinks, content gaps, outreach directory scraping will not work)');
if (!process.env.META_ADS_TOKEN && !process.env.META_ACCESS_TOKEN) _missingEnvVars.push('META_ADS_TOKEN (Meta Ads daily report will not work)');
if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_API_KEY) _missingEnvVars.push('ANTHROPIC_API_KEY (AI intelligence + outreach icebreaker/reply classifier will use fallback mode)');
if (!process.env.META_PIXEL_ID) _missingEnvVars.push('META_PIXEL_ID (Meta CAPI conversions will not fire — get from Events Manager)');
// Outreach-critical env vars
if (!process.env.GOOGLE_PLACES_API_KEY) _missingEnvVars.push('GOOGLE_PLACES_API_KEY (daily outreach lead discovery will not run)');
if (!process.env.HUNTER_API_KEY) _missingEnvVars.push('HUNTER_API_KEY (outreach enrichment email-finder primary source disabled)');
if (!process.env.SNOVIO_API_KEY && !process.env.SNOV_API_KEY) _missingEnvVars.push('SNOVIO_API_KEY (outreach enrichment email-finder secondary source disabled)');
if (!process.env.SALESHANDY_API_KEY) _missingEnvVars.push('SALESHANDY_API_KEY (outreach upload-to-sequence automation will not work)');
if (!process.env.SALESHANDY_SEQUENCE_ID) _missingEnvVars.push('SALESHANDY_SEQUENCE_ID (outreach upload target sequence missing)');
if (!process.env.OUTREACH_INTERNAL_SECRET) _missingEnvVars.push('OUTREACH_INTERNAL_SECRET (n8n ↔ backend auth for outreach endpoints disabled)');
if (!process.env.MEETING_BOOKING_URL) _missingEnvVars.push('MEETING_BOOKING_URL (INTERESTED-reply drafts will not include a self-book link)');
if (!process.env.MAX_DAILY_UPLOADS) _missingEnvVars.push('MAX_DAILY_UPLOADS (default 200) (uploadToSaleshandy daily cap safety-net)');
const _missingPurelymailSlots: string[] = [];
for (let i = 1; i <= 6; i++) {
  if (!process.env[`PURELYMAIL_PASS_${i}`]) _missingPurelymailSlots.push(String(i));
}
if (_missingPurelymailSlots.length > 0) {
  _missingEnvVars.push(`PURELYMAIL_PASS_${_missingPurelymailSlots.join(',')} (outreach IMAP reply polling will skip these inboxes)`);
}
if (_missingEnvVars.length > 0) {
  console.warn('[worker] ⚠️ MISSING ENV VARS:');
  for (const v of _missingEnvVars) console.warn(`  • ${v}`);
  // Slack DM removed 2026-05-03 — fired on every deploy and was producing
  // ~24 DMs/day on heavy-deploy days. Console output above is sufficient
  // since Railway logs are searchable and env vars rarely change silently.
}

// Track all setInterval timers for graceful shutdown
const _intervals: ReturnType<typeof setInterval>[] = [];

// One-time startup: ensure enrichment columns + reply alert columns + self-healing columns + funnel metrics
import('./services/outreachEnrichmentService').then(m => m.ensureEnrichmentColumns()).catch(() => {});
import('./services/outreachAlertService').then(m => m.ensureOutreachAlertColumns()).catch(() => {});
import('./services/workflowSelfHealingService').then(m => m.ensureSelfHealingColumns()).catch(() => {});
import('./services/outreachFunnelMetrics').then(m => m.ensureOutreachFunnelTable()).catch(() => {});
import('./services/websiteCacheService').then(m => m.ensureWebsiteCacheTable()).catch(() => {});
import('./services/attendanceColumns').then(m => m.ensureAttendanceColumns()).catch(() => {});
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
// Drain landing-page events queued by Vercel edge functions when Railway was
// unreachable. No-op if UPSTASH_REDIS_REST_URL/TOKEN are unset.
startEdgeQueueDrainer().catch(e => console.error('[worker] edge drainer failed to start:', e));

// ---------------------------------------------------------------------------
// safeCron — wraps cron handlers with error catch, logging, overlap protection
// ---------------------------------------------------------------------------
const _cronRunning = new Map<string, boolean>();

function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const chr = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash;
}

async function safeCron(name: string, fn: () => Promise<unknown>, useAdvisoryLock = false): Promise<void> {
  // Overlap protection — skip if already running (in-process)
  if (_cronRunning.get(name)) {
    console.log(`[CRON] ${name} already running — skipping`);
    return;
  }

  // Cross-process lock (advisory lock using hash of name)
  if (useAdvisoryLock) {
    try {
      const lockKey = Math.abs(hashCode(name));
      const lockResult = await pool.query('SELECT pg_try_advisory_lock($1) AS acquired', [lockKey]);
      if (!lockResult.rows[0]?.acquired) {
        console.log(`[CRON] ${name} — another instance holds the lock, skipping`);
        return;
      }
    } catch { /* advisory lock non-critical, continue anyway */ }
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
    if (useAdvisoryLock) {
      try {
        const lockKey = Math.abs(hashCode(name));
        await pool.query('SELECT pg_advisory_unlock($1)', [lockKey]);
      } catch { /* non-critical */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Cron jobs
// ---------------------------------------------------------------------------

// Blocker alerts — DISABLED (folded into Morning Briefing)
// cron.schedule('45 4 * * 1-6', () => safeCron('Blocker Alerts', checkAndAlertBlockers), { timezone: 'UTC' });
console.log('[cron] blocker alerts — disabled (folded into morning briefing)');

// Morning Briefing — 9:30 AM IST (04:00 UTC), Mon-Sat — personalized DM per team member
cron.schedule('0 4 * * 1-6', () => safeCron('Morning Briefing', async () => {
  const { sendMorningBriefings } = await import('./services/morningBriefingService');
  const result = await sendMorningBriefings();
  console.log(`[CRON] Morning Briefing: ${result.sent} sent, ${result.errors.length} errors`);
}), { timezone: 'UTC' });
console.log('[cron] morning briefing scheduled — 9:30 AM IST Mon-Sat');

// PAUSED 2026-05-03 — SOD Digest + Sakcham Priority SOD. Re-enable by uncommenting.
/*
cron.schedule('45 4 * * 1-6', async () => {
  await safeCron('SOD Digest', sendSODDigest);
  await safeCron('Sakcham Priority SOD', sendSakhamSOD);
}, { timezone: 'UTC' });
console.log('[cron] SOD digest scheduled — 10:15 AM IST Mon-Sat');
*/
console.log('[cron] SOD digest — PAUSED 2026-05-03');

// PAUSED 2026-05-03 — EOD Summary. Re-enable by uncommenting.
/*
cron.schedule('45 13 * * 1-6', () => safeCron('EOD Summary', sendEODSummary), { timezone: 'UTC' });
console.log('[cron] EOD summary scheduled — 7:15 PM IST Mon-Sat');
*/
console.log('[cron] EOD summary — PAUSED 2026-05-03');

// Evening Summary — 7:15 PM IST (13:45 UTC), Mon-Sat — personalized DM per team member
cron.schedule('45 13 * * 1-6', () => safeCron('Evening Summary', async () => {
  const { sendEveningSummaries } = await import('./services/eveningSummaryService');
  const result = await sendEveningSummaries();
  console.log(`[CRON] Evening Summary: ${result.sent} sent, ${result.errors.length} errors`);
}), { timezone: 'UTC' });
console.log('[cron] evening summary scheduled — 7:15 PM IST Mon-Sat');

// Team channel prompts — lightweight "drop yours" cues in real Slack
// channels so the team sees the rhythm even when personalised digests are
// paused. Three crons; all Mon–Sat; UTC because that's the existing
// convention in this file (cron-utils helper added IST offset comments).

// SOD prompt — 10:15 AM IST (04:45 UTC) in #sod-eod, tags Kanishk/Kratika/Sneha
cron.schedule('45 4 * * 1-6', () => safeCron('Team SOD Prompt', sendTeamSODPrompt), { timezone: 'UTC' });
console.log('[cron] team SOD prompt scheduled — 10:15 AM IST Mon-Sat');

// EOD prompt — 7:00 PM IST (13:30 UTC) in #sod-eod, tags Kanishk/Kratika/Sneha
cron.schedule('30 13 * * 1-6', () => safeCron('Team EOD Prompt', sendTeamEODPrompt), { timezone: 'UTC' });
console.log('[cron] team EOD prompt scheduled — 7:00 PM IST Mon-Sat');

// Social media posting prompt — 9:30 AM IST (04:00 UTC) in #social-media-posting,
// tags Kratika & Sneha so they list which brands need posting today.
cron.schedule('0 4 * * 1-6', () => safeCron('Social Media Prompt', sendSocialMediaPrompt), { timezone: 'UTC' });
console.log('[cron] social media prompt scheduled — 9:30 AM IST Mon-Sat');

// Spend alert check — DISABLED (folded into Morning Briefing)
// cron.schedule('0 * * * *', () => safeCron('Spend Alert Check', checkSpendAlerts), { timezone: 'UTC' });
console.log('[cron] spend alert check — disabled (folded into morning briefing)');

// PAUSED 2026-05-03 — Monthly Invoice Drafts. Re-enable by uncommenting.
/*
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
      `🧾 *Invoice Drafts Ready — ${month}*\n\nDrafts generated for all active billing clients.\nReview and approve at: /billing\n\n<@${SLACK_JATIN}> <@${SLACK_SAKCHAM}> — please review before sending to clients.`);
    // DM Jatin with details
    await sendSlackDM(SLACK_JATIN,
      `🧾 *${result.generated} Invoice Drafts Generated — ${month}*\n\n` +
      `${result.errors.length > 0 ? `⚠️ ${result.errors.length} error(s): ${result.errors.join(', ')}\n\n` : ''}` +
      `Review and send: https://crm.growthescalators.com/billing`
    ).catch(() => {});
  }
}), { timezone: 'UTC' });
console.log('[cron] monthly invoice drafts scheduled — 1st of month at 9 AM IST');
*/
console.log('[cron] monthly invoice drafts — PAUSED 2026-05-03');

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

// PAUSED 2026-05-03 — Daily Intelligence Report (Anthropic). Re-enable by uncommenting.
/*
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
*/
console.log('[cron] AI intelligence report — PAUSED 2026-05-03');

// PAUSED 2026-05-03 — SEO Workflow Health. The SEO workflows it monitors
// no longer exist in n8n (only the unrelated content pipeline remains),
// so this fired "n8n is DOWN" alerts daily for a thing that's intentionally
// not running. Re-enable by uncommenting after redeploying SEO workflows.
/*
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
      `Fix: /seo → Workflows → Run Now\n` +
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
*/
console.log('[cron] SEO workflow health check — PAUSED 2026-05-03');

// PAUSED 2026-05-03 — Workflow Self-Healing. Polls n8n for failed SEO
// executions every 30 min — but the workflows it heals don't exist in n8n
// anymore (only content pipeline runs there), and the N8N_API_KEY for this
// service is currently rejecting with 401 anyway. Re-enable after
// redeploying SEO workflows + refreshing the API key.
// (Using //-comments here instead of /* */ because the cron expression
// '*/30 * * * *' contains */ which terminates a block comment early.)
//
// cron.schedule('*/30 * * * *', () => safeCron('Workflow Self-Healing', async () => {
//   const { runSelfHealingCycle } = await import('./services/workflowSelfHealingService');
//   await runSelfHealingCycle();
// }), { timezone: 'UTC' });
// console.log('[cron] workflow self-healing scheduled — every 30 minutes');
console.log('[cron] workflow self-healing — PAUSED 2026-05-03');

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
  const { fetchAccountInsights, buildAccountReport, sortAccountsForReport } = await import('./services/metaAdsService');

  const token = process.env.META_ADS_TOKEN || process.env.META_ACCESS_TOKEN;
  if (!token) {
    await sendSlackMessage(SLACK_PERF_MARKETING_CHANNEL, '📊 *Meta Ads Daily Report*\n\n⚠️ META_ADS_TOKEN not configured — cannot fetch data.', undefined, { allowDuringPause: true });
    return;
  }

  // Only Active accounts hit Slack. Paused accounts stay in the table but
  // are skipped (the admin UI flips is_active to control this). Deleted
  // accounts are removed entirely.
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

  // One Slack message per active account, sorted highest-spend-first so the
  // most-impactful accounts appear at the top of the channel timeline.
  // Small inter-message delay keeps the messages in order in Slack and
  // avoids tripping any rate limits.
  let sent = 0;
  for (const a of sortAccountsForReport(insights)) {
    const ok = await sendSlackMessage(SLACK_PERF_MARKETING_CHANNEL, buildAccountReport(a), undefined, { allowDuringPause: true })
      .catch((e) => { console.error('[CRON] Meta Ads post failed for', a.clientName, e); return false; });
    if (ok) sent++;
    await new Promise(r => setTimeout(r, 800));
  }
  console.log(`[CRON] Meta Ads report sent: ${sent}/${insights.length} accounts`);
}), { timezone: 'UTC' });
console.log('[cron] Meta Ads daily report scheduled — 9:30 AM IST Mon-Sat');

// PAUSED 2026-05-03 — Money on Table. Re-enable by uncommenting.
/*
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
*/
console.log('[cron] Money on table — PAUSED 2026-05-03');

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

// Growth OS — Co-Pilot: poll unprocessed inbound messages from Growth OS founders — every 10 minutes
cron.schedule('*/10 * * * *', () => safeCron('Co-Pilot Poller', async () => {
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
console.log('[cron] Co-pilot message poller scheduled — every 10 minutes');

// ---------------------------------------------------------------------------
// Pipeline placement job — every 5 minutes
// Picks up slo_purchase events whose contacts haven't been placed in a pipeline yet.
// Hooks into the payment flow without touching cashfree.ts or webhooks.ts.
// ---------------------------------------------------------------------------
// Runs every 5 minutes — fast enough for delivery, reduces DB load from 2880 to 288 queries/day
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
      LIMIT 100
    `);

    if (rows.length === 0) return;

    console.log(`[CRON] Pipeline placement: processing ${rows.length} unplaced contact(s)`);
    for (const row of rows as Array<{ id: string; contact_id: string; payload: Record<string, unknown>; tenant_id: string }>) {
      const { contact_id, payload, tenant_id } = row;
      const segment = (payload.segment as string) || 'd2c';
      const amount  = typeof payload.amount === 'number' ? payload.amount : 9;
      const bump1   = Boolean(payload.bump1);
      const bump2   = Boolean(payload.bump2);
      const funnelSlug = (payload.funnelSlug as string) || 'ecom';
      try {
        const result = await placePipelineContact({ contactId: contact_id, segment, amount, bump1, bump2, tenantId: tenant_id, funnelSlug });
        if (!result.success) {
          console.warn(`[CRON] Pipeline placement failed for ${contact_id} (${funnelSlug}) — delivering assets anyway`);
        }

        // Deliver purchase assets (WhatsApp + email) REGARDLESS of pipeline placement
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
              bump1, bump2, segment, funnelSlug,
            });
          }
        } catch (ae) {
          console.error('[CRON] Asset delivery failed for contact', contact_id, ':', ae);
        }
      } catch (e) {
        console.error('[CRON] Pipeline placement failed for contact', contact_id, ':', e);
      }
    }
}), 5 * 60_000);
_intervals.push(PLACEMENT_INTERVAL);
console.log('[cron] Pipeline placement job scheduled — every 5 minutes');

// ---------------------------------------------------------------------------
// Outreach Daily Digest — DISABLED (folded into Evening Summary)
// Posts pipeline stats to #outreach / #sales-bd channel
// ---------------------------------------------------------------------------
/* DISABLED — outreach stats now in Evening Summary DMs
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
DISABLED — end of outreach daily digest */
console.log('[cron] Outreach daily digest — disabled (folded into evening summary)');

// ---------------------------------------------------------------------------
// Outreach: backend enrichment — every 10 minutes
// Bypasses n8n WF-01 and enriches leads directly from backend
// ---------------------------------------------------------------------------
// PAUSED 2026-05-03 — Outreach Enrichment (Hunter+Snov+Apollo+reacher). Re-enable by uncommenting.
/*
const ENRICHMENT_INTERVAL = setInterval(() => safeCron('Outreach Enrichment', async () => {
  const { enrichStuckLeads } = await import('./services/outreachEnrichmentService');
  await enrichStuckLeads();
  // Task 6: check for INTERESTED leads unanswered >90 minutes
  const { checkReplySpeedAlerts } = await import('./services/outreachAlertService');
  await checkReplySpeedAlerts();
}), 5 * 60_000); // every 5 minutes
_intervals.push(ENRICHMENT_INTERVAL);
console.log('[cron] Outreach enrichment scheduled — every 5 minutes');
*/
console.log('[cron] Outreach enrichment — PAUSED 2026-05-03');

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
const SALESHANDY_INTERVAL = setInterval(() => safeCron('Saleshandy Auto-Upload', async () => {
  const { uploadToSaleshandy } = await import('./services/outreachEnrichmentService');
  await uploadToSaleshandy();
}), 15 * 60_000);
_intervals.push(SALESHANDY_INTERVAL);
console.log('[cron] Saleshandy auto-upload scheduled — every 15 minutes');

// ---------------------------------------------------------------------------
// Outreach → CRM Sync — every 30 minutes
// Creates CRM contacts + deals from Active outreach leads
// ---------------------------------------------------------------------------
import('./services/outreachCrmSyncService').then(m => m.ensureOutreachCrmSetup()).catch(() => {});
import('./services/systemHealthMonitor').then(m => m.ensureCronJobLogsTable()).catch(() => {});
const CRM_SYNC_INTERVAL = setInterval(() => safeCron('Outreach CRM Sync', async () => {
  const { syncOutreachToCrm } = await import('./services/outreachCrmSyncService');
  await syncOutreachToCrm();
}), 30 * 60_000);
_intervals.push(CRM_SYNC_INTERVAL);
console.log('[cron] Outreach CRM sync scheduled — every 30 minutes');

// ---------------------------------------------------------------------------
// Daily Lead Discovery — 7:00 AM IST (1:30 UTC)
// Runs 3 searches per day, rotating through the list
// ---------------------------------------------------------------------------
const DISCOVERY_QUERIES = [
  // UK — major cities × keyword variations
  { query: 'performance marketing agency', location: 'Birmingham', country: 'UK' },
  { query: 'performance marketing agency', location: 'Leeds', country: 'UK' },
  { query: 'performance marketing agency', location: 'Bristol', country: 'UK' },
  { query: 'digital marketing agency', location: 'Edinburgh', country: 'UK' },
  { query: 'ppc agency', location: 'Liverpool', country: 'UK' },
  { query: 'meta ads agency', location: 'Manchester', country: 'UK' },
  { query: 'google ads agency', location: 'Glasgow', country: 'UK' },
  { query: 'paid social agency', location: 'Newcastle', country: 'UK' },
  { query: 'ecommerce marketing agency', location: 'Nottingham', country: 'UK' },
  { query: 'shopify marketing agency', location: 'Sheffield', country: 'UK' },
  { query: 'facebook ads agency', location: 'Cardiff', country: 'UK' },
  { query: 'D2C marketing agency', location: 'Belfast', country: 'UK' },
  { query: 'paid media agency', location: 'Southampton', country: 'UK' },
  { query: 'growth marketing agency', location: 'Brighton', country: 'UK' },
  // AU — expanded cities
  { query: 'performance marketing agency', location: 'Sydney', country: 'AU' },
  { query: 'digital marketing agency', location: 'Brisbane', country: 'AU' },
  { query: 'ppc agency', location: 'Perth', country: 'AU' },
  { query: 'meta ads agency', location: 'Melbourne', country: 'AU' },
  { query: 'google ads agency', location: 'Adelaide', country: 'AU' },
  { query: 'ecommerce marketing agency', location: 'Gold Coast', country: 'AU' },
  { query: 'paid social agency', location: 'Canberra', country: 'AU' },
  { query: 'shopify agency', location: 'Hobart', country: 'AU' },
  // CA — expanded cities
  { query: 'performance marketing agency', location: 'Vancouver', country: 'CA' },
  { query: 'digital marketing agency', location: 'Calgary', country: 'CA' },
  { query: 'meta ads agency', location: 'Toronto', country: 'CA' },
  { query: 'ppc agency', location: 'Montreal', country: 'CA' },
  { query: 'google ads agency', location: 'Ottawa', country: 'CA' },
  { query: 'ecommerce marketing agency', location: 'Edmonton', country: 'CA' },
  { query: 'paid media agency', location: 'Winnipeg', country: 'CA' },
  // US — expanded cities + niche keywords
  { query: 'meta ads agency', location: 'New York', country: 'US' },
  { query: 'performance marketing agency', location: 'Austin', country: 'US' },
  { query: 'digital advertising agency', location: 'Chicago', country: 'US' },
  { query: 'ecommerce marketing agency', location: 'Miami', country: 'US' },
  { query: 'google ads agency', location: 'Los Angeles', country: 'US' },
  { query: 'shopify marketing agency', location: 'San Francisco', country: 'US' },
  { query: 'paid social agency', location: 'Denver', country: 'US' },
  { query: 'D2C marketing agency', location: 'Atlanta', country: 'US' },
  { query: 'facebook ads agency', location: 'Dallas', country: 'US' },
  { query: 'growth marketing agency', location: 'Seattle', country: 'US' },
  { query: 'ppc management agency', location: 'Boston', country: 'US' },
  { query: 'performance media agency', location: 'Nashville', country: 'US' },
  { query: 'paid advertising agency', location: 'Portland', country: 'US' },
  { query: 'digital ads agency', location: 'Phoenix', country: 'US' },
  { query: 'meta advertising agency', location: 'Charlotte', country: 'US' },
  // NZ
  { query: 'digital marketing agency', location: 'Auckland', country: 'NZ' },
  { query: 'ppc agency', location: 'Wellington', country: 'NZ' },
  // IE
  { query: 'performance marketing agency', location: 'Dublin', country: 'IE' },
  { query: 'paid social agency', location: 'Cork', country: 'IE' },
  // EU — Berlin / Amsterdam / Stockholm / Copenhagen (English-speaking agency scene)
  { query: 'performance marketing agency', location: 'Berlin', country: 'DE' },
  { query: 'ecommerce marketing agency', location: 'Berlin', country: 'DE' },
  { query: 'paid social agency', location: 'Munich', country: 'DE' },
  { query: 'ppc agency', location: 'Hamburg', country: 'DE' },
  { query: 'performance marketing agency', location: 'Amsterdam', country: 'NL' },
  { query: 'shopify agency', location: 'Amsterdam', country: 'NL' },
  { query: 'paid media agency', location: 'Rotterdam', country: 'NL' },
  { query: 'performance marketing agency', location: 'Stockholm', country: 'SE' },
  { query: 'ecommerce agency', location: 'Stockholm', country: 'SE' },
  { query: 'digital marketing agency', location: 'Gothenburg', country: 'SE' },
  { query: 'performance marketing agency', location: 'Copenhagen', country: 'DK' },
  { query: 'paid social agency', location: 'Copenhagen', country: 'DK' },
  { query: 'performance marketing agency', location: 'Oslo', country: 'NO' },
  { query: 'ecommerce marketing agency', location: 'Helsinki', country: 'FI' },
  // UK tier-2 + niche
  { query: 'CRO agency', location: 'London', country: 'UK' },
  { query: 'lifecycle marketing agency', location: 'London', country: 'UK' },
  { query: 'retention agency', location: 'London', country: 'UK' },
  { query: 'TikTok ads agency', location: 'London', country: 'UK' },
  { query: 'amazon marketing agency', location: 'London', country: 'UK' },
  { query: 'klaviyo email agency', location: 'London', country: 'UK' },
  { query: 'email marketing agency', location: 'Manchester', country: 'UK' },
  { query: 'performance creative agency', location: 'London', country: 'UK' },
  { query: 'youtube ads agency', location: 'London', country: 'UK' },
  { query: 'influencer marketing agency', location: 'London', country: 'UK' },
  { query: 'direct response agency', location: 'London', country: 'UK' },
  { query: 'B2B marketing agency', location: 'London', country: 'UK' },
  { query: 'SaaS marketing agency', location: 'London', country: 'UK' },
  { query: 'dtc agency', location: 'London', country: 'UK' },
  { query: 'subscription marketing agency', location: 'London', country: 'UK' },
  // US tier-2 + niche
  { query: 'CRO agency', location: 'New York', country: 'US' },
  { query: 'lifecycle marketing agency', location: 'New York', country: 'US' },
  { query: 'retention agency', location: 'Los Angeles', country: 'US' },
  { query: 'TikTok ads agency', location: 'Los Angeles', country: 'US' },
  { query: 'amazon marketing agency', location: 'New York', country: 'US' },
  { query: 'klaviyo email agency', location: 'New York', country: 'US' },
  { query: 'email marketing agency', location: 'Chicago', country: 'US' },
  { query: 'youtube ads agency', location: 'Los Angeles', country: 'US' },
  { query: 'influencer marketing agency', location: 'Los Angeles', country: 'US' },
  { query: 'B2B marketing agency', location: 'San Francisco', country: 'US' },
  { query: 'SaaS marketing agency', location: 'San Francisco', country: 'US' },
  { query: 'subscription marketing agency', location: 'Austin', country: 'US' },
  { query: 'performance marketing agency', location: 'Minneapolis', country: 'US' },
  { query: 'digital marketing agency', location: 'Indianapolis', country: 'US' },
  { query: 'paid social agency', location: 'Salt Lake City', country: 'US' },
  { query: 'ecommerce marketing agency', location: 'San Diego', country: 'US' },
  { query: 'ppc agency', location: 'Orlando', country: 'US' },
  { query: 'google ads agency', location: 'Las Vegas', country: 'US' },
  { query: 'facebook ads agency', location: 'Tampa', country: 'US' },
  { query: 'shopify marketing agency', location: 'Brooklyn', country: 'US' },
  // AU niche
  { query: 'shopify agency', location: 'Sydney', country: 'AU' },
  { query: 'TikTok ads agency', location: 'Melbourne', country: 'AU' },
  { query: 'klaviyo email agency', location: 'Sydney', country: 'AU' },
  { query: 'CRO agency', location: 'Melbourne', country: 'AU' },
  { query: 'B2B marketing agency', location: 'Sydney', country: 'AU' },
  // CA niche
  { query: 'shopify agency', location: 'Toronto', country: 'CA' },
  { query: 'klaviyo email agency', location: 'Toronto', country: 'CA' },
  { query: 'TikTok ads agency', location: 'Vancouver', country: 'CA' },
];

// PAUSED 2026-05-03 — Daily Lead Discovery (Google Places). Re-enable by uncommenting.
/*
cron.schedule('30 1 * * *', () => safeCron('Daily Lead Discovery', async () => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) { console.log('[CRON] Discovery: GOOGLE_PLACES_API_KEY not set'); return; }

  const QUERIES_PER_DAY = 5;
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const startIdx = (dayOfYear * QUERIES_PER_DAY) % DISCOVERY_QUERIES.length;
  const todayQueries = Array.from({ length: QUERIES_PER_DAY }, (_, i) =>
    DISCOVERY_QUERIES[(startIdx + i) % DISCOVERY_QUERIES.length]);

  let totalInserted = 0;
  let totalApiCalls = 0;
  const countryCounts: Record<string, number> = {};
  const { insertOutreachLead } = await import('./services/outreachLeadsService');

  type Place = { name: string; formatted_address?: string; rating?: number; user_ratings_total?: number };

  for (const q of todayQueries) {
    try {
      const fullQuery = encodeURIComponent(`${q.query} ${q.location}`);
      const baseUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${fullQuery}&key=${apiKey}`;

      // Paginate up to 3 pages (60 results max) via next_page_token.
      // Places requires ~2s delay before pagetoken becomes active.
      const allPlaces: Place[] = [];
      let nextToken: string | undefined;
      for (let page = 0; page < 3; page++) {
        const url = page === 0 ? baseUrl : `${baseUrl}&pagetoken=${nextToken}`;
        if (page > 0) await new Promise(r => setTimeout(r, 2500));
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        totalApiCalls++;
        if (!res.ok) break;
        const data = await res.json() as { results?: Place[]; next_page_token?: string };
        allPlaces.push(...(data.results ?? []));
        nextToken = data.next_page_token;
        if (!nextToken) break;
      }

      for (const p of allPlaces) {
        const fitScore = Math.min(100, 50 + (p.rating ?? 0) * 5 + Math.min((p.user_ratings_total ?? 0), 10) * 2);
        if (fitScore < 40) continue;

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

  if (totalApiCalls > 0) {
    try {
      const { incrementDiscoveryCost } = await import('./services/outreachFunnelMetrics');
      await incrementDiscoveryCost(totalApiCalls);
    } catch (err) {
      console.error('[CRON] discovery cost track failed:', err instanceof Error ? err.message : String(err));
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
  console.log(`[CRON] Daily discovery: ${totalInserted} new leads, ${totalApiCalls} Places calls`);
}), { timezone: 'UTC' });
console.log('[cron] Daily lead discovery scheduled — 7:00 AM IST');
*/
console.log('[cron] Daily lead discovery — PAUSED 2026-05-03');

// ---------------------------------------------------------------------------
// Outreach Funnel Snapshot — 23:55 IST (18:25 UTC)
// Captures daily funnel counts for ROI tracking on /outreach-dashboard
// ---------------------------------------------------------------------------
cron.schedule('25 18 * * *', () => safeCron('Outreach Funnel Snapshot', async () => {
  const { snapshotTodaysFunnel } = await import('./services/outreachFunnelMetrics');
  await snapshotTodaysFunnel();
}), { timezone: 'UTC' });
console.log('[cron] Outreach funnel snapshot scheduled — 23:55 IST');

// ---------------------------------------------------------------------------
// Saleshandy Stats Poll — 23:50 IST (18:20 UTC), just before funnel snapshot
// Populates today's sent/open/bounce/click before snapshotTodaysFunnel runs
// ---------------------------------------------------------------------------
cron.schedule('20 18 * * *', () => safeCron('Saleshandy Stats Poll', async () => {
  const { pollSaleshandyStats } = await import('./services/saleshandyStatsService');
  await pollSaleshandyStats();
}), { timezone: 'UTC' });
console.log('[cron] Saleshandy stats poll scheduled — 23:50 IST');

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Retainer Invoice Generator — daily 9:00 AM IST (3:30 UTC)
// ---------------------------------------------------------------------------
import('./services/retainerService').then(m => m.ensureRetainerTables()).catch(() => {});
// PAUSED 2026-05-03 — Retainer Invoice Generator. Re-enable by uncommenting.
/*
cron.schedule('30 3 * * *', () => safeCron('Retainer Invoice Generator', async () => {
  const tenantResult = await db.execute(sql`SELECT id FROM tenants WHERE slug = ${DEFAULT_TENANT_SLUG} LIMIT 1`);
  const tenantId = (tenantResult.rows[0] as { id: string } | undefined)?.id;
  if (!tenantId) return;

  const { generatePendingInvoices } = await import('./services/retainerService');
  const result = await generatePendingInvoices(tenantId, 'system');

  if (result.generated > 0) {
    const { sendSlackMessage } = await import('./services/slackService');
    await sendSlackMessage(SLACK_SOD_EOD_CHANNEL,
      `🧾 *Auto-generated ${result.generated} retainer invoice(s)*\nReview at: /billing`,
    ).catch(() => {});
  }
  console.log(`[CRON] Retainer invoices: ${result.generated} generated, ${result.errors.length} errors`);
}), { timezone: 'UTC' });
console.log('[cron] Retainer invoice generator scheduled — daily 9:00 AM IST');
*/
console.log('[cron] Retainer invoice generator — PAUSED 2026-05-03');

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// SEO Weekly Email — Thursday 10:30 AM IST (5:00 UTC)
// ---------------------------------------------------------------------------
cron.schedule('0 5 * * 4', () => safeCron('SEO Weekly Email', async () => {
  if (isPaused('seo')) return;
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
  if (isPaused('seo')) return;
  const startedAt = new Date();
  const { runPageSpeedChecks } = await import('./services/pagespeedService');
  const { logSeoWorkflowRun } = await import('./services/seoWorkflowHealthService');
  try {
    const result = await runPageSpeedChecks();
    console.log(`[CRON] PageSpeed: ${result.checked} checked, ${result.errors} errors`);
    await logSeoWorkflowRun({
      workflowId: 'z21W6MDWBF0dukkT', workflowName: 'PageSpeed Monitor',
      status: 'success', startedAt, recordsProcessed: result.checked,
    });
  } catch (e) {
    await logSeoWorkflowRun({
      workflowId: 'z21W6MDWBF0dukkT', workflowName: 'PageSpeed Monitor',
      status: 'error', startedAt, errorMessage: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}), { timezone: 'UTC' });
console.log('[cron] PageSpeed monitor scheduled — Sundays 7:30 AM IST');

// PAUSED 2026-05-03 — Rank Tracking (Serper.dev). Re-enable by uncommenting.
/*
cron.schedule('30 3 * * 2', () => safeCron('Rank Tracking', async () => {
  const startedAt = new Date();
  const { runRankChecks } = await import('./services/rankTrackingService');
  const { logSeoWorkflowRun } = await import('./services/seoWorkflowHealthService');
  try {
    const result = await runRankChecks();
    console.log(`[CRON] Rank tracking: ${result.checked} keywords checked, ${result.errors} errors`);
    await logSeoWorkflowRun({
      workflowId: 'BwO187curjMMA60i', workflowName: 'Rank Tracking',
      status: 'success', startedAt, recordsProcessed: result.checked,
    });
  } catch (e) {
    await logSeoWorkflowRun({
      workflowId: 'BwO187curjMMA60i', workflowName: 'Rank Tracking',
      status: 'error', startedAt, errorMessage: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}), { timezone: 'UTC' });
console.log('[cron] Rank tracking scheduled — Tuesdays 9:00 AM IST (Serper.dev)');
*/
console.log('[cron] Rank tracking — PAUSED 2026-05-03');

// SEO Alert Triggers — Daily 9 AM IST (3:30 UTC) — runs directly (no n8n dependency)
cron.schedule('30 3 * * *', () => safeCron('SEO Alert Triggers', async () => {
  if (isPaused('seo')) return;
  const startedAt = new Date();
  const { runSeoAlertChecks } = await import('./services/seoAlertService');
  const { logSeoWorkflowRun } = await import('./services/seoWorkflowHealthService');
  try {
    const result = await runSeoAlertChecks();
    console.log(`[CRON] SEO Alert Triggers: ${result.alerts} alerts generated`);
    await logSeoWorkflowRun({
      workflowId: '5FVX2kEjuD7vWD0e', workflowName: 'Alert Triggers',
      status: 'success', startedAt, recordsProcessed: result.alerts,
    });
  } catch (e) {
    await logSeoWorkflowRun({
      workflowId: '5FVX2kEjuD7vWD0e', workflowName: 'Alert Triggers',
      status: 'error', startedAt, errorMessage: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}), { timezone: 'UTC' });
console.log('[cron] SEO alert triggers scheduled — daily 9:00 AM IST (backend-native)');

// PAUSED 2026-05-03 — SEO Backlink Monitor (Serper.dev). Re-enable by uncommenting.
/*
cron.schedule('30 3 * * 5', () => safeCron('SEO Backlink Monitor', async () => {
  const startedAt = new Date();
  const { runBacklinkCheck } = await import('./services/seoBacklinkService');
  const { logSeoWorkflowRun } = await import('./services/seoWorkflowHealthService');
  try {
    const result = await runBacklinkCheck();
    console.log(`[CRON] SEO Backlink Monitor: ${result.found} new backlinks, ${result.errors} errors`);
    await logSeoWorkflowRun({
      workflowId: '19R3BStSY2S1N9H1', workflowName: 'Backlink Monitor',
      status: 'success', startedAt, recordsProcessed: result.found,
    });
  } catch (e) {
    await logSeoWorkflowRun({
      workflowId: '19R3BStSY2S1N9H1', workflowName: 'Backlink Monitor',
      status: 'error', startedAt, errorMessage: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}), { timezone: 'UTC' });
console.log('[cron] SEO backlink monitor scheduled — Fridays 9:00 AM IST (backend-native)');
*/
console.log('[cron] SEO backlink monitor — PAUSED 2026-05-03');

// PAUSED 2026-05-03 — SEO Content Decay Detection (Serper.dev). Re-enable by uncommenting.
/*
cron.schedule('30 3 * * 1', () => safeCron('SEO Content Decay', async () => {
  const startedAt = new Date();
  const { runContentDecayDetection } = await import('./services/seoContentDecayService');
  const { logSeoWorkflowRun } = await import('./services/seoWorkflowHealthService');
  try {
    const result = await runContentDecayDetection();
    console.log(`[CRON] SEO Content Decay: ${result.opportunities} decay opportunities found`);
    await logSeoWorkflowRun({
      workflowId: 'Ss2Bfps5lXBWUUs4', workflowName: 'Content Decay Detection',
      status: 'success', startedAt, recordsProcessed: result.opportunities,
    });
  } catch (e) {
    await logSeoWorkflowRun({
      workflowId: 'Ss2Bfps5lXBWUUs4', workflowName: 'Content Decay Detection',
      status: 'error', startedAt, errorMessage: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}), { timezone: 'UTC' });
console.log('[cron] SEO content decay scheduled — Every Monday 9:00 AM IST (backend-native)');
*/
console.log('[cron] SEO content decay — PAUSED 2026-05-03');

// SEO Weekly Opportunity Digest — Friday 5 PM IST (11:30 UTC) — sends via Slack directly
cron.schedule('30 11 * * 5', () => safeCron('SEO Weekly Digest', async () => {
  if (isPaused('seo')) return;
  const startedAt = new Date();
  const { sendWeeklyOpportunityDigest } = await import('./services/seoDigestService');
  const { logSeoWorkflowRun } = await import('./services/seoWorkflowHealthService');
  try {
    const result = await sendWeeklyOpportunityDigest();
    console.log(`[CRON] SEO Weekly Digest: ${result.sent ? 'sent' : 'failed'}`);
    await logSeoWorkflowRun({
      workflowId: 'M4rbRZL5jh0jJHku', workflowName: 'Weekly Opportunity Digest',
      status: result.sent ? 'success' : 'error', startedAt,
      errorMessage: result.sent ? undefined : 'Slack send failed',
    });
  } catch (e) {
    await logSeoWorkflowRun({
      workflowId: 'M4rbRZL5jh0jJHku', workflowName: 'Weekly Opportunity Digest',
      status: 'error', startedAt, errorMessage: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}), { timezone: 'UTC' });
console.log('[cron] SEO weekly digest scheduled — Fridays 5:00 PM IST (backend-native)');

// Competitor Content Analysis — 1st and 15th of each month at 9:00 AM IST (3:30 UTC)
cron.schedule('30 3 1,15 * *', () => safeCron('Competitor Content Analysis', async () => {
  if (isPaused('seo')) return;
  const { runCompetitorContentAnalysis } = await import('./services/competitorContentService');
  const result = await runCompetitorContentAnalysis();
  console.log(`[CRON] Competitor content: ${result.analyzed} keywords analyzed, ${result.errors} errors`);
}), { timezone: 'UTC' });
console.log('[cron] Competitor content analysis scheduled — 1st & 15th of month at 9:00 AM IST');

// PAUSED 2026-05-03 — SEO Content Gap Analysis (Serper.dev). Re-enable by uncommenting.
/*
cron.schedule('30 4 15 * *', () => safeCron('SEO Content Gap Analysis', async () => {
  const { runContentGapAnalysis } = await import('./services/seoContentGapService');
  const result = await runContentGapAnalysis();
  console.log(`[CRON] Content gap analysis: ${result.gaps} gaps, ${result.opportunities} opportunities`);
}), { timezone: 'UTC' });
console.log('[cron] SEO content gap analysis scheduled — 15th of month at 10:00 AM IST');
*/
console.log('[cron] SEO content gap analysis — PAUSED 2026-05-03');

// Directory Scrapers — Daily 11 AM IST (5:30 UTC) — Clutch, GoodFirms, Upwork, LinkedIn
cron.schedule('30 5 * * *', () => safeCron('Directory Scrapers', async () => {
  const { runAllScrapers } = await import('./services/directoryScraperService');
  const result = await runAllScrapers();
  console.log(`[CRON] Directory scrapers: ${result.total} found, ${result.imported} new leads imported`);
}), { timezone: 'UTC' });
console.log('[cron] Directory scrapers scheduled — daily 11:00 AM IST');

// PAUSED 2026-05-03 — Finance Monthly Generation (recurring expenses). Re-enable by uncommenting.
/*
cron.schedule('30 3 1 * *', () => safeCron('Finance Monthly Generation', async () => {
  const { generateMonthlyExpenses } = await import('./services/financeService');
  const tenantResult = await pool.query(`SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`);
  if (tenantResult.rows.length > 0) {
    const result = await generateMonthlyExpenses(tenantResult.rows[0].id as string);
    console.log(`[CRON] Finance: generated ${result.generated} recurring expenses for this month`);
  }
}), { timezone: 'UTC' });
console.log('[cron] Finance monthly generation scheduled — 1st of month 9:00 AM IST');
*/
console.log('[cron] Finance monthly generation — PAUSED 2026-05-03');

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
const HEALTH_INTERVAL = setInterval(() => safeCron('System Health Check', async () => {
  const { checkAllSystems, sendCriticalAlerts } = await import('./services/systemHealthMonitor');
  const report = await checkAllSystems();
  await sendCriticalAlerts(report);
  console.log(`[health] System score: ${report.overallScore}/100`);
}), 30 * 60_000);
_intervals.push(HEALTH_INTERVAL);
console.log('[cron] System health monitor scheduled — every 30 minutes');

// ---------------------------------------------------------------------------
// Worker health check HTTP server (for Railway health monitoring)
// Only bound when running as a standalone process — when imported by web,
// web's own /health route serves the same purpose and binds the public port.
// ---------------------------------------------------------------------------
if (RUNNING_STANDALONE) {
  const WORKER_PORT = parseInt(process.env.WORKER_PORT ?? '3001', 10);
  const healthServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: Math.round(process.uptime()), ts: Date.now() }));
  });
  healthServer.listen(WORKER_PORT, () => {
    console.log(`[worker] Health check server listening on port ${WORKER_PORT}`);
  });
}

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

// PAUSED 2026-05-03 — Late Attendance Check. Replaced by the self-service
// attendance flow at /my-attendance — late-detection now happens at check-in
// time (is_late + late_minutes columns) and admins see the data in the
// finance/attendance view rather than via daily Slack DM.
/*
cron.schedule('0 5 * * 1-6', () => safeCron('Late Attendance Check', async () => {
  const { sendSlackDM } = await import('./services/slackService');
  const today = new Date().toISOString().split('T')[0];
  const members = await pool.query(
    `SELECT tp.name FROM team_payroll tp
     WHERE tp.is_active = true
       AND NOT EXISTS (
         SELECT 1 FROM team_attendance ta
         WHERE ta.member_id = tp.id AND ta.attendance_date = $1 AND ta.check_in IS NOT NULL
       )`, [today]
  );
  if (members.rows.length > 0) {
    const names = members.rows.map((r: { name: string }) => r.name).join(', ');
    await sendSlackDM(SLACK_JATIN,
      `⏰ *Late Attendance Alert*\n${members.rows.length} team member(s) not checked in by 10:15 AM: ${names}`
    );
    console.log(`[CRON] Late Attendance: ${members.rows.length} member(s) not checked in`);
  } else {
    console.log('[CRON] Late Attendance: all team members checked in');
  }
}), { timezone: 'UTC' });
console.log('[cron] Late attendance check scheduled — Mon-Sat 10:30 AM IST');
*/
console.log('[cron] Late attendance check — PAUSED 2026-05-03 (replaced by self-service /my-attendance)');

// ---------------------------------------------------------------------------
// Monthly client benchmarks — 1st of month, 11:00 AM IST (5:30 UTC)
// ---------------------------------------------------------------------------
cron.schedule('30 5 1 * *', () => safeCron('Monthly Client Benchmarks', async () => {
  const { calculateMonthlyBenchmarks } = await import('./services/metaAdsService');
  await calculateMonthlyBenchmarks();
}), { timezone: 'UTC' });
console.log('[cron] Monthly client benchmarks scheduled — 1st of month 11:00 AM IST');

// ---------------------------------------------------------------------------
// Graceful shutdown
//
// Split into two parts so the import path (web) can reuse the cron/interval
// cleanup without also closing the shared DB pool — that's web's responsibility.
// The standalone path bundles both into the original behavior.
// ---------------------------------------------------------------------------

/**
 * Stop scheduled crons and intervals, drain in-flight jobs (max 30s).
 * Does NOT close the DB pool — caller decides when to do that.
 * Safe to call from `src/index.ts` shutdown when background jobs run in-process.
 */
export async function stopBackgroundJobs(): Promise<void> {
  console.log(`[scheduler-shutdown] stopping background jobs…`);

  for (const id of _intervals) clearInterval(id);
  console.log(`[scheduler-shutdown] cleared ${_intervals.length} interval timer(s)`);

  stopEdgeQueueDrainer();

  const runningJobs = [..._cronRunning.entries()].filter(([, v]) => v).map(([k]) => k);
  if (runningJobs.length > 0) {
    console.log(`[scheduler-shutdown] waiting for ${runningJobs.length} running job(s): ${runningJobs.join(', ')}`);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const stillRunning = [..._cronRunning.entries()].filter(([, v]) => v);
      if (stillRunning.length === 0) break;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

const shutdown = async (signal: string) => {
  console.log(`[worker-shutdown] ${signal} received — stopping workers…`);
  await stopBackgroundJobs();

  try {
    await pool.end();
    console.log('[worker-shutdown] database pool closed');
  } catch (e) {
    console.error('[worker-shutdown] error closing database pool:', e);
  }

  console.log('[worker-shutdown] graceful shutdown complete');
  process.exit(0);
};

if (RUNNING_STANDALONE) {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
