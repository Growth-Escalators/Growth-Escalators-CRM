/**
 * Bounce (NDR) detection for Wizmatch outreach.
 *
 * Most target companies are on Google Workspace / Microsoft 365 where we cannot
 * pre-verify a guessed email — the only reliable confirmation is a send that does
 * not bounce. This parses inbound Non-Delivery Reports so a hard bounce can add the
 * address to the suppression list ("verify by sending"). Detection is always free;
 * suppression writes are gated behind WIZMATCH_BOUNCE_SUPPRESSION_ENABLED (default off).
 */
import { pool } from '../db/index';
import logger from '../utils/logger';

export interface ParsedBounce {
  isBounce: boolean;
  bouncedRecipient: string | null;
  hard: boolean; // permanent (5.x.x / 5xx / "user unknown") vs transient/unknown
}

const BOUNCE_SENDER = /(mailer-daemon|postmaster|mail-daemon)@/i;
const BOUNCE_SUBJECT = /(undeliverable|undelivered|delivery status notification|delivery failure|delivery has failed|returned mail|failure notice|mail delivery failed|delivery incomplete|not delivered)/i;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const SELF_DOMAINS = /@(purelymail|trulyinbox)\.com$/i;

/** Pure function: is this email a bounce, for whom, and is it permanent? */
export function parseBounce(email: { from: string; subject: string; body: string }): ParsedBounce {
  const from = (email.from || '').toLowerCase();
  const subject = email.subject || '';
  const body = email.body || '';

  const looksLikeBounce = BOUNCE_SENDER.test(from) || BOUNCE_SUBJECT.test(subject);
  if (!looksLikeBounce) return { isBounce: false, bouncedRecipient: null, hard: false };

  // Prefer RFC3464 DSN fields; then X-Failed-Recipients; then first plausible address.
  let recipient: string | null = null;
  const finalRcpt = body.match(/final-recipient:\s*rfc822;\s*([^\s]+)/i) || body.match(/original-recipient:\s*rfc822;\s*([^\s]+)/i);
  if (finalRcpt) recipient = finalRcpt[1].trim().toLowerCase();
  if (!recipient) {
    const xFailed = body.match(/x-failed-recipients:\s*([^\s]+)/i);
    if (xFailed) recipient = xFailed[1].trim().toLowerCase();
  }
  if (!recipient) {
    const addrs = (body.match(EMAIL_RE) || [])
      .map((a) => a.toLowerCase())
      .filter((a) => !BOUNCE_SENDER.test(`${a.split('@')[0]}@`) && !SELF_DOMAINS.test(a));
    recipient = addrs[0] || null;
  }

  // Permanent-failure markers.
  const dsnStatus = body.match(/status:\s*([245])\.\d+\.\d+/i);
  const smtp5xx = /\b5\d\d\b/.test(body);
  const permanentLang = /permanent|does not exist|no such user|user unknown|mailbox unavailable|address rejected|recipient not found|account.*disabled|no longer/i.test(body);
  const hard = (dsnStatus ? dsnStatus[1] === '5' : false) || smtp5xx || permanentLang;

  return { isBounce: Boolean(recipient), bouncedRecipient: recipient, hard };
}

/** Suppression writes are opt-in — merging this code changes nothing until the flag is set. */
export function bounceSuppressionEnabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env.WIZMATCH_BOUNCE_SUPPRESSION_ENABLED || '').toLowerCase());
}

/** Adds a hard-bounced address to the Wizmatch suppression list (idempotent). */
export async function recordHardBounce(recipient: string, meta: { inbox?: string } = {}): Promise<void> {
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  if (!tenantId) return;
  try {
    await pool.query(
      `INSERT INTO wizmatch_suppression_list (tenant_id, email, reason, source_channel, notes)
       VALUES ($1, LOWER($2), 'hard_bounce', 'email', $3)
       ON CONFLICT (tenant_id, email) DO NOTHING`,
      [tenantId, recipient, `Auto-suppressed on hard bounce${meta.inbox ? ` (via ${meta.inbox})` : ''}`],
    );
    logger.info({ recipient, inbox: meta.inbox }, '[wizmatch-bounce] hard bounce suppressed');
  } catch (err) {
    logger.warn({ err, recipient }, '[wizmatch-bounce] failed to record hard bounce');
  }
}
