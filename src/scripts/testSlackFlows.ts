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
  const ok = await sendSlackDM(SLACK_JATIN, TEST_PREFIX + body + FOOTER, undefined, { allowDuringPause: true }).catch((e) => {
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

  // ── Phase 4 — Meta Ads daily report (FORMAT preview with sample data) ──
  // Uses synthetic insights so the FORMAT can be verified without paying the
  // Meta-API roundtrip and without depending on a Railway-internal DB
  // connection (which doesn't resolve from outside Railway's VPC). The real
  // cron at 9:30 AM IST runs inside the web container so it pulls live data
  // happily — this preview just shows the layout.
  console.log('\n[test] generating Meta Ads daily report with sample data…');
  try {
    const { buildDailyReport } = await import('../services/metaAdsService');

    // Crafted to exercise all the new polish bits:
    //  - Paraiso: highest spend → sorts to top, healthy ROAS (no flag)
    //  - Odra: mid spend, moderate ROAS (no flag) → confirms it's wired in
    //  - GE Agency: high spend BUT ROAS < 1 → ⚠️ flag fires
    const sampleInsights = [
      {
        clientName: 'Paraiso',
        accountId: 'act_689363376592426',
        yesterday: { spend: 24500, purchases: 38, roas: 3.42, revenue: 83790, impressions: 124000, clicks: 1820, ctr: 1.47 },
        last7days: { spend: 168400, purchases: 251, roas: 3.18, revenue: 535512, impressions: 882000, clicks: 13104, ctr: 1.49 },
        thisMonth: { spend: 392150, purchases: 612, roas: 3.05, revenue: 1196057, impressions: 2010000, clicks: 30420, ctr: 1.51 },
        bestCampaign: { name: 'Comfortwear Retargeting — UGC', roas: 4.91 },
      },
      {
        clientName: 'Odra',
        accountId: 'act_1428140022075180',
        yesterday: { spend: 8200, purchases: 11, roas: 2.18, revenue: 17876, impressions: 41000, clicks: 580, ctr: 1.41 },
        last7days: { spend: 54300, purchases: 78, roas: 2.31, revenue: 125433, impressions: 285000, clicks: 4180, ctr: 1.46 },
        thisMonth: { spend: 126400, purchases: 189, roas: 2.27, revenue: 286928, impressions: 638000, clicks: 9540, ctr: 1.49 },
        bestCampaign: { name: 'Organics Cold — Story Set 3', roas: 3.12 },
      },
      {
        clientName: 'GE Agency',
        accountId: 'act_323237510625803',
        yesterday: { spend: 14200, purchases: 4, roas: 0.62, revenue: 8804, impressions: 67000, clicks: 920, ctr: 1.37 },
        last7days: { spend: 91400, purchases: 47, roas: 1.18, revenue: 107852, impressions: 471000, clicks: 6510, ctr: 1.38 },
        thisMonth: { spend: 218200, purchases: 132, roas: 1.32, revenue: 288024, impressions: 1043000, clicks: 14820, ctr: 1.42 },
        bestCampaign: { name: 'Brand Awareness — Founder Reels', roas: 1.91 },
      },
    ];

    const report = buildDailyReport(sampleInsights);

    await send('Phase 4 · Meta Ads daily report (sample-data FORMAT preview)',
      `🎯 *Will post to:* <#${SLACK_PERF_MARKETING_CHANNEL}> daily at 9:30 AM IST Mon–Sat\n\n` +
      `_Below is the FORMAT preview using synthetic numbers. The real 9:30 AM run pulls live data._\n\n` +
      `---\n` +
      report + `\n` +
      `---\n\n` +
      `*Verify in the preview above:*\n` +
      `• Top-line summary row at the top showing totals across 3 accounts\n` +
      `• Paraiso first (highest yesterday spend ₹24.5k)\n` +
      `• Odra second — confirms it's wired in\n` +
      `• GE Agency last with a ⚠️ *low ROAS at scale* flag (yesterday spend ₹14.2k, ROAS 0.62)\n` +
      `• Each account shows its % share of yesterday's total spend`
    );
  } catch (e) {
    await send('Phase 4 · Meta Ads daily report — ERROR',
      `❌ Report generation failed: ${(e as Error).message}`
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
