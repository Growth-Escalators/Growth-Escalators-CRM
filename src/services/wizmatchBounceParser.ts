/**
 * Bounce (NDR) detection for Wizmatch outreach.
 *
 * Most target companies are on Google Workspace / Microsoft 365 where we cannot
 * pre-verify a guessed email — the only reliable confirmation is a send that does
 * not bounce. This parses inbound Non-Delivery Reports so a hard bounce can add the
 * address to the suppression list ("verify by sending"). Detection is always free;
 * suppression writes are gated behind WIZMATCH_BOUNCE_SUPPRESSION_ENABLED (default off).
 */
import logger from '../utils/logger';
import { suppress } from '../modules/outreach/outreachGate';

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

/**
 * PRD-005 §22.3 A-4 — hard bounces are now ALWAYS persisted; the prior
 * WIZMATCH_BOUNCE_SUPPRESSION_ENABLED flag (default off, meaning bounces were
 * detected then discarded) is deleted. Kept only as a no-op compatibility
 * export in case any other code still references the name.
 */
export function bounceSuppressionEnabled(): boolean {
  return true;
}

/** Adds a hard-bounced address to the Wizmatch suppression list (idempotent), via the gate's sole suppression write path. */
export async function recordHardBounce(recipient: string, meta: { inbox?: string } = {}): Promise<void> {
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  if (!tenantId) return;
  try {
    await suppress({
      tenantId,
      email: recipient,
      reason: 'hard_bounce',
      sourceChannel: 'email',
      source: `bounce_parser${meta.inbox ? `:${meta.inbox}` : ''}`,
    });
    logger.info({ recipient, inbox: meta.inbox }, '[wizmatch-bounce] hard bounce suppressed');
  } catch (err) {
    logger.warn({ err, recipient }, '[wizmatch-bounce] failed to record hard bounce');
  }
}
