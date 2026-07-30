import { type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db, users } from '../db/index';
import { eq } from 'drizzle-orm';

export interface AuthPayload {
  id: string;
  email: string;
  tenantId: string;
  tenantSlug?: string;
  product?: string;
  role: string;
  tokenVersion: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

const JWT_SECRET_VALUE = process.env.JWT_SECRET;

// tokenVersion revocation cache. requireAuth previously only checked that the
// JWT *carried* a tokenVersion claim, never that it matched the user's
// current value in the DB — so a password reset or forced logout (which
// bumps users.tokenVersion) did not actually invalidate already-issued
// tokens on ~40 of the ~43 mounts using requireAuth; only the 3 mounts using
// requireStrictAuth got real revocation. A stolen token kept working
// everywhere else for up to its full 7-day expiry.
//
// Querying the DB on every request would add a round-trip to every
// authenticated call, so results are cached per-user for a short TTL. This
// bounds "how long can a revoked token still work" to the TTL instead of the
// full token lifetime, while keeping the common case cache-hit-cheap.
const TOKEN_VERSION_CACHE_TTL_MS = 30_000;

// H-1 (QA 2026-07-30) — this cache carries the user's `tenant_id` alongside
// `token_version` because BOTH are now verified against the database.
//
// The defect it closes: `requireAuth` verified the JWT signature and the DB
// `token_version`, but never compared the token's `tenantId` CLAIM against the
// user's actual `users.tenant_id`. Handlers scope their queries by
// `req.user.tenantId`, taken verbatim from the token — so anyone able to mint a
// token could re-sign their own otherwise-valid claims with a different
// `tenantId` and read another tenant's rows with HTTP 200. The `token_version`
// check could not contain this: it is keyed on `users.id`, so the attacker's own
// id and own current version match, and the tenant was the only tampered claim.
//
// The practical bar was Railway project read access rather than a secret
// compromise, because `list_variables` returns `JWT_SECRET` in plaintext
// (finding M-11). Two tenants matter here: both pilot operators hold accounts in
// two of them, so tenant binding is load-bearing, not theoretical.
//
// Reading `tenant_id` costs nothing extra — it is added to the SAME single-row
// select and cached under the same TTL, so the warm path still issues no query.
type CachedIdentity = { tokenVersion: number; tenantId: string | null; isActive: boolean | null };
const identityCache = new Map<string, { identity: CachedIdentity; expiresAt: number }>();

async function currentIdentity(userId: string): Promise<CachedIdentity | null> {
  const cached = identityCache.get(userId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.identity;
  const [user] = await db
    .select({ tokenVersion: users.tokenVersion, tenantId: users.tenantId, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;
  const identity: CachedIdentity = {
    tokenVersion: user.tokenVersion || 1,
    tenantId: user.tenantId ?? null,
    isActive: user.isActive ?? null,
  };
  identityCache.set(userId, { identity, expiresAt: now + TOKEN_VERSION_CACHE_TTL_MS });
  return identity;
}

// Both checks live here so `requireAuth` and `optionalAuth` cannot drift apart
// again — H-4 was exactly that drift for the token_version half.
// Returns null when the identity is acceptable, or a reason string when it is not.
function identityMismatch(identity: CachedIdentity | null, payload: AuthPayload): string | null {
  if (identity === null) return 'user no longer exists';
  // Deactivation must be a kill switch on its own (QA 2026-07-30).
  //
  // Login gates on `is_active` (`src/routes/auth.ts:83`), but nothing re-checked
  // it per request, so a token issued BEFORE deactivation kept working for up to
  // its full 7-day expiry. The supported offboarding path
  // (`permissions.ts:306-311`) bumps `token_version` in the same UPDATE, so it
  // was never exploitable through the API — but that made session death depend
  // on remembering to bump a second column. Any other route to deactivation (a
  // direct SQL fix, a future code path, or that UPDATE partially applying) left
  // live sessions alive. Checking it here makes `is_active` authoritative by
  // itself, bounded by the same 30s cache TTL as revocation.
  //
  // `=== false` deliberately, NOT falsy: the column is nullable and login treats
  // NULL as active (`is_active IS NULL OR is_active = true`). A truthiness test
  // would log out every user whose row predates the column's backfill.
  if (identity.isActive === false) return 'user is deactivated';
  if (identity.tokenVersion !== payload.tokenVersion) return 'token_version revoked';
  // Also fails closed when the user row's tenant_id is NULL: both callers
  // already reject a token whose `tenantId` claim is falsy before reaching here,
  // so a NULL on the DB side can only ever be unequal to a non-empty claim. A
  // separate `!identity.tenantId` branch would be unreachable — deliberately not
  // added, because a guard no test can turn red is indistinguishable from a
  // vacuous one. `fails closed (401) when the user row carries a NULL tenant_id`
  // in auth.test.ts pins this behaviour through this comparison.
  if (identity.tenantId !== payload.tenantId) return 'tenant mismatch';
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorised' });
    return;
  }

  const secret = JWT_SECRET_VALUE || process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'server misconfigured' });
    return;
  }

