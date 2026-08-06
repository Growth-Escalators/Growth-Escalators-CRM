// The backstop for third-party error text on its way into a log line.
//
// The first case below is not hypothetical: it is the exact string a
// siteChangesRoutes test uses to prove a provider error never reaches the HTTP
// response — and which the route was, until this module existed, writing into
// the log in full. A control that stops a token at the response boundary while
// the same token flows into retained logs is half a control.
import { describe, expect, it } from 'vitest';

import { redactSecrets, safeLogText } from '../utils/redactSecrets';

describe('redactSecrets', () => {
  it('scrubs the provider-error string that was reaching the logs verbatim', () => {
    // The EXACT fixture from siteChangesRoutes.test.ts — six characters.
    // The first version of this test used an 18-character token, which matched
    // the `Bearer|Basic|Token` rule's 8-character minimum and so passed while
    // the real six-character one still leaked into the log. Keep this string
    // byte-identical to the route fixture; a longer one re-hides the bug.
    const raw = 'connection refused to internal-host with token abc123';
    const out = redactSecrets(raw);
    expect(out).not.toContain('abc123');
    // The diagnostic shape survives — an operator can still see what failed.
    expect(out).toContain('connection refused');
    expect(out).toContain('internal-host');
  });

  it('leaves an ordinary word after a credential keyword alone', () => {
    // Over-redaction has a cost too: "token expired" scrubbed to
    // "token [redacted]" tells an operator nothing.
    expect(redactSecrets('token expired')).toBe('token expired');
    expect(redactSecrets('client_secret not set')).toBe('client_secret not set');
    expect(redactSecrets('auth failed for user')).toContain('failed');
  });

  it.each([
    ['password=hunter2secret', 'hunter2secret'],
    ['api_key: AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
    ['"access_token":"ya29.a0AfH6SMBx"', 'ya29.a0AfH6SMBx'],
    ['client_secret = abcdef123456', 'abcdef123456'],
  ])('scrubs assignment shape %s', (input, secret) => {
    expect(redactSecrets(input)).not.toContain(secret);
  });

  it('keeps the key name so the log still says WHAT was missing', () => {
    // "password=[redacted]" is diagnostic; "[redacted]" alone is not.
    expect(redactSecrets('password=hunter2secret')).toMatch(/password/i);
  });

  it.each([
    ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9', 'eyJhbGciOiJIUzI1NiJ9'],
    ['Authorization: Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpwYXNzd29yZA=='],
  ])('scrubs auth header %s', (input, secret) => {
    expect(redactSecrets(input)).not.toContain(secret);
  });

  it('scrubs a password embedded in a connection string but keeps the host', () => {
    const out = redactSecrets('failed to connect: postgresql://appuser:s3cr3tpw@db.internal:5432/crm');
    expect(out).not.toContain('s3cr3tpw');
    expect(out).toContain('db.internal');
    expect(out).toContain('appuser');
  });

  it.each([
    ['sk-abcdefghij1234567890', 'openai-style'],
    ['xoxb-123456789012-abcdefghijkl', 'slack bot token'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'github PAT'],
    ['github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz', 'fine-grained PAT'],
    ['GOCSPX-abcdefghijklmnop', 'google oauth client secret'],
    ['AIzaSyBu6ZkzPyXbYK1QKabcdefghijklmnop', 'google api key'],
  ])('scrubs the %s vendor prefix (%s)', (secret) => {
    expect(redactSecrets(`key is ${secret} ok`)).not.toContain(secret);
  });

  it('scrubs a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(redactSecrets(`token ${jwt}`)).not.toContain(jwt);
  });

  it('leaves ordinary diagnostic text alone', () => {
    const ordinary = 'ECONNREFUSED connecting to https://example.com/wp-json/wp/v2/pages (status 502)';
    expect(redactSecrets(ordinary)).toBe(ordinary);
  });

  it('never throws, whatever it is handed', () => {
    expect(redactSecrets(null)).toBe('');
    expect(redactSecrets(undefined)).toBe('');
    expect(() => redactSecrets({ toString() { throw new Error('boom'); } })).not.toThrow();
    // Failing closed: an input it cannot process must not pass through raw.
    expect(redactSecrets({ toString() { throw new Error('boom'); } })).toBe('[redacted]');
  });

  it('bounds how much it will scan, so an error path cannot become a CPU sink', () => {
    const huge = 'a'.repeat(50_000);
    const out = redactSecrets(huge);
    expect(out.length).toBeLessThan(5_000);
  });
});

describe('safeLogText', () => {
  it('collapses whitespace and caps length for a single log line', () => {
    const out = safeLogText(`line one\n\n   line   two ${'x'.repeat(2000)}`);
    expect(out).not.toContain('\n');
    expect(out.length).toBeLessThanOrEqual(500);
  });

  it('still redacts', () => {
    expect(safeLogText('token=abcdef1234567890')).not.toContain('abcdef1234567890');
  });
});
