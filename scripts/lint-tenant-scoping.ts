/**
 * Tenant-scoping lint check
 * =========================
 *
 * Static guard against the cross-tenant IDOR bug class this repo has hit
 * repeatedly (see .ai/HANDOFF_LOG.md, and PRs #109/#110/#111): a raw Drizzle
 * query-builder call — `db.select()/update()/delete()/insert()` (or the same
 * on a `tx` handle inside `db.transaction(async (tx) => ...)`) — that touches
 * a tenant-scoped table (a table with a `tenantId` column in `src/db/schema.ts`)
 * with no `tenantId`/`tenant_id` predicate anywhere in the same function.
 *
 * Run: npm run lint:tenant-scoping
 *
 * -----------------------------------------------------------------------
 * Heuristic (deliberately loose — see "Known limitations" below)
 * -----------------------------------------------------------------------
 * 1. Only tables with an actual `tenantId` column in schema.ts are checked
 *    (parsed directly from schema.ts — not hardcoded). `tenants` itself,
 *    join tables without their own tenantId, etc. are correctly excluded.
 *
 * 2. For select/update/delete: walk the full chained call
 *    (`db.select(...).from(X).where(W)...`) and check whether `W` (the
 *    `.where(...)` argument) references `<something>.tenantId` anywhere in
 *    its subtree. If it does, the call is considered scoped.
 *
 * 3. If not, fall back to a FUNCTION-LEVEL check: does the enclosing
 *    function's source text reference `tenantId` (or `tenant_id`) ANYWHERE
 *    else? This repo's dominant convention is "verify the parent row is
 *    owned by the caller's tenant first, then act on it by id" (see
 *    `deals.ts`'s PATCH handler, or `roundRobinService.ts`'s
 *    `resetFunnelCounts`) — the mutating statement's own `.where()` never
 *    mentions `tenantId` directly, but the function around it plainly does.
 *    Flagging those would make the check too noisy to keep enabled, so a
 *    function that shows *any* tenant-scoping awareness is given the
 *    benefit of the doubt for every query inside it.
 *
 * 4. update()/delete() calls with NO `.where()` at all on a tenant-scoped
 *    table are ALWAYS flagged (as "no filter clause") — that bypasses the
 *    function-level fallback, since an unconditional mutation of a
 *    multi-tenant table is never intentional.
 *
 * 5. insert() calls are checked for a `tenantId` key in `.values(...)`
 *    (own property, spread, or the function-level fallback if the values
 *    object is entirely dynamic) rather than a predicate — there is no
 *    WHERE on an insert, the risk is a row landing under nobody's tenant
 *    (or the wrong one).
 *
 * -----------------------------------------------------------------------
 * Raw SQL (`pool.query(...)` / `db.execute(sql\`...\`)`)
 * -----------------------------------------------------------------------
 * A large share of this codebase's DB access — most of `src/routes/wizmatch.ts`
 * in particular — is raw SQL via node-postgres `pool.query(...)` or Drizzle's
 * `db.execute(sql\`...\`)` escape hatch, not the query builder. Those are
 * checked too, with a coarser, string-based heuristic:
 *   - Only literal/template SQL text is inspected (a query built from a
 *     runtime string variable is skipped — can't statically see it).
 *   - Skip anything that isn't a SELECT/UPDATE/DELETE/INSERT (DDL-only
 *     ensure-hooks, `SELECT 1`, etc.).
 *   - If the SQL text mentions a tenant-scoped table's actual SQL name (e.g.
 *     `wizmatch_job_signals`) but never mentions `tenant_id` anywhere in
 *     that same query text, fall back to the same function-level check as
 *     above, then flag.
 *
 * -----------------------------------------------------------------------
 * Known limitations (false negatives this heuristic accepts)
 * -----------------------------------------------------------------------
 * - Tables that only ever exist via a raw-SQL "ensure-hook"
 *   (`CREATE TABLE IF NOT EXISTS` at boot, not in schema.ts) are invisible
 *   to this tool, because the tenant-scoped-table list comes from
 *   schema.ts — see PR #111's Growth OS tables.
 * - A function that is tenant-aware for *any* reason (even scoping a
 *   different table) will not have its other queries flagged, so a second,
 *   truly-unscoped query on another table in the same function can slip
 *   through. Tune this if it proves too loose in practice.
 * - This checks *presence* of a `tenantId` predicate/column, not whether
 *   its *value* actually comes from the authenticated session rather than
 *   client input (the "trusted a client-supplied tenantId" bug class from
 *   PR #109/#110) — that needs taint-tracking, a different tool.
 *
 * If you need to suppress a specific line (confirmed safe on inspection),
 * add `// tenant-scoping-lint-ignore-next-line` on the line above the call.
 *
 * -----------------------------------------------------------------------
 * Baseline (how this stays usable on day one, in a repo with pre-existing debt)
 * -----------------------------------------------------------------------
 * This codebase has real, pre-existing instances of this bug class that
 * predate this check (see `scripts/tenant-scoping-baseline.json` and the PR
 * that introduced this tool for the specifics). Turning the check on
 * strictly from day one would either block unrelated PRs on debt they didn't
 * introduce, or force fixing/reviewing security-sensitive code as a side
 * effect of adding a lint rule — neither is right.
 *
 * So: by default this command diffs against the committed baseline and only
 * fails on a *new* violation (grouped by file+table+method — robust to
 * line-number churn from unrelated edits). Existing baselined debt is
 * reported but does not fail the build.
 *
 *   npm run lint:tenant-scoping                 — CI mode: fail only on NEW violations
 *   npm run lint:tenant-scoping -- --full        — show everything, baseline or not (audit)
 *   npm run lint:tenant-scoping -- --update-baseline  — accept current state as the new baseline
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(ROOT, 'src/db/schema.ts');
const SCAN_ROOT = path.join(ROOT, 'src');

const RISKY_METHODS = new Set(['select', 'update', 'delete', 'insert']);
const DB_HANDLE_NAMES = new Set(['db', 'tx']);

const SUPPRESS_COMMENT = 'tenant-scoping-lint-ignore-next-line';

const EXCLUDE_PATH_PATTERNS: RegExp[] = [
  /[\\/]__tests__[\\/]/,
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /[\\/]db[\\/]migrations[\\/]/,
  /[\\/]db[\\/]schema\.ts$/, // parsed separately, not scanned for risky calls
  /[\\/]src[\\/]scripts[\\/]/, // one-off admin/seed CLI utilities — human-run once, never web-reachable
  /[\\/]workers[\\/]/, // background sweep/cron workers — intentionally cross-tenant by design (drain queues for every tenant), not driven by a caller-supplied id
];

// ---------------------------------------------------------------------------
// Step 1: figure out which tables have a tenantId column, straight from schema.ts
// ---------------------------------------------------------------------------
interface SchemaInfo {
  /** Drizzle export identifiers, e.g. "wizmatchJobSignals" — used by the query-builder check. */
  tsNames: Set<string>;
  /** Actual Postgres table names, e.g. "wizmatch_job_signals" — used by the raw-SQL check. */
  sqlNames: Set<string>;
}