  const token = header.slice(7);
  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, secret) as AuthPayload;
  } catch {
    res.status(401).json({ error: 'invalid or expired token' });
    return;
  }

  if (!payload.role || !payload.tokenVersion || !payload.id || !payload.tenantId) {
    res.status(401).json({ error: 'invalid token — missing claims' });
    return;
  }

  try {
    const mismatch = identityMismatch(await currentIdentity(payload.id), payload);
    if (mismatch) {
      // Deliberately one opaque message for every mismatch reason. Telling a
      // caller "tenant mismatch" (or echoing the real tenant) would confirm
      // which claim was rejected and leak the user's true tenant; the reason is
      // logged server-side instead.
      console.warn(`[auth] requireAuth rejected token for user ${payload.id}: ${mismatch}`);
      res.status(401).json({ error: 'session expired — please log in again' });
      return;
    }
  } catch (e) {
    // Fail closed on DB error. A transient blip will log users out briefly
    // (mitigated by the cache above for anyone with a recent hit); letting
    // requests through without this check is the actual security hole — a
    // revoked session could otherwise be re-used until the DB comes back.
    console.error('[auth] requireAuth tokenVersion lookup failed:', e instanceof Error ? e.message : e);
    res.status(401).json({ error: 'session check unavailable — please retry' });
    return;
  }

  req.user = payload;
  // Read-only 'viewer' service role may issue only safe (read) methods. Additive and gated on
  // a role no human user holds, so this cannot change any existing flow.
  if (payload.role === 'viewer' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.status(403).json({ error: 'forbidden', message: 'viewer role is read-only' });
    return;
  }
  next();
}

// Optional auth — parses JWT if present, but allows requests without it.
//
// Revocation parity with requireAuth (added 2026-07-30). Previously this
// checked only that the JWT *carried* a tokenVersion claim, never that it
// matched the user's current `users.token_version` — so a session revoked by a
// password reset or an offboarding token bump kept on authenticating here until
// the JWT expired naturally (up to 7 days). requireAuth has done the DB check
// since the tokenVersion cache was introduced; this closes the last mount that
// did not.
//
// A stale/revoked token DEGRADES TO ANONYMOUS rather than 401: this is
// *optional* auth, mounted on a route that legitimately serves unauthenticated
// callers (`/api/outreach/leads`, which authorises by OUTREACH_INTERNAL_SECRET
// and reads no `req.user` at all today). Rejecting outright would break that
// contract for any client holding a stale token; refusing to populate
// `req.user` removes the privilege without changing the route's reachability.
// The DB lookup reuses the same 30s-TTL cache as requireAuth, so this adds no
// per-request query in the warm path, and any lookup failure also degrades to
// anonymous (fail closed).
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const secret = JWT_SECRET_VALUE || process.env.JWT_SECRET;
    if (secret) {
      try {
        const payload = jwt.verify(header.slice(7), secret) as AuthPayload;
        // Fail closed for incomplete tokens — never default to admin
        if (payload.role && payload.tokenVersion && payload.id && payload.tenantId) {
          // Same identity check as requireAuth (token_version AND tenant
          // binding) — see identityMismatch. A failure here leaves req.user
          // unset, degrading to anonymous rather than 401ing.
          if (!identityMismatch(await currentIdentity(payload.id), payload)) {
            req.user = payload;
          }
        }
      } catch { /* token invalid, or tokenVersion lookup failed — continue without user */ }
    }
  }
  // Same read-only guard for the 'viewer' service role on optional-auth routes.
  if (req.user?.role === 'viewer' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    _res.status(403).json({ error: 'forbidden', message: 'viewer role is read-only' });
    return;
  }
  next();
}

// requireStrictAuth used to additionally verify tokenVersion against the DB
// on top of requireAuth's claims-only check — that DB check now lives in
// requireAuth itself (see above), so this is a plain alias kept for the
// existing 3 call sites (cashfree admin, billing, permissions) rather than
// churning their imports. Do not remove without updating those mounts.
export const requireStrictAuth = requireAuth;

// Standalone JWT verification (claims-only, no DB tokenVersion check) for
// non-Express call sites — currently the Socket.io connection handshake,
// which needs the same "is this a valid token" check as requireAuth but
// outside the req/res middleware shape. Returns null on any failure.
export function verifyAuthToken(token: string): AuthPayload | null {
  const secret = JWT_SECRET_VALUE || process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(token, secret) as AuthPayload;
    if (!payload.role || !payload.tokenVersion || !payload.id || !payload.tenantId) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Socket.io handshake verification with the SAME identity checks as requireAuth
 * (QA 2026-07-30).
 *
 * `verifyAuthToken` above is claims-only — it never touches the database. The
 * Socket.io handshake (`src/index.ts`) used it, so its own comment's claim of
 * "same verification rules as every HTTP route" stopped being true the moment
 * requireAuth gained the DB token_version check: a revoked or offboarded user
 * holding a still-valid JWT could open a live, tenant-scoped inbox stream and
 * keep it until the token expired naturally, up to 7 days.
 *
 * This reuses `currentIdentity` and `identityMismatch`, so the socket lane gets
 * revocation, tenant binding and the deactivation kill switch on exactly the
 * same terms as HTTP, through the same 30s cache.
 *
 * KNOWN LIMITATION, stated rather than implied: this runs at HANDSHAKE only.
 * An already-established connection is not re-checked, so revocation takes
 * effect for the socket lane on the next connection attempt, not mid-stream.
 * Closing that needs a periodic re-validation sweep over live sockets.
 */
export async function verifyAuthTokenForHandshake(token: string): Promise<AuthPayload | null> {
  const payload = verifyAuthToken(token);
  if (!payload) return null;
  try {
    if (identityMismatch(await currentIdentity(payload.id), payload)) return null;
    return payload;
  } catch {
    // Fail closed, matching requireAuth's posture on a lookup error.
    return null;
  }
}
