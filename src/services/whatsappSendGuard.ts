import { pool } from '../db/index';
import logger from '../utils/logger';
import { DEFAULT_TENANT_SLUG } from '../config/constants';

// ---------------------------------------------------------------------------
// GE-tenant guard for the shared WhatsApp send path
// ---------------------------------------------------------------------------
// Extracted from the now-deleted Growth OS feature (services/growthOSSetup.ts)
// because two non-Growth-OS callers depend on it: assetDeliveryService.ts's
// D2C post-purchase asset delivery (sendWhatsAppMessage) and
// cashfreeEventProcessor.ts's purchase-confirmation WhatsApp send
// (canSendGrowthOSWhatsApp — name kept verbatim from the extraction, not
// renamed, to keep that payment-adjacent change a pure import-path repoint).
//
// There is no per-tenant WhatsApp Business number yet — every send below
// goes out through GE's own META_PHONE_NUMBER_ID/META_ACCESS_TOKEN. Same
// invariant as canSendWhatsApp() in routes/inbox.ts: only a caller resolved
// to GE's own tenant may be delivered to over that shared identity — a
// reseller tenant's send must be silently skipped rather than sent under
// GE's identity.
let _geTenantIdPromise: Promise<string | null> | null = null;
async function resolveGeTenantId(): Promise<string | null> {
  if (!_geTenantIdPromise) {
    _geTenantIdPromise = pool.query(`SELECT id FROM tenants WHERE slug = $1 LIMIT 1`, [DEFAULT_TENANT_SLUG])
      .then(r => (r.rows[0] as { id?: string } | undefined)?.id ?? null)
      .catch(() => null);
  }
  const id = await _geTenantIdPromise;
  if (!id) _geTenantIdPromise = null; // allow retry on next call if the lookup failed
  return id;
}

/** Fail-closed: a client with no tenant_id (never GE) is blocked, same as a
 *  missing tenantSlug claim in routes/inbox.ts's canSendWhatsApp(). */
export async function canSendGrowthOSWhatsApp(clientTenantId: string | null | undefined): Promise<boolean> {
  if (!clientTenantId) return false;
  const geTenantId = await resolveGeTenantId();
  return geTenantId !== null && clientTenantId === geTenantId;
}

// Test-only escape hatch — lets tests reset the memoized GE tenant id between cases.
export function __resetGeTenantCacheForTests(): void {
  _geTenantIdPromise = null;
}

// ---------------------------------------------------------------------------
// Shared WhatsApp send utility
// ---------------------------------------------------------------------------
export async function sendWhatsAppMessage(to: string, text: string): Promise<boolean> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? process.env.META_PHONE_NUMBER_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    logger.warn('[whatsapp-send] WhatsApp not configured — WHATSAPP_PHONE_NUMBER_ID or META_ACCESS_TOKEN missing');
    return false;
  }

  const phone = to.replace(/\D/g, '');

  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: text },
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      logger.error(`[whatsapp-send] WhatsApp send failed ${res.status}:`, err.slice(0, 200));
      return false;
    }
    logger.info(`[whatsapp-send] WhatsApp sent to ${phone}`);
    return true;
  } catch (e) {
    logger.error('[whatsapp-send] WhatsApp send error:', e instanceof Error ? e.message : String(e));
    return false;
  }
}