function getTenantScopedTables(): SchemaInfo {
  const source = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const sourceFile = ts.createSourceFile(SCHEMA_PATH, source, ts.ScriptTarget.Latest, true);
  const tsNames = new Set<string>();
  const sqlNames = new Set<string>();

  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          ts.isCallExpression(decl.initializer) &&
          ts.isIdentifier(decl.initializer.expression) &&
          decl.initializer.expression.text === 'pgTable'
        ) {
          const nameArg = decl.initializer.arguments[0];
          const columnsArg = decl.initializer.arguments[1];
          if (columnsArg && ts.isObjectLiteralExpression(columnsArg)) {
            const hasTenantId = columnsArg.properties.some((p) => {
              const name = getPropertyName(p);
              return name === 'tenantId';
            });
            if (hasTenantId) {
              tsNames.add(decl.name.text);
              if (nameArg && ts.isStringLiteral(nameArg)) sqlNames.add(nameArg.text);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { tsNames, sqlNames };
}

function getPropertyName(p: ts.ObjectLiteralElementLike): string | undefined {
  if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p)) && p.name) {
    if (ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isStringLiteral(p.name)) return p.name.text;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Step 2: collect files to scan
// ---------------------------------------------------------------------------
function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      collectFiles(full, out);
    } else if (entry.isFile() && full.endsWith('.ts')) {
      if (EXCLUDE_PATH_PATTERNS.some((re) => re.test(full))) continue;
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------
interface ChainLink {
  methodName: string;
  args: readonly ts.Expression[];
  call: ts.CallExpression;
}

/** Climb from the anchor call to the outermost call in the same chain, then
 *  flatten back down, collecting every `.method(args)` link along the way
 *  (including the anchor itself). */
function flattenChain(anchor: ts.CallExpression): ChainLink[] {
  let top: ts.CallExpression = anchor;
  while (
    top.parent &&
    ts.isPropertyAccessExpression(top.parent) &&
    top.parent.expression === top &&
    top.parent.parent &&
    ts.isCallExpression(top.parent.parent) &&
    top.parent.parent.expression === top.parent
  ) {
    top = top.parent.parent;
  }

  const links: ChainLink[] = [];
  let cur: ts.Expression = top;
  while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
    links.push({ methodName: cur.expression.name.text, args: cur.arguments, call: cur });
    cur = cur.expression.expression;
  }
  return links;
}

