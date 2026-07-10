/**
 * Multi-domain cold email sender using nodemailer + Purelymail SMTP.
 *
 * Inbox rotation per PRD §7.4:
 *   - Pick healthy domain (status='healthy', least sends_7d)
 *   - Round-robin inbox within domain (≤30/day/inbox)
 *   - Inject List-Unsubscribe header
 *
 * In-process = cheap; no external SaaS send cost.
 */

import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { pool } from '../db/index';

export interface SendResult {
  from: string;
  fromInbox: string;
  domain: string;
  messageId: string;
}

/** Raised when every eligible inbox has hit its daily send cap. Routes map this to HTTP 429. */
export class AllInboxesAtDailyCapError extends Error {
  constructor(public readonly cap: number) {
    super(`All inboxes have reached the daily send cap (${cap}/inbox)`);
    this.name = 'AllInboxesAtDailyCapError';
  }
}

function maxSendsPerInboxDay(): number {
  const v = Number(process.env.WIZMATCH_MAX_SENDS_PER_INBOX_DAY);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 30;
}

/** Today's cold-send count per inbox (from the messages we stamp with fromInbox). */
async function getTodaySendCountByInbox(tenantId: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  try {
    const res = await pool.query(
      `SELECT metadata->>'fromInbox' AS inbox, COUNT(*)::int AS c
       FROM messages
       WHERE tenant_id = $1 AND direction = 'outbound' AND status = 'sent'
         AND sent_at::date = CURRENT_DATE AND metadata->>'fromInbox' IS NOT NULL
       GROUP BY metadata->>'fromInbox'`,
      [tenantId],
    );
    for (const row of res.rows) counts.set(row.inbox as string, Number(row.c));
  } catch { /* best-effort; treat as zero on error */ }
  return counts;
}

export interface SendParams {
  to: string;
  subject: string;
  body: string;
  fromName: string;
  tenantId: string;
}

// Build inbox config from env vars (6 inboxes across 3 domains)
function getInboxes() {
  const host = process.env.PURELYMAIL_SMTP_HOST || 'smtp.purelymail.com';
  const port = Number(process.env.PURELYMAIL_SMTP_PORT) || 587;

  const inboxes: Array<{ user: string; pass: string; domain: string }> = [];
  for (let i = 1; i <= 6; i++) {
    const user = process.env[`PURELYMAIL_SMTP_USER_${i}`] || process.env[`PURELYMAIL_USER_${i}`];
    const pass = process.env[`PURELYMAIL_SMTP_PASS_${i}`] || process.env[`PURELYMAIL_PASS_${i}`];
    if (user && pass) {
      const domain = user.split('@')[1] || '';
      inboxes.push({ user, pass, domain });
    }
  }

  return { host, port, inboxes };
}

export async function sendColdEmail(params: SendParams): Promise<SendResult> {
  const { host, port, inboxes } = getInboxes();

  if (inboxes.length === 0) {
    throw new Error('No Purelymail inboxes configured (PURELYMAIL_SMTP_USER_1..6 + PURELYMAIL_SMTP_PASS_1..6)');
  }

  // Sendable domains: never send cold mail from a paused/blacklisted domain.
  // Healthy first, then least-used. When no domain_health rows exist yet (bootstrap),
  // fall back to all inboxes so the very first sends aren't blocked.
  const domainsResult = await pool.query(
    `SELECT domain, status FROM wizmatch_domain_health
     WHERE tenant_id = $1 AND status NOT IN ('paused', 'blacklisted')
     ORDER BY (status = 'healthy') DESC, sends_7d ASC, domain`,
    [params.tenantId],
  );
  const sendableDomains = domainsResult.rows.map((r: { domain: string }) => r.domain);

  let availableInboxes = sendableDomains.length > 0
    ? inboxes.filter((ib) => sendableDomains.includes(ib.domain))
    : inboxes;
  if (availableInboxes.length === 0) availableInboxes = inboxes;

  // Enforce the per-inbox daily cap: drop inboxes at/over the cap, prefer least-used.
  const cap = maxSendsPerInboxDay();
  const todayCounts = await getTodaySendCountByInbox(params.tenantId);
  const underCap = availableInboxes
    .map((ib) => ({ ib, used: todayCounts.get(ib.user) || 0 }))
    .filter((x) => x.used < cap)
    .sort((a, b) => a.used - b.used);

  if (underCap.length === 0) {
    throw new AllInboxesAtDailyCapError(cap);
  }

  // Among the least-used tier, keep recipient-stable distribution via the hash.
  const minUsed = underCap[0].used;
  const leastUsed = underCap.filter((x) => x.used === minUsed).map((x) => x.ib);
  const selectedInbox = leastUsed[Math.abs(hashString(params.to)) % leastUsed.length];

  const fromAddress = `${params.fromName} <${selectedInbox.user}>`;

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user: selectedInbox.user, pass: selectedInbox.pass },
  });

  // List-Unsubscribe: sign the one-click HTTPS link with the same HMAC the
  // unsubscribe route verifies, so one-click actually works (was previously unsigned).
  const unsubEmail = `unsubscribe@${selectedInbox.domain}`;
  const sig = crypto
    .createHmac('sha256', process.env.WIZMATCH_UNSUBSCRIBE_HMAC_SECRET || 'default-secret')
    .update(params.to)
    .digest('base64url');
  const unsubUrl = `https://api.growthescalators.com/api/wizmatch/unsubscribe?email=${encodeURIComponent(params.to)}&sig=${sig}`;

  const info = await transport.sendMail({
    from: fromAddress,
    to: params.to,
    subject: params.subject,
    text: params.body,
    headers: {
      'List-Unsubscribe': `<mailto:${unsubEmail}>, <${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'X-Mailer': 'Wizmatch Outreach',
    },
  });

  // Bump sends_7d on the domain
  await pool.query(
    `UPDATE wizmatch_domain_health SET sends_7d = sends_7d + 1 WHERE tenant_id = $1 AND domain = $2`,
    [params.tenantId, selectedInbox.domain],
  ).catch(() => {});

  return {
    from: fromAddress,
    fromInbox: selectedInbox.user,
    domain: selectedInbox.domain,
    messageId: info.messageId,
  };
}

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const chr = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash;
}

// Domain warmup sender — sends to friendly contacts
export async function sendWarmupEmails(tenantId: string, warmupContacts: string[]) {
  const { host, port, inboxes } = getInboxes();
  if (inboxes.length === 0 || warmupContacts.length === 0) return;

  let sent = 0;
  for (const inbox of inboxes) {
    // Pick a warmup contact round-robin
    const target = warmupContacts[sent % warmupContacts.length];
    try {
      const transport = nodemailer.createTransport({
        host, port, secure: false,
        auth: { user: inbox.user, pass: inbox.pass },
      });
      await transport.sendMail({
        from: `Archit <${inbox.user}>`,
        to: target,
        subject: 'Quick sync this week?',
        text: `Hi,\n\nAre you free for a quick catch-up this week?\n\n— Archit`,
      });
      sent++;
    } catch (e) {
      console.error(`[wizmatch-warmup] Failed for ${inbox.user}:`, e instanceof Error ? e.message : e);
    }
  }

  // Log warmup
  await pool.query(
    `INSERT INTO events (tenant_id, event_type, channel, direction, payload, occurred_at)
     VALUES ($1, 'domain_warmup', 'email', 'outbound', $2::jsonb, NOW())`,
    [tenantId, JSON.stringify({ sent, total_inboxes: inboxes.length })],
  ).catch(() => {});

  return { sent, total: inboxes.length };
}