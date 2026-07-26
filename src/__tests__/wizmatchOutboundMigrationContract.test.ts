// PRD-005 §10.11.4 / §22.2 #8, #10 — mechanical contract tests over migration
// 0037's SQL text.
//
// These exist because the §10.11.4 fresh `0000 -> 0037` replay needs a live
// Postgres and so cannot run in CI here. Two classes of defect that the replay
// would have caught are checkable from the file alone, and both were real:
//
//   1. Composite-FK ordering. PostgreSQL resolves the referenced unique index
//      at ADD CONSTRAINT time, not at COMMIT. drizzle-kit emits every
//      CREATE INDEX after every ADD CONSTRAINT, which for a
//      (tenant_id, id) composite FK is unusable — SQLSTATE 42830.
//   2. Enrolment-state drift. §22.2 #8 requires all four partial-index
//      predicates and the state CHECK to derive from ONE exported constant.
//      The migration text is necessarily a frozen copy, so only a test can
//      pin the copy to the constant.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WIZMATCH_ALL_ENROLMENT_STATES,
  WIZMATCH_LIVE_ENROLMENT_STATES,
} from '../config/wizmatchOutreachStates';

const MIGRATION_PATH = join(__dirname, '..', 'db', 'migrations', '0037_unknown_siren.sql');
const sqlText = readFileSync(MIGRATION_PATH, 'utf8');
const statements = sqlText.split('--> statement-breakpoint');

/** Index of the first statement matching `predicate`, or -1. */
function indexOfStatement(predicate: (s: string) => boolean): number {
  return statements.findIndex(predicate);
}

describe('migration 0037 — composite-FK ordering (PRD-005 §10.11.4)', () => {
  // Every composite FK in the file, as (statementIndex, parentTable).
  const compositeFkRefs: { statementIndex: number; parent: string; constraint: string }[] = [];
  statements.forEach((stmt, statementIndex) => {
    const re =
      /ADD CONSTRAINT "([^"]+)" FOREIGN KEY \("tenant_id","[^"]+"\) REFERENCES "public"\."([^"]+)"\("tenant_id","id"\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(stmt)) !== null) {
      compositeFkRefs.push({ statementIndex, constraint: match[1]!, parent: match[2]! });
    }
  });

  it('finds the composite FKs it is meant to be checking', () => {
    // Guards against the regexes silently matching nothing and the suite
    // passing vacuously.
    expect(compositeFkRefs.length).toBeGreaterThanOrEqual(25);
  });

  it('creates every referenced (tenant_id, id) unique index BEFORE the FK that needs it', () => {
    const failures: string[] = [];

    for (const { statementIndex, parent, constraint } of compositeFkRefs) {
      const indexStatementIndex = indexOfStatement(
        (s) =>
          /CREATE UNIQUE INDEX/.test(s) &&
          new RegExp(`ON "${parent}" USING btree \\("tenant_id","id"\\)`).test(s),
      );

      if (indexStatementIndex === -1) {
        failures.push(`${constraint}: no UNIQUE INDEX on ${parent}(tenant_id, id) anywhere in 0037`);
      } else if (indexStatementIndex > statementIndex) {
        failures.push(
          `${constraint}: FK at statement ${statementIndex} references ${parent}(tenant_id, id), ` +
            `but that index is not created until statement ${indexStatementIndex} — ` +
            `PostgreSQL raises 42830 and the migration aborts`,
        );
      }
    }

    expect(failures).toEqual([]);
  });
});

describe('migration 0037 — enrolment-state parity (PRD-005 §22.2 #8)', () => {
  const liveList = WIZMATCH_LIVE_ENROLMENT_STATES.map((s) => `'${s}'`).join(',');

  it('every partial lock predicate lists exactly the eight live states', () => {
    // The four §10.6.2 live-state partial unique indexes.
    const partialPredicates = sqlText.match(/WHERE[^;]*\bstate IN \([^)]*\)/g) ?? [];

    expect(partialPredicates.length).toBe(4);
    for (const predicate of partialPredicates) {
      const stateList = predicate.match(/\bstate IN \(([^)]*)\)/)?.[1];
      expect(stateList?.replace(/\s/g, '')).toBe(liveList);
    }
  });

  it('the state CHECK carries all fifteen states from the exported constant', () => {
    const check = sqlText.match(/CONSTRAINT "wizmatch_outreach_enrolments_state_chk" CHECK \(([^)]*)\)/)?.[1];
    expect(check).toBeDefined();

    for (const state of WIZMATCH_ALL_ENROLMENT_STATES) {
      expect(check).toContain(`'${state}'`);
    }
    // and nothing beyond them
    const quoted = check!.match(/'[a-z_]+'/g) ?? [];
    expect(new Set(quoted).size).toBe(WIZMATCH_ALL_ENROLMENT_STATES.length);
  });
});

describe('migration 0037 — additive-only (PRD-005 §10.11.3, §22.2 #10)', () => {
  it('contains no destructive statement', () => {
    const destructive =
      /\b(DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN\s+"[^"]+"\s+TYPE|RENAME)\b/gi;
    expect(sqlText.match(destructive) ?? []).toEqual([]);
  });

  it('leaves the wizmatch_suppression_list UNIQUE (tenant_id, email) index untouched (§22.2 #7)', () => {
    expect(sqlText).not.toMatch(/wizmatch_suppression_tenant_email_uniq_idx/);
  });

  it('has no admin_override, suppression_scope or scope_ref_id column (§22.2 #2, #6)', () => {
    expect(sqlText).not.toMatch(/\badmin_override\b/);
    expect(sqlText).not.toMatch(/\bsuppression_scope\b/);
    expect(sqlText).not.toMatch(/\bscope_ref_id\b/);
  });

  it('references wizmatch_job_signals for signal_id, never Growth’s signals table (§22.2 #2)', () => {
    expect(sqlText).toMatch(
      /"wizmatch_company_policies_signal_fk" FOREIGN KEY \("tenant_id","signal_id"\) REFERENCES "public"\."wizmatch_job_signals"/,
    );
    expect(sqlText).not.toMatch(/REFERENCES "public"\."signals"/);
  });
});
