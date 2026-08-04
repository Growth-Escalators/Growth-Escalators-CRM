// Route-level enforcement for `src/services/tenantFeatures.ts`.
//
// WHY THIS EXISTS. `getTenantFeatures()` shipped with zero call sites on any
// request-serving HTTP route — it was consulted only by background cron
// helpers (`getActiveTenantsWithFeature`/`getSingleActiveTenantWithFeature`
// in worker.ts, drainers, etc). That meant a tenant whose plan turns e.g.
// `wizmatch` or `gstBilling` off could still successfully call those routes
// via the API: not a cross-tenant leak (a caller only ever sees rows scoped
// to their own `req.user.tenantId`, same as every other route in this repo),
// but the plan entitlement itself was not actually enforced — a
// reseller-pilot tenant could use a Growth-Escalators-internal product
// surface it was never sold.
//
// This middleware is that enforcement. Mount it AFTER `requireAuth` (it reads
// `req.user.tenantId`, which only `requireAuth`/`requireStrictAuth` populate)
// and BEFORE the router it protects.
//
// Fail-closed on every exit, matching this file's siblings
// (`requirePlatformSuperadmin` in rbac.ts, `wizmatchPilotGate.ts`): missing
// `req.user`, a tenant row that no longer exists, or the DB call throwing all
// deny with 403 rather than falling through to the router.
import type { Request, Response, NextFunction } from 'express';
import { getTenantFeatures, type TenantFeatureFlags } from '../services/tenantFeatures';

export function requireTenantFeature(feature: keyof TenantFeatureFlags) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: 'unauthorised', message: 'Authentication is required' });
      return;
    }
    try {
      const features = await getTenantFeatures(tenantId);
      if (features[feature]) {
        next();
        return;
      }
      res.status(403).json({
        error: 'feature_not_enabled',
        message: `This feature ('${feature}') is not enabled for your account.`,
      });
    } catch (error) {
      // getTenantFeatures() throws if the tenant row itself is gone (e.g. a
      // deleted/deactivated tenant whose users still hold a live JWT — see
      // auth.ts's identityMismatch, which already fails closed on a similar
      // shape of "the DB no longer agrees with the token" case). Deny rather
      // than 500, so a data hiccup here reads to the caller exactly like a
      // disabled feature, not a server outage.
      console.error(`[require-tenant-feature] lookup failed for tenant=${tenantId} feature=${feature}:`, error);
      res.status(403).json({ error: 'feature_not_enabled', message: `This feature ('${feature}') is not enabled for your account.` });
    }
  };
}
