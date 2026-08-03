import { createHash } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db, processedEvents, subscriptions, plans } from '../db/index';
import { applyPlanEntitlementsToTenant } from './tenantFeatures';
import logger from '../utils/logger';
import type { NormalizedSubscriptionEvent, SubscriptionProvider } from './paymentGateway/types';

export type SubscriptionProcessResult =
  | { ok: true; status: 'skipped'; reason: string }
  | { ok: true; status: 'processed'; subscriptionId: string; newStatus: string };

/**
 * Idempotent processing of a normalized subscription webhook event, common
 * to every provider (Cashfree, Razorpay, ...future). Mirrors the
 * claim-then-release idempotency pattern in cashfreeEventProcessor.ts:
 *
 *   - Atomically claim the event via INSERT ... ON CONFLICT DO NOTHING into
 *     `processed_events`, so two concurrent/retried deliveries of the exact
 *     same webhook can't both process — only one wins the claim.
 *   - The claim key is a SHA-256 hash of the raw webhook body, not a
 *     provider-supplied event id (NormalizedSubscriptionEvent doesn't carry
 *     one — the shared contract only guarantees type/providerSubscriptionId/
 *     amount/currency/raw). Hashing the raw bytes means the exact same
 *     delivery (a provider retry resending byte-identical JSON) always maps
 *     to the same key and is skipped, while a genuinely new event — even a
 *     second `subscription.charged` for the same subscription — has
 *     different raw content (different timestamp/charge id at minimum) and
 *     gets its own key, so renewals still extend on every real charge.
 *   - On any thrown error after the claim, the claim row is deleted so the
 *     provider's automatic webhook retry can reprocess instead of the event
 *     being permanently (and silently) marked done with no DB update ever
 *     applied.
 */
export async function processSubscriptionEvent(
  provider: SubscriptionProvider,
  rawBody: string,
  event: NormalizedSubscriptionEvent,
): Promise<SubscriptionProcessResult> {
  const bodyHash = createHash('sha256').update(rawBody).digest('hex');
  const eventId = `subscription:${provider}:${bodyHash}`;

  const claim = await db
    .insert(processedEvents)
    .values({ eventId, source: 'subscription' })
    .onConflictDoNothing()
    .returning();
  if (claim.length === 0) {
    logger.info(`[subscription-webhook] ${eventId} already claimed — skipping`);
    return { ok: true, status: 'skipped', reason: 'already processed' };
  }

  try {
    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.paymentProvider, provider),
          eq(subscriptions.providerSubscriptionId, event.providerSubscriptionId),
        ),
      )
      .limit(1);

    if (!subscription) {
      // A webhook for a subscription this instance never created (e.g. a
      // stale/replayed test event, or the provider's id and ours drifted).
      // Not an error worth a 500/retry storm — log and move on.
      logger.warn(
        `[subscription-webhook] no local subscription for ${provider}:${event.providerSubscriptionId} — skipping`,
      );
      return { ok: true, status: 'skipped', reason: 'unknown subscription' };
    }

    let newStatus = subscription.status;
    const updates: { status?: string; updatedAt: Date; renewalDate?: Date } = { updatedAt: new Date() };

    switch (event.type) {
      case 'subscription.activated': {
        newStatus = 'active';
        updates.status = newStatus;
        // Entitlements are applied as a best-effort side effect: a failure
        // here must not unwind the subscription-status update above (the
        // subscription really is active at the gateway either way), and
        // must not throw the whole webhook into the catch block below,
        // which would release the idempotency claim and cause the entire
        // event — status update included — to be reprocessed on retry.
        const [plan] = await db.select().from(plans).where(eq(plans.id, subscription.planId)).limit(1);
        if (plan) {
          await applyPlanEntitlementsToTenant(subscription.tenantId, plan.featureEntitlements).catch((e) => {
            logger.error(
              `[subscription-webhook] failed to apply plan entitlements for tenant ${subscription.tenantId}:`,
              e,
            );
          });
        } else {
          logger.error(
            `[subscription-webhook] subscription ${subscription.id} references missing plan ${subscription.planId} — entitlements not applied`,
          );
        }
        break;
      }
      case 'subscription.charged': {
        newStatus = 'active';
        updates.status = newStatus;
        // No provider gives us an authoritative "next billing date" through
        // this shared contract (NormalizedSubscriptionEvent has no such
        // field) — extend 30 days from whichever is later, the existing
        // renewalDate or now, so an early/duplicate-but-distinct charge
        // event can't shorten a renewal that's already further out.
        const base =
          subscription.renewalDate && subscription.renewalDate.getTime() > Date.now()
            ? subscription.renewalDate
            : new Date();
        const next = new Date(base);
        next.setDate(next.getDate() + 30);
        updates.renewalDate = next;
        break;
      }
      case 'subscription.cancelled': {
        newStatus = 'cancelled';
        updates.status = newStatus;
        break;
      }
      case 'subscription.failed': {
        newStatus = 'failed';
        updates.status = newStatus;
        break;
      }
    }

    await db.update(subscriptions).set(updates).where(eq(subscriptions.id, subscription.id));

    return { ok: true, status: 'processed', subscriptionId: subscription.id, newStatus };
  } catch (err) {
    await db.delete(processedEvents).where(eq(processedEvents.eventId, eventId)).catch((delErr) => {
      logger.error(
        `[subscription-webhook] CRITICAL: failed to release claim for ${eventId} after a processing error — this event will NOT be retried automatically. Manual replay required.`,
        delErr,
      );
    });
    throw err;
  }
}
