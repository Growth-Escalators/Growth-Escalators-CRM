// Tests for the shared live-page reader every SiteProvider delegates to.
//
// Two things carry real risk here and get most of the coverage:
//   - the SSRF guard on EVERY redirect hop, not just the first URL (a public
//     host that 302s to 169.254.169.254 is the actual attack, and checking
//     only the initial URL buys nothing);
//   - extraction stability, because the drift sweep compares these values
//     across days and platforms — an extractor that returns `null` where it
//     used to return a string reads as "the client edited the page".
import { describe, expect, it, vi } from 'vitest';

import {
  MAX_SNAPSHOT_BYTES,
  diffSeoElements,
  extractSeoElements,
  fetchLivePageSnapshot,
  hashSeoElements,
} from '../modules/site/liveSnapshot';
import { SiteProviderError } from '../modules/site/providers/site-provider.interface';

const PAGE = `<!doctype html>
<html>
<head>
  <title>Pricing &amp; Plans | Example</title>
  <meta name="description" content="Compare our plans.">
  <meta name="robots" content="INDEX, FOLLOW">
  <meta name="googlebot" content="noindex">
  <link rel="stylesheet" href="/a.css">
  <link rel="canonical" href="https://example.com/pricing">
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Product","name":"Plan"}
  </script>
  <script type="application/ld+json">
    {"@graph":[{"@type":"Organization"},{"@type":["BreadcrumbList","ItemList"]}]}
  </script>
  <style>body { color: red; }</style>
</head>
<body>
  <h1>Our pricing</h1>
  <p>Three plans for teams of every size.</p>
  <a href="/contact">Contact</a>
  <a href="https://example.com/about">About</a>
  <a href="https://www.example.com/blog">Blog</a>
  <a href="https://partner.invalid/x">Partner</a>
  <a href="#top">Top</a>
  <a href="mailto:hi@example.com">Mail</a>
  <script>var noise = "this text must not be counted";</script>
  <h1>Second heading</h1>
</body>
</html>`;

function fakeResponse(init: {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}): Response {
  const { status = 200, headers = { 'content-type': 'text/html' }, body = '' } = init;
  return new Response(body, { status, headers });
}

describe('extractSeoElements', () => {
  const el = extractSeoElements(PAGE, 'https://example.com/pricing');

  it('reads the title, decoding entities', () => {
    expect(el.metaTitle).toBe('Pricing & Plans | Example');
  });

  it('reads the meta description and canonical', () => {
    expect(el.metaDescription).toBe('Compare our plans.');
    expect(el.canonicalUrl).toBe('https://example.com/pricing');
  });

  it('prefers the generic robots directive over a bot-specific one', () => {
    // A page with both must not be reported as noindex — that would fire the
    // highest-severity drift alert on a page that is indexed perfectly well.
    expect(el.robots).toBe('index, follow');
  });

  it('falls back to googlebot when no generic robots tag is present', () => {
    const only = extractSeoElements('<meta name="googlebot" content="noindex">');
    expect(only.robots).toBe('noindex');
  });

  it('reads the first h1 and counts them all', () => {
    expect(el.h1).toBe('Our pricing');
    expect(el.h1Count).toBe(2);
  });

  it('collects JSON-LD types including nested @graph entries and array types', () => {
    expect(el.jsonLdTypes).toEqual(['BreadcrumbList', 'ItemList', 'Organization', 'Product']);
  });

  it('excludes script and style content from the word count', () => {
    expect(el.wordCount).toBeGreaterThan(0);
    const text = 'this text must not be counted';
    expect(extractSeoElements(`<body><script>${text}</script></body>`).wordCount).toBe(0);
  });

  it('classifies links as internal or external, ignoring anchors and mailto', () => {
    // /contact, https://example.com/about, https://www.example.com/blog
    expect(el.internalLinkCount).toBe(3);
    // partner.invalid only — #top and mailto: are skipped entirely.
    expect(el.externalLinkCount).toBe(1);
  });

  it('degrades to "everything external" rather than throwing on a bad pageUrl', () => {
    const noHost = extractSeoElements('<a href="https://example.com/x">x</a>', 'not a url');
    expect(noHost.externalLinkCount).toBe(1);
    expect(noHost.internalLinkCount).toBe(0);
  });

  it('returns the empty shape for empty input', () => {
    const empty = extractSeoElements('');
    expect(empty.metaTitle).toBeNull();
    expect(empty.jsonLdTypes).toEqual([]);
  });

  it('survives invalid JSON-LD without losing the rest of the page', () => {
    const broken = extractSeoElements(
      '<title>T</title><script type="application/ld+json">{not json}</script>',
    );
    expect(broken.metaTitle).toBe('T');
    expect(broken.jsonLdTypes).toEqual([]);
  });
});

