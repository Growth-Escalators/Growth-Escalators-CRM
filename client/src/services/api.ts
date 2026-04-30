/**
 * API URL builder.
 *
 * - In production on Vercel, every landing-page fetch goes to the *same origin*
 *   (`ecom.growthescalators.com`). All `/api/*` paths are handled by Vercel
 *   edge functions in `client/api/*`, which then call Cashfree directly,
 *   write to the Upstash queue, or proxy to Railway as needed.
 * - In local dev, Vite's proxy (vite.config.ts) sends `/api/*` to the Express
 *   backend on :3000.
 *
 * Setting `VITE_API_BASE_URL` is therefore optional. It exists as an escape
 * hatch for split deployments (e.g. preview builds that need to call
 * `https://api.growthescalators.com` directly without going through Vercel
 * edge functions). When unset (the production default), all calls stay
 * relative to the current origin.
 */
const BASE = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = `/${path}`;
  return `${BASE}${path}`;
}

/**
 * fetch() wrapper that adds a default timeout and surfaces errors in a
 * consistent shape. Use this for non-critical reads where you want to fail
 * gracefully — pair with try/catch and a sensible UI fallback.
 */
export async function safeFetch(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(apiUrl(path), { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
