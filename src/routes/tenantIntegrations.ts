/**
 * Per-tenant integration credential management (Phase 3 white-label effort).
 *
 * Guarantees enforced here:
 *   - GET (list + single) is readable by any authenticated member of the
 *     tenant, but only ever returns `status`/`metadata` — never
 *     `encryptedCredentials`, decrypted or otherwise. See
 *     `tenantIntegrationsService.PublicIntegration`, which is a field
 *     whitelist that structurally cannot carry the secret.
 *   - PUT (set credentials) and DELETE (disconnect) are owner-only, using the
 *     exact `userPermissions.isOwner` inline-check convention already used in
 *     `src/routes/permissions.ts`.
 *   - Every query is scoped by `req.user!.tenantId` (never a client-supplied
 *     tenant id) — a tenant can only ever see/touch its own integrations.
 */

import { Router, type Request, type Response } from 'express';
import { db } from '../db/index';
import { userPermissions } from '../db/schema';
import { eq } from 'drizzle-orm';
import logger from '../utils/logger';
import {
  disconnectIntegration,
  getIntegrationStatus,
  listIntegrations,
  upsertIntegrationCredentials,
} from '../services/tenantIntegrationsService';

const router = Router();

// Plain text `provider` column (matches the rest of this schema's convention
// for enum-like fields), but the route still validates shape/length so a
// stray client can't write an arbitrary huge/garbage key.
const PROVIDER_RE = /^[a-z][a-z0-9_]{1,49}$/;

function isValidProvider(provider: unknown): provider is string {
  return typeof provider === 'string' && PROVIDER_RE.test(provider);
}

async function isOwner(userId: string): Promise<boolean> {
  // tenant-scoping-lint-ignore-next-line — userId is always req.user!.id
  // (authenticated, never client-supplied — see both call sites), and
  // userPermissions.userId references users.id, which is globally unique
  // regardless of tenant. No additional tenant_id predicate can narrow this
  // further.
  const [myPerms] = await db.select().from(userPermissions)
    .where(eq(userPermissions.userId, userId)).limit(1);
  return Boolean(myPerms?.isOwner);
}

// ---------------------------------------------------------------------------
// GET /api/tenant-integrations — list this tenant's integrations
// (status/metadata only; any authenticated tenant member).
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const integrations = await listIntegrations(tenantId);
    res.json({ integrations });
  } catch (e: unknown) {
    logger.error({ err: e }, '[tenantIntegrations] list failed');
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/tenant-integrations/:provider — single provider status
// (status/metadata only; any authenticated tenant member).
// ---------------------------------------------------------------------------
router.get('/:provider', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { provider } = req.params;
  if (!isValidProvider(provider)) {
    res.status(400).json({ error: 'invalid provider' });
    return;
  }

  try {
    const integration = await getIntegrationStatus(tenantId, provider);
    res.json({ integration: integration ?? { provider, status: 'disconnected', metadata: {} } });
  } catch (e: unknown) {
    logger.error({ err: e }, '[tenantIntegrations] get status failed');
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/tenant-integrations/:provider — set/replace credentials
// (owner-only). Body: { credentials: object, metadata?: object }.
// Never echoes back the credentials it was given.
// ---------------------------------------------------------------------------
router.put('/:provider', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const { provider } = req.params;

  if (!isValidProvider(provider)) {
    res.status(400).json({ error: 'invalid provider' });
    return;
  }
  if (!(await isOwner(userId))) {
    res.status(403).json({ error: 'owner only' });
    return;
  }

  const { credentials, metadata } = req.body as { credentials?: unknown; metadata?: unknown };
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
    res.status(400).json({ error: 'credentials (object) is required' });
    return;
  }
  if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))) {
    res.status(400).json({ error: 'metadata must be an object if provided' });
    return;
  }

  try {
    const integration = await upsertIntegrationCredentials(
      tenantId,
      provider,
      credentials,
      metadata as Record<string, unknown> | undefined,
    );
    res.json({ integration });
  } catch (e: unknown) {
    logger.error({ err: e }, '[tenantIntegrations] upsert failed');
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/tenant-integrations/:provider — disconnect (owner-only).
// Wipes the stored ciphertext; row remains for audit/history with
// status='disconnected'.
// ---------------------------------------------------------------------------
router.delete('/:provider', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const { provider } = req.params;

  if (!isValidProvider(provider)) {
    res.status(400).json({ error: 'invalid provider' });
    return;
  }
  if (!(await isOwner(userId))) {
    res.status(403).json({ error: 'owner only' });
    return;
  }

  try {
    const integration = await disconnectIntegration(tenantId, provider);
    res.json({ integration: integration ?? { provider, status: 'disconnected', metadata: {} } });
  } catch (e: unknown) {
    logger.error({ err: e }, '[tenantIntegrations] disconnect failed');
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