function findEnclosingFunctionText(node: ts.Node, sourceFile: ts.SourceFile): string {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur)
    ) {
      return cur.getText(sourceFile);
    }
    cur = cur.parent;
  }
  return sourceFile.text; // top-level module code — permissive fallback
}

function referencesTenantId(node: ts.Node): boolean {
  let found = false;
  function visit(n: ts.Node) {
    if (found) return;
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'tenantId') {
      found = true;
      return;
    }
    if (ts.isIdentifier(n) && n.text === 'tenantId') {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return found;
}

// Deliberately broad: also matches indirection helpers/types that don't spell
// out "tenantId" verbatim (e.g. a `scope?: JobTenantScope` param threaded into
// a `tenantPredicate(scope)` helper, as in jobQueue.ts) — a plain substring
// hit on "tenant" anywhere in the function is treated as awareness.
const TENANT_ID_TEXT_RE = /tenant/i;

function hasLeadingSuppressComment(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const fullStart = node.getFullStart();
  const text = sourceFile.text.slice(fullStart, node.getStart(sourceFile));
  return text.includes(SUPPRESS_COMMENT);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Pulls the literal SQL text out of a string literal, template literal, or a
 *  `sql\`...\`` tagged template — returns undefined for anything dynamic
 *  (built from a variable) that we can't statically inspect. */
function extractSqlText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) text += ' __EXPR__ ' + span.literal.text;
    return text;
  }
  if (ts.isTaggedTemplateExpression(node)) return extractSqlText(node.template);
  return undefined;
}

const DML_RE = /\b(select|update|delete|insert)\b/i;
const TENANT_ID_SQL_RE = /\btenant_id\b/i;

type ValuesCheck = true | false | 'unknown';

function valuesHasTenantId(expr: ts.Expression): ValuesCheck {
  if (ts.isObjectLiteralExpression(expr)) {
    let sawSpread = false;
    for (const p of expr.properties) {
      const name = getPropertyName(p);
      if (name === 'tenantId') return true;
      if (ts.isSpreadAssignment(p)) sawSpread = true;
    }
    return sawSpread ? 'unknown' : false;
  }
  if (ts.isArrayLiteralExpression(expr)) {
    if (expr.elements.length === 0) return 'unknown';
    const results = expr.elements.map((el) => (ts.isExpression(el) ? valuesHasTenantId(el) : 'unknown'));
    if (results.some((r) => r === false)) return false;
    if (results.every((r) => r === true)) return true;
    return 'unknown';
  }
  return 'unknown'; // variable, function call, spread-only reference, etc.
}

// ---------------------------------------------------------------------------
// Violation reporting
// ---------------------------------------------------------------------------
interface Violation {
  file: string;
  line: number;
  table: string;
  method: string;
  reason: string;
}

