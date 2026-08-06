import logger from '../utils/logger';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { verify, hash } from '@node-rs/argon2';
import { db, users, passwordResetTokens } from '../db/index';
import { eq, and, gte, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { logAuditEvent } from '../utils/audit';
import crypto from 'crypto';
import https from 'https';
import { findValidInvite, consumeInvite } from '../services/userInvites';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required');
  if (process.env.NODE_ENV === 'production') process.exit(1);
}
// 7-day session — small trusted team. Forced logout still works via
// tokenVersion bump in DB (used by removeUser scripts and password resets).
const JWT_EXPIRES = '7d';
const DEFAULT_TENANT_SLUG = 'growth-escalators';

function normaliseEmail(email: string): string {
  return email.toLowerCase().trim();
}

// Reseller readiness (2026-08) — this USED to fold any slug that wasn't one
// of the two hardcoded GE/Wizmatch aliases down to DEFAULT_TENANT_SLUG. That
// broke login for every provisioned reseller tenant: a user under slug
// `acme-media` got looked up as `growth-escalators` and always 401'd.
//
// Known aliases still fold exactly as before (byte-for-byte unchanged for GE
// and Wizmatch). Anything else is passed through unchanged, lowercased and
// trimmed, rather than folded — the login/forgot-password/reset-password
// queries below all INNER JOIN tenants ON t.slug = tenantSlug AND
// t.is_active = true, so a slug that doesn't match an active tenant simply
// matches zero rows and falls through to the exact same generic 401 (or
// non-committal "if that email is registered…" response) as a bad password.
// That IS the tenant-existence check — there is no separate lookup to add,
// and critically no separate code path that could leak which slugs exist.
function normaliseTenantSlug(value: unknown): string {
  const raw = String(value || '').toLowerCase().trim();
  if (raw === 'wizmatch' || raw === 'wm') return 'wizmatch';
  if (raw === 'growth' || raw === 'growth-escalators' || raw === 'ge') return 'growth-escalators';
  return raw;
}

function tenantSlugFromRequest(req: Request, explicit?: unknown): string {
  if (explicit) {
    const slug = normaliseTenantSlug(explicit);
    if (slug) return slug;
  }
  const headerTenant = req.get('x-tenant-slug') || req.get('x-product');
  if (headerTenant) {
    const slug = normaliseTenantSlug(headerTenant);
    if (slug) return slug;
  }
  const host = (req.hostname || req.get('host') || '').toLowerCase();
  if (host.startsWith('wizmatch.') || host.includes('wizmatch')) return 'wizmatch';
  return DEFAULT_TENANT_SLUG;
}

function productForTenant(tenantSlug: string): string {
  return tenantSlug === 'wizmatch' ? 'wizmatch' : 'growth-escalators';
}

// Rate limiters
const loginLimiter = rateLimit({ windowMs: 60_000, max: 5, message: { error: 'Too many login attempts. Try again in 1 minute.' }, standardHeaders: true, legacyHeaders: false });
const resetLimiter = rateLimit({ windowMs: 15 * 60_000, max: 3, message: { error: 'Too many reset attempts. Try again in 15 minutes.' }, standardHeaders: true, legacyHeaders: false });

