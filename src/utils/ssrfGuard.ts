/**
 * ssrfGuard.ts — reusable SSRF protection for user-supplied websites / domains.
 *
 * An authenticated user can point Wizmatch discovery/enrichment at an arbitrary
 * "company website". Those hosts are fetched server-side (careers/contact page
 * scrape, email enrichment), so without a guard a user could reach internal
 * infrastructure — cloud metadata (169.254.169.254), Railway private services
 * (*.railway.internal), loopback, or RFC-1918 ranges — a classic SSRF.
 *
 * This module blocks:
 *   - IP literals in private/loopback/link-local/CGNAT/reserved ranges
 *     (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 100.64/10, 0/8, 224/4, …;
 *      ::1, ::, fc00::/7, fe80::/10, IPv4-mapped)
 *   - `localhost`
 *   - `*.internal` / `*.railway.internal` / `*.local` (internal service discovery, mDNS)
 *   - userinfo (`user@host`) and non-http(s) schemes
 *   - single-label hosts (e.g. `web`, `postgres`) — those are internal names
 *   - obfuscated IPv4 (decimal `2130706433`, hex `0x7f.0.0.1`, octal) — canonicalised
 *     via the WHATWG URL parser (the same form `fetch`/undici resolves) before checking
 *
 * Only public, dotted DNS hostnames (and public IP literals) over http(s) pass.
 *
 * NOTE: DNS rebinding is a residual risk — a hostname that passes here can still
 * resolve to a private address at connection time. These checks close the direct
 * literal/private-host exposure (the real attack surface); a fully rebind-proof
 * fix requires pinning the resolved socket address, which undici does not expose.
 */
import { isIP } from 'net';

/** Suffixes that indicate an internal / non-public host. */
const BLOCKED_SUFFIXES = ['.internal', '.railway.internal', '.local', '.localhost'];

function isPrivateIPv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed → treat as unsafe
  }
  const [a, b, c] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved (incl. 255.255.255.255)
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  let h = ip.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h === '::1' || h === '::') return true; // loopback / unspecified
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(h)) return true; // fe80::/10 link-local
  const mapped = h.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/); // ::ffff:a.b.c.d (IPv4-mapped)
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/**
 * True when `host` is a public host safe to fetch server-side. Accepts a bare
 * hostname or IP literal (no scheme/path). Rejects everything listed in the
 * module doc. This is the core check; `isSafeFetchUrl` wraps it for full URLs.
 */
export function isSafeFetchHost(host: string | null | undefined): boolean {
  if (!host) return false;
  let h = String(host).trim().toLowerCase();
  if (!h) return false;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1); // unwrap IPv6 literal
  if (!h) return false;
  if (/[@\s/\\?#]/.test(h)) return false; // userinfo / path / whitespace must not be embedded
  if (h.endsWith('.')) h = h.slice(0, -1); // strip FQDN root dot
  if (!h) return false;

  // Resolve to the canonical hostname the URL parser (and undici at fetch time)
  // will actually use, so obfuscated IPv4 forms cannot bypass the range checks.
  let canonical = h;
  if (isIP(h) === 0) {
    try {
      canonical = new URL(`http://${h}`).hostname.toLowerCase();
    } catch {
      return false; // unparseable host → refuse
    }
    if (canonical.startsWith('[') && canonical.endsWith(']')) canonical = canonical.slice(1, -1);
  }

  const version = isIP(canonical);
  if (version === 4) return !isPrivateIPv4(canonical);
  if (version === 6) return !isPrivateIPv6(canonical);

  if (canonical === 'localhost') return false;
  if (BLOCKED_SUFFIXES.some((suffix) => canonical.endsWith(suffix))) return false;
  if (!canonical.includes('.')) return false; // single-label host = internal service name
  return true;
}

/**
 * True when `rawUrl` is safe to fetch: an http(s) URL, no userinfo, and a public
 * host per {@link isSafeFetchHost}. Use this immediately before any server-side
 * fetch of a user-influenced URL.
 */
export function isSafeFetchUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  let url: URL;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false; // userinfo (user@host) not allowed
  return isSafeFetchHost(url.hostname);
}
