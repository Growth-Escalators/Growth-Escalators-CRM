// F-A — narrow, read-only machine-sync lane for the Command Deck sync
// (`~/GE-Brain/scripts/crm-sync.mjs`, outside this repo — reference only).
//
// Background: `wizmatchPilotGate` (this dir) requires the caller's role to be
// pilot-eligible (`PILOT_ELIGIBLE_ROLES` in `wizmatchStaffingAccess.ts`)
// BEFORE it ever consults the pilot roster
// (`pilotAllowed = roleEligible && (allUsers || ids.has(userId))`). `viewer`
// — the documented machine/service role in this repo — is not in that set,
// so a `viewer` is 403'd on every one of the 82 routes behind
// `wizmatchRouter`, including plain reads, and no roster configuration can
// change that (see the (now-resolved) comment this replaced in
// `src/index.ts`). That broke the sync, which authenticates as a normal
// application JWT with `role: 'viewer'` and only ever issues GETs.
//
// The owner-ratified fix (decision F-A) is NOT a general viewer role change.
// It is a narrow allowlist of the exact eight GET paths `crm-sync.mjs`
// actually calls (crm-sync.mjs:49-56), gated on:
//   - GET only
//   - an authenticated request (`req.user` present, populated by the
//     upstream `requireAuth` in the `/api/wizmatch` mount chain)
//   - tenant-safe: a non-empty string `tenantId` AND `id` on `req.user` —
//     the lane never accepts a tenant from query/body/header, it only ever
//     forwards to handlers that already scope by `req.user.tenantId`
//   - `req.user.role === 'viewer'` — the documented machine/service marker
//     (crm-sync.mjs:257)
//   - an EXACT string match of `req.path` against the frozen allowlist below
//     (not `startsWith`, not a regex, not a prefix match) — Express's
//     `req.path` is mount-relative under `app.use('/api/wizmatch', ...)` and
//     is NOT url-decoded or dot-segment-normalised (`url.parse` semantics),
//     so `/dashboard/`, `/Dashboard`, `/%64ashboard` and
//     `/dashboard/../signals` all fail the equality check and fall through
//     to the ordinary pilot gate, which then 403s them.
//
// Every other request — any non-GET, any path outside the eight, any
// non-`viewer` role, any unauthenticated caller — falls through unchanged to
// `wizmatchPilotGate`, so nothing about interactive WizMatch access (roles,
// pilot roster, send/spend/provider routes) changes for humans.

import type { Request, Response, NextFunction } from 'express';
import { wizmatchPilotGate } from './wizmatchPilotGate';

// Source of truth: `~/GE-Brain/scripts/crm-sync.mjs:49-56` (outside this
// repo). Keep this list and that file in lockstep — see
// `wizmatchMachineSyncLane.test.ts` for the exact-set assertion that catches
// drift, and confirms each entry is a real registered GET route on
// `wizmatchRouter`.
export const WIZMATCH_MACHINE_SYNC_GET_ALLOWLIST: readonly string[] = Object.freeze([
  '/dashboard',
  '/command-center',
  '/candidate-intelligence/queue',
  '/client-discovery/queue',
  '/review-workbench',
  '/guardrails',
  '/placements',
  '/candidates',
]);

export function isWizmatchMachineSyncRequest(req: Request): boolean {
  if (req.method !== 'GET') return false;

  const user = req.user;
  if (!user) return false;
  if (typeof user.tenantId !== 'string' || user.tenantId.length === 0) return false;
  if (typeof user.id !== 'string' || user.id.length === 0) return false;
  if (user.role !== 'viewer') return false;

  // Exact equality only — see the module comment for why prefix/startsWith
  // matching is unsafe here.
  return WIZMATCH_MACHINE_SYNC_GET_ALLOWLIST.includes(req.path);
}

export function wizmatchPilotOrMachineSync(req: Request, res: Response, next: NextFunction): void {
  if (isWizmatchMachineSyncRequest(req)) {
    next();
    return;
  }
  wizmatchPilotGate(req, res, next);
}
