import { describe, expect, it } from 'vitest';
import { normalizeDomain } from '../services/wizmatchContactIntelligenceRepo';

describe('wizmatch seed-company helpers', () => {
  describe('normalizeDomain', () => {
    it('returns null for empty or falsy input', () => {
      expect(normalizeDomain(null)).toBeNull();
      expect(normalizeDomain(undefined)).toBeNull();
      expect(normalizeDomain('')).toBeNull();
      expect(normalizeDomain('   ')).toBeNull();
    });

    it('strips protocol and www prefix', () => {
      expect(normalizeDomain('https://www.acme.com')).toBe('acme.com');
      expect(normalizeDomain('http://acme.com')).toBe('acme.com');
      expect(normalizeDomain('HTTPS://ACME.COM')).toBe('acme.com');
    });

    it('drops path, query, and fragment', () => {
      expect(normalizeDomain('https://acme.com/about?ref=x')).toBe('acme.com');
      expect(normalizeDomain('acme.com/careers#roles')).toBe('acme.com');
      expect(normalizeDomain('https://acme.com?foo=bar')).toBe('acme.com');
    });

    it('lowercases the resulting host', () => {
      expect(normalizeDomain('Acme.Com')).toBe('acme.com');
      expect(normalizeDomain('SUB.EXAMPLE.CO.IN')).toBe('sub.example.co.in');
    });

    it('keeps a bare domain as-is (minus normalisation)', () => {
      expect(normalizeDomain('acme.com')).toBe('acme.com');
      expect(normalizeDomain('sub.example.co.in')).toBe('sub.example.co.in');
    });
  });
});
