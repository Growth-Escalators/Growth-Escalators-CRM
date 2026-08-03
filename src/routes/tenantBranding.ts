import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { tenantBranding, userPermissions } from '../db/schema';
import { getDefaultBrandingForSlug, getTenantSlugById } from '../services/tenantBrandingDefaults';

const router = Router();

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

interface SanitizedBranding {
  displayName?: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  faviconUrl?: string | null;
}

function sanitizeBrandingInput(body: Record<string, unknown>): { errors: string[]; values: SanitizedBranding } {
  const errors: string[] = [];
  const values: SanitizedBranding = {};

  if ('displayName' in body) {
    const v = body.displayName;
    if (typeof v !== 'string' || !v.trim()) {
      errors.push('displayName must be a non-empty string');
    } else {
      values.displayName = v.trim().slice(0, 200);
    }
  }

  for (const key of ['logoUrl', 'faviconUrl'] as const) {
    if (key in body) {
      const v = body[key];
      if (v === null || v === '') {
        values[key] = null;
      } else if (typeof v === 'string') {
        values[key] = v.trim().slice(0, 2000);
      } else {
        errors.push(`${key} must be a string or null`);
      }
    }
  }

  for (const key of ['primaryColor', 'accentColor'] as const) {
    if (key in body) {
      const v = body[key];
      if (v === null || v === '') {
        values[key] = null;
      } else if (typeof v === 'string' && HEX_COLOR_RE.test(v.trim())) {
        values[key] = v.trim();
      } else {
        errors.push(`${key} must be a hex color like #1A3A5C`);
      }
    }
  }

  return { errors, values };
}

// ---------------------------------------------------------------------------
// GET /api/tenant-branding
// Any authenticated user of a tenant may read that tenant's branding — it's
// just chrome for the UI they already have access to. Scoped strictly by
// req.user.tenantId (never a client-supplied tenant id/slug).
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const [row] = await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1);
    if (row) {
      res.json({ branding: row });
      return;
    }

    // No row yet — either the startup seed hasn't run against this
    // environment, or this tenant was created after the feature shipped.
    // Serve a computed default rather than a blank/404 so the SPA never
    // renders with empty branding.
    const slug = req.user!.tenantSlug || (await getTenantSlugById(tenantId));
    const defaults = getDefaultBrandingForSlug(slug || '');
    res.json({
      branding: {
        id: null,
        tenantId,
        ...defaults,
        createdAt: null,
        updatedAt: null,
      },
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/tenant-branding
// Owner-only (userPermissions.isOwner — same convention as src/routes/
// permissions.ts). Upserts the caller's own tenant's row; tenantId always
// comes from req.user, never from the request body.
// ---------------------------------------------------------------------------
router.put('/', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const tenantId = req.user!.tenantId;

  const [myPerms] = await db.select().from(userPermissions).where(eq(userPermissions.userId, userId)).limit(1);
  if (!myPerms?.isOwner) { res.status(403).json({ error: 'owner only' }); return; }

  const { errors, values } = sanitizeBrandingInput(req.body as Record<string, unknown>);
  if (errors.length > 0) { res.status(400).json({ error: errors.join('; ') }); return; }
  if (Object.keys(values).length === 0) { res.status(400).json({ error: 'no valid branding fields supplied' }); return; }

  try {
    const [existing] = await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1);

    let result;
    if (existing) {
      [result] = await db.update(tenantBranding)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(tenantBranding.tenantId, tenantId))
        .returning();
    } else {
      if (!values.displayName) {
        res.status(400).json({ error: 'displayName is required to create branding for the first time' });
        return;
      }
      [result] = await db.insert(tenantBranding)
        .values({
          tenantId,
          displayName: values.displayName,
          logoUrl: values.logoUrl ?? null,
          primaryColor: values.primaryColor ?? null,
          accentColor: values.accentColor ?? null,
          faviconUrl: values.faviconUrl ?? null,
        })
        .returning();
    }

    res.json({ branding: result });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
