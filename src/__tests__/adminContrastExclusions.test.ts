// 2026-08-01 — `text-neutral-400` is 2.56:1 on white and fails WCAG AA for text,
// so it was swept to `text-neutral-500` (4.76:1) across the admin SPA.
//
// The sweep is NOT total, and the leftovers are deliberate. This test pins the
// exclusions, because the obvious "finish the job" follow-up — a blanket
// find-and-replace — makes exactly one of them WORSE and silently undoes two
// intentional affordances.
//
// A future contributor seeing ~40 remaining occurrences will reasonably assume
// the sweep was abandoned halfway. It wasn't. Each category below is a decision.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ADMIN = join(__dirname, '..', '..', 'admin', 'src');
const read = (...p: string[]) => readFileSync(join(ADMIN, ...p), 'utf8');

describe('the one dark-background site must KEEP text-neutral-400', () => {
  // ContactsPage's bulk-action bar is `bg-neutral-900 text-white`. On that
  // surface neutral-400 is the LIGHT end — moving it to 500 pushes it toward the
  // background and REDUCES contrast. This is the single occurrence in the whole
  // SPA where the sweep would be actively harmful.
  const src = read('pages', 'ContactsPage.jsx');

  it('the Clear-selection button on the dark bulk bar is still neutral-400', () => {
    expect(src).toMatch(/text-sm text-neutral-400 hover:text-white/);
  });

  it('and the bar it sits on is still dark (if this changes, revisit the button)', () => {
    expect(src).toMatch(/bg-neutral-900 text-white/);
  });
});

describe('placeholder and disabled text stay muted on purpose', () => {
  it('.input keeps a neutral-400 placeholder', () => {
    // Placeholder text is an affordance, not content: it must read as "not filled
    // in". WCAG does not require placeholders to meet body-text contrast, and
    // darkening them makes an empty field look populated.
    expect(read('index.css')).toMatch(/placeholder:text-neutral-400/);
  });

  it('.input-help was NOT excluded — it is body-sized helper text and was fixed', () => {
    // The counterexample: helper text under a field IS content, is read, and
    // therefore does need 4.5:1. One shared class, so one edit covered every
    // consumer.
    const css = read('index.css');
    expect(css).toMatch(/\.input-help\s+\{ @apply text-xs text-neutral-500/);
    expect(css).not.toMatch(/\.input-help\s+\{ @apply text-xs text-neutral-400/);
  });
});

describe('the swept surfaces stay swept', () => {
  // Spot-checks on the files that had the most occurrences, so a regression that
  // reintroduces neutral-400 body text is caught rather than accumulating.
  it.each([
    ['components/ContactSlideIn.jsx'],
    ['components/DealDrawer.jsx'],
    ['pages/BillingPage.jsx'],
    ['pages/InboxPage.jsx'],
  ])('%s has no non-icon neutral-400 text left', (rel) => {
    const offenders = read(...rel.split('/'))
      .split('\n')
      .filter((l) => l.includes('text-neutral-400'))
      // Icons are exempt: they fall under the 3:1 non-text rule, and darkening
      // every icon in the app is a visual-weight decision, not an a11y fix.
      .filter((l) => !/\bw-\d|\bh-\d/.test(l))
      .filter((l) => !l.includes('placeholder:') && !l.includes('disabled:'));
    expect(offenders, `non-icon neutral-400 text in ${rel}:\n${offenders.join('\n')}`).toHaveLength(0);
  });
});
