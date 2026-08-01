import { Router, type Request, type Response } from 'express';
import { and, eq, or, type SQL } from 'drizzle-orm';
import { db, users } from '../db/index';
import { savedViews } from '../db/schema';

// ---------------------------------------------------------------------------
// /api/saved-views — per-user, per-page saved table views (filters + sort).
//
// Tenant isolation is the load-bearing property of this file: EVERY statement
// below filters on `req.user.tenantId`, and a row belonging to another tenant
// is 404 — indistinguishable from one that never existed. Ownership is always
// read from the row in the database, never from the request body.
//
// Visibility inside a tenant: you see your own views (shared or not) plus other
// people's views where `is_shared = true`. A teammate's private view is never
// returned.
//
// The table + migration (0039_tan_thundra.sql) already exist; there is
// deliberately no ensure*Table() boot hook — this went through Drizzle.
// ---------------------------------------------------------------------------

const router = Router();

export const SAVED_VIEW_LIMITS = {
  name: 80,
  pageId: 64,
  // `query` is a URL query string ("score=8..&status=scored"), not a payload.
  query: 2000,
} as const;

const CREATE_KEYS = ['pageId', 'name', 'query', 'isShared'] as const;
const PATCH_KEYS = ['name', 'query', 'isShared'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SavedViewError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'SavedViewError';
  }
}

export interface SavedViewActor {
  tenantId: string;
  userId: string;
}

function actor(req: Request): SavedViewActor {
  const user = req.user;
  if (!user?.id || !user?.tenantId) {
    throw new SavedViewError(401, 'unauthorised', 'Authentication is required');
  }
  return { tenantId: user.tenantId, userId: user.id };
}

function handle(error: unknown, res: Response) {
  if (error instanceof SavedViewError) {
    return res.status(error.status).json({ error: error.code, message: error.message });
  }
  // Renaming a view onto a name you already use on the same page collides with
  // saved_views_owner_page_name_uniq. POST resolves this by upserting; PATCH
  // cannot guess intent, so it reports the conflict.
  if ((error as { code?: string })?.code === '23505') {
    return res.status(409).json({ error: 'duplicate_name', message: 'You already have a view with that name on this page' });
  }
  console.error('[SAVED VIEWS]', error);
  return res.status(500).json({ error: 'saved_view_operation_failed' });
}

// ---------------------------------------------------------------------------
// Query conditions — exported so tests can compile them with PgDialect and
// assert on the real SQL rather than on a mock's behaviour.
// ---------------------------------------------------------------------------

/** Rows on `pageId` visible to `userId`: own (any sharing state) + shared. */
export function buildVisibilityCondition(tenantId: string, pageId: string, userId: string): SQL {
  return and(
    eq(savedViews.tenantId, tenantId),
    eq(savedViews.pageId, pageId),
    or(eq(savedViews.ownerUserId, userId), eq(savedViews.isShared, true)),
  )!;
}

/** A single row addressed by id — always tenant-scoped, so cross-tenant ids miss. */
export function buildViewByIdCondition(tenantId: string, id: string): SQL {
  return and(eq(savedViews.id, id), eq(savedViews.tenantId, tenantId))!;
}

/** The unique-index tuple: one name per person per page. */
export function buildOwnNamedViewCondition(
  tenantId: string,
  userId: string,
  pageId: string,
  name: string,
): SQL {
  return and(
    eq(savedViews.tenantId, tenantId),
    eq(savedViews.ownerUserId, userId),
    eq(savedViews.pageId, pageId),
    eq(savedViews.name, name),
  )!;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function rejectUnknownKeys(body: Record<string, unknown>, allowed: readonly string[]) {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new SavedViewError(400, 'unknown_fields', `Unsupported field(s): ${unknown.join(', ')}`);
  }
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SavedViewError(400, 'invalid_body', 'A JSON object body is required');
  }
  return body as Record<string, unknown>;
}

