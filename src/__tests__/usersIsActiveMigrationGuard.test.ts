// QA run 2026-07-30 — regression guard for failure-matrix finding M-3
// ("`users.is_active` exists in no schema or migration").
//
// `users.is_active` is load-bearing for authentication: `src/routes/auth.ts`
// gates login on it in three places, and `DELETE /api/permissions/users/:userId`
// deactivates a departed employee by setting it. Yet it existed in no migration
// and no schema — only in a fire-and-forget, error-swallowing runtime ALTER at
// `src/routes/permissions.ts:21`. A database built from migrations alone (a DR
// restore, or any new environment) came up without the column, and because login
// references it in raw SQL, login failed outright there.
//
// Migration 0038 models it properly. This is a SOURCE-LEVEL guard, the
// convention this repo already uses for invariants a unit test cannot otherwise
// observe (`wizmatchIndexMountOrder.test.ts`,
// `wizmatchCompanyBootstrapCoverage.test.ts`): the real assertion — that a clean
// `drizzle-kit migrate` onto an empty PostgreSQL 18 database yields a `users`
// table containing `is_active` — needs a live cluster and so cannot run in this
// DB-less unit suite. It was verified by hand during the QA run and is recorded
// in docs/testing/WIZMATCH_FULL_PLAYWRIGHT_VALIDATION_FINAL.md.
//
// What this file protects against, mechanically:
//  1. someone deleting `isActive` from the `users` model in schema.ts;
//  2. the column having no migration backing it at all (the original defect);
//  3. the `IF NOT EXISTS` being lost — which matters more than it looks. Every
//     existing database already has this column from the runtime ALTER, so a
//     bare `ADD COLUMN` raises `column "is_active" ... already exists`. Because
//     migrations run from the API service's startCommand, that means the API
//     does not start. Verified during the QA run: the bare form drizzle
//     generates does error against a database that already has the column.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');
const schemaSource = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.ts'), 'utf8');

function usersTableBlock(): string {
  const start = schemaSource.indexOf("export const users = pgTable(");
  expect(start, 'users table not found in schema.ts').toBeGreaterThan(-1);
  // The model ends at the first `);` that closes the pgTable call.
  const end = schemaSource.indexOf('\n);', start);
  expect(end, 'could not find the end of the users pgTable call').toBeGreaterThan(start);
  return schemaSource.slice(start, end);
}

/** Every applied .sql migration, newest last. */
function migrationSql(): { file: string; sql: string }[] {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8') }));
}

describe('users.is_active is backed by schema + migration (M-3)', () => {
  it('is modelled on the users table in schema.ts', () => {
    expect(usersTableBlock()).toMatch(/isActive:\s*boolean\('is_active'\)/);
  });

  it('is nullable, because login reads `is_active IS NULL OR is_active = true`', () => {
    const block = usersTableBlock();
    const line = block.split('\n').find((l) => l.includes("boolean('is_active')")) ?? '';
    // A `.notNull()` here would contradict auth.ts's NULL-tolerant predicate and
    // would fail to apply against a populated table without a backfill.
    expect(line).not.toMatch(/notNull\(\)/);
    expect(line).toMatch(/default\(true\)/);
  });

  it('is added to the users table by at least one migration', () => {
    const adding = migrationSql().filter(({ sql }) =>
      /ALTER TABLE\s+"?users"?\s+ADD COLUMN(\s+IF NOT EXISTS)?\s+"?is_active"?/i.test(sql));
    expect(
      adding.map((m) => m.file),
      'no migration adds users.is_active — this is defect M-3 reappearing',
    ).not.toHaveLength(0);
  });

  // The load-bearing half. Drizzle generates a BARE `ADD COLUMN`; every existing
  // database already has this column from the runtime ALTER, so the bare form
  // errors and — since migrations run from the API startCommand — the API will
  // not boot. Regenerating this migration would silently reintroduce that.
  it('adds it with IF NOT EXISTS, so it cannot fail against a database that already has it', () => {
    const adding = migrationSql().filter(({ sql }) =>
      /ALTER TABLE\s+"?users"?\s+ADD COLUMN(\s+IF NOT EXISTS)?\s+"?is_active"?/i.test(sql));
    for (const { file, sql } of adding) {
      const statements = sql.split('\n')
        .filter((l) => /ALTER TABLE\s+"?users"?\s+ADD COLUMN/i.test(l));
      for (const statement of statements) {
        expect(
          statement,
          `${file} adds users.is_active without IF NOT EXISTS — this will abort the migration, and therefore API startup, on every environment that already has the column`,
        ).toMatch(/ADD COLUMN\s+IF NOT EXISTS/i);
      }
    }
  });

  // The ensure hook stays until production has the column via the migration
  // path — removing both in one change would leave a window with neither.
  it('keeps the idempotent runtime ensure hook in permissions.ts as a belt-and-braces fallback', () => {
    const permissions = fs.readFileSync(path.join(__dirname, '..', 'routes', 'permissions.ts'), 'utf8');
    expect(permissions).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active/);
  });
});
