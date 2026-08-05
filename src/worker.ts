import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import cron from 'node-cron';
import type { PoolClient } from 'pg';
import { db, pool } from './db/index';
import { sql } from 'drizzle-orm';
import { startStuckJobWorker } from './workers/stuckJobWorker';
import { startStaleWizmatchSourceRunWorker } from './workers/staleWizmatchSourceRunWorker';
import { startSequenceWorker } from './workers/sequenceWorker';
import { startSocialPostWorker } from './workers/socialPostWorker';
import { startEdgeQueueDrainer, stopEdgeQueueDrainer } from './services/edgeQueueDrainer';
import { startJobDrainer, stopJobDrainer } from './services/jobDrainer';
import { slackDigestEnabled } from './utils/slackDigestFlag';
import { checkAndAlertBlockers } from './services/blockerAlertService';
import { generateMonthlyDraftInvoices } from './services/recurringInvoiceService';
import { sendSODDigest, sendEODSummary, sendSakhamSOD } from './services/sodEodService';
import { sendTeamSODPrompt, sendTeamEODPrompt, sendSocialMediaPrompt } from './services/dailyPromptsService';
import { placePipelineContact } from './services/pipelineService';
import { checkSpendAlerts } from './services/spendAlertService';
import { collectDailyData } from './services/intelligenceDataCollector';
import { analyzeWithClaude } from './services/intelligenceAnalyzer';
import { deliverDailyIntelligence } from './services/intelligenceDelivery';
import { SLACK_SALES_BD_CHANNEL, SLACK_JATIN, SLACK_SAKCHAM, SLACK_PERF_MARKETING_CHANNEL, SLACK_OUTREACH_CHANNEL, SLACK_SOD_EOD_CHANNEL, DEFAULT_TENANT_SLUG, WIZMATCH_LEADS_CHANNEL, WIZMATCH_SYSTEM_CHANNEL } from './config/constants';
import { isPaused } from './config/featureFlags';
import { getWizmatchAutomationStatus, WIZMATCH_STAFFING_REMINDER_CRON } from './services/wizmatchAutomation';
import { getActiveTenantsWithFeature, getSingleActiveTenantWithFeature } from './services/tenantFeatures';
import { extractErrorCount } from './services/cronErrorExtraction';
import { expireOverdueContracts, sendSigningReminders } from './modules/esign/esign.jobs';

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
if (!process.env.OUTREACH_INTERNAL_SECRET) _missingEnvVars.push('OUTREACH_INTERNAL_SECRET (internal auth for outreach endpoints disabled — historically n8n, which is decommissioned; verify current caller before assuming this is unused)');
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

// One-time startup: ensure enrichment columns + reply alert columns + funnel metrics
// Each failure is logged (was previously a silent .catch(() => {})) — a
// failed schema-bootstrap here left zero evidence, so the FIRST symptom was
// a cron throwing "column does not exist" hours later with no link back to
// the actual boot-time failure.
import('./services/outreachEnrichmentService').then(m => m.ensureEnrichmentColumns()).catch(e => console.error('[worker] ensureEnrichmentColumns failed:', e instanceof Error ? e.message : e));
import('./services/outreachAlertService').then(m => m.ensureOutreachAlertColumns()).catch(e => console.error('[worker] ensureOutreachAlertColumns failed:', e instanceof Error ? e.message : e));
// workflowSelfHealingService.ts (and its seo_workflow_logs self-healing columns
// bootstrap that used to run here) has been removed — it retried failed n8n
// executions, and n8n is decommissioned. The 13 native src/services/seo*
// services it used to "heal" don't have executions to retry; they either
// succeed or throw, and safeCron() already surfaces a thrown error to Slack.
import('./services/outreachFunnelMetrics').then(m => m.ensureOutreachFunnelTable()).catch(e => console.error('[worker] ensureOutreachFunnelTable failed:', e instanceof Error ? e.message : e));
import('./services/websiteCacheService').then(m => m.ensureWebsiteCacheTable()).catch(e => console.error('[worker] ensureWebsiteCacheTable failed:', e instanceof Error ? e.message : e));
import('./services/attendanceColumns').then(m => m.ensureAttendanceColumns()).catch(e => console.error('[worker] ensureAttendanceColumns failed:', e instanceof Error ? e.message : e));
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
startStaleWizmatchSourceRunWorker();
startSequenceWorker();
startSocialPostWorker();
// Drain landing-page events queued by Vercel edge functions when Railway was
// unreachable. No-op if UPSTASH_REDIS_REST_URL/TOKEN are unset.
startEdgeQueueDrainer().catch(e => console.error('[worker] edge drainer failed to start:', e));
// Internal `jobs` queue drainer (form_submit only). The queue's only consumer
// was the HTTP endpoint n8n polled; n8n is gone from production, so nothing had
// drained it since 2026-03 -- 178 real website leads were sitting unprocessed.
// Fail-closed: does nothing unless JOB_DRAINER_ENABLED is explicitly set.
startJobDrainer();

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

// extractErrorCount lives in ./services/cronErrorExtraction — pure function,
// unit tested there without triggering this file's module-scope side effects
// (cron.schedule/setInterval registration) that firing on import.

