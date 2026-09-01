import { createHmac, timingSafeEqual } from 'crypto';
import {
  KAPSO_API_KEY,
  KAPSO_BASE_URL,
  KAPSO_PHONE_NUMBER_ID,
  KAPSO_GRAPH_VERSION,
  KAPSO_WEBHOOK_SECRET,
} from '../../config/constants';
import { redactPhone } from '../phoneService';
import logger from '../../utils/logger';

/**
 * The single outbound WhatsApp transport for automated messages.
 *
 * Kapso proxies the Meta Graph API: the request body is byte-identical to the
 * Cloud API call the CRM already makes elsewhere, only the host and the auth
 * header differ (X-API-Key instead of Authorization: Bearer). That means this
 * client can be pointed back at graph.facebook.com later by changing two
 * values, with no change to callers.
 *
 * Nothing in here decides WHETHER to send — that is outboundPolicy's job. This
 * module only knows how to talk to Kapso, classify the response, and keep
 * customer phone numbers out of the logs.
 */

export type SendOutcome =
  | { ok: true; messageId: string }
  /** Retry is worth attempting: network fault, timeout, 429, 5xx. */
  | { ok: false; retryable: true; error: string; status?: number }
  /** Never retry: Meta rejected the message on its merits. */
  | { ok: false; retryable: false; error: string; status?: number };

export interface TemplateVariable {
  type: 'text';
  text: string;
}

const REQUEST_TIMEOUT_MS = Number(process.env.KAPSO_TIMEOUT_MS ?? '10000');

/**
 * Meta error codes that will never succeed on retry. Retrying these burns
 * quota and, for 131047/131026, actively harms number quality.
 *   131026 — message undeliverable (recipient not on WhatsApp)
 *   131047 — re-engagement required (outside the 24h window, no template)
 *   131051 — unsupported message type
 *   132000 — template param count mismatch
 *   132001 — template does not exist / not approved in this language
 *   132005 — template text too long after substitution
 *   132007 — template format/character policy violation
 *   132012 — template parameter format mismatch
 *   132015 — template is paused
 *   132016 — template is disabled
 *   133010 — phone number not registered
 *   100    — generic invalid parameter
 */
const PERMANENT_META_CODES = new Set([
  100, 131026, 131047, 131051, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 133010,
]);

export function isConfigured(): boolean {
  return Boolean(KAPSO_API_KEY && KAPSO_PHONE_NUMBER_ID);
}

/**
 * Send an approved template message.
 *
 * @param toE164     Destination in E.164 (with or without leading +).
 * @param template   Approved template name.
 * @param language   Template language code, must match Meta exactly.
 * @param variables  Ordered body variables ({{1}}, {{2}}, ...).
 */
export async function sendTemplate(
  toE164: string,
  template: string,
  language: string,
  variables: TemplateVariable[],
): Promise<SendOutcome> {
  if (!isConfigured()) {
    return { ok: false, retryable: false, error: 'kapso_not_configured' };
  }

  const to = toE164.replace(/^\+/, '');
  const url = `${KAPSO_BASE_URL}/meta/whatsapp/${KAPSO_GRAPH_VERSION}/${KAPSO_PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: template,
      language: { code: language },
      components: variables.length
        ? [{ type: 'body', parameters: variables }]
        : [],
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text().catch(() => '');
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }

    if (res.ok) {
      const messages = parsed.messages as Array<{ id?: string }> | undefined;
      const messageId = messages?.[0]?.id;
      if (!messageId) {
        // 200 with no message id should not be treated as success — we would
        // have nothing to reconcile the delivery webhook against.
        return { ok: false, retryable: true, error: 'kapso_200_without_message_id', status: res.status };
      }
      logger.info(`[kapso] template sent to ${redactPhone(toE164)} (${template})`);
      return { ok: true, messageId };
    }

    const metaError = (parsed.error ?? {}) as { code?: number; message?: string; type?: string };
    const code = typeof metaError.code === 'number' ? metaError.code : undefined;
    // Truncate and never echo the destination number back into the log line.
    const detail = `${res.status}${code ? `/${code}` : ''}: ${(metaError.message ?? text).slice(0, 180)}`;

    const permanentByCode = code !== undefined && PERMANENT_META_CODES.has(code);
    const permanentByStatus = res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404;
    const retryableByStatus = res.status === 429 || res.status >= 500;

    // A 4xx we do not recognise is treated as permanent: re-sending a message
    // Meta already refused is the behaviour most likely to damage the number.
    const retryable = retryableByStatus || (!permanentByCode && !permanentByStatus);

    logger.warn(`[kapso] send failed for ${redactPhone(toE164)} — ${detail} (retryable=${retryable})`);
    return { ok: false, retryable, error: detail, status: res.status };
  } catch (e) {
    const err = e as Error;
    const isTimeout = err.name === 'AbortError';
    logger.warn(`[kapso] transport error for ${redactPhone(toE164)} — ${isTimeout ? 'timeout' : err.message}`);
    return {
      ok: false,
      retryable: true,
      error: isTimeout ? 'kapso_timeout' : `kapso_transport: ${err.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify a Kapso webhook signature.
 *
 * Kapso signs the raw request body with HMAC-SHA256 and sends the hex digest in
 * `X-Webhook-Signature`. We compare against `req.rawBody`, which index.ts
 * already captures in the express.json verify hook — re-serialising req.body
 * would not reproduce the original bytes.
 *
 * Fails closed: an unset secret rejects every request rather than waving them
 * through, because this endpoint mutates opt-out state.
 */
export function verifyWebhookSignature(rawBody: string | undefined, signature: string | undefined): boolean {
  if (!KAPSO_WEBHOOK_SECRET) {
    logger.error('[kapso] KAPSO_WEBHOOK_SECRET is not set — rejecting webhook');
    return false;
  }
  if (!rawBody || !signature) return false;

  const expected = createHmac('sha256', KAPSO_WEBHOOK_SECRET).update(rawBody, 'utf8').digest('hex');
  // Accept both bare hex and a "sha256=" prefixed form.
  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature;

  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(provided, 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
