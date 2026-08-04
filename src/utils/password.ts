import crypto from 'crypto';

// Extracted from src/routes/permissions.ts's POST /api/permissions/users flow
// (auto-generate a temporary password + print/return it once for manual
// handoff, user can change it later via "Forgot password"). Pulled into a
// shared util so other one-off provisioning flows — e.g.
// scripts/onboarding/provisionResellerTenant.ts — reuse the exact same
// generation approach instead of reinventing it.
//
// 12 chars: mixed case + digits — readable but reasonable entropy. Excludes
// visually-ambiguous characters (0/O, 1/I/l) on purpose.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function generatePassword(length = 12): string {
  return Array.from(crypto.randomFillSync(new Uint8Array(length)))
    .map((b) => ALPHABET[b % ALPHABET.length]).join('');
}
