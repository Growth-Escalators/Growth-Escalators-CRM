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

import nodemailer from 'nodemailer';
import { pool } from '../db/index';
import { WIZMATCH_SYSTEM_CHANNEL } from '../config/constants';
import { sendSlackMessage } from './slackService';
import { getDecryptedCredentials } from './tenantIntegrationsService';
import logger from '../utils/logger';

export interface SendResult {
  from: string;
  domain: string;
  messageId: string;
}

export interface SendParams {
  to: string;
  subject: string;
  body: string;
  fromName: string;
  tenantId: string;
}

interface TenantSmtpCredentials {
  host: string;
  port: number;
  user: string;
  pass: string;
}

function isTenantSmtpCredentials(v: unknown): v is TenantSmtpCredentials {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.host === 'string' && c.host.length > 0
    && typeof c.user === 'string' && c.user.length > 0
    && typeof c.pass === 'string' && c.pass.length > 0
    && (typeof c.port === 'number' || typeof c.port === 'string') && Number(c.port) > 0;
}

/**
 * Per-tenant SMTP credentials (Phase 3 white-label — `tenant_integrations`,
 * provider 'email_smtp'). Returns null when the tenant has no `connected` row
 * — the fallback signal `sendColdEmail` uses to hit exactly today's global
 * PURELYMAIL_*_1..6 pool below. True for every tenant today (none has a
 * `tenant_integrations` row yet), so this is a zero-behavior-change addition
 * until a tenant actually connects their own SMTP account.
 *
 * A `connected` row with a corrupt/incomplete credential payload throws
 * rather than silently falling through — see
 * `tenantIntegrationsService.getDecryptedCredentials`.
 */
async function getTenantSmtpCredentials(tenantId: string): Promise<TenantSmtpCredentials | null> {
  const creds = await getDecryptedCredentials<Partial<TenantSmtpCredentials>>(tenantId, 'email_smtp');
  if (!creds) return null;
  if (!isTenantSmtpCredentials(creds)) {
    throw new Error(
      `tenant_integrations 'email_smtp' credentials for tenant=${tenantId} decrypted to an incomplete/invalid payload (need host, port, user, pass)`,
    );
  }
  return { host: creds.host, port: Number(creds.port), user: creds.user, pass: creds.pass };
}

