import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  normaliseHeader,
  normaliseEmail,
  isValidIcpSegment,
  isValidStatus,
  mapHeaderIndices,
  validateEmailAddress,
  ICP_SEGMENTS,
  STATUSES,
} from '../routes/outbound';

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------
describe('parseCsv', () => {
  it('parses a simple header + 1 row', () => {
    const rows = parseCsv('a,b,c\n1,2,3\n');
    expect(rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('handles CRLF line endings', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('handles missing trailing newline', () => {
    const rows = parseCsv('a,b\n1,2');
    expect(rows).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('preserves commas inside quoted fields', () => {
    const rows = parseCsv('a,b\n"x, y",z\n');
    expect(rows).toEqual([['a', 'b'], ['x, y', 'z']]);
  });

  it('unescapes doubled quotes inside quoted fields', () => {
    const rows = parseCsv('a\n"she said ""hi"""\n');
    expect(rows).toEqual([['a'], ['she said "hi"']]);
  });

  it('preserves embedded newlines in quoted fields', () => {
    const rows = parseCsv('a,b\n"line1\nline2",x\n');
    expect(rows).toEqual([['a', 'b'], ['line1\nline2', 'x']]);
  });

  it('drops fully-blank rows (incl. lone newlines)', () => {
    const rows = parseCsv('a,b\n1,2\n\n3,4\n');
    expect(rows).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normaliseHeader — defends against CSVs with funky casing/spaces/punctuation
// ---------------------------------------------------------------------------
describe('normaliseHeader', () => {
  it.each([
    ['First Name', 'first_name'],
    ['  EMAIL  ', 'email'],
    ['LinkedIn URL', 'linkedin_url'],
    ['Company-Size', 'companysize'], // hyphen stripped, not converted to underscore
    ['ICP Segment!', 'icp_segment'],
  ])('"%s" → "%s"', (input, expected) => {
    expect(normaliseHeader(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// normaliseEmail — must lowercase + trim (contact dedup invariant)
// ---------------------------------------------------------------------------
describe('normaliseEmail', () => {
  it('lowercases and trims', () => {
    expect(normaliseEmail('  Jatin@X.COM  ')).toBe('jatin@x.com');
  });

  it('returns null for whitespace-only input', () => {
    expect(normaliseEmail('   ')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(normaliseEmail(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normaliseEmail('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Enum guards — keep in sync with CHECK constraints in migration 0017
// ---------------------------------------------------------------------------
describe('isValidIcpSegment', () => {
  it.each(ICP_SEGMENTS)('accepts canonical "%s"', (seg) => {
    expect(isValidIcpSegment(seg)).toBe(true);
  });

  it('rejects unknown segment', () => {
    expect(isValidIcpSegment('not_a_segment')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidIcpSegment(null)).toBe(false);
  });

  it('locks in the canonical list (4 entries)', () => {
    expect(ICP_SEGMENTS).toEqual(['dev_saas', 'dev_agency', 'marketing_d2c', 'marketing_agency']);
  });
});

describe('isValidStatus', () => {
  it.each(STATUSES)('accepts canonical "%s"', (st) => {
    expect(isValidStatus(st)).toBe(true);
  });

  it('rejects unknown status', () => {
    expect(isValidStatus('archived')).toBe(false);
  });

  it('locks in the canonical lifecycle (9 entries)', () => {
    // Order matters for migration CHECK alignment; freeze it here.
    expect(STATUSES).toEqual([
      'new', 'contacted', 'accepted', 'replied', 'meeting',
      'pilot', 'client', 'recycled', 'suppressed',
    ]);
  });
});

// ---------------------------------------------------------------------------
// mapHeaderIndices — forgiving CSV column resolution
// ---------------------------------------------------------------------------
describe('mapHeaderIndices', () => {
  it('maps canonical headers in their natural order', () => {
    const idx = mapHeaderIndices([
      'first_name', 'last_name', 'email', 'linkedin_url', 'icp_segment',
    ]);
    expect(idx).toEqual({
      first_name: 0, last_name: 1, email: 2, linkedin_url: 3, icp_segment: 4,
    });
  });

  it('accepts alias headers (firstname, linkedin, segment, …)', () => {
    const idx = mapHeaderIndices([
      'FirstName', 'Last Name', 'Email Address', 'LinkedIn', 'segment',
    ]);
    expect(idx).toEqual({
      first_name: 0, last_name: 1, email: 2, linkedin_url: 3, icp_segment: 4,
    });
  });

  it('omits unmapped columns silently', () => {
    const idx = mapHeaderIndices(['email', 'phone', 'birthday']);
    expect(idx).toEqual({ email: 0 });
  });

  it('returns {} when no header is recognised', () => {
    expect(mapHeaderIndices(['foo', 'bar', 'baz'])).toEqual({});
  });

  it('survives Sales Navigator-style noisy headers', () => {
    const idx = mapHeaderIndices([
      'Given Name', 'Surname', 'Job Title', 'Company Name', 'Profile URL', 'Work Email',
    ]);
    expect(idx).toEqual({
      first_name: 0, last_name: 1, title: 2, company: 3, linkedin_url: 4, email: 5,
    });
  });
});

// ---------------------------------------------------------------------------
// validateEmailAddress — verdicts that don't require DNS lookup.
// MX-lookup cases would hit the live resolver; we skip those in unit tests
// and rely on the live smoke-test instead.
// ---------------------------------------------------------------------------
describe('validateEmailAddress', () => {
  it('returns unverified for null', async () => {
    expect(await validateEmailAddress(null)).toBe('unverified');
  });

  it('returns invalid for empty-shape strings', async () => {
    expect(await validateEmailAddress('not-an-email')).toBe('invalid');
    expect(await validateEmailAddress('@nodomain')).toBe('invalid');
    expect(await validateEmailAddress('nolocal@.com')).toBe('invalid');
  });

  it('flags disposable provider domains', async () => {
    expect(await validateEmailAddress('foo@mailinator.com')).toBe('disposable');
    expect(await validateEmailAddress('foo@yopmail.com')).toBe('disposable');
    // Case-insensitive on the domain
    expect(await validateEmailAddress('foo@MAILINATOR.COM')).toBe('disposable');
  });

  it(
    'returns valid for a real domain with MX records',
    async () => {
      // google.com is one of the most stable MX records on the internet —
      // safe to lean on for a CI smoke. If this ever flakes, swap for a
      // mock-only test.
      const verdict = await validateEmailAddress('hello@google.com', { mxTimeoutMs: 4000 });
      expect(['valid', 'risky']).toContain(verdict);
    },
    10_000,
  );

  it(
    'downgrades role addresses to risky even on a valid domain',
    async () => {
      const verdict = await validateEmailAddress('info@google.com', { mxTimeoutMs: 4000 });
      expect(verdict).toBe('risky');
    },
    10_000,
  );

  it(
    'returns invalid for a domain with no MX record',
    async () => {
      // A reserved TLD that won't resolve to MX. RFC 2606 reserves .invalid.
      const verdict = await validateEmailAddress('foo@example.invalid', { mxTimeoutMs: 4000 });
      expect(['invalid', 'unknown']).toContain(verdict);
    },
    10_000,
  );
});
