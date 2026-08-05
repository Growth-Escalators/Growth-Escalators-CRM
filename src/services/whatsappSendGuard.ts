import { pool } from '../db/index';
import logger from '../utils/logger';
import { DEFAULT_TENANT_SLUG } from '../config/constants';

// ---------------------------------------------------------------------------
// Growth OS client → GE-tenant guard for the shared WhatsApp send path
// ---------------------------------------------------------------------------
// There is no per-tenant WhatsApp Business number for Growth OS yet — every
// send below goes out through GE's own META_PHONE_NUMBER_ID/META_ACCESS_TOKEN
// (see sendWhatsAppMessage below). Same invariant as canSendWhatsApp() in
// routes/inbox.ts: only a Growth OS client that belongs to GE's own tenant
// may be delivered to over that shared identity — a reseller tenant's client
// must have its WhatsApp step silently skipped rather than sent under GE's
// identity.
//
// Resolved from the client's `tenant_id` (not `req.user.tenantSlug`) because
// this guard also has to protect the daily/weekly Growth OS crons in
// worker.ts, which sweep every tenant's active clients with no `req` at all
// (see getActiveGrowthOSClients's tenantId-optional comment above) — so the
// check has to live where both the HTTP route and the cron actually call
// through, not duplicated at each caller.
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
    logger.warn('[growth-os] WhatsApp not configured — WHATSAPP_PHONE_NUMBER_ID or META_ACCESS_TOKEN missing');
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
      logger.error(`[growth-os] WhatsApp send failed ${res.status}:`, err.slice(0, 200));
      return false;
    }
    logger.info(`[growth-os] WhatsApp sent to ${phone}`);
    return true;
  } catch (e) {
    logger.error('[growth-os] WhatsApp send error:', e instanceof Error ? e.message : String(e));
    return false;
  }
}
