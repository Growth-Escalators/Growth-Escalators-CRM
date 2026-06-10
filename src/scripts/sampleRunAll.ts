// One-shot sample-run harness — posts ONE example of every new Slack
// workflow into its real destination channel, clearly labeled as a SAMPLE,
// so the team can see exactly what tomorrow's automated runs will look
// like. Safe to re-run (each post is idempotent at the message layer).
//
// Run via:  railway run npx tsx src/scripts/sampleRunAll.ts
//
// After the team has reviewed, this script can be deleted.
import { sendSlackMessage } from '../services/slackService';
import {
  SLACK_SALES_BD_CHANNEL,
  SLACK_SOD_EOD_CHANNEL,
  SLACK_SOCIAL_MEDIA_CHANNEL,
  SLACK_PERF_MARKETING_CHANNEL,
  SLACK_KANISHK,
  SLACK_KRATIKA,
  SLACK_SNEHA,
} from '../config/constants';
import { buildDailyReport } from '../services/metaAdsService';

const HEADER = '🧪 *SAMPLE PREVIEW — this is what the real automated message will look like. Ignore the data.*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
const FOOTER = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n_(End of sample — tomorrow you will see the real version at the scheduled time.)_';

function ist(): string {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
    timeZone: 'Asia/Kolkata',
  });
}

