// Source-level guards for the Today workbench's queue table.
//
// `.js` on purpose, matching wizmatchTelemetryRegistry.test.js: tsconfig pins
// `rootDir: "./src"` with `allowJs` off, so a .js test may reach across into
// admin/ while a .test.ts of the same content would fail `npm run build`.
//
// These are source-text assertions rather than rendered-component tests
// because this repo's vitest environment is `node` with no jsdom, React or
// testing-library — the same reason sidebarNavBucketCoverage and the telemetry
// registry test are written this way. They deliberately cover only invariants
// where being wrong is expensive and silent:
//
//   1. A signal or contact id must NEVER be posted to POST /today/actions.
//      `runTodayActions` dispatches `if (target.type === 'company') … else
//      applyDuplicateAction(…)`, so a non-company target does not error — it
//      is routed into DUPLICATE RESOLUTION. There is no runtime signal for
//      that mistake, on either side.
//   2. Every `buildBody` must still be a FUNCTION at dialog-open time; an
//      accidentally-evaluated one throws only when the operator presses
//      Confirm, i.e. only in production.
//   3. The queue key list must exist in exactly one place. The four literals
//      this table replaced had to be edited in five spots, and a key present
//      in the render loop but absent from the selection state throws on first
//      click.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_PATH = path.join(
  __dirname, '..', '..', 'admin', 'src', 'components', 'wizmatch', 'TodayDecisionWorkbench.jsx',
);
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

/** Strips comments before any source-text assertion — otherwise the prose explaining a rule counts as a violation of it. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const defsBlock = code.slice(code.indexOf('const QUEUE_DEFS = ['), code.indexOf('\n];', code.indexOf('const QUEUE_DEFS = [')));

const defs = defsBlock
  .split(/\n  \{/)
  .slice(1)
  .map((block) => ({
    key: /key: '([^']+)'/.exec(block)?.[1],
    kind: /kind: '([^']+)'/.exec(block)?.[1],
    idField: /idField: '([^']+)'/.exec(block)?.[1],
    endpoint: /endpoint: '([^']+)'/.exec(block)?.[1],
    block,
  }));

const ENDPOINT_BY_KIND = {
  company: '/api/wizmatch/today/actions',
  signal: '/api/wizmatch/signals/bulk-action',
  contact: '/api/wizmatch/contact-intelligence/contacts/bulk-review',
};

describe('TodayDecisionWorkbench QUEUE_DEFS', () => {
  it('defines the six queues, each with a kind, an id field and an endpoint', () => {
    expect(defs.map((d) => d.key)).toEqual([
      'signalsToQualify', 'contactsToReview', 'readyToContact', 'needsReview', 'routed', 'pausedOrBlocked',
    ]);
    for (const def of defs) {
      expect(def.kind, `${def.key} has no kind`).toBeTruthy();
      expect(def.idField, `${def.key} has no idField`).toBeTruthy();
      expect(def.endpoint, `${def.key} has no endpoint`).toBeTruthy();
    }
  });

  // The load-bearing one. /today/actions cannot act on a signal or a contact,
  // and will not say so — it will treat the id as a duplicate-pair id.
  it('routes each kind to ITS OWN endpoint, and never a non-company kind to /today/actions', () => {
    for (const def of defs) {
      expect(def.endpoint, `${def.key} (${def.kind}) posts to the wrong endpoint`).toBe(ENDPOINT_BY_KIND[def.kind]);
    }
    for (const def of defs.filter((d) => d.kind !== 'company')) {
      expect(def.endpoint).not.toContain('/today/actions');
    }
  });

  it('keys each queue on its own id field, so a row key is never silently undefined', () => {
    const idFieldByKind = { company: 'companyId', signal: 'signalId', contact: 'candidateId' };
    for (const def of defs) {
      expect(def.idField, `${def.key}`).toBe(idFieldByKind[def.kind]);
    }
  });

  it('gives every non-company queue a request-body builder (the two bulk endpoints differ: `action` vs `decision`)', () => {
    const signalDef = defs.find((d) => d.kind === 'signal');
    const contactDef = defs.find((d) => d.kind === 'contact');
    expect(signalDef.block).toMatch(/buildBody: \(action, ids, extra\) => \(\{ ids, action,/);
    expect(contactDef.block).toMatch(/buildBody: \(action, ids, extra\) => \(\{ ids, decision: action,/);
  });

  it('reports a load failure per queue, so a broken queue can never render as a finished one', () => {
    for (const def of defs.filter((d) => d.kind !== 'company')) {
      expect(def.block, `${def.key} has no unavailableKey`).toMatch(/unavailableKey: '/);
      expect(def.block, `${def.key} has no unavailableMessage`).toMatch(/unavailableMessage: '/);
    }
  });
});

describe('TodayDecisionWorkbench — derived state, not a second hardcoded key list', () => {
  it('has no queue-key array literal outside QUEUE_DEFS', () => {
    const outsideDefs = code.replace(defsBlock, '');
    // The exact literal this table replaced. Any reappearance means the list
    // exists in two places again, which is how they drift.
    expect(outsideDefs).not.toMatch(/\['readyToContact'/);
    expect(outsideDefs).not.toMatch(/readyToContact: new Set\(\)/);
    expect(outsideDefs).toMatch(/const QUEUE_KEYS = QUEUE_DEFS\.map/);
  });

  it('builds selection state and the id lookup from QUEUE_DEFS', () => {
    expect(code).toMatch(/const emptySelection = \(\) => Object\.fromEntries\(QUEUE_KEYS\.map/);
    expect(code).toMatch(/for \(const def of QUEUE_DEFS\) \{[\s\S]{0,200}item\[def\.idField\]/);
  });

  it('renders the queue loop from QUEUE_DEFS', () => {
    expect(code).toMatch(/QUEUE_DEFS\.map\(\(def\) => \{/);
  });
});

describe('TodayDecisionWorkbench — dialog body builders stay lazy', () => {
  // `companyBody(action, targets, pid)(action, ids)` returns an OBJECT, and
  // `submitAction` calls `dialog.buildBody(extra)` — which then throws
  // "buildBody is not a function" at Confirm time and nowhere earlier. This
  // exact mistake was made and caught during implementation.
  it('never assigns an immediately-invoked builder to buildBody', () => {
    for (const match of code.matchAll(/buildBody:[^\n]*\n?[^\n]*/g)) {
      expect(match[0], 'buildBody must stay a function, not an evaluated object')
        .not.toMatch(/companyBody\([^)]*\)\s*\(/);
    }
  });

  it('every buildBody assignment yields a function of `extra`', () => {
    const assignments = [...code.matchAll(/buildBody: ([\s\S]*?)(?=,\n\s*\}\)|,\n\s{6}\w+:)/g)].map((m) => m[1]);
    expect(assignments.length).toBeGreaterThanOrEqual(3);
    for (const assignment of assignments) {
      expect(assignment, `not a lazy builder: ${assignment.slice(0, 80)}`)
        .toMatch(/\(extra\) =>|\(action, ids, extra\) =>|companyBody\(action,[^)]*\)(?!\s*\()/);
    }
  });
});

