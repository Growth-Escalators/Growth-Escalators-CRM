import { pool } from '../db/index';
import logger from '../utils/logger';
import { type GrowthOSClient, sendWhatsAppMessage } from './growthOSSetup';

// ---------------------------------------------------------------------------
// Industry benchmarks
// ---------------------------------------------------------------------------

const BENCHMARKS = {
  cartRecoveryRate: 0.15,
  winbackRate: 0.08,
  whatsappOptinRate: 0.03,
  valuePerWAContact: 180,
  avgOrderValue: 1200,
  upsellRate: 0.12,
};

export interface OpportunityReport {
  client_name: string;
  ad_account_id: string;
  week_start: string;
  cart_abandonment_opportunity: number;
  winback_opportunity: number;
  whatsapp_optin_opportunity: number;
  email_sequence_opportunity: number;
  upsell_opportunity: number;
  total_opportunity: number;
  detail: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Main calculator
// ---------------------------------------------------------------------------

export async function calculateMoneyOnTable(client: GrowthOSClient): Promise<OpportunityReport> {
  logger.info(`[opportunity] Calculating for ${client.client_name}...`);

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const aov = BENCHMARKS.avgOrderValue;

  const [paymentsRes, contactsRes, lapsedRes, seqRes] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS cnt FROM payments WHERE created_at >= date_trunc('month', NOW())`).catch(() => ({ rows: [{ cnt: '0' }] })),
    pool.query(`SELECT COUNT(*) AS cnt, MIN(created_at) AS earliest FROM contacts`).catch(() => ({ rows: [{ cnt: '0', earliest: null }] })),
    pool.query(`SELECT COUNT(*) AS cnt FROM contacts WHERE updated_at < NOW() - INTERVAL '90 days'`).catch(() => ({ rows: [{ cnt: '0' }] })),
    pool.query(`SELECT COUNT(*) AS cnt, array_agg(name) AS names FROM sequences WHERE is_active = true`).catch(() => ({ rows: [{ cnt: '0', names: [] }] })),
  ]);

  const ordersThisMonth = Number((paymentsRes.rows[0] as { cnt: string }).cnt ?? 0);
  const totalContacts = Number((contactsRes.rows[0] as { cnt: string; earliest: string | null }).cnt ?? 0);
  const earliestContact = (contactsRes.rows[0] as { cnt: string; earliest: string | null }).earliest;
  const lapsedContacts = Number((lapsedRes.rows[0] as { cnt: string }).cnt ?? 0);
  const activeSeqCount = Number((seqRes.rows[0] as { cnt: string; names: string[] }).cnt ?? 0);
  const activeSeqNames: string[] = ((seqRes.rows[0] as { cnt: string; names: string[] | null }).names ?? []) as string[];

  // 1. Cart abandonment
  const estimatedAbandoned = ordersThisMonth * 2.5;
  const cart_abandonment_opportunity = Math.round(estimatedAbandoned * BENCHMARKS.cartRecoveryRate * aov);
  const hasCartSequence = activeSeqNames.some(n => (n ?? '').toLowerCase().includes('cart'));

  // 2. Win-back
  const winback_opportunity = Math.round(lapsedContacts * BENCHMARKS.winbackRate * aov);
  const hasWinbackSequence = activeSeqNames.some(n => (n ?? '').toLowerCase().includes('win') || (n ?? '').toLowerCase().includes('lapsed'));

  // 3. WhatsApp opt-ins — estimate monthly visitors from contact acquisition rate
  const monthsActive = earliestContact
    ? Math.max(1, Math.round((Date.now() - new Date(earliestContact).getTime()) / (30 * 86400000)))
    : 6;
  const estimatedMonthlyVisitors = Math.max(1000, (totalContacts / monthsActive) * 100);
  const missedOptins = Math.round(estimatedMonthlyVisitors * BENCHMARKS.whatsappOptinRate);
  const whatsapp_optin_opportunity = Math.round(missedOptins * BENCHMARKS.valuePerWAContact);

  // 4. Email sequences missing
  const essentialSequences = ['welcome', 'cart', 'win-back', 'post-purchase', 'review'];
  const missingSequences = essentialSequences.filter(s =>
    !activeSeqNames.some(n => (n ?? '').toLowerCase().includes(s))
  );
  const email_sequence_opportunity = missingSequences.length * aov * 50; // approx 50 orders per missing flow

  // 5. Upsell
  const upsell_opportunity = Math.round(ordersThisMonth * BENCHMARKS.upsellRate * aov * 0.3);

  const total_opportunity = cart_abandonment_opportunity + winback_opportunity + whatsapp_optin_opportunity + email_sequence_opportunity + upsell_opportunity;

  const detail = {
    orders_this_month: ordersThisMonth,
    estimated_abandoned: Math.round(estimatedAbandoned),
    lapsed_contacts: lapsedContacts,
    active_sequences: activeSeqCount,
    missing_sequences: missingSequences,
    estimated_monthly_visitors: Math.round(estimatedMonthlyVisitors),
    missed_optins_per_month: missedOptins,
    has_cart_sequence: hasCartSequence,
    has_winback_sequence: hasWinbackSequence,
    fee: 35000,
    ten_percent_capture: Math.round(total_opportunity * 0.1),
  };

  const report: OpportunityReport = {
    client_name: client.client_name,
    ad_account_id: client.ad_account_id,
    week_start: weekStartStr,
    cart_abandonment_opportunity,
    winback_opportunity,
    whatsapp_optin_opportunity,
    email_sequence_opportunity,
    upsell_opportunity,
    total_opportunity,
    detail,
  };

  await saveOpportunityReport(report);
  logger.info(`[opportunity] ${client.client_name} total opportunity: ₹${total_opportunity.toLocaleString('en-IN')}`);
  return report;
}

async function saveOpportunityReport(report: OpportunityReport): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO money_on_table (client_name, ad_account_id, week_start, cart_abandonment_opportunity, winback_opportunity, whatsapp_optin_opportunity, email_sequence_opportunity, upsell_opportunity, total_opportunity, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        report.client_name, report.ad_account_id, report.week_start,
        report.cart_abandonment_opportunity, report.winback_opportunity,
        report.whatsapp_optin_opportunity, report.email_sequence_opportunity,
        report.upsell_opportunity, report.total_opportunity,
        JSON.stringify(report.detail),
      ]
    );
  } catch (e) {
    logger.error('[opportunity] save failed:', e);
  }
}

export async function sendMoneyOnTableWhatsApp(report: OpportunityReport, founderWA: string): Promise<void> {
  if (!founderWA) return;

  const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const d = report.detail as Record<string, unknown>;

  const msg =
    `💰 *Money Left on Table — ${report.client_name}*\n` +
    `Week of ${date}\n\n` +
    `You left *${fmt(report.total_opportunity)}* on the table this week.\n\n` +
    `🛒 Cart abandonment: ${fmt(report.cart_abandonment_opportunity)}\n` +
    `   ${d.has_cart_sequence ? '✅ Sequence running' : '❌ No recovery sequence'}\n\n` +
    `😴 Lapsed customers: ${fmt(report.winback_opportunity)}\n` +
    `   ${d.has_winback_sequence ? '✅ Win-back running' : '❌ No win-back campaign'}\n\n` +
    `📱 WhatsApp opt-ins: ${fmt(report.whatsapp_optin_opportunity)}\n` +
    `   Estimated ${d.missed_optins_per_month} contacts/month not captured\n\n` +
    `📧 Email gaps: ${fmt(report.email_sequence_opportunity)}\n` +
    `   ${(d.missing_sequences as string[] | undefined)?.length ?? 0} sequences not set up\n\n` +
    `💎 Upsell missed: ${fmt(report.upsell_opportunity)}\n\n` +
    `*Your Growth OS fee: ₹35,000*\n` +
    `*If we capture just 10%: ${fmt(report.total_opportunity * 0.1)} ROI*`;

  await sendWhatsAppMessage(founderWA, msg);
}
