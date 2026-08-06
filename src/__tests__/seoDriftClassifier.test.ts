// The classifier behind the product's differentiator.
//
// The distinction it exists to draw is "this page changed" (a hash answers
// that) versus "this page changed and nobody on our side asked for it" — the
// second needs the change log as an input, and is the thing an agency will
// actually pay for.
//
// Two failure directions, deliberately not treated as equally bad:
//   - calling OUR change an unexpected edit burns the agency's trust in the
//     alert, and an alert nobody trusts is worse than no alert at all;
//   - calling a CLIENT edit ours is bounded — it can only happen inside the
//     attribution window on a page we also touched, and the next sweep with no
//     matching publish catches it.
import { describe, expect, it } from 'vitest';

import { EMPTY_SEO_ELEMENTS, type SeoElements } from '../modules/site/liveSnapshot';
import {
  DRIFT_ATTRIBUTION_WINDOW_MS,
  classifySeoDrift,
  shouldAlertOnDrift,
  type ClassifySeoDriftInput,
} from '../services/seoDriftClassifier';

const NOW = new Date('2026-08-05T12:00:00Z');

function elements(overrides: Partial<SeoElements> = {}): SeoElements {
  return {
    ...EMPTY_SEO_ELEMENTS,
    metaTitle: 'Pricing | Example',
    metaDescription: 'Our plans.',
    canonicalUrl: 'https://example.com/pricing',
    robots: 'index, follow',
    h1: 'Our pricing',
    h1Count: 1,
    jsonLdTypes: ['Product'],
    wordCount: 400,
    internalLinkCount: 12,
    externalLinkCount: 3,
    ...overrides,
  };
}

function input(overrides: Partial<ClassifySeoDriftInput> = {}): ClassifySeoDriftInput {
  return {
    previous: elements(),
    previousHttpStatus: 200,
    current: elements(),
    currentHttpStatus: 200,
    matchedChange: null,
    now: NOW,
    ...overrides,
  };
}

describe('no drift', () => {
  it('returns null when nothing changed', () => {
    expect(classifySeoDrift(input())).toBeNull();
  });

  it('returns null on a first sighting — a baseline is not drift', () => {
    expect(classifySeoDrift(input({ previous: null, previousHttpStatus: null }))).toBeNull();
  });
});

describe('unexpected_edit — the sellable one', () => {
  it('flags a title change with no approved change behind it', () => {
    const result = classifySeoDrift(
      input({ current: elements({ metaTitle: 'Cheap Deals!!! | Example' }) }),
    );
    expect(result?.kind).toBe('unexpected_edit');
    expect(result?.severity).toBe('warning');
    expect(result?.changedFields).toContain('metaTitle');
    expect(shouldAlertOnDrift(result!)).toBe(true);
  });

  it('flags an edit whose matching change published too long ago to be responsible', () => {
    const result = classifySeoDrift(
      input({
        current: elements({ h1: 'Something else' }),
        matchedChange: {
          changeId: 'change-1',
          publishedAt: new Date(NOW.getTime() - DRIFT_ATTRIBUTION_WINDOW_MS - 60_000),
        },
      }),
    );
    expect(result?.kind).toBe('unexpected_edit');
    expect(result?.matchedChangeId).toBeNull();
  });

  it('does not attribute an edit to a change that publishes in the future', () => {
    // A clock-skew guard. A future-dated publish must not silently absorb an
    // edit that predates it.
    const result = classifySeoDrift(
      input({
        current: elements({ h1: 'Something else' }),
        matchedChange: { changeId: 'change-1', publishedAt: new Date(NOW.getTime() + 60_000) },
      }),
    );
    expect(result?.kind).toBe('unexpected_edit');
  });
});

describe('verified_live', () => {
  it('attributes an edit to a change published within the window', () => {
    const result = classifySeoDrift(
      input({
        current: elements({ metaTitle: 'Plans & Pricing | Example' }),
        matchedChange: { changeId: 'change-7', publishedAt: new Date(NOW.getTime() - 60 * 60 * 1000) },
      }),
    );
    expect(result?.kind).toBe('verified_live');
    expect(result?.severity).toBe('info');
    expect(result?.matchedChangeId).toBe('change-7');
    // Confirming our own work is not an interruption.
    expect(shouldAlertOnDrift(result!)).toBe(false);
  });

  it('accepts a change published exactly at the window boundary', () => {
    const result = classifySeoDrift(
      input({
        current: elements({ metaTitle: 'x' }),
        matchedChange: {
          changeId: 'change-7',
          publishedAt: new Date(NOW.getTime() - DRIFT_ATTRIBUTION_WINDOW_MS),
        },
      }),
    );
    expect(result?.kind).toBe('verified_live');
  });
});

