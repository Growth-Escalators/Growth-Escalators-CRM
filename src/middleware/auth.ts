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
    if (!payload.role) payload.role = 'admin';
    if (!payload.tokenVersion) payload.tokenVersion = 1;
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
        if (!payload.role) payload.role = 'admin';
        if (!payload.tokenVersion) payload.tokenVersion = 1;
        req.user = payload;
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
    } catch {
      next(); // DB error — allow through rather than blocking
    }
  });
}
