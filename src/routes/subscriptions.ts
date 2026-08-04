import { Router, type Request, type Response } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, subscriptions, plans } from '../db/index';
import { getPaymentGatewayAdapter } from '../services/paymentGateway';
import type { SubscriptionProvider } from '../services/paymentGateway/types';
import logger from '../utils/logger';

const router = Router();

const VALID_PROVIDERS: SubscriptionProvider[] = ['cashfree', 'razorpay'];
function isValidProvider(value: unknown): value is SubscriptionProvider {
  return typeof value === 'string' && (VALID_PROVIDERS as string[]).includes(value);
}

// ---------------------------------------------------------------------------
// POST /api/subscriptions — provider-agnostic subscription creation.
//
// tenantId is ALWAYS taken from the authenticated caller (req.user.tenantId),
// never from the request body — this is what makes "a tenant can't create a
// subscription for another tenant" true by construction rather than an extra
// check that could be forgotten later. Matches this repo's convention (see
// src/routes/contacts.ts) of never trusting a client-supplied tenantId.
//
// `provider` is required in the body rather than resolved from a stored
// per-tenant/plan default — neither `tenants` nor `plans` has a "preferred
// gateway" column today; adding one is out of scope for this PR and flagged
// in the PR description for the two adapter PRs (Cashfree/Razorpay) to weigh
// in on before it's added.
// ---------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const { planId, provider, returnUrl } = req.body as {
      planId?: string;
      provider?: string;
      returnUrl?: string;
    };

    if (!planId || typeof planId !== 'string') {
      res.status(400).json({ error: 'planId is required' });
      return;
    }
    if (!isValidProvider(provider)) {
      res.status(400).json({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
      return;
    }

    const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    if (!plan || !plan.isActive) {
      res.status(404).json({ error: 'plan not found' });
      return;
    }

    const adapter = getPaymentGatewayAdapter(provider);
    const resolvedReturnUrl =
      returnUrl || `${process.env.FRONTEND_URL || 'https://web-production-311da.up.railway.app'}/billing/thank-you`;

    const { providerSubscriptionId, authorizationUrl } = await adapter.createSubscription({
      tenantId,
      planId,
      customerEmail: req.user!.email,
      returnUrl: resolvedReturnUrl,
    });

    const [created] = await db
      .insert(subscriptions)
      .values({
        tenantId,
        planId,
        status: 'created',
        paymentProvider: provider,
        providerSubscriptionId,
        currency: plan.currency,
      })
      .returning();

    res.status(201).json({ subscriptionId: created.id, authorizationUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[subscriptions] create error:', msg);
    res.status(500).json({ error: msg });
  }
});

// GET /api/subscriptions — the caller's own tenant's subscriptions only.
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const rows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .orderBy(desc(subscriptions.createdAt));
    res.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[subscriptions] list error:', msg);
    res.status(500).json({ error: msg });
  }
});

// GET /api/subscriptions/:id — tenant-scoped lookup. The tenant predicate is
// folded into the SAME query as the id lookup (not checked afterwards), so a
// request for another tenant's subscription id 404s exactly like a
// non-existent id — it can't be used to enumerate ids across tenants.
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const id = req.params.id as string;
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.tenantId, tenantId)))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: 'subscription not found' });
      return;
    }
    res.json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[subscriptions] get error:', msg);
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/subscriptions/:id/cancel — same tenant-scoping posture as GET
// /:id above: the WHERE clause enforces ownership, not a check after load.
// ---------------------------------------------------------------------------
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const id = req.params.id as string;

    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.tenantId, tenantId)))
      .limit(1);
    if (!subscription) {
      res.status(404).json({ error: 'subscription not found' });
      return;
    }

    const adapter = getPaymentGatewayAdapter(subscription.paymentProvider as SubscriptionProvider);
    await adapter.cancelSubscription(subscription.providerSubscriptionId);

    await db
      .update(subscriptions)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(subscriptions.id, subscription.id));

    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[subscriptions] cancel error:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