// Build inbox config from env vars (6 inboxes across 3 domains) — the global
// fallback pool, exactly as before this file gained tenant-awareness.
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
  // Master automated-email kill-switch (default OFF). Cold outreach is an
  // automated send to contacts, so it is blocked unless AUTOMATED_EMAILS_ENABLED
  // is explicitly turned on (in addition to any WIZMATCH_SENDING_ENABLED gate).
  if (process.env.AUTOMATED_EMAILS_ENABLED !== 'true') {
    throw new Error('cold email suppressed — AUTOMATED_EMAILS_ENABLED is off');
  }

  // Per-tenant SMTP integration takes priority over the shared global pool.
  // A tenant's own account is out of scope for `wizmatch_domain_health` (that
  // table tracks reputation of OUR shared Purelymail inboxes, not a tenant's
  // own domain), so it bypasses the healthy-domain gate below entirely.
  const tenantSmtp = await getTenantSmtpCredentials(params.tenantId);
  if (tenantSmtp) {
    return sendWithInboxes(
      tenantSmtp.host,
      tenantSmtp.port,
      [{ user: tenantSmtp.user, pass: tenantSmtp.pass, domain: tenantSmtp.user.split('@')[1] || '' }],
      params,
    );
  }

  const { host, port, inboxes } = getInboxes();

  if (inboxes.length === 0) {
    throw new Error('No Purelymail inboxes configured (PURELYMAIL_SMTP_USER_1..6 + PURELYMAIL_SMTP_PASS_1..6)');
  }

  // Get healthy domains, ordered by least sends
  const domainsResult = await pool.query(
    `SELECT domain FROM wizmatch_domain_health
     WHERE tenant_id = $1 AND status = 'healthy'
     ORDER BY sends_7d ASC, domain`,
    [params.tenantId],
  );

  const healthyDomains = domainsResult.rows.map((r: { domain: string }) => r.domain);

  // Filter inboxes by healthy domains
  const availableInboxes = inboxes.filter((ib) => healthyDomains.includes(ib.domain));

  // PRD-005 §18.3 — fail closed with no healthy inbox. The prior behaviour
  // ("use all inboxes") is reversed: it now requires an explicit, alerted
  // emergency override rather than being the silent default.
  if (availableInboxes.length === 0) {
    // Read per-call, never cached at import time (mirrors the
    // AUTOMATED_EMAILS_ENABLED check above) — a flip must take effect without
    // a restart and must be independently testable per-call.
    if (process.env.WIZMATCH_MAILER_EMERGENCY_OVERRIDE !== 'true') {
      throw new Error('cold email suppressed — no healthy sending domain and WIZMATCH_MAILER_EMERGENCY_OVERRIDE is off');
    }
    logger.error({ tenantId: params.tenantId }, '[multiDomainMailer] EMERGENCY OVERRIDE in use — sending with no healthy domain');
    if (WIZMATCH_SYSTEM_CHANNEL) {
      await sendSlackMessage(
        WIZMATCH_SYSTEM_CHANNEL,
        `:rotating_light: WizMatch mailer emergency override in use — no healthy sending domain for tenant ${params.tenantId}, sending anyway.`,
        undefined,
        { allowDuringPause: true },
      ).catch(() => {});
    }
    return sendWithInboxes(host, port, inboxes, params);
  }

  return sendWithInboxes(host, port, availableInboxes, params);
}

async function sendWithInboxes(
  host: string,
  port: number,
  availableInboxes: Array<{ user: string; pass: string; domain: string }>,
  params: SendParams,
): Promise<SendResult> {
  // Round-robin: pick inbox based on today's count (simplified — in production, track per-inbox daily count)
  // For now, use a hash of the recipient email to distribute evenly
  const bucket = Math.abs(hashString(params.to)) % availableInboxes.length;
  const selectedInbox = availableInboxes[bucket];

  const fromAddress = `${params.fromName} <${selectedInbox.user}>`;

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user: selectedInbox.user, pass: selectedInbox.pass },
  });

  // Generate List-Unsubscribe header (mailto + HTTPS)
  const unsubEmail = `unsubscribe@${selectedInbox.domain}`;

  const info = await transport.sendMail({
    from: fromAddress,
    to: params.to,
    subject: params.subject,
    text: params.body,
    headers: {
      'List-Unsubscribe': `<mailto:${unsubEmail}>, <https://api.growthescalators.com/api/wizmatch/unsubscribe?email=${encodeURIComponent(params.to)}>`,
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
  if (process.env.AUTOMATED_EMAILS_ENABLED !== 'true') {
    console.warn('[multiDomainMailer] warmup emails suppressed — AUTOMATED_EMAILS_ENABLED is off');
    return;
  }
  const { host, port, inboxes } = getInboxes();
  if (inboxes.length === 0 || warmupContacts.length === 0) return;

  // §8.10.1 row 30 — warm-up is exempt from company outreach policy, but not
  // from mailbox health: never warm an inbox whose domain is not 'healthy'.
  const domainsResult = await pool.query(
    `SELECT domain FROM wizmatch_domain_health WHERE tenant_id = $1 AND status = 'healthy'`,
    [tenantId],
  );
  const healthyDomains = new Set(domainsResult.rows.map((r: { domain: string }) => r.domain));
  const healthyInboxes = inboxes.filter((ib) => healthyDomains.has(ib.domain));
  if (healthyInboxes.length === 0) return { sent: 0, total: inboxes.length };

  let sent = 0;
  for (const inbox of healthyInboxes) {
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