import { describe, expect, it } from 'vitest';
import { isSafeFetchHost, isSafeFetchUrl } from '../utils/ssrfGuard';

describe('ssrfGuard', () => {
  describe('isSafeFetchHost', () => {
    it('allows normal public DNS hostnames', () => {
      expect(isSafeFetchHost('acme.com')).toBe(true);
      expect(isSafeFetchHost('sub.example.co.in')).toBe(true);
      expect(isSafeFetchHost('www.google.com')).toBe(true);
      expect(isSafeFetchHost('getwizmatch.com')).toBe(true);
      expect(isSafeFetchHost('ACME.COM')).toBe(true); // case-insensitive
      expect(isSafeFetchHost('acme.com.')).toBe(true); // trailing FQDN dot
    });

    it('allows public IP literals', () => {
      expect(isSafeFetchHost('8.8.8.8')).toBe(true);
      expect(isSafeFetchHost('1.1.1.1')).toBe(true);
    });

    it('blocks empty / falsy input', () => {
      expect(isSafeFetchHost(null)).toBe(false);
      expect(isSafeFetchHost(undefined)).toBe(false);
      expect(isSafeFetchHost('')).toBe(false);
      expect(isSafeFetchHost('   ')).toBe(false);
    });

    it('blocks localhost and single-label internal names', () => {
      expect(isSafeFetchHost('localhost')).toBe(false);
      expect(isSafeFetchHost('web')).toBe(false);
      expect(isSafeFetchHost('postgres')).toBe(false);
    });

    it('blocks internal service-discovery suffixes', () => {
      expect(isSafeFetchHost('internal-svc.railway.internal')).toBe(false);
      expect(isSafeFetchHost('foo.internal')).toBe(false);
      expect(isSafeFetchHost('printer.local')).toBe(false);
    });

    it('blocks loopback / private / link-local / CGNAT IPv4', () => {
      expect(isSafeFetchHost('127.0.0.1')).toBe(false);
      expect(isSafeFetchHost('10.0.0.5')).toBe(false);
      expect(isSafeFetchHost('172.16.0.1')).toBe(false);
      expect(isSafeFetchHost('172.31.255.255')).toBe(false);
      expect(isSafeFetchHost('192.168.1.1')).toBe(false);
      expect(isSafeFetchHost('169.254.169.254')).toBe(false); // cloud metadata
      expect(isSafeFetchHost('100.64.0.1')).toBe(false); // CGNAT
      expect(isSafeFetchHost('0.0.0.0')).toBe(false);
    });

    it('blocks private / loopback IPv6', () => {
      expect(isSafeFetchHost('::1')).toBe(false);
      expect(isSafeFetchHost('[::1]')).toBe(false);
      expect(isSafeFetchHost('fc00::1')).toBe(false);
      expect(isSafeFetchHost('fd12:3456::1')).toBe(false);
      expect(isSafeFetchHost('fe80::1')).toBe(false);
      expect(isSafeFetchHost('::ffff:127.0.0.1')).toBe(false); // IPv4-mapped loopback
    });

    it('blocks userinfo embedded in the host', () => {
      expect(isSafeFetchHost('foo@169.254.169.254')).toBe(false);
      expect(isSafeFetchHost('user@acme.com')).toBe(false);
    });

    it('blocks obfuscated IPv4 (decimal / hex) that resolves to a private address', () => {
      expect(isSafeFetchHost('2130706433')).toBe(false); // decimal 127.0.0.1
      expect(isSafeFetchHost('0x7f.0.0.1')).toBe(false); // hex 127.0.0.1
      expect(isSafeFetchHost('017700000001')).toBe(false); // octal 127.0.0.1
    });
  });

  describe('isSafeFetchUrl', () => {
    it('allows public http(s) URLs', () => {
      expect(isSafeFetchUrl('https://acme.com/contact')).toBe(true);
      expect(isSafeFetchUrl('http://acme.com')).toBe(true);
      expect(isSafeFetchUrl('https://www.google.com/search?q=x')).toBe(true);
    });

    it('blocks non-http(s) schemes', () => {
      expect(isSafeFetchUrl('file:///etc/passwd')).toBe(false);
      expect(isSafeFetchUrl('gopher://acme.com')).toBe(false);
      expect(isSafeFetchUrl('ftp://acme.com')).toBe(false);
    });

    it('blocks userinfo in the URL', () => {
      expect(isSafeFetchUrl('https://foo@169.254.169.254/')).toBe(false);
      expect(isSafeFetchUrl('https://user:pass@acme.com/')).toBe(false);
    });

    it('blocks internal / private hosts', () => {
      expect(isSafeFetchUrl('http://localhost:3000/')).toBe(false);
      expect(isSafeFetchUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
      expect(isSafeFetchUrl('http://internal-svc.railway.internal/')).toBe(false);
      expect(isSafeFetchUrl('http://[::1]/')).toBe(false);
    });

    it('blocks malformed input', () => {
      expect(isSafeFetchUrl('')).toBe(false);
      expect(isSafeFetchUrl('not a url')).toBe(false);
      expect(isSafeFetchUrl(null)).toBe(false);
    });
  });
});