describe('page_gone', () => {
  it.each([404, 410])('flags a %s as critical', (status) => {
    const result = classifySeoDrift(input({ currentHttpStatus: status }));
    expect(result?.kind).toBe('page_gone');
    expect(result?.severity).toBe('critical');
    expect(shouldAlertOnDrift(result!)).toBe(true);
  });

  it('reports a page that is gone on its FIRST sighting, with no previous snapshot', () => {
    // Unlike every other kind, this one is meaningful without a baseline.
    const result = classifySeoDrift(
      input({ previous: null, previousHttpStatus: null, currentHttpStatus: 404 }),
    );
    expect(result?.kind).toBe('page_gone');
  });

  it('does NOT re-report a page that was already gone last sweep', () => {
    // A permanently-404 URL alerting daily forever is how a Slack channel gets
    // muted, which costs every other alert in it.
    expect(classifySeoDrift(input({ previousHttpStatus: 404, currentHttpStatus: 404 }))).toBeNull();
    expect(classifySeoDrift(input({ previousHttpStatus: 410, currentHttpStatus: 404 }))).toBeNull();
  });
});

describe('severity ordering', () => {
  it('reports a noindex over a simultaneous title edit', () => {
    // A page that went noindex AND had its title changed is a noindex problem.
    // Reporting the title edit would bury the thing that actually costs money.
    const result = classifySeoDrift(
      input({ current: elements({ robots: 'noindex, follow', metaTitle: 'Also changed' }) }),
    );
    expect(result?.kind).toBe('noindex_added');
    expect(result?.severity).toBe('critical');
  });

  it('reports noindex even when one of our own changes could explain the edit', () => {
    // "We probably did it" is not a good enough reason to stay quiet about a
    // page dropping out of the index.
    const result = classifySeoDrift(
      input({
        current: elements({ robots: 'noindex' }),
        matchedChange: { changeId: 'change-9', publishedAt: new Date(NOW.getTime() - 60_000) },
      }),
    );
    expect(result?.kind).toBe('noindex_added');
  });

  it('does not fire noindex when the page was already noindex', () => {
    const result = classifySeoDrift(
      input({
        previous: elements({ robots: 'noindex' }),
        current: elements({ robots: 'noindex', metaTitle: 'changed' }),
      }),
    );
    expect(result?.kind).toBe('unexpected_edit');
  });

  it('flags a canonical change as a warning', () => {
    const result = classifySeoDrift(
      input({ current: elements({ canonicalUrl: 'https://example.com/other' }) }),
    );
    expect(result?.kind).toBe('canonical_changed');
    expect(result?.severity).toBe('warning');
  });

  it('flags removed structured data and names what was lost', () => {
    const result = classifySeoDrift(
      input({
        previous: elements({ jsonLdTypes: ['Product', 'FAQPage'] }),
        current: elements({ jsonLdTypes: ['Product'] }),
      }),
    );
    expect(result?.kind).toBe('structured_data_removed');
    expect(result?.summary).toContain('FAQPage');
  });

  it('does not flag structured data that was ADDED', () => {
    const result = classifySeoDrift(
      input({
        previous: elements({ jsonLdTypes: ['Product'] }),
        current: elements({ jsonLdTypes: ['Product', 'FAQPage'] }),
      }),
    );
    expect(result?.kind).not.toBe('structured_data_removed');
  });
});

describe('alerting', () => {
  it('interrupts a human only for critical drift or an unexpected edit', () => {
    const gone = classifySeoDrift(input({ currentHttpStatus: 404 }))!;
    const unexpected = classifySeoDrift(input({ current: elements({ h1: 'x' }) }))!;
    const ours = classifySeoDrift(
      input({
        current: elements({ h1: 'x' }),
        matchedChange: { changeId: 'c', publishedAt: new Date(NOW.getTime() - 1000) },
      }),
    )!;
    const canonical = classifySeoDrift(input({ current: elements({ canonicalUrl: 'https://x.invalid/' }) }))!;

    expect(shouldAlertOnDrift(gone)).toBe(true);
    expect(shouldAlertOnDrift(unexpected)).toBe(true);
    expect(shouldAlertOnDrift(ours)).toBe(false);
    // A canonical change is worth a dashboard row, not a notification.
    expect(shouldAlertOnDrift(canonical)).toBe(false);
  });

  it('never puts page content in a summary', () => {
    // Summaries reach Slack. Field names and ids are fine; a client's copy is
    // not ours to broadcast into a chat channel.
    const result = classifySeoDrift(
      input({ current: elements({ metaTitle: 'CONFIDENTIAL client copy here' }) }),
    );
    expect(result?.summary).not.toContain('CONFIDENTIAL client copy here');
  });
});
