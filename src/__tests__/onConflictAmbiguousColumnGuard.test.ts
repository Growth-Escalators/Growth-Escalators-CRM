// QA run 2026-07-30 — regression guard for ambiguous column references inside
// `ON CONFLICT ... DO UPDATE` blocks.
//
// The defect this generalises (register QA-17): `wizmatchContactIntelligenceRepo.ts`
// wrote
//     status = CASE WHEN review_status = 'rejected' THEN status ELSE EXCLUDED.status END
// inside an ON CONFLICT DO UPDATE on `wizmatch_company_intelligence`, a table that
// has BOTH `status` and `review_status`. Inside that block an unqualified column
// name is ambiguous between the target row and `excluded`, and PostgreSQL rejects
// it at PARSE time:
//     ERROR: column reference "review_status" is ambiguous
// Parse time, not conflict time — so it did not fail on an edge case. It made the
// statement, and with it the entire discovery-preview/discover code path, 500 on
// EVERY call, for every company. Reproduced live by the Playwright lane and then
// minimally against PostgreSQL 18.4.
//
// This bug class has bitten this repo before (a signals-list ambiguous-column
// 500), which is why the guard is generic rather than a single assertion about
// one line: it scans every ON CONFLICT DO UPDATE block in the codebase and
// requires each column reference on the right-hand side of a SET assignment to
// be qualified — either `excluded.x` or `some_table.x`.
//
// A unit suite cannot catch this by executing the query (no database here), and
// the failure is invisible to type-checking because it lives inside a template
// string. A source scan is the only mechanism that sees it at all.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry === 'migrations') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else if (entry.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

/**
 * Extracts the text of each `ON CONFLICT ... DO UPDATE SET ...` block, ending at
 * the statement terminator (RETURNING, a closing backtick, or a trailing `;`).
 */
function onConflictBlocks(source: string): { block: string; index: number }[] {
  const out: { block: string; index: number }[] = [];
  const re = /ON\s+CONFLICT[\s\S]{0,200}?DO\s+UPDATE\s+SET/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const start = m.index + m[0].length;
    // SQL comments are stripped FIRST — before the end delimiter is located and
    // before the caller splits on commas. Order matters, and both orderings were
    // got wrong while writing this guard:
    //   - stripping after splitting lets a comment containing a COMMA swallow
    //     the assignment that follows it;
    //   - stripping after finding the end lets a comment containing a BACKTICK
    //     terminate the block early, truncating away the very assignment being
    //     checked. That is what made the first version of this guard vacuous,
    //     and it was only caught by mutating the known defect back in and
    //     watching the test still pass.
    const rest = source.slice(start).replace(/--.*$/gm, ' ');
    const endMatch = /\bRETURNING\b|`|;\s*$/i.exec(rest);
    out.push({ block: rest.slice(0, endMatch ? endMatch.index : 400), index: start });
  }
  return out;
}

/** SQL keywords and function names that are not column references. */
const NOT_A_COLUMN = new Set([
  'case', 'when', 'then', 'else', 'end', 'and', 'or', 'not', 'null', 'is', 'in',
  'now', 'coalesce', 'greatest', 'least', 'true', 'false', 'excluded', 'select',
  'from', 'where', 'as', 'cast', 'jsonb', 'text', 'int', 'boolean', 'timestamp',
  'array', 'distinct', 'on', 'conflict', 'do', 'update', 'set', 'nullif', 'concat',
  'interval', 'default', 'returning', 'string_agg', 'to_jsonb', 'json_build_object',
]);

describe('no unqualified column reference inside ON CONFLICT DO UPDATE', () => {
  const files = collect(SRC);

  it('scans a non-trivial number of source files (guards against a broken collector)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('finds at least one ON CONFLICT DO UPDATE block to check (guards against a broken matcher)', () => {
    const total = files.reduce((n, f) => n + onConflictBlocks(readFileSync(f, 'utf8')).length, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('every column reference in a DO UPDATE assignment is table- or excluded-qualified', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const { block } of onConflictBlocks(source)) {
        // Only the right-hand sides: `col = <expr>`. The left-hand target of a
        // SET assignment is unambiguous by definition and must NOT be qualified.
        for (const assignment of block.split(',')) {
          const eq = assignment.indexOf('=');
          if (eq === -1) continue;
          const rhs = assignment.slice(eq + 1);

          // Strip qualified references and SQL string literals, then anything
          // still identifier-shaped is an unqualified column reference.
          const stripped = rhs
            .replace(/\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*/g, ' ')
            .replace(/'[^']*'/g, ' ')
            .replace(/\$\d+/g, ' ')
            .replace(/--.*$/gm, ' ');

          for (const ident of stripped.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? []) {
            if (NOT_A_COLUMN.has(ident.toLowerCase())) continue;
            offenders.push(
              `${file.replace(SRC, 'src')}: unqualified "${ident}" in "${assignment.trim().slice(0, 90)}"`,
            );
          }
        }
      }
    }

    expect(
      offenders,
      'An unqualified column inside ON CONFLICT DO UPDATE is ambiguous between the target row and `excluded`. '
        + 'PostgreSQL rejects it at PARSE time, so the statement fails on EVERY call, not only on conflict. '
        + 'Qualify it as `excluded.col` or `the_table.col`.',
    ).toEqual([]);
  });
});
