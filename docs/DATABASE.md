# Database

## Schema lifecycle — two paths

### Drizzle migrations (preferred for new work)

- Schema lives in `src/db/schema.ts`.
- Generate a migration: `npm run db:generate` — diffs schema against DB and emits SQL to `src/db/migrations/`.
- Migrations run on every API boot via `dist/scripts/migrate.js`.
- **Never hand-edit `schema.ts` or files in `src/db/migrations/`** — edit the schema, regenerate, commit both together.

### Runtime `ensure*` hooks (legacy pattern — preserve, don't extend)

Many services have `ensureXTable()` / `ensureXColumns()` functions called fire-and-forget at the top of `src/index.ts` and `src/worker.ts`. These cover ALTER TABLE deltas that pre-date Drizzle adoption, or columns added quickly during incidents. New columns should go through Drizzle, but if you're inheriting a service that uses `ensure*` — keep that pattern within the service.

## Multi-tenancy

The system is multi-tenant by `tenants.slug`. The default slug `growth-escalators` lives in `src/config/constants.ts` as `DEFAULT_TENANT_SLUG`.

**Every new table needs:**
- A `tenant_id` column
- A foreign-key constraint matching the rest of the schema

Almost every query is tenant-scoped — forgetting `tenant_id` leaks data across tenants.

## Contact channels schema

Email and phone do **not** live on the `contacts` table. They live in `contact_channels` as rows with `(channel_type, channel_value)`. Selecting `c.email` or `c.phone` from `contacts` will 500 — use a correlated subquery or join against `contact_channels`.

## Key tables

| Table | Notes |
|---|---|
| `contacts` | Core entity. `tags[]`, `metadata{}`, `status`, `score`, `doNotContact` |
| `contact_channels` | Phone / WhatsApp / email per contact (unique per contact+type+value) |
| `deals` | Pipeline cards. `metadata.archived` for soft-hide |
| `processed_events` | Idempotency guard for all incoming webhooks |
| `jobs` | Background job queue — idempotency key prevents double-processing |
| `sequence_enrolments` | Contact × sequence position — `currentStep`, `nextStepAt`, `status` |

Full schema: `src/db/schema.ts`.

## Useful commands

```bash
npm run db:generate    # diff schema.ts → emit migration SQL
npm run db:migrate     # apply pending migrations
npm run db:studio      # local web UI
```
