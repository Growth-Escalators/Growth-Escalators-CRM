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
const tokenVersionCache = new Map<string, { tokenVersion: number; expiresAt: number }>();

async function currentTokenVersion(userId: string): Promise<number | null> {
  const cached = tokenVersionCache.get(userId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.tokenVersion;
  const [user] = await db.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  const tokenVersion = user.tokenVersion || 1;
  tokenVersionCache.set(userId, { tokenVersion, expiresAt: now + TOKEN_VERSION_CACHE_TTL_MS });
  return tokenVersion;
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
    const dbTokenVersion = await currentTokenVersion(payload.id);
    if (dbTokenVersion === null || dbTokenVersion !== payload.tokenVersion) {
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

// Optional auth — parses JWT if present, but allows requests without it
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const secret = JWT_SECRET_VALUE || process.env.JWT_SECRET;
    if (secret) {
      try {
        const payload = jwt.verify(header.slice(7), secret) as AuthPayload;
        // Fail closed for incomplete tokens — never default to admin
        if (payload.role && payload.tokenVersion && payload.id && payload.tenantId) {
          req.user = payload;
        }
      } catch { /* token invalid — continue without user */ }
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
