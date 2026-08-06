/**
 * Scrubs credential-shaped substrings out of text that is about to be LOGGED.
 *
 * WHY THIS EXISTS. Several boundaries in this codebase catch a third-party
 * error and do the right thing with the response body — return a stable code,
 * never the vendor's text — and then log the vendor's text in full for
 * diagnostics. That is half a control. If the reason you refuse to put a
 * provider's message in an HTTP response is "a misbehaving adapter might have
 * embedded a token in it", then the log is precisely where that token lands,
 * and Railway retains logs and shows them to anyone with dashboard access.
 *
 * This module is the other half. It is NOT a substitute for providers not
 * embedding secrets in the first place (see the contract at the top of
 * site-provider.interface.ts) — it is the backstop for when one does.
 *
 * DELIBERATE LIMITS, so nobody mistakes this for a guarantee:
 *  - It is pattern-based. A secret that looks like ordinary prose survives it.
 *  - It errs toward over-redaction. Losing a diagnostic string is cheap;
 *    leaking a live credential into a retained log is not.
 *  - It does not decode. A base64'd or URL-encoded secret is not detected
 *    unless its encoded form matches one of the shapes below.
 *
 * Every pattern is anchored and length-bounded — this runs on an error path,
 * and a catastrophically backtracking regex on an error path is an outage.
 */

/** Replacement marker. Distinctive enough to grep for when auditing logs. */
const MARK = '[redacted]';

/** Longest input we will scan. An error message beyond this is truncated first — no legitimate diagnostic needs more. */
const MAX_SCAN_LENGTH = 4000;

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // `password=hunter2`, `api_key: abc`, `token" : "xyz"` — the assignment
  // shapes. Key name is kept (it is the useful part); the value goes.
  [
    /\b(pass(?:word|wd)?|secret|token|api[_-]?key|apikey|auth|credential|access[_-]?token|client[_-]?secret)\b(\s*["']?\s*[:=]\s*["']?)([^\s"'&,;}]{1,200})/gi,
    `$1$2${MARK}`,
  ],
  // The same keywords delimited by WHITESPACE rather than `:`/`=` — e.g.
  // "connection refused with token abc123". This was missed by the assignment
  // pattern above, and it is not a contrived shape: it is how a hand-written
  // error message from an adapter actually reads.
  //
  // No minimum length beyond 4 characters, deliberately. An earlier version of
  // this file relied on the `Bearer|Basic|Token` rule below to cover this
  // case, whose 8-character minimum let a short token through — and the test
  // that was supposed to catch that used an 18-character fixture, so it passed
  // for the wrong reason while the real 6-character one leaked.
  //
  // The negative lookahead is the false-positive guard: these keywords are
  // frequently followed by an ordinary English word ("token expired", "secret
  // not set"), and redacting those makes logs useless without protecting
  // anything. `auth` is excluded from this rule entirely — "auth failed" is
  // far more common than "auth <secret>".
  [
    /\b(pass(?:word|wd)?|secret|token|api[_-]?key|apikey|credential|access[_-]?token|client[_-]?secret)(\s+)(?!(?:is|was|were|not|no|missing|absent|expired|invalid|required|malformed|empty|null|undefined|unset|set|failed|failure|error|mismatch|rejected|for|from|in|on|and|or|the|a|an|to|value|header|field)\b)([^\s"'&,;}]{4,200})/gi,
    `$1$2${MARK}`,
  ],
  // Authorization header values.
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,400}/gi, `$1 ${MARK}`],
  // URL userinfo: scheme://user:secret@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]{1,120}):([^\s@]{1,200})@/gi, `$1$2:${MARK}@`],
  // Vendor key prefixes with a distinctive, unambiguous shape.
  [/\bsk-[A-Za-z0-9_-]{8,200}/g, MARK],
  [/\bxox[baprs]-[A-Za-z0-9-]{8,200}/g, MARK],
  [/\bghp_[A-Za-z0-9]{20,255}/g, MARK],
  [/\bgithub_pat_[A-Za-z0-9_]{20,255}/g, MARK],
  [/\bGOCSPX-[A-Za-z0-9_-]{8,200}/g, MARK],
  [/\bAIza[A-Za-z0-9_-]{20,200}/g, MARK],
  // JWTs — three dot-separated base64url segments starting with the standard
  // `{"alg"` header encoding.
  [/\beyJ[A-Za-z0-9_-]{4,2000}\.[A-Za-z0-9_-]{4,2000}\.[A-Za-z0-9_-]{0,2000}/g, MARK],
];

/**
 * Returns `text` with credential-shaped substrings replaced.
 *
 * Never throws: this is called from catch blocks, and a redactor that can
 * itself fail would turn a handled error into an unhandled one. On any
 * internal failure it returns a fully-redacted placeholder rather than the
 * original — failing closed, because the whole point is that the input is
 * untrusted.
 */
export function redactSecrets(text: unknown): string {
  try {
    if (text === null || text === undefined) return '';
    let out = String(text);
    if (out.length > MAX_SCAN_LENGTH) out = `${out.slice(0, MAX_SCAN_LENGTH)}…`;
    for (const [pattern, replacement] of PATTERNS) {
      out = out.replace(pattern, replacement);
    }
    return out;
  } catch {
    return MARK;
  }
}

/**
 * `redactSecrets` plus whitespace collapsing and a hard length cap — the shape
 * wanted when writing a third-party error into a single log line.
 */
export function safeLogText(text: unknown, maxLength = 500): string {
  return redactSecrets(text).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
