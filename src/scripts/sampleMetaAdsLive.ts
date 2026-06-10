// One-shot — posts the Meta Ads daily report into #perf-marketing using
// the EXACT same pipeline as the 9:30 AM IST cron, but with live data
// pulled right now. Bypasses the shared db pool (which uses the Railway
// internal hostname) by opening its own pg Client against DATABASE_PUBLIC_URL
// with TLS, so it can run from a developer machine via `railway run`.
//
// Run via:  railway run npx tsx src/scripts/sampleMetaAdsLive.ts
import { Client } from 'pg';
import { fetchAccountInsights, buildDailyReport } from '../services/metaAdsService';
import { sendSlackMessage } from '../services/slackService';
import { SLACK_PERF_MARKETING_CHANNEL } from '../config/constants';

async function main(): Promise<void> {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const token = process.env.META_ADS_TOKEN || process.env.META_ACCESS_TOKEN;

  if (!url) { console.error('FAIL: no DATABASE_URL'); process.exit(1); }
  if (!token) { console.error('FAIL: META_ADS_TOKEN / META_ACCESS_TOKEN missing'); process.exit(1); }

  console.log('[sample] connecting to Postgres…');
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
  });
  await client.connect();
  console.log('[sample] connected.');

  const result = await client.query<{
    account_id: string; client_name: string; currency: string; exchange_rate: string | number;
  }>(`SELECT account_id, client_name, currency, exchange_rate FROM ad_accounts WHERE is_active = true ORDER BY client_name`);

  if (result.rows.length === 0) {
    console.error('FAIL: no active rows in ad_accounts');
    await client.end();
    process.exit(1);
  }
  console.log(`[sample] active accounts: ${result.rows.map(r => r.client_name).join(', ')}`);

  // Pull live insights — log each fetch so we can spot Meta API failures
  // immediately rather than silently dropping accounts from the report.
  const insights = [];
  for (const acct of result.rows) {
    process.stdout.write(`[sample] fetching insights for ${acct.client_name} (${acct.account_id})… `);
    try {
      const data = await fetchAccountInsights(
        acct.account_id, token, acct.client_name,
        acct.currency, Number(acct.exchange_rate ?? 1),
      );
      insights.push(data);
      console.log('OK');
    } catch (e) {
      console.log(`FAIL: ${(e as Error).message}`);
    }
  }

  if (insights.length === 0) {
    console.error('FAIL: no insights fetched — Meta API token may lack permission on all accounts');
    await client.end();
    process.exit(1);
  }

  const report = buildDailyReport(insights);
  const namesLine = result.rows.map(r => r.client_name).join(', ');
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const HEADER = '🧪 *SAMPLE PREVIEW — LIVE DATA from Meta Ads API.*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  const FOOTER = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n_(End of sample — same pipeline fires at 9:30 AM IST Mon–Sat. Reach out if any account looks off.)_';
  const body =
    `📌 *Sample fires daily at:* 9:30 AM IST · Mon–Sat\n` +
    `📌 *Accounts pulled from CRM \`ad_accounts\`:* ${namesLine}\n` +
    `📌 *Generated:* ${now} IST\n\n` +
    report;

  console.log('[sample] posting to #perf-marketing…');
  const ok = await sendSlackMessage(SLACK_PERF_MARKETING_CHANNEL, HEADER + body + FOOTER, undefined, { allowDuringPause: true });
  console.log(`[sample] post: ${ok ? 'POSTED ✓' : 'FAIL ✗'}`);

  await client.end();
  process.exit(0);
}

main().catch((e) => {
  console.error('Sample failed:', e);
  process.exit(1);
});
