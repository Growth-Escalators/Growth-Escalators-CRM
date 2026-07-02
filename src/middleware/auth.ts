import { type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db, users } from '../db/index';
import { eq } from 'drizzle-orm';

export interface AuthPayload {
  id: string;
  email: string;
  tenantId: string;
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

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
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
  try {
    const payload = jwt.verify(token, secret) as AuthPayload;
    if (!payload.role || !payload.tokenVersion || !payload.id || !payload.tenantId) {
      res.status(401).json({ error: 'invalid token — missing claims' });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'invalid or expired token' });
  }
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
  next();
}

// Strict auth: also verifies tokenVersion against DB (use for sensitive endpoints)
export function requireStrictAuth(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, async () => {
    if (!req.user) return;
    try {
      const [user] = await db.select({ tokenVersion: users.tokenVersion }).from(users)
        .where(eq(users.id, req.user.id)).limit(1);
      if (!user || (user.tokenVersion || 1) !== req.user.tokenVersion) {
        res.status(401).json({ error: 'session expired — please log in again' });
        return;
      }
      next();
    } catch (e) {
      // Fail closed on DB error. A transient blip will log the user out, but
      // letting requests through without a tokenVersion check is a security
      // hole — a revoked session could be re-used until the DB comes back.
      console.error('[auth] requireStrictAuth DB lookup failed:', e instanceof Error ? e.message : e);
      res.status(401).json({ error: 'session check unavailable — please retry' });
    }
  });
}
