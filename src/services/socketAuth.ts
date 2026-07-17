import type { Pool } from 'pg';

// Extracted so the tenant-scoping check for Socket.io's join_contact handler
// is directly unit-testable — index.ts embeds the io.use()/socket.on() wiring
// inline inside startServer(), which has import-time side effects (DB
// connections, HTTP listen) that make the file itself untestable as a whole.
export async function contactBelongsToTenant(pool: Pick<Pool, 'query'>, contactId: unknown, tenantId: string): Promise<boolean> {
  if (typeof contactId !== 'string' || !contactId) return false;
  try {
    const result = await pool.query('SELECT tenant_id FROM contacts WHERE id = $1', [contactId]);
    return result.rows[0]?.tenant_id === tenantId;
  } catch {
    return false;
  }
}
