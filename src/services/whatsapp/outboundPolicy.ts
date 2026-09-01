import { and, eq, gte, sql } from 'drizzle-orm';
import { db, contacts, messages, waMonthlyUsage } from '../../db/index';
import { canSendGrowthOSWhatsApp } from '../whatsappSendGuard';
import {
  WHATSAPP_AUTOMATION_ENABLED,
  WHATSAPP_TEST_MODE,
  WHATSAPP_TEST_ALLOWLIST,
  WHATSAPP_MONTHLY_HARD_LIMIT,
  WHATSAPP_MONTHLY_WARN_THRESHOLD,
  WA_ACK_COOLDOWN_HOURS,
  KAPSO_SENDER_E164,
} from '../../config/constants';
import { parsePhone } from '../phoneService';
import logger from '../../utils/logger';

/**
 * The gate every automated WhatsApp send must pass through.
 *
 * All message-safety rules live here, in one function, so a future caller
 * cannot bypass one by calling kapsoClient directly. The only thing that should
 * ever call kapsoClient for automation is a worker that called this first.
 *
 * Scope: AUTOMATED sends only. A human reply typed in the Kapso inbox or the
 * WhatsApp Business app never passes through here and is never blocked —
 * including when the monthly budget is exhausted.
 */

export type PolicyDecision =
  | { allowed: true; toE164: string }
  | { allowed: false; status: PolicySkipStatus; reason: string };

export type PolicySkipStatus =
  | 'skipped_disabled'
  | 'skipped_wrong_tenant'
  | 'skipped_no_consent'
  | 'opted_out'
  | 'skipped_duplicate'
  | 'skipped_budget'
  | 'skipped_test_mode'
  | 'skipped_self_send'
  | 'failed_permanent';

function currentYearMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Decide whether an acknowledgement may be sent.
 *
 * Order matters: cheap in-memory checks run before database round-trips, and
 * consent is checked before anything that could be read as intent to send.
 */
export async function evaluate(params: {
  tenantId: string;
  contactId: string;
  phoneSubmitted: string;
  phoneE164: string | null;
  regionHint?: string;
  consentGiven: boolean;
}): Promise<PolicyDecision> {
  // 1. Emergency kill switch. Absent env var means OFF, not ON.
  if (!WHATSAPP_AUTOMATION_ENABLED) {
    return { allowed: false, status: 'skipped_disabled', reason: 'WHATSAPP_AUTOMATION_ENABLED is not true' };
  }

  /**
   * 2. Tenant identity. The Kapso number is Growth Escalators' own WhatsApp
   *    identity, exactly like META_PHONE_NUMBER_ID in whatsappSendGuard.ts and
   *    routes/inbox.ts. A reseller tenant's lead must be silently skipped
   *    rather than messaged under GE's identity. Same invariant, reused
   *    helper — not a second implementation of it.
   */
  if (!(await canSendGrowthOSWhatsApp(params.tenantId))) {
    return {
      allowed: false,
      status: 'skipped_wrong_tenant',
      reason: 'lead does not belong to the Growth Escalators tenant',
    };
  }

  // 3. Consent, before any send-shaped work happens.
  if (!params.consentGiven) {
    return { allowed: false, status: 'skipped_no_consent', reason: 'no WhatsApp consent on this submission' };
  }

  // 4. Central opt-out state. do_not_contact covers every channel; opted_in_wa
  //    is the WhatsApp-specific flag a STOP reply clears.
  const [contact] = await db
    .select({ doNotContact: contacts.doNotContact, optedInWa: contacts.optedInWa })
    .from(contacts)
    .where(eq(contacts.id, params.contactId))
    .limit(1);

  if (!contact) {
    return { allowed: false, status: 'failed_permanent', reason: 'contact not found' };
  }
  if (contact.doNotContact) {
    return { allowed: false, status: 'opted_out', reason: 'contact is marked do_not_contact' };
  }
  if (!contact.optedInWa) {
    return { allowed: false, status: 'opted_out', reason: 'contact has opted out of WhatsApp' };
  }

  // 5. Phone validity. Re-parsed here rather than trusted from the caller, so
  //    the gate holds even if an upstream path forgets to validate.
  const e164 = params.phoneE164
    ? params.phoneE164
    : (() => {
        const parsed = parsePhone(params.phoneSubmitted, params.regionHint);
        return parsed.ok ? parsed.e164 : null;
      })();

  if (!e164) {
    return { allowed: false, status: 'failed_permanent', reason: 'phone number is not valid E.164' };
  }

  // 6. Frequency protection — one automated acknowledgement per contact per
  //    cooldown window, however many forms they fill. This also means a lead a
  //    human has already messaged (coexistence records those as outbound) will
  //    not receive an automated template on top.
  const cooldownStart = new Date(Date.now() - WA_ACK_COOLDOWN_HOURS * 60 * 60 * 1000);
  const [recent] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.contactId, params.contactId),
        eq(messages.channel, 'whatsapp'),
        eq(messages.direction, 'outbound'),
        gte(messages.sentAt, cooldownStart),
      ),
    );

  if ((recent?.count ?? 0) > 0) {
    return {
      allowed: false,
      status: 'skipped_duplicate',
      reason: `an outbound WhatsApp message already went out within ${WA_ACK_COOLDOWN_HOURS}h`,
    };
  }

  /**
   * 7. Never message our own number. Meta's rejection for this is the generic
   *    "(#100) Invalid parameter", which the client classifies as permanent —
   *    so without this the acknowledgement fails silently and the log names
   *    nothing useful. Cheap check, saves a long hunt.
   */
  if (KAPSO_SENDER_E164) {
    const digits = (v: string) => v.replace(/\D/g, '');
    if (digits(e164) === digits(KAPSO_SENDER_E164)) {
      return {
        allowed: false,
        status: 'skipped_self_send',
        reason: 'destination is the sending number — WhatsApp cannot message itself',
      };
    }
  }

  // 8. Monthly budget. Fails closed below the Kapso free-tier ceiling.
  const usage = await getMonthlyUsage(params.tenantId);
  if (usage >= WHATSAPP_MONTHLY_HARD_LIMIT) {
    return {
      allowed: false,
      status: 'skipped_budget',
      reason: `monthly automated-send limit reached (${usage}/${WHATSAPP_MONTHLY_HARD_LIMIT})`,
    };
  }

  // 9. Test mode last, so everything above is exercised in staging exactly as
  //    it will run in production.
  if (WHATSAPP_TEST_MODE) {
    const allowed = WHATSAPP_TEST_ALLOWLIST.some((n) => n.replace(/^\+/, '') === e164.replace(/^\+/, ''));
    if (!allowed) {
      return {
        allowed: false,
        status: 'skipped_test_mode',
        reason: 'test mode is on and this number is not allowlisted',
      };
    }
  }

  return { allowed: true, toE164: e164 };
}

