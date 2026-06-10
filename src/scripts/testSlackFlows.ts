// One-off test harness for the Slack workflow changes shipped in b48a3d2.
// Sends every new message format as a DM to Jatin (no channels disturbed)
// so the design, mentions and Meta Ads report can all be verified before
// the real crons fire tomorrow.
//
// Run via:
//   railway run npx tsx src/scripts/testSlackFlows.ts
//
// Safe to re-run — it doesn't write to any tables.
//
// DELETE after the team has verified — it's a one-shot validation harness.
import { sendSlackDM } from '../services/slackService';
import {
  SLACK_JATIN,
  SLACK_KANISHK,
  SLACK_KRATIKA,
  SLACK_SNEHA,
  SLACK_SALES_BD_CHANNEL,
  SLACK_SOD_EOD_CHANNEL,
  SLACK_SOCIAL_MEDIA_CHANNEL,
  SLACK_PERF_MARKETING_CHANNEL,
} from '../config/constants';

const TEST_PREFIX = '🧪 *[TEST RUN — ignore]* 🧪\n\n';
const FOOTER = '\n\n_— end of test message —_';

function ist(): string {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
    timeZone: 'Asia/Kolkata',
  });
}

async function send(label: string, body: string): Promise<void> {
  console.log(`\n[test] sending: ${label}`);
  const ok = await sendSlackDM(SLACK_JATIN, TEST_PREFIX + body + FOOTER).catch((e) => {
    console.error(`[test] ${label} FAILED:`, e?.message ?? e);
    return false;
  });
  console.log(`[test] ${label}: ${ok ? 'OK ✓' : 'FAIL ✗'}`);
  await new Promise(r => setTimeout(r, 1200)); // small delay so the order is deterministic in Slack
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Slack flow test harness');
  console.log(`  Routing all 5 test messages to Jatin's DM (${SLACK_JATIN})`);
  console.log('═══════════════════════════════════════════════════');

  // ── Phase 2a — SOD prompt ──────────────────────────────────────────────
  await send('Phase 2a · SOD prompt (would post to #sod-eod)',
    `🎯 *Will post to:* <#${SLACK_SOD_EOD_CHANNEL}> daily at 10:15 AM IST Mon–Sat\n\n` +
    `---\n` +
    `🌅 *Good morning team — ${ist()}*\n\n` +
    `Share your *SOD plan* for today in this thread 👇\n\n` +
    `<@${SLACK_KANISHK}> · <@${SLACK_KRATIKA}> · <@${SLACK_SNEHA}>\n\n` +
    `_Drop the top 3 things you're shipping today + anything blocked._\n` +
    `---\n\n` +
    `*Verify:* Kanishk, Kratika and Sneha should appear as @-mentions above (not raw IDs).`
  );

  // ── Phase 2b — EOD prompt ──────────────────────────────────────────────
  await send('Phase 2b · EOD prompt (would post to #sod-eod)',
    `🎯 *Will post to:* <#${SLACK_SOD_EOD_CHANNEL}> daily at 7:00 PM IST Mon–Sat\n\n` +
    `---\n` +
    `🌙 *Wrapping up — ${ist()}*\n\n` +
    `Share your *EOD recap* in this thread 👇\n\n` +
    `<@${SLACK_KANISHK}> · <@${SLACK_KRATIKA}> · <@${SLACK_SNEHA}>\n\n` +
    `_What shipped today · what's blocked · what's queued for tomorrow._\n` +
    `---`
  );

  // ── Phase 3 — Social Media prompt ──────────────────────────────────────
  await send('Phase 3 · Social Media prompt (would post to #social-media-posting)',
    `🎯 *Will post to:* <#${SLACK_SOCIAL_MEDIA_CHANNEL}> daily at 9:30 AM IST Mon–Sat\n\n` +
    `---\n` +
    `📱 *Social posting — ${ist()}*\n\n` +
    `<@${SLACK_KRATIKA}> · <@${SLACK_SNEHA}> — which brands need posting today?\n\n` +
    `Share the list + any creative briefs in this thread by *11 AM IST* 👇\n` +
    `---\n\n` +
    `*Verify:* the channel link above should resolve to the right Social Media channel.`
  );

  // ── Phase 1 — sample funnel-purchase ping (would post to #sales-bd) ─────
  await send('Phase 1 · sample funnel-purchase ping (would post to #sales-bd)',
    `🎯 *Will post to:* <#${SLACK_SALES_BD_CHANNEL}> on every Cashfree purchase\n\n` +
    `_Below is a sample purchase ping in the new routing — actual content depends on the funnel config._\n` +
    `---\n` +
    `💰 *New Purchase!*\n` +
    `• Funnel: D2C Funnel Breakdown Pack\n` +
    `• Name: [Test Customer]\n` +
    `• Amount: ₹49\n` +
    `• Segment: D2C founder\n` +
    `• Products: D2C Funnel Breakdown Pack\n` +
    `---\n\n` +
    `*Verify:* the channel link above should resolve to the right Sales-BD channel.`
  );

  // ── Phase 4 — Meta Ads daily report (REAL data) ────────────────────────
  console.log('\n[test] generating Meta Ads daily report from live data…');
  try {
    const token = process.env.META_ADS_TOKEN || process.env.META_ACCESS_TOKEN;
    if (!token) {
      await send('Phase 4 · Meta Ads daily report — SKIPPED',
        `⚠️ \`META_ADS_TOKEN\` not configured in this environment.\n` +
        `When the real cron runs, the report posts to <#${SLACK_PERF_MARKETING_CHANNEL}> at 9:30 AM IST.`
      );
    } else {
      const { pool } = await import('../db/index');
      const { fetchAccountInsights, buildDailyReport } = await import('../services/metaAdsService');

      const accounts = await pool.query(
        `SELECT account_id, client_name, currency, exchange_rate
         FROM ad_accounts WHERE is_active = true`
      );

      if (accounts.rows.length === 0) {
        await send('Phase 4 · Meta Ads daily report',
          `⚠️ No active ad accounts in the database. The Odra row hasn't seeded yet — that happens on next backend boot.`
        );
      } else {
        const insights = [];
        for (const acct of accounts.rows as Array<{ account_id: string; client_name: string; currency: string; exchange_rate: number }>) {
          try {
            const data = await fetchAccountInsights(
              acct.account_id, token, acct.client_name,
              acct.currency, Number(acct.exchange_rate ?? 1),
            );
            insights.push(data);
          } catch (e) {
            console.warn(`[test] insights fetch failed for ${acct.client_name}:`, (e as Error).message);
          }
        }
        const report = buildDailyReport(insights);
        const activeNames = accounts.rows.map((r) => (r as { client_name: string }).client_name).join(', ');

        await send('Phase 4 · Meta Ads daily report (real data)',
          `🎯 *Will post to:* <#${SLACK_PERF_MARKETING_CHANNEL}> daily at 9:30 AM IST Mon–Sat\n\n` +
          `_Accounts pulled from \`ad_accounts\`: ${activeNames}_\n\n` +
          `---\n` +
          report + `\n` +
          `---\n\n` +
          `*Verify:* Paraiso AND Odra should both appear. Top-line summary row should be at the top. Sort order = highest yesterday-spend first. ⚠️ flag should appear on any account with ₹10k+ spend AND ROAS < 1.`
        );
      }
    }
  } catch (e) {
    await send('Phase 4 · Meta Ads daily report — ERROR',
      `❌ Report generation failed: ${(e as Error).message}\n\nWhen the real cron runs, it has the same dependencies — fix the error in env or DB.`
    );
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Done. Check Jatin\'s Slack DMs for 5 messages.');
  console.log('═══════════════════════════════════════════════════');
  process.exit(0);
}

main().catch((e) => {
  console.error('Test harness failed:', e);
  process.exit(1);
});