// Cross-process advisory locking now defaults ON. Every one of the ~25
// safeCron() call sites in this file previously left this false (none
// passed the third argument), so overlap protection was in-process only
// (_cronRunning below). Background jobs run inside the `web` process by
// default (see index.ts), so during a Railway rolling deploy the old and
// new containers briefly coexist — every cron fired in both, duplicating
// Slack alerts, invoice drafts, and (worst case) the 5-minute placement
// job racing itself on the same slo_purchase events. pg_try_advisory_lock
// is cheap and non-blocking, so defaulting it on has no real downside.
//
// Advisory locks are SESSION-scoped in Postgres. Both this acquire and the
// matching release below therefore run on ONE dedicated client checked out
// of the pool — never `pool.query()`, which hands back an arbitrary
// connection each call. `pg_advisory_unlock` from a session that doesn't
// hold the lock logs a warning, returns false, and LEAVES THE LOCK HELD;
// with the previous `pool.query()` pair (and both sides swallowed by a bare
// `catch {}`) that happened silently whenever the pool didn't hand back the
// same connection twice, and every later fire of that cron then hit the
// "another instance holds the lock" branch and returned before running —
// permanently, with no run row and no error. src/db/index.ts sets
// `min: 2` with no maxLifetime/maxUses, so pg-pool's idle reaper never
// recycles the last two connections: an orphaned lock could survive until
// the next deploy. Same shape as withWizmatchSourceLock in
// services/wizmatchSourcing.ts.
// Exported for src/__tests__/safeCronAdvisoryLock.test.ts only — nothing else
// imports it; every call site lives in this file.
export async function safeCron(name: string, fn: () => Promise<unknown>, useAdvisoryLock = true): Promise<void> {
  // Overlap protection — skip if already running (in-process)
  if (_cronRunning.get(name)) {
    console.log(`[CRON] ${name} already running — skipping`);
    return;
  }

  // Cross-process lock (advisory lock using hash of name)
  const lockKey = Math.abs(hashCode(name));
  let lockClient: PoolClient | null = null;
  if (useAdvisoryLock) {
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      const lockResult = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [lockKey]);
      if (!lockResult.rows[0]?.acquired) {
        console.log(`[CRON] ${name} — another instance holds the lock, skipping`);
        client.release();
        return;
      }
      lockClient = client;
    } catch (error) {
      // Acquire failed. We can't tell a "never taken the lock" failure from a
      // "server took it, then the connection died mid-read" one, so destroy
      // the connection (release(err)) — closing the session drops any
      // advisory lock it may be holding. Then continue without the lock, as
      // the previous implementation did: overlap protection is non-critical,
      // skipping the job entirely is worse.
      if (client) client.release(error instanceof Error ? error : new Error(String(error)));
      console.warn(`[CRON] ${name} — advisory lock unavailable, running without cross-process lock:`, error instanceof Error ? error.message : error);
    }
  }

  _cronRunning.set(name, true);
  let logId = 0;
  const start = Date.now();
  try {
    const { logCronStart } = await import('./services/systemHealthMonitor');
    logId = await logCronStart(name).catch(() => 0);
  } catch { /* logging non-critical */ }

  try {
    const result = await fn();
    // Many crons already return { errors: [...] } or { errors: N } from an
    // internal per-item loop (Slack DM sends, signal scoring, etc.) and
    // just console.log the count — previously that count was never fed
    // back here, so a cron where every single item failed still logged
    // 'success' and never alerted. Duck-typed so this works for any cron
    // whose result already carries an error count, with no per-cron changes.
    const errorCount = extractErrorCount(result);
    if (logId) {
      const { logCronSuccess, logCronPartial } = await import('./services/systemHealthMonitor');
      if (errorCount > 0) {
        await logCronPartial(logId, Date.now() - start, 0, `${errorCount} item(s) failed within a successful run`).catch(() => {});
      } else {
        await logCronSuccess(logId, Date.now() - start).catch(() => {});
      }
    }
    if (errorCount > 0) {
      console.warn(`[CRON PARTIAL] ${name}: ${errorCount} item(s) failed`);
      try {
        const { sendSlackDM } = await import('./services/slackService');
        const ts = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        await sendSlackDM(SLACK_JATIN,
          `⚠️ *CRON PARTIAL: ${name}*\n\n${errorCount} item(s) failed within an otherwise-successful run.\nTime: ${ts}\n\nCheck worker logs for details.`
        );
      } catch { /* Slack send failed */ }
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
    if (lockClient) {
      const client = lockClient;
      lockClient = null;
      let unlockError: Error | undefined;
      try {
        const unlockResult = await client.query('SELECT pg_advisory_unlock($1) AS released', [lockKey]);
        // Postgres returns false (no error) when this session never held the
        // lock — the exact silent-orphan case this rewrite exists to prevent.
        if (unlockResult.rows[0]?.released === false) {
          console.warn(`[CRON] ${name} — pg_advisory_unlock returned false; lock may be orphaned (key=${lockKey})`);
        }
      } catch (error) {
        unlockError = error instanceof Error ? error : new Error(String(error));
        console.error(`[CRON] ${name} — pg_advisory_unlock failed, destroying connection to drop the lock (key=${lockKey}):`, unlockError.message);
      }
      // Only pass the error on failure. release(err) tells pg-pool to DESTROY
      // the connection instead of returning it; closing the session releases
      // every advisory lock it holds, which is the one guaranteed way out of
      // a stuck unlock. Doing that unconditionally would churn a connection
      // on every one of the ~25 crons here for no benefit.
      client.release(unlockError);
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
// ---------------------------------------------------------------------------
// Daily Slack digest gating (2026-07-31, owner-requested)
//
// SOD/EOD digests and the Meta Ads daily report DM real people on a schedule.
// The owner asked for them off. They are gated by env flag rather than
// commented out, deliberately: the block below previously carried
// "PAUSED 2026-05-03 — re-enable by uncommenting" comments while the crons
// underneath were LIVE and had been re-enabled at some point. Stale comments
// that contradict running code are how a scheduled DM to real humans hides in
// plain sight. A flag cannot go stale — the runtime value is the truth, and it
// can be flipped back from Railway without a code change or a deploy.
//
// All default OFF (fail-closed, matching this repo's flag convention). Parsing
// lives in utils/slackDigestFlag so the service-level gate in
// saleshandyStatsService cannot drift from the cron-level gates here.
//
//   SOD_EOD_SLACK_ENABLED=true            -> SOD/EOD digests + team prompts
//   META_ADS_REPORT_SLACK_ENABLED=true    -> Meta Ads daily "ad account overview"
//
// 2026-07-31 (second pass) — the owner asked for the rest of the recurring
// Growth Escalators Slack traffic off too. These five were ungated and, apart
// from Saleshandy, unconditional:
//   MORNING_BRIEFING_SLACK_ENABLED=true   -> Mon-Sat 09:30 IST DM x3
//   SOCIAL_PROMPT_SLACK_ENABLED=true      -> Mon-Sat 09:30 IST #social-media-posting
//   OUTREACH_SUMMARY_SLACK_ENABLED=true   -> Monday 08:00 IST DM
//   SEO_DIGEST_SLACK_ENABLED=true         -> Friday 17:00 IST #seo, one post per client
//   SALESHANDY_ALERT_SLACK_ENABLED=true   -> nightly deliverability DM (see below)
//
// NOTE on Saleshandy: its cron is NOT gated, because pollSaleshandyStats also
// writes today's sent/open/bounce/click that snapshotTodaysFunnel reads 30
// minutes later. Gating the cron would silently break the funnel numbers, so
// only the two sendSlackDM calls inside the service are gated.
const SOD_EOD_SLACK_ENABLED = slackDigestEnabled('SOD_EOD_SLACK_ENABLED');
const META_ADS_REPORT_SLACK_ENABLED = slackDigestEnabled('META_ADS_REPORT_SLACK_ENABLED');
const MORNING_BRIEFING_SLACK_ENABLED = slackDigestEnabled('MORNING_BRIEFING_SLACK_ENABLED');
const SOCIAL_PROMPT_SLACK_ENABLED = slackDigestEnabled('SOCIAL_PROMPT_SLACK_ENABLED');
const OUTREACH_SUMMARY_SLACK_ENABLED = slackDigestEnabled('OUTREACH_SUMMARY_SLACK_ENABLED');
const SEO_DIGEST_SLACK_ENABLED = slackDigestEnabled('SEO_DIGEST_SLACK_ENABLED');
if (!SOD_EOD_SLACK_ENABLED) console.log('[cron] SOD/EOD Slack digests DISABLED (set SOD_EOD_SLACK_ENABLED=true to re-enable)');
if (!META_ADS_REPORT_SLACK_ENABLED) console.log('[cron] Meta Ads daily report DISABLED (set META_ADS_REPORT_SLACK_ENABLED=true to re-enable)');
if (!MORNING_BRIEFING_SLACK_ENABLED) console.log('[cron] Morning briefing DMs DISABLED (set MORNING_BRIEFING_SLACK_ENABLED=true to re-enable)');
if (!SOCIAL_PROMPT_SLACK_ENABLED) console.log('[cron] Social media prompt DISABLED (set SOCIAL_PROMPT_SLACK_ENABLED=true to re-enable)');
if (!OUTREACH_SUMMARY_SLACK_ENABLED) console.log('[cron] Weekly outreach summary DM DISABLED (set OUTREACH_SUMMARY_SLACK_ENABLED=true to re-enable)');
if (!SEO_DIGEST_SLACK_ENABLED) console.log('[cron] SEO weekly digest DISABLED (set SEO_DIGEST_SLACK_ENABLED=true to re-enable)');

if (MORNING_BRIEFING_SLACK_ENABLED) cron.schedule('0 4 * * 1-6', () => safeCron('Morning Briefing', async () => {
  const { sendMorningBriefings } = await import('./services/morningBriefingService');
  const result = await sendMorningBriefings();
  console.log(`[CRON] Morning Briefing: ${result.sent} sent, ${result.errors.length} errors`);
}), { timezone: 'UTC' });
console.log('[cron] morning briefing scheduled — 9:30 AM IST Mon-Sat');

// Gated by SOD_EOD_SLACK_ENABLED (default OFF). The previous
// "PAUSED 2026-05-03 / re-enable by uncommenting" note was STALE — this cron
// was live and DMing people daily when the owner asked for it to be turned off.
/*
if (SOD_EOD_SLACK_ENABLED) cron.schedule('45 4 * * 1-6', async () => {
  await safeCron('SOD Digest', sendSODDigest);
  await safeCron('Sakcham Priority SOD', sendSakhamSOD);
}, { timezone: 'UTC' });
console.log('[cron] SOD digest scheduled — 10:15 AM IST Mon-Sat');
*/
console.log('[cron] SOD digest — PAUSED 2026-05-03');

// Gated by SOD_EOD_SLACK_ENABLED (default OFF). Previous PAUSED note was stale.
/*
if (SOD_EOD_SLACK_ENABLED) cron.schedule('45 13 * * 1-6', () => safeCron('EOD Summary', sendEODSummary), { timezone: 'UTC' });
console.log('[cron] EOD summary scheduled — 7:15 PM IST Mon-Sat');
*/
console.log('[cron] EOD summary — PAUSED 2026-05-03');

// Evening Summary — 7:15 PM IST (13:45 UTC), Mon-Sat — personalized DM per team member
if (SOD_EOD_SLACK_ENABLED) cron.schedule('45 13 * * 1-6', () => safeCron('Evening Summary', async () => {
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
if (SOD_EOD_SLACK_ENABLED) cron.schedule('45 4 * * 1-6', () => safeCron('Team SOD Prompt', sendTeamSODPrompt), { timezone: 'UTC' });
console.log('[cron] team SOD prompt scheduled — 10:15 AM IST Mon-Sat');

// EOD prompt — 7:00 PM IST (13:30 UTC) in #sod-eod, tags Kanishk/Kratika/Sneha
if (SOD_EOD_SLACK_ENABLED) cron.schedule('30 13 * * 1-6', () => safeCron('Team EOD Prompt', sendTeamEODPrompt), { timezone: 'UTC' });

// Contracts / e-signature — daily expiry sweep then signing reminders (see src/modules/esign/esign.jobs.ts)
cron.schedule('20 4 * * *', () => safeCron('Contract Expiry Sweep', async () => { await expireOverdueContracts(); }), { timezone: 'UTC' });
cron.schedule('40 4 * * *', () => safeCron('Contract Signing Reminders', async () => { await sendSigningReminders(); }), { timezone: 'UTC' });
console.log('[cron] team EOD prompt scheduled — 7:00 PM IST Mon-Sat');

// Social media posting prompt — 9:30 AM IST (04:00 UTC) in #social-media-posting,
// tags Kratika & Sneha so they list which brands need posting today.
// Gated by SOCIAL_PROMPT_SLACK_ENABLED (default OFF). Worth noting why the
// code gate is the only option here: sendSocialMediaPrompt posts with
// { allowDuringPause: true }, so SLACK_NOTIFICATIONS_PAUSED does NOT stop it.
if (SOCIAL_PROMPT_SLACK_ENABLED) cron.schedule('0 4 * * 1-6', () => safeCron('Social Media Prompt', sendSocialMediaPrompt), { timezone: 'UTC' });
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
//
// Tenant-feature-gated (PR: tenant feature gating) — replaces the old
// hardcoded `tenant_id = (SELECT id FROM tenants WHERE slug = DEFAULT_TENANT_SLUG)`
// subquery. Today only growth-escalators has the "gstBilling" feature
// enabled (see tenantFeatures.ts PLAN_DEFAULTS), so this resolves to the
// exact same tenant as before.
cron.schedule('30 4 * * *', () => safeCron('Overdue Invoice Check', async () => {
  const billingTenant = await getSingleActiveTenantWithFeature('gstBilling');
  if (!billingTenant) { console.log('[cron] overdue invoice check skipped — no tenant has gstBilling enabled'); return; }
  const overdueResult = await db.execute(sql`
    SELECT i.id, i.invoice_number, i.total_amount, i.due_date,
           bc.name as client_name
    FROM invoices i
    JOIN billing_clients bc ON bc.id = i.client_id
    WHERE i.status = 'sent'
      AND i.due_date < now()
      AND i.tenant_id = ${billingTenant.id}
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

// REMOVED — SEO Workflow Health (n8n-down alerting) and Workflow Self-Healing
// crons. Both polled n8n's API for failed executions of SEO workflows; n8n
// has since been decommissioned entirely (not just the SEO workflows — the
// whole instance is gone), so both crons could only ever report "n8n is
// DOWN" and had nothing left to heal. They were already PAUSED 2026-05-03
// for that reason and are now removed along with workflowSelfHealingService.ts.
// The 13 native src/services/seo* services are the replacement: each runs
// directly (see src/routes/seo.ts's BACKEND_SERVICES map and worker.ts's own
// SEO crons below/elsewhere), writes straight to Postgres, and its freshness
// is checked natively by intelligenceDataCollector.ts's
// collectSEOWorkflowHealth() — no n8n involved.
console.log('[cron] SEO workflow health check — removed (n8n decommissioned)');
console.log('[cron] workflow self-healing — removed (n8n decommissioned)');

// ---------------------------------------------------------------------------
// Growth OS — Brand Health Score — Daily 8:00 AM IST (2:30 UTC)
//
// Sweeps every tenant's active clients on purpose (see
// getActiveGrowthOSClients's comment). sendHealthScoreWhatsApp gates its own
// WhatsApp delivery to GE's own tenant (canSendGrowthOSWhatsApp in
// growthOSSetup.ts) — score calculation + save still run for every tenant.
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
import('./services/metaAdsService').then(m => m.ensureMarketingAccountsNotifySlackColumn()).catch(() => {});
if (META_ADS_REPORT_SLACK_ENABLED) cron.schedule('0 4 * * 1-6', () => safeCron('Meta Ads Daily Report', async () => {
  const { sendSlackMessage } = await import('./services/slackService');
  const { fetchAccountInsights, buildAccountReport, sortAccountsForReport } = await import('./services/metaAdsService');

  const token = process.env.META_ADS_TOKEN || process.env.META_ACCESS_TOKEN;
  if (!token) {
    await sendSlackMessage(SLACK_PERF_MARKETING_CHANNEL, '📊 *Meta Ads Daily Report*\n\n⚠️ META_ADS_TOKEN not configured — cannot fetch data.', undefined, { allowDuringPause: true });
    return;
  }

  // Source of truth: marketing_accounts (same table the /ads Accounts tab
  // reads). An account is included in the daily report only if it is
  //   is_active = true       — not pending-removed
  //   notify_slack = true     — admin hasn't paused Slack notifications
  // Both are flippable from the Accounts tab Actions column.
  //
  // marketing_accounts has no `currency` or `exchange_rate` columns (unlike
  // ad_accounts). All clients in this CRM run INR ad accounts, so we
  // hardcode the defaults in SQL — fetchAccountInsights treats currency=INR
  // / rate=1 as no-conversion. If a USD client is ever added, we'll need
  // to either alter the table or move conversion to a per-account override.
  const accounts = await pool.query(
    `SELECT
       CASE WHEN account_id LIKE 'act_%' THEN account_id ELSE 'act_' || account_id END AS account_id,
       COALESCE(client_name, account_name) AS client_name,
       'INR' AS currency,
       1 AS exchange_rate
     FROM marketing_accounts
     WHERE is_active = true AND COALESCE(notify_slack, true) = true
     ORDER BY account_name`,
  );
  if (accounts.rows.length === 0) {
    console.log('[CRON] Meta Ads: no active accounts with notify_slack=true');
    return;
  }

  const insights = [];
  for (const acct of accounts.rows as Array<{ account_id: string; client_name: string; currency: string; exchange_rate: number }>) {
    const data = await fetchAccountInsights(acct.account_id, token, acct.client_name, acct.currency, Number(acct.exchange_rate ?? 1));
    insights.push(data);
  }

  // ONE Slack message per active account, sorted highest-yesterday-spend
  // first so the most impactful accounts surface at the top of the channel
  // timeline. Small inter-message gap keeps order in Slack and stays well
  // under the post-rate ceiling.
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
// Same cross-tenant sweep + same WhatsApp-delivery-only gate as the health
// score cron above — see runCompetitorPulse -> sendCompetitorWhatsApp.
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
  // processed_at IS NULL is an indexed equality filter (events_type_processed_idx)
  // — cheap regardless of table size. It replaces a NOT EXISTS anti-join against
  // pipeline_contacts that had to re-scan every slo_purchase event ever recorded
  // on every run. Only stamped on a *successful* placement (below), so a
  // transient placePipelineContact failure still gets retried on the next tick —
  // same retry semantics as before, just an indexed instead of anti-join filter.
  const { rows } = await pool.query(`
      SELECT e.id, e.contact_id, e.payload, e.tenant_id
      FROM events e
      WHERE e.event_type = 'slo_purchase'
        AND e.contact_id IS NOT NULL
        AND e.processed_at IS NULL
      ORDER BY e.created_at ASC
      LIMIT 100
    `);

    if (rows.length === 0) return;

    console.log(`[CRON] Pipeline placement: processing ${rows.length} unplaced contact(s)`);
    for (const row of rows as Array<{ id: string; contact_id: string; payload: Record<string, unknown>; tenant_id: string }>) {
      const { id: eventId, contact_id, payload, tenant_id } = row;
      const segment = (payload.segment as string) || 'd2c';
      const amount  = typeof payload.amount === 'number' ? payload.amount : 9;
      const bump1   = Boolean(payload.bump1);
      const bump2   = Boolean(payload.bump2);
      const funnelSlug = (payload.funnelSlug as string) || 'ecom';
      try {
        const result = await placePipelineContact({ contactId: contact_id, segment, amount, bump1, bump2, tenantId: tenant_id, funnelSlug });
        if (result.success) {
          await pool.query(`UPDATE events SET processed_at = NOW() WHERE id = $1`, [eventId]).catch(e =>
            console.error('[CRON] Failed to stamp processed_at for event', eventId, ':', e)
          );
        } else {
          console.warn(`[CRON] Pipeline placement failed for ${contact_id} (${funnelSlug}) — delivering assets anyway`);
        }

        // Deliver purchase assets (WhatsApp + email) — HARD-DISABLED BY DEFAULT.
        //
        // Purchase delivery only runs when PURCHASE_DELIVERY_ENABLED === 'true'
        // (opt-in). After the mass-send incident it stays off unless deliberately
        // turned on — so a fresh deploy / re-enabled jobs can never repeat it.
        // Even when enabled, `backfilled: true` events (historical purchases the
        // backfill stamps for pipeline placement) are never delivered — those
        // people already received their asset when they actually bought.
        // (deliverPurchaseAssets ALSO enforces the flag at its source.)
        const deliveryEnabled = process.env.PURCHASE_DELIVERY_ENABLED === 'true';
        const isBackfilled = (payload as { backfilled?: boolean })?.backfilled === true;
        if (!deliveryEnabled || isBackfilled) {
          console.log(
            `[CRON] Asset delivery skipped for ${contact_id} — ${!deliveryEnabled ? 'PURCHASE_DELIVERY_ENABLED not set (hard-disabled)' : 'backfilled/historical purchase'}`,
          );
        } else {
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
// SEO CRON BLOCK — every cron below sweeps PER TENANT.
//
// They used to call the service with no arguments, and the service resolved its
// tenant internally via resolveDefaultSeoTenantId(). That resolver throws the
// moment a SECOND active tenant has `seo: true`, because
// getSingleActiveTenantWithFeature refuses to guess who owns the data (it
// exists because a reseller tenant once silently stole GE's own inbound leads).
//
// The consequence was a live tripwire on the sale path: enabling the SEO add-on
// for one reseller would have killed every SEO cron for EVERY tenant, including
// Growth Escalators' own, with no code change to point at. Selling the feature
// would have broken the feature.
//
// So each cron now loops via forEachSeoTenant(), which isolates per-tenant
// failures — one tenant's expired Google token must not skip every tenant after
// it in the list — and each service takes the tenant id explicitly. Nothing in
// this block reaches resolveDefaultSeoTenantId() any more. That is asserted by
// a test; see src/__tests__/seoCronTenantSweep.test.ts.
//
// Partial failures are recorded as partial (status 'error' on the workflow row,
// successes kept) and only a TOTAL failure rethrows, so safeCron's alerting
// still fires when nothing worked at all.
// ---------------------------------------------------------------------------

/**
 * Runs one SEO cron body once per SEO-enabled tenant, writing ONE
 * seo_workflow_logs row per tenant.
 *
 * Per-tenant rows rather than one aggregate row: seo_workflow_logs.tenant_id is
 * populated now, and "the Backlink Monitor failed" is not an actionable alert
 * once two agencies run it — "it failed for tenant X" is. An aggregate row
 * would also have to pick one status for a run where one tenant succeeded and
 * another failed, and there is no honest answer to that.
 *
 * `countOf` extracts the per-tenant "records processed" number from whatever
 * the service returns, so each caller keeps its own notion of what it counted.
 */
async function seoTenantSweep<T>(
  workflow: { workflowId: string; workflowName: string },
  fn: (tenantId: string) => Promise<T>,
  countOf: (value: T) => number,
  describe: (value: T) => string,
): Promise<void> {
  const { forEachSeoTenant } = await import('./services/seoTenantContext');
  const { logSeoWorkflowRun } = await import('./services/seoWorkflowHealthService');

  const sweep = await forEachSeoTenant(workflow.workflowName, async (tenantId) => {
    // Started/finished are measured per tenant, not across the whole sweep —
    // otherwise the last tenant's row claims a duration covering everyone.
    const startedAt = new Date();
    try {
      const value = await fn(tenantId);
      console.log(`[CRON] ${workflow.workflowName} (tenant ${tenantId}): ${describe(value)}`);
      await logSeoWorkflowRun({
        ...workflow, status: 'success', startedAt, tenantId,
        recordsProcessed: countOf(value),
      });
      return value;
    } catch (e) {
      await logSeoWorkflowRun({
        ...workflow, status: 'error', startedAt, tenantId,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
      throw e; // forEachSeoTenant catches it, records the failure, and continues
    }
  });

  if (sweep.failed > 0 && sweep.succeeded === 0) {
    // Total failure — indistinguishable from the old single-tenant behaviour,
    // so rethrow and let safeCron alert exactly as it always did.
    throw new Error(
      `[CRON] ${workflow.workflowName} failed for all ${sweep.failed} tenant(s): ` +
      sweep.results.map((r) => (r.ok ? '' : r.error.message)).filter(Boolean).join('; '),
    );
  }
  if (sweep.failed > 0) {
    console.warn(
      `[CRON] ${workflow.workflowName}: PARTIAL — ${sweep.succeeded} tenant(s) succeeded, ${sweep.failed} failed`,
    );
  }
}

/**
 * True only for the tenant whose humans the fixed SEO notification destinations
 * actually belong to.
 *
 * The SEO digest posts to SLACK_SEO_CHANNEL and the weekly email goes to a
 * hardcoded jatin@growthescalators.com — neither destination is per-tenant.
 * So sweeping those two crons across every SEO tenant would not deliver a
 * reseller their own report; it would deliver THEIR data into GE's Slack
 * channel and inbox, once per tenant.
 *
 * Both crons are env-gated off today (SEO_DIGEST_SLACK_ENABLED,
 * AUTOMATED_EMAILS_ENABLED), so nothing is being sent right now. This guard
 * exists so that turning either flag on later does not quietly start shipping a
 * reseller's data to GE — it fails closed instead, and says why.
 *
 * Remove this once recipients are resolved per tenant (a tenant_integrations
 * Slack channel + a per-tenant report recipient). Until then the honest
 * behaviour is "GE gets its report, resellers get nothing", not "everyone's
 * report goes to GE".
 */
async function seoNotificationTenantAllowed(tenantId: string, cronName: string): Promise<boolean> {
  const { getDefaultIngestTenant } = await import('./services/tenantFeatures');
  const geTenant = await getDefaultIngestTenant('seo');
  if (geTenant && geTenant.id === tenantId) return true;
  console.warn(
    `[CRON] ${cronName}: skipping tenant ${tenantId} — SEO notification destinations ` +
    '(Slack channel, email recipient) are not per-tenant yet, and sending would deliver ' +
    "this tenant's data to Growth Escalators' own channel/inbox rather than to them.",
  );
  return false;
}

// SEO Weekly Email — Thursday 10:30 AM IST (5:00 UTC)
cron.schedule('0 5 * * 4', () => safeCron('SEO Weekly Email', async () => {
  if (isPaused('seo')) return;
  const { sendSEOWeeklyEmail } = await import('./services/seoWeeklyEmailService');
  const { forEachSeoTenant } = await import('./services/seoTenantContext');
  // One email per tenant. Never a merged send — a single email carrying two
  // tenants' SEO data is a data leak, not a formatting problem.
  //
  // The recipient is still a fixed GE address, so the guard skips every tenant
  // whose report would land in the wrong inbox. See its docblock.
  const sweep = await forEachSeoTenant('SEO Weekly Email', async (tenantId) => {
    if (!(await seoNotificationTenantAllowed(tenantId, 'SEO Weekly Email'))) return;
    await sendSEOWeeklyEmail(tenantId);
  });
  if (sweep.failed > 0 && sweep.succeeded === 0) {
    throw new Error(`[CRON] SEO Weekly Email failed for all ${sweep.failed} tenant(s)`);
  }
}), { timezone: 'UTC' });
console.log('[cron] SEO weekly email scheduled — Thursdays 10:30 AM IST');

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// SEO GSC Pull — Monday 8:15 AM IST (2:45 UTC)
//
// REPLACES the old 'GE SEO Pull', which spawned `npx tsx scripts/ge-seo-pull.ts`
// as a subprocess and wrote docs/seo/state/growthescalators.{json,md} to the
// container's local filesystem. Three things were wrong with that, in order:
//
//   1. Railway's filesystem is EPHEMERAL — wiped on every deploy and restart —
//      so the data was routinely gone before anyone read it, and there was no
//      history at all.
//   2. It was hardcoded to one property (growthescalators.com), so it could
//      never work for a second tenant. That is the whole product now.
//   3. Spawning `npx tsx` from a worker needs devDependencies present at
//      runtime and gives no typed errors — a failure surfaced as stderr text.
//
// Now an importable service writing to Postgres, per tenant via
// seoTenantSweep like every other SEO cron. GA4 is a SEPARATE cron (see
// 'SEO GA4 Pull' immediately below): they were one job, so a GA4 failure
// discarded the GSC data that had already been fetched.
//
// scripts/ge-seo-pull.ts is intentionally left in place — it still works as a
// manual CLI (`npm run ge:seo`) and deleting it is not this change.
// ---------------------------------------------------------------------------
cron.schedule('45 2 * * 1', () => safeCron('SEO GSC Pull', async () => {
  if (isPaused('seo')) return;
  const { runSeoSearchConsolePull } = await import('./services/seoSearchConsoleService');
  await seoTenantSweep(
    { workflowId: 'seo-gsc-pull', workflowName: 'SEO GSC Pull' },
    (tenantId) => runSeoSearchConsolePull(tenantId),
    (r) => r.rows,
    (r) => `${r.sites} sites, ${r.rows} rows, ${r.errors} errors`,
  );
}), { timezone: 'UTC' });
console.log('[cron] SEO GSC pull scheduled — Mondays 8:15 AM IST (2:45 UTC)');

// ---------------------------------------------------------------------------
// SEO GA4 Pull — Monday 8:45 AM IST (3:15 UTC), 30 min after the GSC pull
//
// A SEPARATE cron from the GSC pull, which is the whole point. In the legacy
// scripts/ge-seo-pull.ts these were one job that fetched both and wrote at the
// end, so a GA4 failure discarded Search Console data that had already been
// fetched successfully. Splitting them means each survives the other failing.
//
// Runs AFTER the GSC pull rather than alongside it: both write the same
// (site, week) row of seo_weekly_metrics — GSC owns clicks/impressions, GA4
// owns sessions — and each merges into the other's row rather than adding a
// second one. The order is not required for correctness (both writers do
// UPDATE-then-INSERT, in either direction), but staggering avoids two
// concurrent writers racing to create the same row.
// ---------------------------------------------------------------------------
cron.schedule('15 3 * * 1', () => safeCron('SEO GA4 Pull', async () => {
  if (isPaused('seo')) return;
  const { runSeoAnalyticsPull } = await import('./services/seoAnalyticsService');
  await seoTenantSweep(
    { workflowId: 'seo-ga4-pull', workflowName: 'SEO GA4 Pull' },
    (tenantId) => runSeoAnalyticsPull(tenantId),
    (r) => r.rows,
    (r) => `${r.sites} sites, ${r.rows} rows, ${r.errors} errors`,
  );
}), { timezone: 'UTC' });
console.log('[cron] SEO GA4 pull scheduled — Mondays 8:45 AM IST (3:15 UTC)');

// ---------------------------------------------------------------------------
// Task 7: Weekly Outreach Performance Summary — Monday 8:00 AM IST (2:30 UTC)
// Posts pipeline stats + reply activity to Jatin's Slack DM
// ---------------------------------------------------------------------------
// Gated by OUTREACH_SUMMARY_SLACK_ENABLED (default OFF). Pure Slack — the
// summary is computed for the message and nothing else, so gating the whole
// cron loses no data.
if (OUTREACH_SUMMARY_SLACK_ENABLED) cron.schedule('30 2 * * 1', () => safeCron('Weekly Outreach Summary', async () => {
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
  const { runPageSpeedChecks } = await import('./services/pagespeedService');
  await seoTenantSweep(
    { workflowId: 'z21W6MDWBF0dukkT', workflowName: 'PageSpeed Monitor' },
    (tenantId) => runPageSpeedChecks(tenantId),
    (r) => r.checked,
    (r) => `${r.checked} checked, ${r.errors} errors`,
  );
}), { timezone: 'UTC' });
console.log('[cron] PageSpeed monitor scheduled — Sundays 7:30 AM IST');

// RE-ENABLED 2026-07 (seo-learning-loop) — Serper calls now go through
// the per-tenant Serper cost guard (guardedSerperCall, seoSerperGuard.ts) before this fires.
cron.schedule('30 3 * * 2', () => safeCron('Rank Tracking', async () => {
  const { runRankChecks } = await import('./services/rankTrackingService');
  await seoTenantSweep(
    { workflowId: 'BwO187curjMMA60i', workflowName: 'Rank Tracking' },
    (tenantId) => runRankChecks(tenantId),
    (r) => r.checked,
    (r) => `${r.checked} keywords checked, ${r.errors} errors`,
  );
}), { timezone: 'UTC' });
console.log('[cron] Rank tracking scheduled — Tuesdays 9:00 AM IST (Serper.dev)');

// ---------------------------------------------------------------------------
// SEO Drift Sweep — Daily 7:30 AM IST (2:00 UTC)
//
// Reads each tracked page as a crawler would and compares it to the last
// snapshot. This is the detector for "the client edited the page behind the
// agency's back" — the failure an agency cannot otherwise see until rankings
// have already stalled for months.
//
// Scheduled BEFORE the other SEO crons, not after: rank tracking and content
// decay both reason about pages that are assumed live and unchanged, so a
// sweep that runs first means those jobs work against a set whose drift is
// already known rather than one nobody has checked today.
//
// Per-tenant via seoTenantSweep like every other SEO cron — runSeoDriftSweep
// is single-tenant per call by convention (the service takes an optional
// tenantId; the fan-out lives here, which is what keeps
// resolveDefaultSeoTenantId out of the cron block — see
// src/__tests__/seoCronTenantSweep.test.ts).
// ---------------------------------------------------------------------------
cron.schedule('0 2 * * *', () => safeCron('SEO Drift Sweep', async () => {
  if (isPaused('seo')) return;
  const { runSeoDriftSweep } = await import('./services/siteDriftService');
  await seoTenantSweep(
    { workflowId: 'seo-drift-sweep', workflowName: 'SEO Drift Sweep' },
    (tenantId) => runSeoDriftSweep(tenantId),
    (r) => r.drifts,
    (r) => `${r.sites} sites, ${r.urls} urls, ${r.drifts} drifts, ${r.alerts} alerts, ${r.errors} errors`,
  );
}), { timezone: 'UTC' });
console.log('[cron] SEO drift sweep scheduled — daily 7:30 AM IST');

// SEO Alert Triggers — Daily 9 AM IST (3:30 UTC) — runs directly (no n8n dependency)
cron.schedule('30 3 * * *', () => safeCron('SEO Alert Triggers', async () => {
  if (isPaused('seo')) return;
  const { runSeoAlertChecks } = await import('./services/seoAlertService');
  await seoTenantSweep(
    { workflowId: '5FVX2kEjuD7vWD0e', workflowName: 'Alert Triggers' },
    (tenantId) => runSeoAlertChecks(tenantId),
    (r) => r.alerts,
    (r) => `${r.alerts} alerts generated`,
  );
}), { timezone: 'UTC' });
console.log('[cron] SEO alert triggers scheduled — daily 9:00 AM IST (backend-native)');

// RE-ENABLED 2026-07 (seo-learning-loop) — Serper calls now go through
// the per-tenant Serper cost guard (guardedSerperCall, seoSerperGuard.ts) before this fires.
cron.schedule('30 3 * * 5', () => safeCron('SEO Backlink Monitor', async () => {
  const { runBacklinkCheck } = await import('./services/seoBacklinkService');
  await seoTenantSweep(
    { workflowId: '19R3BStSY2S1N9H1', workflowName: 'Backlink Monitor' },
    (tenantId) => runBacklinkCheck(tenantId),
    (r) => r.found,
    (r) => `${r.found} new backlinks, ${r.errors} errors`,
  );
}), { timezone: 'UTC' });
console.log('[cron] SEO backlink monitor scheduled — Fridays 9:00 AM IST (backend-native)');

// RE-ENABLED 2026-07 (seo-learning-loop) — content decay reads keyword_rankings
// (no direct Serper call), unaffected by the cap but re-enabled alongside its
// upstream (Rank Tracking above) so decay detection has fresh data to work from.
cron.schedule('30 3 * * 1', () => safeCron('SEO Content Decay', async () => {
  const { runContentDecayDetection } = await import('./services/seoContentDecayService');
  await seoTenantSweep(
    { workflowId: 'Ss2Bfps5lXBWUUs4', workflowName: 'Content Decay Detection' },
    (tenantId) => runContentDecayDetection(tenantId),
    (r) => r.opportunities,
    (r) => `${r.opportunities} decay opportunities found`,
  );
}), { timezone: 'UTC' });
console.log('[cron] SEO content decay scheduled — Every Monday 9:00 AM IST (backend-native)');

// SEO Weekly Opportunity Digest — Friday 5 PM IST (11:30 UTC) — sends via Slack directly
// Gated by SEO_DIGEST_SLACK_ENABLED (default OFF). sendWeeklyOpportunityDigest
// only reads — every write it does (logSeoWorkflowRun) exists to record that the
// digest was sent, so gating the cron loses nothing but the message itself.
if (SEO_DIGEST_SLACK_ENABLED) cron.schedule('30 11 * * 5', () => safeCron('SEO Weekly Digest', async () => {
  if (isPaused('seo')) return;
  const { sendWeeklyOpportunityDigest } = await import('./services/seoDigestService');
  // One digest per tenant. A merged digest would put two agencies' opportunity
  // lists in the same Slack message.
  await seoTenantSweep(
    { workflowId: 'M4rbRZL5jh0jJHku', workflowName: 'Weekly Opportunity Digest' },
    async (tenantId) => {
      // Posts to a fixed GE Slack channel, so skip any tenant whose digest
      // would land in the wrong place. See seoNotificationTenantAllowed.
      if (!(await seoNotificationTenantAllowed(tenantId, 'SEO Weekly Digest'))) {
        return { sent: false, skipped: true };
      }
      const result = await sendWeeklyOpportunityDigest(tenantId);
      // A false `sent` is a failure, not a quiet success — throw so this
      // tenant's row records 'error' and the sweep counts it as failed.
      if (!result.sent) throw new Error('Slack send failed');
      return { ...result, skipped: false };
    },
    (r) => (r.skipped ? 0 : 1),
    (r) => (r.skipped ? 'skipped (no per-tenant Slack destination)' : 'sent'),
  );
}), { timezone: 'UTC' });
console.log('[cron] SEO weekly digest scheduled — Fridays 5:00 PM IST (backend-native)');

// GSC "Request Indexing" reminder — Fridays 12:30 PM IST (7:00 UTC).
// There is no supported API for requesting indexing on ordinary pages, so this
// never calls Google — it syncs the queue from the live sitemap (diffed against
// GSC top-pages, a proxy for "already indexed"), then DMs Jatin a small batch to
// click through by hand in the real GSC UI. See seoIndexingQueueService.ts.
cron.schedule('0 7 * * 5', () => safeCron('SEO Indexing Reminder', async () => {
  if (isPaused('seo')) return;
  const { sendIndexingReminderDigest } = await import('./services/seoIndexingQueueService');
  const { forEachSeoTenant } = await import('./services/seoTenantContext');
  // No seo_workflow_logs row for this one — it never had one, and adding one
  // here would make it look like a workflow the health page tracks when it is
  // really a Slack nudge. Kept as a plain sweep.
  const sweep = await forEachSeoTenant('SEO Indexing Reminder', async (tenantId) => {
    const result = await sendIndexingReminderDigest(tenantId);
    console.log(`[CRON] SEO Indexing Reminder (tenant ${tenantId}): ${result.sent ? `sent (${result.count} URLs, ${result.pendingTotal} pending total)` : 'skipped (nothing due)'}`);
    return result;
  });
  if (sweep.failed > 0 && sweep.succeeded === 0) {
    throw new Error(`[CRON] SEO Indexing Reminder failed for all ${sweep.failed} tenant(s)`);
  }
}), { timezone: 'UTC' });
console.log('[cron] SEO indexing reminder scheduled — Fridays 12:30 PM IST (backend-native)');

// Competitor Content Analysis — 1st and 15th of each month at 9:00 AM IST (3:30 UTC)
cron.schedule('30 3 1,15 * *', () => safeCron('Competitor Content Analysis', async () => {
  if (isPaused('seo')) return;
  const { runCompetitorContentAnalysis } = await import('./services/competitorContentService');
  await seoTenantSweep(
    { workflowId: 'competitor-content-analysis', workflowName: 'Competitor Content Analysis' },
    (tenantId) => runCompetitorContentAnalysis(tenantId),
    (r) => r.analyzed,
    (r) => `${r.analyzed} keywords analyzed, ${r.errors} errors`,
  );
}), { timezone: 'UTC' });
console.log('[cron] Competitor content analysis scheduled — 1st & 15th of month at 9:00 AM IST');

// RE-ENABLED 2026-07 (seo-learning-loop) — Serper calls now go through
// the per-tenant Serper cost guard (guardedSerperCall, seoSerperGuard.ts) before this fires.
cron.schedule('30 4 15 * *', () => safeCron('SEO Content Gap Analysis', async () => {
  const { runContentGapAnalysis } = await import('./services/seoContentGapService');
  await seoTenantSweep(
    { workflowId: 'seo-content-gap-analysis', workflowName: 'SEO Content Gap Analysis' },
    (tenantId) => runContentGapAnalysis(tenantId),
    (r) => r.opportunities,
    (r) => `${r.gaps} gaps, ${r.opportunities} opportunities`,
  );
}), { timezone: 'UTC' });
console.log('[cron] SEO content gap analysis scheduled — 15th of month at 10:00 AM IST');

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

// ===========================================================================
// WIZMATCH STAFFING MODULE CRONS
// HTTP/DB-only jobs (no browser/Python — those run in GitHub Actions)
// ===========================================================================

const wizmatchAutomation = getWizmatchAutomationStatus();

if (wizmatchAutomation.masterEnabled) {
  if (wizmatchAutomation.legacyAutomationEnabled) {

  // Signal scoring — every 30 minutes, cap 50/run (pure TS, $0)
  // Calls scoreSignalById in-process instead of an HTTPS self-request to the public
  // API. No network hop, no global rate-limiter contention, and a hung/failed signal
  // can no longer silently wedge the batch — each is isolated by the per-signal catch.
  //
  // Tenant-feature-gated (PR: tenant feature gating) — every cron in this
  // block used to read `process.env.WIZMATCH_TENANT_ID!` directly, hardcoding
  // automation to a single tenant. They now loop over
  // getActiveTenantsWithFeature('wizmatch'), which today resolves to exactly
  // the one tenant WIZMATCH_TENANT_ID used to point at (see
  // tenantFeatures.ts PLAN_DEFAULTS) — a second tenant onboarding Wizmatch
  // would now run these crons too, without a code change here.
  cron.schedule('*/30 * * * *', () => safeCron('Wizmatch Signal Scoring', async () => {
    const { scoreSignalById } = await import('./services/wizmatchSignalPipeline');
    for (const { id: tenantId } of await getActiveTenantsWithFeature('wizmatch')) {
      const signals = await pool.query(
        `SELECT id FROM wizmatch_job_signals WHERE tenant_id = $1 AND status = 'new' LIMIT 50`,
        [tenantId],
      );
      for (const s of signals.rows) {
        try {
          await scoreSignalById(tenantId, s.id);
        } catch (e) { console.error('[CRON] wizmatch score failed for', s.id, e); }
      }
      if (signals.rows.length > 0) console.log(`[CRON] Wizmatch: scored ${signals.rows.length} signals (tenant ${tenantId})`);
    }
  }), { timezone: 'UTC' });
  console.log('[cron] Wizmatch signal scoring scheduled — every 30 minutes');

  // Enrichment — every hour, cap 20/run
  cron.schedule('0 * * * *', () => safeCron('Wizmatch Enrichment', async () => {
    const { enrichSignalById } = await import('./services/wizmatchSignalPipeline');
    for (const { id: tenantId } of await getActiveTenantsWithFeature('wizmatch')) {
      const signals = await pool.query(
        `SELECT id FROM wizmatch_job_signals WHERE tenant_id = $1 AND score >= 7 AND contact_id IS NULL AND status = 'scored' LIMIT 20`,
        [tenantId],
      );
      for (const s of signals.rows) {
        try {
          await enrichSignalById(tenantId, s.id);
        } catch (e) { console.error('[CRON] wizmatch enrich failed for', s.id, e); }
      }
      if (signals.rows.length > 0) console.log(`[CRON] Wizmatch: enriched ${signals.rows.length} signals (tenant ${tenantId})`);
    }
  }), { timezone: 'UTC' });
  console.log('[cron] Wizmatch enrichment scheduled — every hour');

  // Candidate matching — every 2 hours, cap 30/run (pure SQL+TS, $0)
  cron.schedule('0 */2 * * *', () => safeCron('Wizmatch Matching', async () => {
    const { matchSignalById } = await import('./services/wizmatchSignalPipeline');
    for (const { id: tenantId } of await getActiveTenantsWithFeature('wizmatch')) {
      const signals = await pool.query(
        `SELECT id FROM wizmatch_job_signals WHERE tenant_id = $1 AND status = 'enriched' LIMIT 30`,
        [tenantId],
      );
      for (const s of signals.rows) {
        try {
          await matchSignalById(tenantId, s.id);
        } catch (e) { console.error('[CRON] wizmatch match failed for', s.id, e); }
      }
      if (signals.rows.length > 0) console.log(`[CRON] Wizmatch: matched ${signals.rows.length} signals (tenant ${tenantId})`);
    }
  }), { timezone: 'UTC' });
  console.log('[cron] Wizmatch matching scheduled — every 2 hours');

  // Domain health monitor — every hour
  cron.schedule('0 * * * *', () => safeCron('Wizmatch Domain Health', async () => {
    const { runWizmatchDomainHealthCheck } = await import('./services/wizmatchDomainHealthService');
    for (const { id: tenantId } of await getActiveTenantsWithFeature('wizmatch')) {
      const result = await runWizmatchDomainHealthCheck(tenantId);
      const alertStatus = result.alertSent ? ', alert sent' : result.alertThrottled ? ', alert throttled' : '';
      console.log(`[CRON] Wizmatch domain health (tenant ${tenantId}): checked ${result.checked} domains (${result.healthy} healthy, ${result.warn} warn${alertStatus})`);
    }
  }), { timezone: 'UTC' });
  console.log('[cron] Wizmatch domain health scheduled — every hour');

  // Domain warmup — every 6 hours
  cron.schedule('0 */6 * * *', () => safeCron('Wizmatch Domain Warmup', async () => {
    const warmupContacts = (process.env.WIZMATCH_WARMUP_CONTACTS || '').split(',').filter(Boolean);
    if (warmupContacts.length === 0) return;
    const { sendWarmupEmails } = await import('./services/multiDomainMailer');
    for (const { id: tenantId } of await getActiveTenantsWithFeature('wizmatch')) {
      const result = await sendWarmupEmails(tenantId, warmupContacts);
      console.log(`[CRON] Wizmatch warmup (tenant ${tenantId}): ${result?.sent || 0}/${result?.total || 0} sent`);
    }
  }), { timezone: 'UTC' });
  console.log('[cron] Wizmatch domain warmup scheduled — every 6 hours');

  // ATS Poller — daily 6 AM IST (0:30 UTC)
  cron.schedule('30 0 * * *', () => safeCron('Wizmatch ATS Poller', async () => {
    const { pollAtsBoards } = await import('./services/wizmatchAtsPoller');
    const result = await pollAtsBoards();
    if (result.jobs_inserted > 0 && WIZMATCH_LEADS_CHANNEL) {
      const { sendSlackMessage } = await import('./services/slackService');
      await sendSlackMessage(WIZMATCH_LEADS_CHANNEL,
        `📋 ATS Poller: ${result.jobs_inserted} new jobs from ${result.companies_polled} companies`,
        undefined,
        { allowDuringPause: true }, // new hiring-company signals — client-acquisition alert
      ).catch(() => {});
    }
  }), { timezone: 'UTC' });
  console.log('[cron] Wizmatch ATS poller scheduled — daily 6 AM IST');

  // X-Ray candidate scraper — daily 8 AM IST (2:30 UTC)
  cron.schedule('30 2 * * *', () => safeCron('Wizmatch X-Ray Scraper', async () => {
    const { runXrayScrape } = await import('./services/wizmatchXrayScraper');
    const result = await runXrayScrape(3);
    if (result.candidates_created > 0 && WIZMATCH_LEADS_CHANNEL) {
      const { sendSlackMessage } = await import('./services/slackService');
      await sendSlackMessage(WIZMATCH_LEADS_CHANNEL,
        `🔍 X-Ray: ${result.candidates_created} new candidates sourced from LinkedIn`,
      ).catch(() => {});
    }
  }), { timezone: 'UTC' });
  console.log('[cron] Wizmatch X-ray scraper scheduled — daily 8 AM IST');

  // GitHub miner — daily 9 AM IST (3:30 UTC)
  cron.schedule('30 3 * * *', () => safeCron('Wizmatch GitHub Miner', async () => {
    const { mineGithubCandidates } = await import('./services/wizmatchGithubMiner');
    const result = await mineGithubCandidates(3);
    if (result.candidates_created > 0 && WIZMATCH_LEADS_CHANNEL) {
      const { sendSlackMessage } = await import('./services/slackService');
      await sendSlackMessage(WIZMATCH_LEADS_CHANNEL,
        `💻 GitHub Miner: ${result.candidates_created} new candidates sourced`,
      ).catch(() => {});
    }
  }), { timezone: 'UTC' });
  console.log('[cron] Wizmatch GitHub miner scheduled — daily 9 AM IST');

  // LCA importer — weekly Sunday 10 PM IST (16:30 UTC)
  cron.schedule('30 16 * * 0', () => safeCron('Wizmatch LCA Importer', async () => {
    const { importLcaData } = await import('./services/wizmatchLcaImporter');
    const result = await importLcaData();
    if (WIZMATCH_SYSTEM_CHANNEL) {
      const { sendSlackMessage } = await import('./services/slackService');
      await sendSlackMessage(WIZMATCH_SYSTEM_CHANNEL,
        `📊 LCA Import: ${result.records_processed} records, ${result.companies_updated} companies updated with H-1B data`,
      ).catch(() => {});
    }
  }), { timezone: 'UTC' });
  console.log('[cron] Wizmatch LCA importer scheduled — weekly Sunday 10 PM IST');

  // RemoteOK importer — daily 7 AM IST (1:30 UTC). Free JSON feed, remote tech/contract roles.
  cron.schedule('30 1 * * *', () => safeCron('Wizmatch RemoteOK Importer', async () => {
    const { importRemoteOkJobs } = await import('./services/wizmatchRemoteOkImporter');
    const result = await importRemoteOkJobs();
    if (result.inserted > 0 && WIZMATCH_LEADS_CHANNEL) {
      const { sendSlackMessage } = await import('./services/slackService');
      await sendSlackMessage(WIZMATCH_LEADS_CHANNEL,
        `🌐 RemoteOK: ${result.inserted} new remote job signals`,
        undefined,
        { allowDuringPause: true }, // client-acquisition demand signal
      ).catch(() => {});
    }
  }), { timezone: 'UTC' });
  console.log('[cron] Wizmatch RemoteOK importer scheduled — daily 7 AM IST');

  // TheirStack importer — weekly Monday 7 AM IST (1:30 UTC). India demand incl. Naukri.
  // Dormant unless THEIRSTACK_API_KEY is set; weekly + tight cap respects the free tier.
  cron.schedule('30 1 * * 1', () => safeCron('Wizmatch TheirStack Importer', async () => {
    const { importTheirStackJobs, isTheirStackEnabled } = await import('./services/wizmatchTheirStackImporter');
    if (!isTheirStackEnabled()) return;
    const result = await importTheirStackJobs();
    if (result.inserted > 0 && WIZMATCH_LEADS_CHANNEL) {
      const { sendSlackMessage } = await import('./services/slackService');
      await sendSlackMessage(WIZMATCH_LEADS_CHANNEL,
        `🇮🇳 TheirStack: ${result.inserted} new India job signals`,
        undefined,
        { allowDuringPause: true }, // client-acquisition demand signal
      ).catch(() => {});
    }
  }), { timezone: 'UTC' });
  console.log('[cron] Wizmatch TheirStack importer scheduled — weekly Monday 7 AM IST (dormant without key)');

  // Daily digest — 6 PM IST (12:30 UTC)
  cron.schedule('30 12 * * 1-6', () => safeCron('Wizmatch Daily Digest', async () => {
    const { WIZMATCH_DAILY_CHANNEL } = await import('./config/constants');
    const { sendSlackMessage } = await import('./services/slackService');
    const today = new Date().toISOString().slice(0, 10);

    for (const { id: tenantId } of await getActiveTenantsWithFeature('wizmatch')) {
      const stats = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM wizmatch_job_signals WHERE tenant_id = $1 AND created_at::date = $2) AS signals,
           (SELECT COUNT(*)::int FROM wizmatch_job_signals WHERE tenant_id = $1 AND created_at::date = $2 AND score >= 7) AS priority,
           (SELECT COUNT(*)::int FROM messages WHERE tenant_id = $1 AND sent_at::date = $2 AND channel = 'email' AND direction = 'outbound') AS sends,
           (SELECT COUNT(*)::int FROM wizmatch_job_signals WHERE tenant_id = $1 AND status = 'replied_positive' AND updated_at::date = $2) AS positive_replies,
           (SELECT COUNT(*)::int FROM wizmatch_candidates WHERE tenant_id = $1 AND created_at::date = $2) AS candidates
        `,
        [tenantId, today],
      );
      const s = stats.rows[0] || {};

      if (WIZMATCH_DAILY_CHANNEL) {
        await sendSlackMessage(WIZMATCH_DAILY_CHANNEL,
          `📊 *Wizmatch Daily Digest — ${today}*\n\n` +
          `Signals: ${s.signals || 0} (${s.priority || 0} priority)\n` +
          `Sends: ${s.sends || 0}\n` +
          `Positive replies: ${s.positive_replies || 0}\n` +
          `Candidates sourced: ${s.candidates || 0}`,
        ).catch(() => {});
      }
      console.log(`[CRON] Wizmatch daily digest sent (tenant ${tenantId})`);
    }
  }), { timezone: 'UTC' });
  console.log('[cron] Wizmatch daily digest scheduled — 6 PM IST Mon-Sat');

  } else {
    console.log('[cron] Wizmatch legacy automation skipped (WIZMATCH_LEGACY_AUTOMATION_ENABLED is off)');
  }

  // Results-first sourcing is isolated from the broad legacy block. These jobs
  // only ingest reviewable demand signals; they never send or submit anything.
  if (wizmatchAutomation.sourcing.theirstackEnabled) {
    cron.schedule('35 1 * * 1,4', () => safeCron('Wizmatch TheirStack Results-First Importer', async () => {
      const { importTheirStackJobs } = await import('./services/wizmatchTheirStackImporter');
      const { withWizmatchSourceLock } = await import('./services/wizmatchSourcing');
      for (const { id: tenantId } of await getActiveTenantsWithFeature('wizmatch')) {
        const result = await withWizmatchSourceLock(tenantId, 'theirstack', () => importTheirStackJobs({ trigger: 'scheduled' }));
        if (!result) { console.log(`[CRON] Wizmatch TheirStack sourcing skipped (tenant ${tenantId}) — another run holds the lock`); continue; }
        console.log(`[CRON] Wizmatch TheirStack sourcing (tenant ${tenantId}): ${result.inserted} new, ${result.updated} updated, ${result.errors} errors`);
      }
    }), { timezone: 'UTC' });
    console.log('[cron] Wizmatch TheirStack results-first importer scheduled — 7:05 AM IST Mon/Thu');
  } else {
    console.log('[cron] Wizmatch TheirStack results-first importer skipped');
  }

  if (wizmatchAutomation.sourcing.atsEnabled) {
    cron.schedule('40 0 * * *', () => safeCron('Wizmatch ATS Results-First Poller', async () => {
      const { pollAtsBoards } = await import('./services/wizmatchAtsPoller');
      const { withWizmatchSourceLock } = await import('./services/wizmatchSourcing');
      for (const { id: tenantId } of await getActiveTenantsWithFeature('wizmatch')) {
        const result = await withWizmatchSourceLock(tenantId, 'ats', () => pollAtsBoards({ trigger: 'scheduled' }));
        if (!result) { console.log(`[CRON] Wizmatch ATS sourcing skipped (tenant ${tenantId}) — another run holds the lock`); continue; }
        console.log(`[CRON] Wizmatch ATS sourcing (tenant ${tenantId}): ${result.jobs_inserted} new, ${result.jobs_updated} updated, ${result.errors} errors`);
      }
    }), { timezone: 'UTC' });
    console.log('[cron] Wizmatch ATS results-first poller scheduled — 6:10 AM IST daily');
  } else {
    console.log('[cron] Wizmatch ATS results-first poller skipped');
  }

  // PRD-005 PR 7 §14 — zero-cost company preparation. Strictly ₹0: reuses
  // existing free discovery/scoring only, never calls SearchAPI/Apollo/Snov,
  // never sends, never enrols. Advisory-locked per tenant via the same
  // withWizmatchSourceLock helper as the sourcing jobs above.
  if (wizmatchAutomation.autoPrepEnabled) {
    cron.schedule('15 2 * * *', () => safeCron('Wizmatch Company Preparation', async () => {
      const { prepareCompaniesJob } = await import('./modules/outreach/prepareCompanies');
      for (const { id: tenantId } of await getActiveTenantsWithFeature('wizmatch')) {
        const report = await prepareCompaniesJob(tenantId);
        if (!report.lockAcquired) { console.log(`[CRON] Wizmatch company prep skipped (tenant ${tenantId}) — another run holds the lock`); continue; }
        console.log(`[CRON] Wizmatch company prep (tenant ${tenantId}): ${report.prepared} prepared, ${report.reviewRequired} review-required, ${report.skipped} skipped, ${report.failed} failed (of ${report.attempted} attempted)`);
      }
    }), { timezone: 'UTC' });
    console.log('[cron] Wizmatch company preparation scheduled — 7:45 AM IST daily');
  } else {
    console.log('[cron] Wizmatch company preparation skipped (WIZMATCH_AUTO_PREP_ENABLED is off)');
  }

  // Staffing OS reminders — 9:17 AM IST Mon-Sat. Deterministic and $0:
  // creates deduplicated shared tasks only; it never contacts candidates or clients.
  if (wizmatchAutomation.staffingRemindersEnabled) {
    cron.schedule(WIZMATCH_STAFFING_REMINDER_CRON, () => safeCron('Wizmatch Staffing Reminders', async () => {
      const { wizmatchDeliveryService } = await import('./services/wizmatchDeliveryDomain');
      for (const { id: tenantId } of await getActiveTenantsWithFeature('wizmatch')) {
        const result = await wizmatchDeliveryService.runDeterministicReminders(tenantId);
        console.log(`[CRON] Wizmatch staffing reminders (tenant ${tenantId}): ${result.total} tasks created (${result.requirementSla} requirement SLA, ${result.submissionFollowUps} submission follow-up, ${result.availabilityReviews} availability)`);
      }
    }), { timezone: 'UTC' });
    console.log('[cron] Wizmatch staffing reminders scheduled — 9:17 AM IST Mon-Sat');
  } else {
    console.log('[cron] Wizmatch staffing reminders skipped (staffing automation or Gate C is off)');
  }

} else {
  console.log('[cron] Wizmatch crons skipped (DISABLE_BACKGROUND_JOBS or WIZMATCH_TENANT_ID not set)');
}

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
  stopJobDrainer();

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