describe('hashSeoElements / diffSeoElements', () => {
  it('is stable for identical input and changes when a field changes', () => {
    const a = extractSeoElements(PAGE, 'https://example.com/pricing');
    const b = extractSeoElements(PAGE, 'https://example.com/pricing');
    expect(hashSeoElements(a)).toBe(hashSeoElements(b));

    const changed = extractSeoElements(PAGE.replace('Our pricing', 'Our prices'), 'https://example.com/pricing');
    expect(hashSeoElements(changed)).not.toBe(hashSeoElements(a));
  });

  it('reports only the fields that actually differ', () => {
    const before = extractSeoElements(PAGE, 'https://example.com/pricing');
    const after = extractSeoElements(
      PAGE.replace('content="INDEX, FOLLOW"', 'content="noindex"'),
      'https://example.com/pricing',
    );
    const diff = diffSeoElements(before, after);
    expect(diff.map((d) => d.field)).toEqual(['robots']);
    expect(diff[0]).toMatchObject({ before: 'index, follow', after: 'noindex' });
  });

  it('treats an absent field as a real value, not a skip', () => {
    const before = extractSeoElements('<title>T</title><link rel="canonical" href="https://example.com/">');
    const after = extractSeoElements('<title>T</title>');
    const diff = diffSeoElements(before, after);
    expect(diff.map((d) => d.field)).toEqual(['canonicalUrl']);
    expect(diff[0].after).toBe('');
  });
});

describe('fetchLivePageSnapshot', () => {
  it('refuses an SSRF-unsafe URL before making any request', async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchLivePageSnapshot('http://169.254.169.254/latest/meta-data/', {
        providerName: 'git',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a redirect that points at an internal address', async () => {
    // The whole reason redirect:'manual' is used. A public first hop that
    // bounces to link-local must die at the hop, not be followed.
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ status: 302, headers: { location: 'http://169.254.169.254/' } }),
    );
    await expect(
      fetchLivePageSnapshot('https://example.com/', {
        providerName: 'wordpress',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('follows a safe redirect and records the final url', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url) === 'https://example.com/old') {
        return fakeResponse({ status: 301, headers: { location: '/new' } });
      }
      return fakeResponse({ body: '<title>New</title>' });
    });
    const snap = await fetchLivePageSnapshot('https://example.com/old', {
      providerName: 'shopify',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(snap.finalUrl).toBe('https://example.com/new');
    expect(snap.metaTitle).toBe('New');
  });

  it('gives up rather than looping forever on a redirect chain', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ status: 302, headers: { location: 'https://example.com/loop' } }),
    );
    await expect(
      fetchLivePageSnapshot('https://example.com/loop', {
        providerName: 'git',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
  });

  it('returns a 404 instead of throwing — page_gone is a real reading', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({ status: 404, body: '<title>Not found</title>' }));
    const snap = await fetchLivePageSnapshot('https://example.com/gone', {
      providerName: 'git',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(snap.httpStatus).toBe(404);
    expect(snap.contentHash).toBeTruthy();
  });

  it('wraps a transport failure as provider_unavailable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const error = await fetchLivePageSnapshot('https://example.com/', {
      providerName: 'git',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SiteProviderError);
    expect((error as SiteProviderError).code).toBe('provider_unavailable');
  });

  it('skips extraction for a non-HTML response', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ headers: { 'content-type': 'application/pdf' }, body: '%PDF-1.4' }),
    );
    const snap = await fetchLivePageSnapshot('https://example.com/file.pdf', {
      providerName: 'git',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(snap.metaTitle).toBeUndefined();
    expect(snap.httpStatus).toBe(200);
  });

  it('caps how much of a hostile body it will read', async () => {
    const huge = `<title>Big</title>${'x'.repeat(MAX_SNAPSHOT_BYTES + 50_000)}`;
    const fetchImpl = vi.fn(async () => fakeResponse({ body: huge }));
    const snap = await fetchLivePageSnapshot('https://example.com/big', {
      providerName: 'git',
      keepBodyHtml: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(snap.bodyHtml!.length).toBeLessThanOrEqual(MAX_SNAPSHOT_BYTES);
    expect(snap.metaTitle).toBe('Big');
  });

  it('does not retain the body unless asked', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({ body: '<title>T</title>' }));
    const snap = await fetchLivePageSnapshot('https://example.com/', {
      providerName: 'git',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(snap.bodyHtml).toBeUndefined();
  });
});
