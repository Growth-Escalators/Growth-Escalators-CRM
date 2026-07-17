import { describe, it, expect } from 'vitest';
import { extractErrorCount } from '../services/cronErrorExtraction';

describe('extractErrorCount (M12 — cron partial-failure detection)', () => {
  it('returns 0 for undefined/void results', () => {
    expect(extractErrorCount(undefined)).toBe(0);
  });

  it('returns 0 for null', () => {
    expect(extractErrorCount(null)).toBe(0);
  });

  it('returns 0 for non-object primitives', () => {
    expect(extractErrorCount('ok')).toBe(0);
    expect(extractErrorCount(42)).toBe(0);
  });

  it('returns 0 for an object with no errors field', () => {
    expect(extractErrorCount({ sent: 12 })).toBe(0);
  });

  it('counts the length of an errors array', () => {
    expect(extractErrorCount({ errors: ['a', 'b', 'c'] })).toBe(3);
  });

  it('treats an empty errors array as 0', () => {
    expect(extractErrorCount({ errors: [] })).toBe(0);
  });

  it('passes through a numeric errors count', () => {
    expect(extractErrorCount({ errors: 7 })).toBe(7);
  });

  it('treats NaN/Infinity numeric errors as 0 (not finite)', () => {
    expect(extractErrorCount({ errors: NaN })).toBe(0);
    expect(extractErrorCount({ errors: Infinity })).toBe(0);
  });

  it('ignores an errors field of an unrecognized shape', () => {
    expect(extractErrorCount({ errors: { count: 3 } })).toBe(0);
    expect(extractErrorCount({ errors: 'oops' })).toBe(0);
  });
});
