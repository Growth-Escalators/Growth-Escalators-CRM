import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { tenantBranding, userPermissions } from '../db/schema';
import { getDefaultBrandingForSlug, getTenantSlugById } from '../services/tenantBrandingDefaults';

const router = Router();

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
// 2-digit state code + 13 alphanumeric (PAN + entity number + checksum) — the
// standard 15-character GSTIN shape. Loose on purpose (doesn't validate the
// PAN checksum) rather than risk rejecting a real, unusual-but-valid GSTIN.
const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{13}$/;
// 4-letter bank code + literal '0' + 6-character branch code — the standard
// IFSC shape used by every Indian bank.
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Bank account and GSTIN are financial/tax identifiers the tenant owner
// enters for that tenant's own invoices. Every other tenant member can
// already read the rest of this row (it's just branding chrome + contact
// info) via GET — these four are stripped from the response for anyone who
// isn't isOwner rather than widening who can see them. Keep this list in
// sync with the owner-only columns added to tenantBranding in schema.ts.
const OWNER_ONLY_FIELDS = ['gstin', 'bankName', 'bankAccountName', 'bankAccountNumber', 'bankIfsc'] as const;

function gateOwnerOnlyFields<T extends Record<string, unknown>>(row: T, isOwner: boolean): T {
  if (isOwner) return row;
  const gated = { ...row };
  for (const f of OWNER_ONLY_FIELDS) delete (gated as Record<string, unknown>)[f];
  return gated;
}

interface SanitizedBranding {
  displayName?: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  faviconUrl?: string | null;
  legalEntityName?: string | null;
  registeredAddress?: string | null;
  gstin?: string | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  supportEmail?: string | null;
  supportPhone?: string | null;
  website?: string | null;
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

  // Free-text legal/contact fields — same null-or-trimmed-string shape as
  // logoUrl/faviconUrl above, just with field-appropriate length caps.
  // Narrowed to just the nullable-string keys of SanitizedBranding (unlike
  // e.g. displayName, which is string-only) — otherwise `values[key] = null`
  // below wouldn't type-check against the full keyof union.
  type NullableTextField = 'legalEntityName' | 'registeredAddress' | 'bankName' | 'bankAccountName' | 'supportPhone' | 'website';
  const FREE_TEXT_FIELDS: Array<[NullableTextField, number]> = [
    ['legalEntityName', 200],
    ['registeredAddress', 500],
    ['bankName', 200],
    ['bankAccountName', 200],
    ['supportPhone', 30],
    ['website', 300],
  ];
  for (const [key, maxLen] of FREE_TEXT_FIELDS) {
    if (key in body) {
      const v = body[key];
      if (v === null || v === '') {
        values[key] = null;
      } else if (typeof v === 'string') {
        values[key] = v.trim().slice(0, maxLen);
      } else {
        errors.push(`${key} must be a string or null`);
      }
    }
  }

  if ('gstin' in body) {
    const v = body.gstin;
    if (v === null || v === '') {
      values.gstin = null;
    } else if (typeof v === 'string' && GSTIN_RE.test(v.trim().toUpperCase())) {
      values.gstin = v.trim().toUpperCase();
    } else {
      errors.push('gstin must be a valid 15-character GSTIN, or blank');
    }
  }

  if ('bankAccountNumber' in body) {
    const v = body.bankAccountNumber;
    if (v === null || v === '') {
      values.bankAccountNumber = null;
    } else if (typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 34) {
      values.bankAccountNumber = v.trim();
    } else {
      errors.push('bankAccountNumber must be a string up to 34 characters, or blank');
    }
  }

  if ('bankIfsc' in body) {
    const v = body.bankIfsc;
    if (v === null || v === '') {
      values.bankIfsc = null;
    } else if (typeof v === 'string' && IFSC_RE.test(v.trim().toUpperCase())) {
      values.bankIfsc = v.trim().toUpperCase();
    } else {
      errors.push('bankIfsc must be a valid IFSC code (e.g. ICIC0003617), or blank');
    }
  }

  if ('supportEmail' in body) {
    const v = body.supportEmail;
    if (v === null || v === '') {
      values.supportEmail = null;
    } else if (typeof v === 'string' && EMAIL_RE.test(v.trim())) {
      values.supportEmail = v.trim().toLowerCase().slice(0, 200);
    } else {
      errors.push('supportEmail must be a valid email address, or blank');
    }
  }

  return { errors, values };
}

// ---------------------------------------------------------------------------
// GET /api/tenant-branding
// Any authenticated user of a tenant may read that tenant's branding — it's
// mostly just chrome for the UI they already have access to. Scoped strictly
// by req.user.tenantId (never a client-supplied tenant id/slug).
//
// gstin/bankName/bankAccountName/bankAccountNumber/bankIfsc are the
// exception: those are financial/tax identifiers, so they're gated to
// isOwner (re-checked against userPermissions here, the same way PUT below
// does, rather than trusted from a JWT claim) and stripped from the response
// for anyone else. The no-row-yet default branch never needs the owner
// check — the computed defaults never carry a real GSTIN or bank details.
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  try {
    const [row] = await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1);
    if (row) {
      const [myPerms] = await db.select().from(userPermissions).where(eq(userPermissions.userId, userId)).limit(1);
      res.json({ branding: gateOwnerOnlyFields(row, !!myPerms?.isOwner) });
      return;
    }

    // No row yet — either the startup seed hasn't run against this
    // environment, or this tenant was created after the feature shipped.
    // Serve a computed default rather than a blank/404 so the SPA never
    // renders with empty branding. Legal/financial identity has no computed
    // default — null means "not configured", and stays null here.
    const slug = req.user!.tenantSlug || (await getTenantSlugById(tenantId));
    const defaults = getDefaultBrandingForSlug(slug || '');
    res.json({
      branding: {
        id: null,
        tenantId,
        ...defaults,
        legalEntityName: null,
        registeredAddress: null,
        gstin: null,
        bankName: null,
        bankAccountName: null,
        bankAccountNumber: null,
        bankIfsc: null,
        supportEmail: null,
        supportPhone: null,
        website: null,
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
          legalEntityName: values.legalEntityName ?? null,
          registeredAddress: values.registeredAddress ?? null,
          gstin: values.gstin ?? null,
          bankName: values.bankName ?? null,
          bankAccountName: values.bankAccountName ?? null,
          bankAccountNumber: values.bankAccountNumber ?? null,
          bankIfsc: values.bankIfsc ?? null,
          supportEmail: values.supportEmail ?? null,
          supportPhone: values.supportPhone ?? null,
          website: values.website ?? null,
        })
        .returning();
    }

    res.json({ branding: result });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