describe('TodayDecisionWorkbench — payload validation stays fail-closed', () => {
  it('still REQUIRES the four original arrays before rendering a response', () => {
    const guard = /const isQueuePayload = \(d\) => ([\s\S]*?);\n/.exec(code)[1];
    for (const key of ['readyToContact', 'needsReview', 'pausedOrBlocked', 'repliesNeedingAction']) {
      expect(guard, `isQueuePayload must require ${key}`).toContain(`Array.isArray(d.${key})`);
    }
  });

  // ...while the three later queues are OPTIONAL, so a backend that predates
  // them is not rejected as malformed. Same back-compat reason `routed`
  // already had.
  it('defaults routed / signalsToQualify / contactsToReview to [] instead of requiring them', () => {
    const guard = /const isQueuePayload = \(d\) => ([\s\S]*?);\n/.exec(code)[1];
    for (const key of ['routed', 'signalsToQualify', 'contactsToReview']) {
      expect(guard, `isQueuePayload must NOT require ${key}`).not.toContain(`d.${key}`);
      expect(code).toMatch(new RegExp(`${key}: Array\\.isArray\\(data\\.${key}\\) \\? data\\.${key} : \\[\\]`));
    }
  });
});

describe('TodayDecisionWorkbench — bulk envelope adapter', () => {
  it('stamps `type` from the queue kind but never invents a `code`', () => {
    const adapter = /function normaliseBulkOutcome\(([\s\S]*?)\n\}/.exec(code)[1];
    expect(adapter).toMatch(/type: r\?\.type \|\| kind/);
    // The two bulk endpoints have no failure `code`; fabricating one would
    // make the stale-policy filter act on a value the server never sent.
    expect(adapter).not.toMatch(/code:/);
  });

  it('leaves the stale-policy filter keyed on company results only', () => {
    expect(code).toMatch(/r\.type === 'company' && r\.code === 'stale_policy_state'/);
  });
});
