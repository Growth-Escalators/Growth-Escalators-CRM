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

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required');
  if (process.env.NODE_ENV === 'production') process.exit(1);
}
const JWT_EXPIRES = '8h';

// Rate limiters
const loginLimiter = rateLimit({ windowMs: 60_000, max: 5, message: { error: 'Too many login attempts. Try again in 1 minute.' }, standardHeaders: true, legacyHeaders: false });
const resetLimiter = rateLimit({ windowMs: 15 * 60_000, max: 3, message: { error: 'Too many reset attempts. Try again in 15 minutes.' }, standardHeaders: true, legacyHeaders: false });

// POST /auth/login
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);

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
      { id: user.id, email: user.email, tenantId: user.tenantId, role, tokenVersion },
      JWT_SECRET!,
      { expiresIn: JWT_EXPIRES }
    );

    await logAuditEvent(user.id, user.tenantId, 'LOGIN', 'user', user.id, { email: user.email }, req);

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role } });
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
  const { email } = req.body as { email?: string };

  // Always return success — don't reveal if email exists
  if (!email) { res.json({ message: 'If that email is registered, a reset code has been sent.' }); return; }

  try {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
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
  const { email, code, newPassword } = req.body as { email?: string; code?: string; newPassword?: string };

  if (!email || !code || !newPassword) {
    res.status(400).json({ error: 'email, code, and newPassword are required' });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
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

export default router;