// POST /auth/login
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const { email, password, tenantSlug: rawTenantSlug, product } = req.body as {
    email?: string;
    password?: string;
    tenantSlug?: string;
    product?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const normalisedEmail = normaliseEmail(email);
  const tenantSlug = tenantSlugFromRequest(req, rawTenantSlug || product);

  try {
    const result = await db.execute(sql`
      SELECT u.id, u.name, u.email,
             u.password_hash AS "passwordHash",
             u.role,
             u.tenant_id AS "tenantId",
             u.token_version AS "tokenVersion",
             t.slug AS "tenantSlug",
             t.name AS "tenantName"
      FROM users u
      INNER JOIN tenants t ON t.id = u.tenant_id
      WHERE u.email = ${normalisedEmail}
        AND t.slug = ${tenantSlug}
        AND (u.is_active IS NULL OR u.is_active = true)
        AND (t.is_active IS NULL OR t.is_active = true)
      LIMIT 1
    `);
    const user = result.rows[0] as {
      id: string; name: string; email: string; passwordHash: string;
      role: string; tenantId: string; tokenVersion: number; tenantSlug: string; tenantName: string;
    } | undefined;

    if (!user) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    const valid = await verify(user.passwordHash, password);
    if (!valid) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    const role = user.role || 'staff';
    const tokenVersion = user.tokenVersion || 1;

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        tenantSlug: user.tenantSlug,
        product: productForTenant(user.tenantSlug),
        role,
        tokenVersion,
      },
      JWT_SECRET!,
      { expiresIn: JWT_EXPIRES }
    );

    await logAuditEvent(user.id, user.tenantId, 'LOGIN', 'user', user.id, { email: user.email }, req);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role,
        tenantId: user.tenantId,
        tenantSlug: user.tenantSlug,
        tenantName: user.tenantName,
        product: productForTenant(user.tenantSlug),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[auth] login error:', msg);
    res.status(500).json({ error: 'internal server error' });
  }
});

// GET /auth/me
router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

