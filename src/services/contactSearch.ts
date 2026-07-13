import { sql, type SQL } from 'drizzle-orm';
import { contacts } from '../db/schema';

/**
 * Tenant-scoped CRM contact search used by the shared Growth/Wizmatch contact list.
 * Channel values stay in contact_channels, so email/phone lookup must use a correlated
 * EXISTS rather than filtering only the base contacts row.
 */
export function buildContactSearchCondition(tenantId: string, rawSearch: string): SQL {
  const pattern = `%${rawSearch.trim()}%`;
  return sql`(
    COALESCE(${contacts.firstName}, '') ILIKE ${pattern}
    OR COALESCE(${contacts.lastName}, '') ILIKE ${pattern}
    OR CONCAT_WS(' ', ${contacts.firstName}, ${contacts.lastName}) ILIKE ${pattern}
    OR COALESCE(${contacts.companyName}, '') ILIKE ${pattern}
    OR EXISTS (
      SELECT 1
      FROM contact_channels search_channel
      WHERE search_channel.tenant_id = ${tenantId}::uuid
        AND search_channel.contact_id = ${contacts.id}
        AND search_channel.channel_type IN ('email', 'phone', 'whatsapp')
        AND search_channel.channel_value ILIKE ${pattern}
    )
  )`;
}