async function post(label: string, channel: string, body: string): Promise<void> {
  console.log(`[sample] posting: ${label}`);
  const ok = await sendSlackMessage(channel, HEADER + body + FOOTER, undefined, { allowDuringPause: true })
    .catch((e) => { console.error(`[sample] ${label} FAILED:`, e?.message ?? e); return false; });
  console.log(`[sample] ${label}: ${ok ? 'POSTED ✓' : 'FAIL ✗'}`);
  await new Promise(r => setTimeout(r, 1500));
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Sample run — posting one preview of every workflow');
  console.log('═══════════════════════════════════════════════════');

  // ── #sales-bd — Funnel purchase (Phase 1a) ─────────────────────────────
  await post(
    'Funnel purchase ping → #sales-bd',
    SLACK_SALES_BD_CHANNEL,
    `📌 *Sample fires on:* every Cashfree purchase via the D2C funnel.\n\n` +
    `💰 *New Purchase!*\n` +
    `• Funnel: D2C Funnel Breakdown Pack\n` +
    `• Name: Rahul Sharma\n` +
    `• Amount: ₹49\n` +
    `• Segment: D2C Founder (d2c)\n` +
    `• Products: D2C Funnel Breakdown Pack + Advanced D2C Growth Kit\n` +
    `• Email: rahul.sharma@example.com\n` +
    `• Phone: +91 98xxx xxxxx\n` +
    `• Order ID: cf_order_2026_sample`
  );

  // ── #sales-bd — Agency lead (Phase 1b) ─────────────────────────────────
  await post(
    'New agency lead ping → #sales-bd',
    SLACK_SALES_BD_CHANNEL,
    `📌 *Sample fires on:* every /api/leads/agency submission (white-label landing-page form).\n\n` +
    `🤝 *New Agency Lead*\n` +
    `• Name: Priya Mehta\n` +
    `• Agency: Catalyst Performance Marketing\n` +
    `• Email: priya@catalystperf.in\n` +
    `• Phone: +91 99xxx xxxxx\n` +
    `• Monthly ad-spend managed: ₹15L–₹50L\n` +
    `• Status: NEW`
  );

  // ── #sod-eod — SOD prompt (Phase 2a) ───────────────────────────────────
  await post(
    'SOD team prompt → #sod-eod (10:15 AM IST)',
    SLACK_SOD_EOD_CHANNEL,
    `📌 *Sample fires daily at:* 10:15 AM IST · Mon–Sat\n\n` +
    `🌅 *Good morning team — ${ist()}*\n\n` +
    `Share your *SOD plan* for today in this thread 👇\n\n` +
    `<@${SLACK_KANISHK}> · <@${SLACK_KRATIKA}> · <@${SLACK_SNEHA}>\n\n` +
    `_Drop the top 3 things you're shipping today + anything blocked._`
  );

  // ── #sod-eod — EOD prompt (Phase 2b) ───────────────────────────────────
  await post(
    'EOD team prompt → #sod-eod (7:00 PM IST)',
    SLACK_SOD_EOD_CHANNEL,
    `📌 *Sample fires daily at:* 7:00 PM IST · Mon–Sat\n\n` +
    `🌙 *Wrapping up — ${ist()}*\n\n` +
    `Share your *EOD recap* in this thread 👇\n\n` +
    `<@${SLACK_KANISHK}> · <@${SLACK_KRATIKA}> · <@${SLACK_SNEHA}>\n\n` +
    `_What shipped today · what's blocked · what's queued for tomorrow._`
  );

  // ── #social-media-posting — Social prompt (Phase 3) ────────────────────
  await post(
    'Social posting prompt → #social-media-posting (9:30 AM IST)',
    SLACK_SOCIAL_MEDIA_CHANNEL,
    `📌 *Sample fires daily at:* 9:30 AM IST · Mon–Sat\n\n` +
    `📱 *Social posting — ${ist()}*\n\n` +
    `<@${SLACK_KRATIKA}> · <@${SLACK_SNEHA}> — which brands need posting today?\n\n` +
    `Share the list + any creative briefs in this thread by *11 AM IST* 👇`
  );

  // ── #perf-marketing — Meta Ads daily (Phase 4) ─────────────────────────
  // Synthetic numbers exercise every new polish bit: top-line summary,
  // spend-share badges, sort-by-spend ordering, ⚠️ low-ROAS flag.
  const sampleInsights = [
    {
      clientName: 'Paraiso',
      accountId: 'act_689363376592426',
      yesterday: { spend: 24500, purchases: 38, roas: 3.42, revenue: 83790, impressions: 124000, clicks: 1820, ctr: 1.47 },
      last7days: { spend: 168400, purchases: 251, roas: 3.18, revenue: 535512, impressions: 882000, clicks: 13104, ctr: 1.49 },
      thisMonth: { spend: 392150, purchases: 612, roas: 3.05, revenue: 1196057, impressions: 2010000, clicks: 30420, ctr: 1.51 },
      bestCampaign: { name: 'Comfortwear Retargeting — UGC', roas: 4.91, spend: 8500 },
    },
    {
      clientName: 'Odra',
      accountId: 'act_1428140022075180',
      yesterday: { spend: 8200, purchases: 11, roas: 2.18, revenue: 17876, impressions: 41000, clicks: 580, ctr: 1.41 },
      last7days: { spend: 54300, purchases: 78, roas: 2.31, revenue: 125433, impressions: 285000, clicks: 4180, ctr: 1.46 },
      thisMonth: { spend: 126400, purchases: 189, roas: 2.27, revenue: 286928, impressions: 638000, clicks: 9540, ctr: 1.49 },
      bestCampaign: { name: 'Organics Cold — Story Set 3', roas: 3.12, spend: 8500 },
    },
    {
      clientName: 'GE Agency',
      accountId: 'act_323237510625803',
      yesterday: { spend: 14200, purchases: 4, roas: 0.62, revenue: 8804, impressions: 67000, clicks: 920, ctr: 1.37 },
      last7days: { spend: 91400, purchases: 47, roas: 1.18, revenue: 107852, impressions: 471000, clicks: 6510, ctr: 1.38 },
      thisMonth: { spend: 218200, purchases: 132, roas: 1.32, revenue: 288024, impressions: 1043000, clicks: 14820, ctr: 1.42 },
      bestCampaign: { name: 'Brand Awareness — Founder Reels', roas: 1.91, spend: 8500 },
    },
  ];
  const report = buildDailyReport(sampleInsights);

  await post(
    'Meta Ads daily report → #perf-marketing (9:30 AM IST)',
    SLACK_PERF_MARKETING_CHANNEL,
    `📌 *Sample fires daily at:* 9:30 AM IST · Mon–Sat\n` +
    `_Synthetic numbers below — tomorrow uses real Meta API data for the same accounts._\n\n` +
    report
  );

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Done. 6 sample messages posted across 4 channels.');
  console.log('═══════════════════════════════════════════════════');
  process.exit(0);
}

main().catch((e) => {
  console.error('Sample-run harness failed:', e);
  process.exit(1);
});
