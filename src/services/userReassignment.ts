// Reassign-on-offboard — generic replacement for
// scripts/onboarding/replace-tushar-with-kanishk.ts (a hardcoded one-off
// naming two specific employees). Used by:
//   - POST /api/permissions/users/:userId/reassign (standalone tool)
//   - DELETE /api/permissions/users/:userId (optional reassign-then-deactivate)
//
// WHY A CASE EXPRESSION, NOT ONE CANONICAL VALUE. `contacts.assignedTo` and
// `deals.assignedTo` have no FK to `users` — they're free text. The admin
// SPA's own "Assigned To" pickers (ContactsPage.jsx, PipelinePage.jsx,
// ContactSlideIn.jsx) hardcode literal first-name values like "jatin" /
// "saksham", completely decoupled from the users table. `tasks.assignedTo`,
// by contrast, stores the real user uuid (see TasksPage.jsx, admin's
// tasks/lib/format.js: "uuid or legacy email"). There is no single
// representation to convert to — a blind "set everything to the target's
// id" would silently break contacts/deals rows the frontend renders by
// matching against a name string, and a blind "set everything to the
// target's name" would break tasks' uuid-keyed rendering.
//
// So each UPDATE below matches whichever representation a given row already
// used (id, email, full name, or the contacts/deals legacy lowercased-first-
// name convention) and replaces it with the SAME representation for the
// target user — preserving whatever shape that row/table already expects
// instead of forcing one convention onto all three tables.
import { sql } from 'drizzle-orm';
import { db } from '../db/index';

export interface ReassignableUser {
  id: string;
  name: string | null;
  email: string;
}

export interface ReassignCounts {
  contacts: number;
  deals: number;
  tasks: number;
}

function firstNameLower(name: string | null): string {
  return (name || '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

// seo_content_calendar.assignedTo is deliberately EXCLUDED: it's a content-
// ownership concept (could name a freelancer who has no `users` row at all),
// not a CRM-user-account concept — reassigning it under a "user offboarding"
// tool risks silently overwriting an unrelated assignment. tasks/contacts/
// deals are the tables this feature is scoped to (per the PRD).
async function reassignTable(
  table: 'contacts' | 'deals' | 'tasks',
  tenantId: string,
  from: ReassignableUser,
  to: ReassignableUser,
): Promise<number> {
  const fromFirst = firstNameLower(from.name);
  const toFirst = firstNameLower(to.name);
  const candidates = [from.id, from.email, from.name, fromFirst].filter((v): v is string => !!v);
  // Same sql.join(...values, ', ') technique src/routes/contacts.ts's
  // bulk-assign/bulk-delete endpoints already use for a dynamic IN-list.
  const candidatesArray = sql.join(candidates.map((c) => sql`${c}`), sql`, `);

  const result = await db.execute(sql`
    UPDATE ${sql.identifier(table)}
    SET assigned_to = CASE
      WHEN assigned_to = ${from.id} THEN ${to.id}
      WHEN assigned_to = ${from.email} THEN ${to.email}
      WHEN assigned_to = ${from.name} THEN ${to.name}
      WHEN assigned_to = ${fromFirst} THEN ${toFirst}
      ELSE assigned_to
    END,
    updated_at = now()
    WHERE tenant_id = ${tenantId}
      AND assigned_to = ANY(ARRAY[${candidatesArray}]::text[])
  `);
  return result.rowCount ?? 0;
}

/** Bulk-reassigns contacts/deals/tasks from one user to another, scoped to one tenant. Returns a per-table count of records reassigned. */
export async function reassignUserRecords(
  tenantId: string,
  from: ReassignableUser,
  to: ReassignableUser,
): Promise<ReassignCounts> {
  const [contacts, deals, tasks] = await Promise.all([
    reassignTable('contacts', tenantId, from, to),
    reassignTable('deals', tenantId, from, to),
    reassignTable('tasks', tenantId, from, to),
  ]);
  return { contacts, deals, tasks };
}
