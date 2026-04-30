---
name: ge-add-contact-path
description: Use when adding any code path that creates or updates a contact — new lead capture route, webhook processor, queue drainer, importer, manual-entry endpoint. Triggers include "wire up the X webhook to the CRM", "drop leads from Y into contacts", "fix(contact)", "missed contact dedup", or anything that calls findOrCreateContact. Skips: read-only queries, admin UI tweaks, anything that only touches deals/sequences without writing to contacts.
---

# Adding a contact-touching path

The CRM has three load-bearing invariants every contact-write path must follow. Miss any one and you ship duplicate contacts, leak data across tenants, or bury repeat buyers at the bottom of the list.

Reference: [`docs/CONVENTIONS.md`](../../../docs/CONVENTIONS.md) "Contact normalisation" and [`docs/DATABASE.md`](../../../docs/DATABASE.md) "Contact channels schema".

## Steps

1. **Locate the entry point.** Lead capture goes in `src/routes/leads.ts`-style routes or a service called from one. Webhook flows route through `src/services/cashfreeEventProcessor.ts` / `src/services/edgeQueueDrainer.ts`. For anything new, write a service first (testable), then a thin route handler — see [`docs/CONVENTIONS.md`](../../../docs/CONVENTIONS.md).

2. **Normalise email and phone before passing to `findOrCreateContact`.** Exact pattern (copy from [src/services/cashfreeEventProcessor.ts:141-145](../../../src/services/cashfreeEventProcessor.ts#L141-L145)):

   ```ts
   const normalizedEmail = email ? email.trim().toLowerCase() : '';
   const normalizedPhone = phone
     ? (phone.startsWith('91') ? phone.replace(/\D/g, '') : `91${phone.replace(/\D/g, '')}`)
     : '';
   ```

   Build the `channels` array with `channelType: 'email' | 'whatsapp'` and the normalised value. `findOrCreateContact` exact-matches on `(channel_type, channel_value)` — any drift (uppercase letter, stray space, `+91 ` prefix vs `91`) creates a duplicate contact.

3. **Call `findOrCreateContact(tenantId, { firstName, lastName?, source, channels })`.** Returns `{ contact, channels, created }`. Use the boolean to decide whether to send first-time-buyer comms or skip them.

4. **Bump `lastActivityAt` on every write — even on found-not-created.** The CRM contacts list sorts by `lastActivityAt DESC` ([src/routes/contacts.ts:70](../../../src/routes/contacts.ts#L70)). Skipping the bump means a repeat buyer's row stays buried where it last sat. Pattern:

   ```ts
   const now = new Date();
   await db.update(contacts).set({
     // ...your status/tags/metadata changes
     updatedAt: now,
     lastActivityAt: now,
   }).where(eq(contacts.id, contact.id));
   ```

5. **Tenant scope every query.** Resolve the tenant via the slug (default `growth-escalators`, see `DEFAULT_TENANT_SLUG` in `src/config/constants.ts`) and pass `tenant.id` into `findOrCreateContact`. New tables joining contacts must carry `tenant_id` themselves.

6. **Never `SELECT c.email` or `c.phone` from `contacts`.** Those columns don't exist. Email and phone live in `contact_channels` as `(channel_type, channel_value)` rows. Use a correlated subquery — see `references/correlated-subquery.md`.

7. **Add a vitest test for the service layer** that exercises: new contact, dedup hit by email, dedup hit by phone, normalisation (`Jatin@X.COM` → `jatin@x.com`, `+91 98765 43210` → `919876543210`).

8. **Verify before commit:** `npm run build` (must exit 0) and `npm test` (must pass). Commit message style: `fix(contact):` or `feat(contact):` matching the convention in `git log`.

## Common ways this goes wrong

- Forgot to lowercase email → "Jatin@x.com" and "jatin@x.com" become two contacts.
- Forgot phone normalisation → "+91 98765 43210", "9876543210", "919876543210" all create separate contacts.
- Forgot `lastActivityAt` bump → repeat buyer stays buried at row 200 of the CRM list.
- Selected `c.email` from `contacts` → 500 error, often surfaces as "Deal not found" or empty panel because the route catches and silently fails.
- Wrote the route without a service → no test coverage, bug recurs next refactor.

## Reference

- [references/correlated-subquery.md](references/correlated-subquery.md) — pulling email/phone for a contact list query
- [`docs/CONVENTIONS.md`](../../../docs/CONVENTIONS.md) — full normalisation + multi-tenancy rules
- [`docs/DATABASE.md`](../../../docs/DATABASE.md) — `contact_channels` schema rationale
- Canonical examples: [src/services/cashfreeEventProcessor.ts](../../../src/services/cashfreeEventProcessor.ts), [src/services/edgeQueueDrainer.ts](../../../src/services/edgeQueueDrainer.ts), [src/routes/leads.ts](../../../src/routes/leads.ts)
