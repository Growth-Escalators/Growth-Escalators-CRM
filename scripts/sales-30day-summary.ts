/**
 * One-off: "Sales — last 30 days" summary → Slack (#sales-bd).
 *
 * Aggregates deals + invoices for the default tenant over a trailing 30-day
 * window and prints a digest. Dry-run by default; pass --post to actually
 * send it to Slack.
 *
 *   npx tsx scripts/sales-30day-summary.ts          # print only (safe)
 *   npx tsx scripts/sales-30day-summary.ts --post   # print + post to #sales-bd
 *
 * Env: DATABASE_PUBLIC_URL (or DATABASE_URL); SLACK_BOT_TOKEN required for --post.
 */
import { Pool } from 'pg';

// #sales-bd — mirrors SLACK_SALES_BD_CHANNEL in src/config/constants.ts
const SALES_BD_CHANNEL = 'C0AMPEF302G';
// mirrors DEFAULT_TENANT_SLUG in src/config/constants.ts
const TENANT_SLUG = 'growth-escalators';

const DATABASE_URL = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL (or DATABASE_PUBLIC_URL) not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
});

const POST = process.argv.includes('--post');
const inr = (n: number): string => `₹${Math.round(n).toLocaleString('en-IN')}`;

async function postToSlack(channel: string, text: string): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error('❌ SLACK_BOT_TOKEN not set — cannot post.');
    return false;
  }
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) console.error(`❌ Slack error: ${data.error ?? 'unknown'}`);
  return data.ok;
}

async function agg(
  sql: string,
  params: unknown[],
): Promise<{ cnt: number; total: number }> {
  const r = await pool.query(sql, params);
  return { cnt: Number(r.rows[0].cnt), total: Number(r.rows[0].total) };
}

async function main(): Promise<void> {
  try {
    const tenant = await pool.query(`SELECT id FROM tenants WHERE slug = $1 LIMIT 1`, [TENANT_SLUG]);
    const tenantId = tenant.rows[0]?.id as string | undefined;
    if (!tenantId) {
      console.error(`❌ Tenant '${TENANT_SLUG}' not found.`);
      process.exit(1);
    }

    // Deal value column used across the app is deal_value (see morningBriefingService / pipelines).
    const won = await agg(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(deal_value,0)),0)::bigint AS total
         FROM deals
        WHERE tenant_id = $1 AND LOWER(stage) = 'won'
          AND COALESCE(closed_at, updated_at) >= NOW() - INTERVAL '30 days'`,
      [tenantId],
    );
    const lost = await agg(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(deal_value,0)),0)::bigint AS total
         FROM deals
        WHERE tenant_id = $1 AND LOWER(stage) = 'lost'
          AND COALESCE(closed_at, updated_at) >= NOW() - INTERVAL '30 days'`,
      [tenantId],
    );
    const created = await agg(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(deal_value,0)),0)::bigint AS total
         FROM deals
        WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`,
      [tenantId],
    );
    const openPipe = await agg(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(deal_value,0)),0)::bigint AS total
         FROM deals
        WHERE tenant_id = $1 AND LOWER(stage) NOT IN ('won','lost','abandoned')`,
      [tenantId],
    );
    const proposals = await agg(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(deal_value,0)),0)::bigint AS total
         FROM deals
        WHERE tenant_id = $1 AND LOWER(stage) = 'proposal'`,
      [tenantId],
    );
    // Invoice amounts are stored in paise → divide by 100.
    const paid = await agg(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(amount_paid,0)),0)::bigint AS total
         FROM invoices
        WHERE tenant_id = $1 AND paid_at >= NOW() - INTERVAL '30 days'`,
      [tenantId],
    );
    const raised = await agg(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(total_amount,0)),0)::bigint AS total
         FROM invoices
        WHERE tenant_id = $1 AND invoice_date >= NOW() - INTERVAL '30 days'`,
      [tenantId],
    );

    const decided = won.cnt + lost.cnt;
    const winRate = decided > 0 ? Math.round((won.cnt / decided) * 100) : 0;
    const asOf = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    const msg = [
      `*📊 Sales — Last 30 Days*  _(as of ${asOf})_`,
      ``,
      `*Closed Won:* ${won.cnt} deals · ${inr(won.total)}`,
      `*Closed Lost:* ${lost.cnt} deals · ${inr(lost.total)}`,
      `*Win rate:* ${winRate}%  _(of ${decided} decided)_`,
      `*New deals created:* ${created.cnt} · ${inr(created.total)}`,
      ``,
      `*Open pipeline (now):* ${openPipe.cnt} deals · ${inr(openPipe.total)}`,
      `*Proposals out (now):* ${proposals.cnt} · ${inr(proposals.total)}`,
      ``,
      `*Invoices raised:* ${raised.cnt} · ${inr(raised.total / 100)}`,
      `*Payments collected:* ${paid.cnt} · ${inr(paid.total / 100)}`,
    ].join('\n');

    console.log('\n' + msg + '\n');

    if (POST) {
      const ok = await postToSlack(SALES_BD_CHANNEL, msg);
      console.log(ok ? '✅ Posted to #sales-bd' : '❌ Slack post failed.');
    } else {
      console.log('ℹ️  Dry run — pass --post to send to #sales-bd.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
