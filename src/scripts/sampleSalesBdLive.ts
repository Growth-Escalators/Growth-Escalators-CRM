// One-shot — posts SAMPLE PREVIEW messages to #sales-bd using real data
// pulled from the CRM:
//   1. Most recent funnel purchase (events.event_type='slo_purchase')
//   2. Most recent agency lead (contacts with 'agency_lead' tag)
//
// Mirrors the exact templates the real Slack pings use, so the team can
// see what shape the message takes when an actual signup or purchase fires.
//
// Run via:  railway run npx tsx src/scripts/sampleSalesBdLive.ts
import { Client } from 'pg';
import { sendSlackMessage } from '../services/slackService';
import { SLACK_SALES_BD_CHANNEL } from '../config/constants';

const HEADER_PURCHASE = '🧪 *SAMPLE PREVIEW — LIVE DATA, most recent funnel purchase from the CRM.*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
const HEADER_LEAD     = '🧪 *SAMPLE PREVIEW — LIVE DATA, most recent agency lead from the CRM.*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
const FOOTER = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n_(End of sample — same template fires automatically going forward.)_';

interface PurchaseRow {
  created_at: string;
  first_name: string;
  last_name: string | null;
  amount: number | string;
  segment: string | null;
  products: string[] | null;
  funnel_slug: string | null;
  cf_payment_id: string | null;
  email: string | null;
  phone: string | null;
}

interface LeadRow {
  created_at: string;
  first_name: string;
  last_name: string | null;
  company_name: string | null;
  notes: string | null;
  email: string | null;
  phone: string | null;
}

function formatPurchase(r: PurchaseRow): string {
  const name = [r.first_name, r.last_name].filter(Boolean).join(' ');
  const ageMin = Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000);
  const ageStr = ageMin < 60 ? `${ageMin} min ago` : ageMin < 1440 ? `${Math.round(ageMin/60)}h ago` : `${Math.round(ageMin/1440)}d ago`;
  const products = Array.isArray(r.products) && r.products.length ? r.products.join(', ') : '—';
  return (
    `📌 *Real fires on:* every Cashfree purchase.\n` +
    `📌 *This sample pulled from:* most recent \`events.slo_purchase\` row (${ageStr}).\n\n` +
    `💰 *New Purchase!*\n` +
    `• Funnel: ${r.funnel_slug || '—'}\n` +
    `• Name: ${name || '(unknown)'}\n` +
    `• Amount: ₹${r.amount}\n` +
    `• Segment: ${r.segment || '—'}\n` +
    `• Products: ${products}\n` +
    `• Email: ${r.email || '—'}\n` +
    `• Phone: ${r.phone || '—'}\n` +
    `• Order ID: ${r.cf_payment_id || '—'}`
  );
}

function formatLead(r: LeadRow): string {
  const name = [r.first_name, r.last_name].filter(Boolean).join(' ');
  const ageMin = Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000);
  const ageStr = ageMin < 60 ? `${ageMin} min ago` : ageMin < 1440 ? `${Math.round(ageMin/60)}h ago` : `${Math.round(ageMin/1440)}d ago`;

  // The agency-lead form stuffs adSpend etc into contacts.notes (one entry per
  // submission). Surface the most recent line if it exists.
  const adSpendLine = r.notes?.split('\n').find(l => /ad[\s-]?spend/i.test(l)) ?? '';
  return (
    `📌 *Real fires on:* every \`/api/leads/agency\` form submission (white-label landing).\n` +
    `📌 *This sample pulled from:* most recent contact tagged 'agency_lead' (${ageStr}).\n\n` +
    `🤝 *New Agency Lead*\n` +
    `• Name: ${name || '(unknown)'}\n` +
    `• Agency: ${r.company_name || '(not provided)'}\n` +
    `• Email: ${r.email || '—'}\n` +
    `• Phone: ${r.phone || '—'}\n` +
    (adSpendLine ? `• ${adSpendLine.trim()}\n` : '') +
    `• Status: EXISTING (sample from history)`
  );
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('FAIL: no DATABASE_URL'); process.exit(1); }

  console.log('[sample] connecting to Postgres…');
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
  });
  await client.connect();
  console.log('[sample] connected.');

  // ── 1. Most recent funnel purchase ──────────────────────────────────────
  // events.slo_purchase rows carry the payload; join contacts for the human
  // name, then left-join contact_channels for email + phone so we surface a
  // realistic ping with the same fields the real Slack message uses.
  console.log('[sample] pulling latest purchase…');
  const purchaseRes = await client.query<PurchaseRow>(`
    SELECT
      e.created_at,
      c.first_name, c.last_name,
      (e.payload->>'amount')::numeric AS amount,
      e.payload->>'segment' AS segment,
      (SELECT array_agg(p) FROM jsonb_array_elements_text(e.payload->'products') p) AS products,
      e.payload->>'funnelSlug' AS funnel_slug,
      e.payload->>'cfPaymentId' AS cf_payment_id,
      (SELECT channel_value FROM contact_channels WHERE contact_id = c.id AND channel_type = 'email' LIMIT 1) AS email,
      (SELECT channel_value FROM contact_channels WHERE contact_id = c.id AND channel_type = 'phone' LIMIT 1) AS phone
    FROM events e
    JOIN contacts c ON c.id = e.contact_id
    WHERE e.event_type = 'slo_purchase'
    ORDER BY e.created_at DESC
    LIMIT 1
  `);

  if (purchaseRes.rows.length === 0) {
    console.log('[sample] no slo_purchase events found in the CRM — skipping purchase preview');
  } else {
    const body = formatPurchase(purchaseRes.rows[0]);
    const ok = await sendSlackMessage(SLACK_SALES_BD_CHANNEL, HEADER_PURCHASE + body + FOOTER, undefined, { allowDuringPause: true });
    console.log(`[sample] purchase preview: ${ok ? 'POSTED ✓' : 'FAIL ✗'}`);
    await new Promise(r => setTimeout(r, 1500));
  }

  // ── 2. Most recent agency lead ──────────────────────────────────────────
  console.log('[sample] pulling latest agency lead…');
  const leadRes = await client.query<LeadRow>(`
    SELECT
      c.created_at, c.first_name, c.last_name, c.company_name, c.notes,
      (SELECT channel_value FROM contact_channels WHERE contact_id = c.id AND channel_type = 'email' LIMIT 1) AS email,
      (SELECT channel_value FROM contact_channels WHERE contact_id = c.id AND channel_type = 'phone' LIMIT 1) AS phone
    FROM contacts c
    WHERE 'agency_lead' = ANY(c.tags)
    ORDER BY c.created_at DESC
    LIMIT 1
  `);

  if (leadRes.rows.length === 0) {
    console.log('[sample] no agency leads found in the CRM — skipping lead preview');
  } else {
    const body = formatLead(leadRes.rows[0]);
    const ok = await sendSlackMessage(SLACK_SALES_BD_CHANNEL, HEADER_LEAD + body + FOOTER, undefined, { allowDuringPause: true });
    console.log(`[sample] lead preview: ${ok ? 'POSTED ✓' : 'FAIL ✗'}`);
  }

  await client.end();
  process.exit(0);
}

main().catch((e) => {
  console.error('Sample failed:', e);
  process.exit(1);
});
