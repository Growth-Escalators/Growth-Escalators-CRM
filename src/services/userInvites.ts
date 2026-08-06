// Invite-by-email — shared by src/routes/permissions.ts (POST /users, POST
// /users/:userId/resend-invite) and src/routes/auth.ts (POST
// /accept-invite). Replaces the old "generate a temp password, print it once
// in the API response, admin copies it into Slack/WhatsApp" flow.
//
// Mirrors auth.ts's forgot-password/reset-password shape (a DB-stored,
// single-use, time-limited token tied to a user) with one deliberate
// improvement: the token itself is hashed before storage (SHA-256), the same
// technique src/modules/esign/contract-signing-link.ts's hashSigningToken
// uses for signer links — an emailed link is more likely to end up in a log
// or screenshot than a 6-digit code a user types in by hand, so hashing the
// at-rest value costs nothing and is strictly safer.
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db, userInvites } from '../db/index';
import { sendTransactionalEmail } from './emailService';
import { getTenantDocumentIdentity } from './tenantBrandingDefaults';

export const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — matches JWT_EXPIRES ('7d') in auth.ts

export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function mintInviteToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function buildAcceptInviteUrl(token: string): string {
  // Same env-var fallback chain as esign's buildSignUrl (contract-signing-link
  // consumer in esign.service.ts) — ADMIN_BASE_URL first since this link opens
  // the admin SPA specifically (not the D2C/content frontends the other vars
  // sometimes point at).
  const base = (
    process.env.ADMIN_BASE_URL ||
    process.env.CRM_BASE_URL ||
    process.env.BASE_URL ||
    process.env.FRONTEND_URL ||
    ''
  ).replace(/\/+$/, '');
  const path = `/accept-invite?token=${encodeURIComponent(token)}`;
  return base ? `${base}${path}` : path;
}

// Minimal HTML-escaping — copied from src/routes/billing.ts's invoice-email
// escapeHtml (not imported, to avoid coupling this module to billing.ts,
// which another workstream owns right now).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Issues a fresh invite token for a user: deletes any prior outstanding
 * invite for that user (same "delete old, insert new" shape as
 * forgot-password's password_reset_tokens handling — this is also what makes
 * "resend invalidates the old link" true for free) and stores a new hashed
 * token. Returns the RAW token (never stored) so the caller can email it.
 */
export async function createInviteToken(userId: string, tenantId: string): Promise<string> {
  const token = mintInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS);

  await db.delete(userInvites).where(eq(userInvites.userId, userId));
  await db.insert(userInvites).values({ userId, tenantId, tokenHash, expiresAt });

  return token;
}

/**
 * Emails the invite link — tenant SMTP first, global Brevo fallback (see
 * emailService.sendTransactionalEmail), branded with the tenant's own
 * tenant_branding.displayName (never a hardcoded "Growth Escalators" —
 * mirrors how src/routes/billing.ts's invoice-send email sources the
 * tenant's identity). Best-effort: throws are the caller's to catch, since a
 * failed send should not undo the invite token already written — the admin
 * can retry via "Resend invite".
 */
export async function sendInviteEmail(
  token: string,
  tenantId: string,
  name: string,
  email: string,
): Promise<{ success: boolean; mock?: boolean }> {
  const identity = await getTenantDocumentIdentity(tenantId);
  // tenant_branding.displayName is NOT NULL in the schema and every tenant
  // gets a row from seedTenantBrandingDefaults() at startup — the fallback
  // below only guards a brand-new tenant whose seed hasn't run yet in this
  // environment (e.g. a fresh test DB), so it deliberately does NOT hardcode
  // "Growth Escalators".
  const brandName = identity?.displayName?.trim() || 'the team';
  const url = buildAcceptInviteUrl(token);

  const subject = `You've been invited to join ${brandName}`;
  const html = `<p>Hi ${escapeHtml(name)},</p>
<p>You've been invited to join <strong>${escapeHtml(brandName)}</strong>. Click below to set your password and activate your account:</p>
<p><a href="${url}">Accept invite</a></p>
<p style="color:#94a3b8;font-size:13px;margin-top:24px">This link expires in 7 days and can only be used once. If you weren't expecting this, you can ignore it.</p>`;
  const text = `Hi ${name},\n\nYou've been invited to join ${brandName}. Set your password here:\n${url}\n\nThis link expires in 7 days and can only be used once.`;

  return sendTransactionalEmail(email, name, subject, html, text, tenantId);
}

/**
 * Looks up a still-valid (unexpired) invite by its raw token. Returns null
 * for both "no such token" and "expired" — same generic-failure posture as
 * auth.ts's reset-password ("Invalid or expired reset code"), so a caller
 * can't distinguish a guessed token from an expired real one.
 */
export async function findValidInvite(token: string): Promise<{ userId: string; tenantId: string } | null> {
  if (!token || typeof token !== 'string') return null;
  const tokenHash = hashInviteToken(token);
  const [row] = await db.select().from(userInvites).where(eq(userInvites.tokenHash, tokenHash)).limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return { userId: row.userId, tenantId: row.tenantId };
}

/** Single-use enforcement: deletes the invite once it's been redeemed. */
export async function consumeInvite(userId: string): Promise<void> {
  // tenant-scoping-lint-ignore-next-line — userInvites.userId is UNIQUE
  // (schema.ts), so this can only ever affect the single row belonging to
  // that specific user's tenant; there is no row to cross into.
  await db.delete(userInvites).where(eq(userInvites.userId, userId));
}

/** Whether a user currently has an outstanding (pending) invite. Used to gate resend-invite to users who are actually pending. */
export async function hasPendingInvite(userId: string): Promise<boolean> {
  // tenant-scoping-lint-ignore-next-line — userInvites.userId is UNIQUE
  // (schema.ts), same reasoning as consumeInvite above: at most one row
  // exists for this userId, so no tenant predicate can narrow it further.
  const [row] = await db.select({ id: userInvites.id }).from(userInvites).where(eq(userInvites.userId, userId)).limit(1);
  return !!row;
}