function checkFile(filePath: string, schema: SchemaInfo): Violation[] {
  const tenantTables = schema.tsNames;
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const violations: Violation[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      DB_HANDLE_NAMES.has(node.expression.expression.text) &&
      RISKY_METHODS.has(node.expression.name.text)
    ) {
      handleAnchor(node);
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ((ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'pool' && node.expression.name.text === 'query') ||
        (ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'db' && node.expression.name.text === 'execute'))
    ) {
      handleRawSqlAnchor(node);
    }
    ts.forEachChild(node, visit);
  }

  function handleRawSqlAnchor(call: ts.CallExpression) {
    const arg0 = call.arguments[0];
    if (!arg0) return;
    const text = extractSqlText(arg0);
    if (!text) return; // built from a runtime string/variable — can't statically inspect, skip
    if (!DML_RE.test(text)) return; // pure DDL (ensure-hooks), SELECT 1, etc. — not our concern

    const mentioned = [...schema.sqlNames].filter((t) => new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i').test(text));
    if (mentioned.length === 0) return;
    if (TENANT_ID_SQL_RE.test(text)) return; // tenant_id appears somewhere in the query text itself

    if (hasLeadingSuppressComment(call, sourceFile)) return;

    const fnText = findEnclosingFunctionText(call, sourceFile);
    if (TENANT_ID_TEXT_RE.test(fnText)) return; // same function-level fallback as the query-builder check

    const line = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile)).line + 1;
    violations.push({
      file: filePath,
      line,
      table: mentioned.join(', '),
      method: 'raw-sql',
      reason: `raw SQL references ${mentioned.join(', ')} but never mentions tenant_id, and the enclosing function never references tenantId`,
    });
  }

  function handleAnchor(anchor: ts.CallExpression) {
    const method = (anchor.expression as ts.PropertyAccessExpression).name.text;
    const links = flattenChain(anchor);

    let table: string | undefined;
    if (method === 'select') {
      const fromLink = links.find((l) => l.methodName === 'from');
      const arg0 = fromLink?.args[0];
      if (arg0 && ts.isIdentifier(arg0)) table = arg0.text;
    } else {
      const arg0 = anchor.arguments[0];
      if (arg0 && ts.isIdentifier(arg0)) table = arg0.text;
    }

    if (!table || !tenantTables.has(table)) return; // not a tenant-scoped table (or table unresolved) — not our concern
    if (hasLeadingSuppressComment(anchor, sourceFile)) return;

    const line = sourceFile.getLineAndCharacterOfPosition(anchor.getStart(sourceFile)).line + 1;

    if (method === 'insert') {
      const valuesLink = links.find((l) => l.methodName === 'values');
      if (!valuesLink || !valuesLink.args[0]) return; // can't statically see the payload — skip, don't guess
      const check = valuesHasTenantId(valuesLink.args[0]);
      if (check === true) return;
      if (check === 'unknown') return; // dynamic values object — accepted false negative
      // check === false: no tenantId key anywhere in the literal — fall back to function-level awareness
      const fnText = findEnclosingFunctionText(anchor, sourceFile);
      if (TENANT_ID_TEXT_RE.test(fnText)) return;
      violations.push({
        file: filePath,
        line,
        table,
        method,
        reason: `insert(${table}).values(...) has no tenantId key, and the enclosing function never references tenantId`,
      });
      return;
    }

    // select / update / delete
    const whereLink = links.find((l) => l.methodName === 'where');

    if (!whereLink) {
      if (method === 'select') {
        // Unfiltered read — still risky, but common enough (aggregations, etc.)
        // that we apply the same function-level fallback rather than hard-flag.
        const fnText = findEnclosingFunctionText(anchor, sourceFile);
        if (TENANT_ID_TEXT_RE.test(fnText)) return;
        violations.push({
          file: filePath,
          line,
          table,
          method,
          reason: `select().from(${table}) has no .where() at all, and the enclosing function never references tenantId`,
        });
      } else {
        // update/delete with literally no .where() on a tenant-scoped table — always flag.
        violations.push({
          file: filePath,
          line,
          table,
          method,
          reason: `${method}(${table}) has no .where() clause at all (unconditional ${method === 'update' ? 'update' : 'delete'} on a multi-tenant table)`,
        });
      }
      return;
    }

    if (referencesTenantId(whereLink.call.arguments[0])) return;

    const fnText = findEnclosingFunctionText(anchor, sourceFile);
    if (TENANT_ID_TEXT_RE.test(fnText)) return;

    violations.push({
      file: filePath,
      line,
      table,
      method,
      reason: `${method}(${table})... .where(...) has no tenantId predicate, and the enclosing function never references tenantId`,
    });
  }

  visit(sourceFile);
  return violations;
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------
const BASELINE_PATH = path.join(ROOT, 'scripts/tenant-scoping-baseline.json');

