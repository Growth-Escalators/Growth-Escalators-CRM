// 2026-08-01 — two write paths had no status guard, and Today's new bulk
// queues made that dangerous rather than merely untidy.
//
//   applyContactCandidateReview  resolved its transition from a HARDCODED
//     `currentContactStatus: 'needs_review'` — it never read the row's real
//     status — and updated on (tenant_id, id) alone. Re-reviewing an
//     already-decided candidate succeeded and silently overwrote `status`,
//     `reviewed_by`, `reviewed_at` and `rejection_reason`. The earlier decision
//     and the person who made it were lost, with no error.
//
//   rejectSignal  updated on (id, tenant_id) alone, so rejecting an already
//     `placed` signal overwrote a real placement outcome with `dead`.
//
// Both were survivable at one row per click. Today now exposes BULK
// approve/reject over the same services with a 200-id cap, so one action could
// overwrite up to 200 prior decisions. The fix is a compare-and-set in the
// WHERE — the same pattern resolveDuplicate and releaseEnrolment use.
//
// These assert on the emitted SQL and its params rather than round-tripping a
// database, which is this suite's convention for raw-SQL services.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (src: string) => src
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  })
  .join('\n');

const routes = strip(readFileSync(join(__dirname, '..', 'routes', 'wizmatch.ts'), 'utf8'));
const sourcing = strip(readFileSync(join(__dirname, '..', 'services', 'wizmatchSourcing.ts'), 'utf8'));
const workbench = strip(readFileSync(join(__dirname, '..', 'modules', 'outreach', 'decisionWorkbench.ts'), 'utf8'));

/** Body of a named function, up to the next top-level declaration. */
function bodyOf(src: string, decl: string): string {
  const start = src.indexOf(decl);
  expect(start, `not found: ${decl}`).toBeGreaterThan(-1);
  const ends = [src.indexOf('\nasync function ', start + decl.length), src.indexOf('\nexport async function ', start + decl.length), src.indexOf('\nrouter.', start + decl.length)]
    .filter((n) => n > -1);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe('contact review cannot silently overwrite a prior decision', () => {
  const body = bodyOf(routes, 'async function applyContactCandidateReview(');

  it('the UPDATE constrains the current status, not just tenant + id', () => {
    const update = body.slice(body.indexOf('UPDATE wizmatch_contact_candidates'));
    expect(update).toMatch(/WHERE tenant_id = \$4 AND id = \$5\s*\n?\s*AND status = ANY\(\$6::text\[\]\)/);
  });

  it('the reviewable set is a named constant, not an inline literal', () => {
    // Inline literals here and in the queue's selection would drift apart
    // silently, and the failure mode is a row Today offers but the write
    // path then refuses.
    expect(routes).toMatch(/const CONTACT_REVIEWABLE_STATUSES = \['new', 'needs_review'\]/);
    expect(body).toContain('CONTACT_REVIEWABLE_STATUSES');
  });

  it('an already-reviewed candidate reports 409, not a misleading 404', () => {
    // The SELECT earlier in the function already proved existence and tenancy,
    // so zero updated rows can only mean "already decided".
    expect(body).toMatch(/already_reviewed/);
    expect(body).toMatch(/ContactCandidateReviewError\(\s*409/);
  });

  it("the write path's reviewable set matches what Today's queue offers", () => {
    // If the queue selected a status the write path rejects, every row it
    // surfaced would fail on click.
    const queueStates = workbench.match(/const CONTACT_AWAITING_REVIEW_STATES = \[([^\]]+)\]/);
    expect(queueStates, 'CONTACT_AWAITING_REVIEW_STATES not found').toBeTruthy();
    const queueSet = (queueStates![1].match(/'([a-z_]+)'/g) ?? []).map((s) => s.replace(/'/g, '')).sort();
    const writeStates = routes.match(/const CONTACT_REVIEWABLE_STATUSES = \[([^\]]+)\]/);
    const writeSet = (writeStates![1].match(/'([a-z_]+)'/g) ?? []).map((s) => s.replace(/'/g, '')).sort();
    expect(writeSet).toEqual(queueSet);
  });
});

describe('signal rejection cannot overwrite a terminal outcome', () => {
  const body = bodyOf(sourcing, 'export async function rejectSignal(');

  it('the UPDATE excludes terminal statuses', () => {
    expect(body).toMatch(/WHERE id=\$1 AND tenant_id=\$2 AND status <> ALL\(\$4::text\[\]\)/);
  });

  it("'placed' is in the excluded set — this is the one that loses real work", () => {
    expect(sourcing).toMatch(/const SIGNAL_TERMINAL_STATUSES = \['dead', 'placed'\]/);
    expect(body).toContain('SIGNAL_TERMINAL_STATUSES');
  });

  it('distinguishes "already terminal" from "not found" for per-item bulk reporting', () => {
    // A bulk run reporting a blanket "Signal not found" for rows that plainly
    // exist is worse than no message.
    expect(body).toMatch(/is already \$\{existing\.rows\[0\]\.status\}/);
    expect(body).toMatch(/Signal not found/);
  });

  it('the extra read happens only on the zero-row path', () => {
    // It exists to explain a failure, not to gate the write — a read-then-write
    // gate would reintroduce the race the compare-and-set removes.
    const updateAt = body.indexOf('UPDATE wizmatch_job_signals');
    const selectAt = body.indexOf('SELECT status FROM wizmatch_job_signals');
    expect(updateAt).toBeGreaterThan(-1);
    expect(selectAt).toBeGreaterThan(updateAt);
  });
});