function requireBoundedString(value: unknown, field: string, max: number, min = 1): string {
  if (typeof value !== 'string') {
    throw new SavedViewError(400, 'invalid_field', `${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw new SavedViewError(400, 'invalid_field', `${field} is required`);
  }
  if (trimmed.length > max) {
    throw new SavedViewError(400, 'invalid_field', `${field} must be at most ${max} characters`);
  }
  return trimmed;
}

function requireQuery(value: unknown): string {
  if (typeof value !== 'string') {
    throw new SavedViewError(400, 'invalid_field', 'query must be a string');
  }
  // Not trimmed to a minimum: a view with no filters at all is legitimate
  // (it is how you get back to "everything, default sort").
  if (value.length > SAVED_VIEW_LIMITS.query) {
    throw new SavedViewError(400, 'invalid_field', `query must be at most ${SAVED_VIEW_LIMITS.query} characters`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new SavedViewError(400, 'invalid_field', `${field} must be a boolean`);
  }
  return value;
}

export interface CreateSavedViewInput {
  pageId: string;
  name: string;
  query: string;
  isShared: boolean;
}

export function parseCreateBody(body: unknown): CreateSavedViewInput {
  const raw = asObject(body);
  rejectUnknownKeys(raw, CREATE_KEYS);
  return {
    pageId: requireBoundedString(raw.pageId, 'pageId', SAVED_VIEW_LIMITS.pageId),
    name: requireBoundedString(raw.name, 'name', SAVED_VIEW_LIMITS.name),
    query: requireQuery(raw.query),
    isShared: raw.isShared === undefined ? false : requireBoolean(raw.isShared, 'isShared'),
  };
}

export interface PatchSavedViewInput {
  name?: string;
  query?: string;
  isShared?: boolean;
}

export function parsePatchBody(body: unknown): PatchSavedViewInput {
  const raw = asObject(body);
  rejectUnknownKeys(raw, PATCH_KEYS);
  const patch: PatchSavedViewInput = {};
  if (raw.name !== undefined) patch.name = requireBoundedString(raw.name, 'name', SAVED_VIEW_LIMITS.name);
  if (raw.query !== undefined) patch.query = requireQuery(raw.query);
  if (raw.isShared !== undefined) patch.isShared = requireBoolean(raw.isShared, 'isShared');
  if (Object.keys(patch).length === 0) {
    throw new SavedViewError(400, 'no_fields', 'Provide at least one of name, query, isShared');
  }
  return patch;
}

export function parsePageIdParam(value: unknown): string {
  const single = Array.isArray(value) ? value[0] : value;
  if (single === undefined || single === null || single === '') {
    throw new SavedViewError(400, 'missing_page_id', 'pageId is required');
  }
  return requireBoundedString(single, 'pageId', SAVED_VIEW_LIMITS.pageId);
}

/**
 * A malformed id is 404, not 400 — an attacker probing ids must not be able to
 * tell "not a uuid" from "not yours". It also keeps Postgres from raising
 * 22P02 on a uuid cast, which would surface as a 500.
 */
export function parseViewId(value: unknown): string {
  const single = Array.isArray(value) ? value[0] : value;
  if (typeof single !== 'string' || !UUID_RE.test(single)) {
    throw new SavedViewError(404, 'not_found', 'Saved view not found');
  }
  return single;
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

export interface SavedViewRow {
  id: string;
  pageId: string;
  name: string;
  query: string;
  isShared: boolean;
  ownerUserId: string;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

export interface SavedViewItem {
  id: string;
  pageId: string;
  name: string;
  query: string;
  isShared: boolean;
  ownerUserId: string;
  ownerName: string | null;
  isOwner: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function serializeView(
  row: SavedViewRow,
  ownerName: string | null | undefined,
  viewerUserId: string,
): SavedViewItem {
  return {
    id: row.id,
    pageId: row.pageId,
    name: row.name,
    query: row.query,
    isShared: row.isShared,
    ownerUserId: row.ownerUserId,
    ownerName: ownerName ?? null,
    // Computed server-side so the UI never has to compare user ids.
    isOwner: row.ownerUserId === viewerUserId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** Own views first, then other people's shared ones; alphabetical within each. */
export function sortViews<T extends { isOwner: boolean; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

const VIEW_COLUMNS = {
  id: savedViews.id,
  pageId: savedViews.pageId,
  name: savedViews.name,
  query: savedViews.query,
  isShared: savedViews.isShared,
  ownerUserId: savedViews.ownerUserId,
  createdAt: savedViews.createdAt,
  updatedAt: savedViews.updatedAt,
} as const;

/** Owner display name, tenant-scoped. Null when the user row is gone. */
async function resolveOwnerName(tenantId: string, userId: string): Promise<string | null> {
  const rows = await db
    .select({ name: users.name })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
    .limit(1);
  return rows[0]?.name ?? null;
}

/** Loads a row by id within the caller's tenant; 404 outside it, 403 if not yours. */
async function loadOwnedView(current: SavedViewActor, id: string): Promise<SavedViewRow> {
  const rows = await db
    .select(VIEW_COLUMNS)
    .from(savedViews)
    .where(buildViewByIdCondition(current.tenantId, id))
    .limit(1);

  const existing = rows[0];
  if (!existing) throw new SavedViewError(404, 'not_found', 'Saved view not found');
  // Ownership comes from the row, never from the request.
  if (existing.ownerUserId !== current.userId) {
    throw new SavedViewError(403, 'forbidden', 'Only the owner can modify this view');
  }
  return existing as SavedViewRow;
}

// ---------------------------------------------------------------------------
// GET /api/saved-views?pageId=<pageId>
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const current = actor(req);
    const pageId = parsePageIdParam(req.query.pageId);

    const rows = await db
      .select({ ...VIEW_COLUMNS, ownerName: users.name })
      .from(savedViews)
      // Left join so a deleted/missing owner leaves ownerName null instead of
      // dropping the view. Joined on tenant too — never cross a tenant edge.
      .leftJoin(users, and(eq(users.id, savedViews.ownerUserId), eq(users.tenantId, savedViews.tenantId)))
      .where(buildVisibilityCondition(current.tenantId, pageId, current.userId))
      .orderBy(savedViews.name);

    const items = sortViews(
      (rows ?? []).map((row) => serializeView(row as SavedViewRow, row.ownerName, current.userId)),
    );
    return res.json({ items });
  } catch (error) {
    return handle(error, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/saved-views — upsert on (tenant, owner, page, name)
//
// Saving twice under the same name updates your view rather than 409ing or
// creating a duplicate, matching the localStorage behaviour this replaces.
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const current = actor(req);
    const input = parseCreateBody(req.body);

    // Existence probe decides 201 vs 200. The write itself is a real upsert, so
    // a concurrent duplicate save can at worst report 201 for what became an
    // update — the row is still correct and still single.
    const [existing, ownerName] = await Promise.all([
      db
        .select({ id: savedViews.id })
        .from(savedViews)
        .where(buildOwnNamedViewCondition(current.tenantId, current.userId, input.pageId, input.name))
        .limit(1),
      resolveOwnerName(current.tenantId, current.userId),
    ]);

    const now = new Date();
    const written = await db
      .insert(savedViews)
      .values({
        tenantId: current.tenantId,
        ownerUserId: current.userId,
        pageId: input.pageId,
        name: input.name,
        query: input.query,
        isShared: input.isShared,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [savedViews.tenantId, savedViews.ownerUserId, savedViews.pageId, savedViews.name],
        set: { query: input.query, isShared: input.isShared, updatedAt: now },
      })
      .returning(VIEW_COLUMNS);

    const item = serializeView(written[0] as SavedViewRow, ownerName, current.userId);
    return res.status(existing.length > 0 ? 200 : 201).json({ item });
  } catch (error) {
    return handle(error, res);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/saved-views/:id — owner only
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  try {
    const current = actor(req);
    const id = parseViewId(req.params.id);
    const patch = parsePatchBody(req.body);

    await loadOwnedView(current, id);

    const updated = await db
      .update(savedViews)
      .set({ ...patch, updatedAt: new Date() })
      // Ownership repeated in the WHERE so the write cannot outrun the check.
      .where(and(buildViewByIdCondition(current.tenantId, id), eq(savedViews.ownerUserId, current.userId)))
      .returning(VIEW_COLUMNS);

    if (updated.length === 0) throw new SavedViewError(404, 'not_found', 'Saved view not found');

    const ownerName = await resolveOwnerName(current.tenantId, current.userId);
    return res.json({ item: serializeView(updated[0] as SavedViewRow, ownerName, current.userId) });
  } catch (error) {
    return handle(error, res);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/saved-views/:id — owner only
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  try {
    const current = actor(req);
    const id = parseViewId(req.params.id);

    await loadOwnedView(current, id);

    await db
      .delete(savedViews)
      .where(and(buildViewByIdCondition(current.tenantId, id), eq(savedViews.ownerUserId, current.userId)));

    return res.status(204).send();
  } catch (error) {
    return handle(error, res);
  }
});

export default router;