// ---------------------------------------------------------------------------
// POST /auth/forgot-password
// ---------------------------------------------------------------------------
router.post('/forgot-password', resetLimiter, async (req: Request, res: Response) => {
  const { email, tenantSlug: rawTenantSlug, product } = req.body as {
    email?: string;
    tenantSlug?: string;
    product?: string;
  };

  // Always return success — don't reveal if email exists
  if (!email) { res.json({ message: 'If that email is registered, a reset code has been sent.' }); return; }

  try {
    const normalisedEmail = normaliseEmail(email);
    const tenantSlug = tenantSlugFromRequest(req, rawTenantSlug || product);
    const result = await db.execute(sql`
      SELECT u.id, u.name, u.email
      FROM users u
      INNER JOIN tenants t ON t.id = u.tenant_id
      WHERE u.email = ${normalisedEmail}
        AND t.slug = ${tenantSlug}
        AND (u.is_active IS NULL OR u.is_active = true)
        AND (t.is_active IS NULL OR t.is_active = true)
      LIMIT 1
    `);
    const user = result.rows[0] as { id: string; name: string; email: string } | undefined;
    if (!user) { res.json({ message: 'If that email is registered, a reset code has been sent.' }); return; }

    // Generate 6-digit code
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Delete old tokens for this user
    await db.execute(sql`DELETE FROM password_reset_tokens WHERE user_id = ${user.id}`);

    // Store new token
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      token: code,
      expiresAt,
    });

    // Send email via Brevo
    const BREVO_API_KEY = process.env.BREVO_API_KEY;
    if (BREVO_API_KEY) {
      const emailBody = JSON.stringify({
        sender: { name: 'Growth Escalators CRM', email: 'noreply@growthescalators.com' },
        to: [{ email: user.email, name: user.name }],
        subject: 'Your GE CRM Password Reset Code',
        htmlContent: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <h2 style="color:#0f172a">Password Reset</h2>
          <p>Your reset code is:</p>
          <div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#0ea5e9;padding:16px 0">${code}</div>
          <p>This code is valid for 15 minutes.</p>
          <p style="color:#94a3b8;font-size:13px;margin-top:24px">If you didn't request this, ignore this email.</p>
        </div>`,
      });

      const brevoReq = https.request({
        hostname: 'api.brevo.com',
        path: '/v3/smtp/email',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': BREVO_API_KEY,
          'Content-Length': Buffer.byteLength(emailBody),
        },
      });
      brevoReq.write(emailBody);
      brevoReq.end();
    }

    res.json({ message: 'If that email is registered, a reset code has been sent.' });
  } catch (err) {
    logger.error('[auth] forgot-password error:', err);
    res.json({ message: 'If that email is registered, a reset code has been sent.' });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/reset-password
// ---------------------------------------------------------------------------
router.post('/reset-password', resetLimiter, async (req: Request, res: Response) => {
  const { email, code, newPassword, tenantSlug: rawTenantSlug, product } = req.body as {
    email?: string;
    code?: string;
    newPassword?: string;
    tenantSlug?: string;
    product?: string;
  };

  if (!email || !code || !newPassword) {
    res.status(400).json({ error: 'email, code, and newPassword are required' });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  try {
    const normalisedEmail = normaliseEmail(email);
    const tenantSlug = tenantSlugFromRequest(req, rawTenantSlug || product);
    const result = await db.execute(sql`
      SELECT u.*
      FROM users u
      INNER JOIN tenants t ON t.id = u.tenant_id
      WHERE u.email = ${normalisedEmail}
        AND t.slug = ${tenantSlug}
        AND (u.is_active IS NULL OR u.is_active = true)
        AND (t.is_active IS NULL OR t.is_active = true)
      LIMIT 1
    `);
    const user = result.rows[0] as { id: string } | undefined;
    if (!user) { res.status(400).json({ error: 'Invalid or expired reset code' }); return; }

    // Find valid token
    const [token] = await db.select().from(passwordResetTokens)
      .where(and(
        eq(passwordResetTokens.userId, user.id),
        eq(passwordResetTokens.token, code),
        gte(passwordResetTokens.expiresAt, new Date()),
      ))
      .limit(1);

    if (!token) {
      res.status(400).json({ error: 'Invalid or expired reset code' });
      return;
    }

    // Hash new password and update
    const passwordHash = await hash(newPassword);
    await db.execute(sql`
      UPDATE users SET password_hash = ${passwordHash}, token_version = COALESCE(token_version, 1) + 1
      WHERE id = ${user.id}
    `);

    // Delete used token
    await db.execute(sql`DELETE FROM password_reset_tokens WHERE user_id = ${user.id}`);

    res.json({ message: 'Password reset successful. Please log in with your new password.' });
  } catch (err) {
    logger.error('[auth] reset-password error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/accept-invite — activates an invited user's account.
//
// Mirrors reset-password's shape (validate a DB-stored token, hash+store a
// new password, bump token_version) but keyed by a single opaque token
// rather than email+code+tenantSlug: the mailed link (see
// src/services/userInvites.ts's buildAcceptInviteUrl) is a 256-bit random
// value, globally unique on its own, so there's no ambiguity to resolve with
// a tenant hint the way a 6-digit reset code needs one. Same generic
// "Invalid or expired" response for both a bad token and an expired one —
// no oracle for probing which.
// ---------------------------------------------------------------------------
router.post('/accept-invite', resetLimiter, async (req: Request, res: Response) => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };

  if (!token || !newPassword) {
    res.status(400).json({ error: 'token and newPassword are required' });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  try {
    const invite = await findValidInvite(token);
    if (!invite) {
      res.status(400).json({ error: 'Invalid or expired invite link' });
      return;
    }

    const passwordHash = await hash(newPassword);
    // tenant-scoping-lint-ignore-next-line — invite.userId came from
    // findValidInvite(token): an unguessable, single-use, hashed token tied
    // to exactly one user via userInvites.userId's UNIQUE constraint. The
    // token itself is the sole authorization here, the same way a password
    // reset code authorizes acting on its one associated user with no
    // tenant predicate needed.
    await db.execute(sql`
      UPDATE users
      SET password_hash = ${passwordHash}, is_active = true, token_version = COALESCE(token_version, 1) + 1
      WHERE id = ${invite.userId}
    `);

    // Single-use enforcement — the token can never be replayed.
    await consumeInvite(invite.userId);

    res.json({ message: 'Account activated. Please log in with your new password.' });
  } catch (err) {
    logger.error('[auth] accept-invite error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

export default router;
