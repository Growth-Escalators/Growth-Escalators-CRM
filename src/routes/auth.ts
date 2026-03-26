import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { verify } from '@node-rs/argon2';
import { db } from '../db/index';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { logAuditEvent } from '../utils/audit';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';
const JWT_EXPIRES = '8h';

// POST /auth/login
router.post('/login', async (req: Request, res: Response) => {
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
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    // Audit log
    await logAuditEvent(user.id, user.tenantId, 'LOGIN', 'user', user.id, { email: user.email }, req);

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[auth] login error:', msg);
    res.status(500).json({ error: 'internal server error' });
  }
});

// GET /auth/me
router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

export default router;
