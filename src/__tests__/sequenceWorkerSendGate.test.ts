// QA run 2026-07-30 — regression guard for the sequence-dispatch send gate.
//
// The gap (found by the security lane, latent because sending is currently off):
// `sequenceWorker.processSequenceSteps` gated WizMatch-linked enrolments on the
// outreach POLICY gate only. That gate defaults to SHADOW — `outreachGate.ts`
// treats anything other than the literal 'enforce' as log-only — so by default
// it never blocks. `WIZMATCH_SENDING_ENABLED` was checked once at enrolment time
// and never re-read, so flipping sending OFF did not stop sequences already in
// flight: the worker kept enqueuing `sequence_step` jobs for them.
//
// The check is deliberately scoped to WizMatch-LINKED enrolments. This worker
// serves EVERY tenant's sequences, and `WIZMATCH_SENDING_ENABLED` is a WizMatch
// switch — gating the whole worker on it would halt the Growth tenant's
// unrelated sequences. The tests below pin both halves: held when linked, and
// NOT held when unlinked.
//
// This is a source-level guard. `processSequenceSteps` is module-private, runs
// on a 30s interval and needs a live Postgres pool plus the WizMatch linkage
// resolver to exercise behaviourally; the repo's convention for that situation
// (`wizmatchIndexMountOrder.test.ts`, `wizmatchScopeBoundaryPR8B.test.ts`) is to
// assert the real source with comments stripped, so a rationale comment cannot
// satisfy the check.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '..', 'workers', 'sequenceWorker.ts'), 'utf8');

/** Comments stripped, so a comment mentioning the flag can never satisfy a check. */
const bare = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('sequenceWorker re-checks the master send flag on dispatch', () => {
  it('reads WIZMATCH_SENDING_ENABLED in executable code, not only in a comment', () => {
    expect(bare).toMatch(/process\.env\.WIZMATCH_SENDING_ENABLED/);
  });

  it('treats anything other than the literal "true" as OFF (fail closed)', () => {
    // `!== 'true'` rather than a truthiness or `!== 'false'` test: an unset,
    // empty, or typo'd value must hold, not dispatch.
    expect(bare).toMatch(/process\.env\.WIZMATCH_SENDING_ENABLED\s*!==\s*'true'/);
  });

  it('performs the check INSIDE the WizMatch-linkage branch, so other tenants are unaffected', () => {
    const linkageBranch = bare.indexOf('if (linkage) {');
    const flagCheck = bare.indexOf('process.env.WIZMATCH_SENDING_ENABLED');
    expect(linkageBranch, 'the WizMatch linkage branch disappeared').toBeGreaterThan(-1);
    expect(flagCheck, 'the send-flag check disappeared').toBeGreaterThan(-1);
    expect(
      flagCheck,
      'the send-flag check moved outside the WizMatch linkage branch — it would now halt every tenant\'s sequences, including the Growth tenant\'s',
    ).toBeGreaterThan(linkageBranch);
  });

  it('checks the flag BEFORE the shadow-by-default policy gate, not after', () => {
    // Ordering is the whole point: the policy gate does not block by default, so
    // relying on it to stop dispatch is exactly the defect this closes.
    const flagCheck = bare.indexOf('process.env.WIZMATCH_SENDING_ENABLED');
    // The CALL site, not the import at the top of the file.
    const policyGate = bare.indexOf('await evaluateWizmatchOutreachGate');
    expect(policyGate, 'the policy gate call disappeared').toBeGreaterThan(-1);
    expect(flagCheck).toBeLessThan(policyGate);
  });

  it('holds the enrolment rather than advancing or cancelling it', () => {
    // Between the flag check and the policy gate there must be a bare `continue`
    // and no enrolment mutation — advancing would silently skip a step, and
    // cancelling would destroy the sequence on a temporary flag flip.
    const flagCheck = bare.indexOf('process.env.WIZMATCH_SENDING_ENABLED');
    const policyGate = bare.indexOf('await evaluateWizmatchOutreachGate');
    const between = bare.slice(flagCheck, policyGate);
    expect(between).toMatch(/continue;/);
    expect(between).not.toMatch(/\.set\(/);
    expect(between).not.toMatch(/insertJob/);
  });

  it('does not gate the whole worker — an unlinked enrolment never consults the WizMatch flag', () => {
    // The flag check must sit after the linkage resolution, so a non-WizMatch
    // enrolment reaches insertJob without ever reading it.
    const linkageResolve = bare.indexOf('resolveWizmatchLinkage');
    const flagCheck = bare.indexOf('process.env.WIZMATCH_SENDING_ENABLED');
    expect(linkageResolve).toBeGreaterThan(-1);
    expect(flagCheck).toBeGreaterThan(linkageResolve);
    // Exactly one EXECUTABLE read of it — a second, unscoped one elsewhere would
    // reintroduce the cross-tenant halt. Counts `process.env.` reads rather than
    // bare mentions so prose in a comment can neither satisfy nor break this.
    expect((bare.match(/process\.env\.WIZMATCH_SENDING_ENABLED/g) ?? []).length).toBe(1);
  });
});
