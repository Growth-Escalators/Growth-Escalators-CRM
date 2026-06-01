import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  normaliseHeader,
  normaliseEmail,
  isValidIcpSegment,
  isValidStatus,
  mapHeaderIndices,
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