interface Baseline {
  generatedAt: string;
  /** key = "relFile::table::method" -> accepted (pre-existing) instance count */
  entries: Record<string, number>;
}

function violationKey(v: Violation): string {
  const rel = path.relative(ROOT, v.file).split(path.sep).join('/');
  return `${rel}::${v.table}::${v.method}`;
}

function groupByKey(violations: Violation[]): Map<string, Violation[]> {
  const map = new Map<string, Violation[]>();
  for (const v of violations) {
    const key = violationKey(v);
    const list = map.get(key);
    if (list) list.push(v);
    else map.set(key, [v]);
  }
  return map;
}

function loadBaseline(): Baseline | undefined {
  if (!fs.existsSync(BASELINE_PATH)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
  } catch {
    return undefined;
  }
}

function writeBaseline(grouped: Map<string, Violation[]>) {
  const entries: Record<string, number> = {};
  for (const [key, list] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    entries[key] = list.length;
  }
  const baseline: Baseline = { generatedAt: new Date().toISOString(), entries };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`[tenant-scoping-lint] wrote baseline with ${Object.keys(entries).length} entries (${Object.values(entries).reduce((a, b) => a + b, 0)} total instances) to ${path.relative(ROOT, BASELINE_PATH)}`);
}

function printViolation(v: Violation) {
  const rel = path.relative(ROOT, v.file);
  console.error(`  ${rel}:${v.line}  [${v.method} → ${v.table}]`);
  console.error(`    ${v.reason}`);
  console.error('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = new Set(process.argv.slice(2));
  const full = args.has('--full');
  const updateBaseline = args.has('--update-baseline');

  const schema = getTenantScopedTables();
  const files = collectFiles(SCAN_ROOT);

  const allViolations: Violation[] = [];
  for (const file of files) {
    allViolations.push(...checkFile(file, schema));
  }
  const grouped = groupByKey(allViolations);

  console.log(`[tenant-scoping-lint] ${schema.tsNames.size} tenant-scoped tables found in schema.ts`);
  console.log(`[tenant-scoping-lint] scanned ${files.length} files under src/`);
  console.log('');

  if (updateBaseline) {
    writeBaseline(grouped);
    process.exit(0);
  }

  if (full) {
    if (allViolations.length === 0) {
      console.log('✅ No missing tenant-scoping predicates found.');
      process.exit(0);
    }
    console.error(`❌ ${allViolations.length} possible missing tenant-scoping predicate(s) (--full, baseline ignored):\n`);
    for (const v of allViolations) printViolation(v);
    process.exit(1);
  }

  // Default: diff against baseline, fail only on NEW instances.
  const baseline = loadBaseline();
  if (!baseline) {
    console.log(
      `[tenant-scoping-lint] no baseline file at ${path.relative(ROOT, BASELINE_PATH)} — treating every` +
      ' finding as new. Run with --update-baseline to accept the current state.\n',
    );
  }
  const baselineEntries = baseline?.entries ?? {};

  const newViolations: Violation[] = [];
  let baselinedCount = 0;
  for (const [key, list] of grouped) {
    const accepted = baselineEntries[key] ?? 0;
    baselinedCount += Math.min(accepted, list.length);
    if (list.length > accepted) newViolations.push(...list.slice(accepted));
  }

  if (baselinedCount > 0) {
    console.log(`[tenant-scoping-lint] ${baselinedCount} pre-existing (baselined) finding(s) — not blocking. Run with --full to see them.`);
    console.log('');
  }

  if (newViolations.length === 0) {
    console.log('✅ No NEW missing tenant-scoping predicates found.');
    process.exit(0);
  }

  console.error(`❌ ${newViolations.length} NEW possible missing tenant-scoping predicate(s):\n`);
  for (const v of newViolations) printViolation(v);
  console.error(
    'These are not in scripts/tenant-scoping-baseline.json, so they look like a NEW\n' +
    'instance of this bug class introduced by this change.\n\n' +
    'If a flagged call is genuinely safe (e.g. tenant ownership already verified by a\n' +
    `different table earlier), add "// ${SUPPRESS_COMMENT}" on the line above it and\n` +
    'leave a short comment explaining why — do not just re-run --update-baseline to\n' +
    'silence it.',
  );
  process.exit(1);
}

main();
