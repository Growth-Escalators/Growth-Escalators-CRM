# Reading email / phone alongside a contact

`contacts` has no `email` / `phone` columns. To return them in a list query, use a correlated subquery against `contact_channels`:

```sql
SELECT
  c.id,
  c.first_name,
  c.last_name,
  (SELECT channel_value FROM contact_channels
     WHERE contact_id = c.id AND channel_type = 'email' LIMIT 1) AS email,
  (SELECT channel_value FROM contact_channels
     WHERE contact_id = c.id
       AND channel_type IN ('whatsapp', 'phone') LIMIT 1) AS phone
FROM contacts c
WHERE c.tenant_id = $1
ORDER BY c.last_activity_at DESC NULLS LAST, c.created_at DESC;
```

Drizzle equivalent — see [src/routes/deals.ts](../../../../src/routes/deals.ts) GET `/:id` handler for the pattern after the 2026-04-18 fix (commit `36541ee`).

The fallback to `whatsapp OR phone` matters: contacts created via Cashfree purchases store the number under `whatsapp`; contacts from the legacy lead form may use `phone`. Reading just `'phone'` will show empty cells for buyers.