/** Automated sends this calendar month for a tenant. */
export async function getMonthlyUsage(tenantId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ sentCount: waMonthlyUsage.sentCount })
    .from(waMonthlyUsage)
    .where(and(eq(waMonthlyUsage.tenantId, tenantId), eq(waMonthlyUsage.yearMonth, currentYearMonth(now))))
    .limit(1);
  return row?.sentCount ?? 0;
}

/**
 * Increment the monthly counter after a successful send. Upsert so concurrent
 * workers cannot lose a count. Returns the new total.
 */
export async function recordSend(tenantId: string, now = new Date()): Promise<number> {
  const yearMonth = currentYearMonth(now);
  const result = await db.execute(sql`
    INSERT INTO wa_monthly_usage (tenant_id, year_month, sent_count, updated_at)
    VALUES (${tenantId}, ${yearMonth}, 1, NOW())
    ON CONFLICT (tenant_id, year_month)
    DO UPDATE SET sent_count = wa_monthly_usage.sent_count + 1, updated_at = NOW()
    RETURNING sent_count
  `);
  const row = result.rows[0] as { sent_count?: number } | undefined;
  const total = Number(row?.sent_count ?? 0);

  if (total === WHATSAPP_MONTHLY_WARN_THRESHOLD) {
    logger.warn(
      `[whatsapp] monthly automated sends reached the warning threshold: ${total}/${WHATSAPP_MONTHLY_HARD_LIMIT}`,
    );
  }
  return total;
}

/**
 * Words that end automation. Matched against the whole trimmed message so a
 * sentence containing "stop" ("please don't stop sending updates") is not an
 * opt-out — WhatsApp's guidance is to honour clear, unambiguous requests.
 */
const OPT_OUT_WORDS = new Set([
  'stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'opt out', 'opt-out',
  'remove me', 'do not message', "don't message", 'no more messages',
]);

export function isOptOutMessage(body: string): boolean {
  const normalized = (body ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.!,;:]+$/g, '')
    .replace(/\s+/g, ' ');
  if (!normalized) return false;
  return OPT_OUT_WORDS.has(normalized);
}
