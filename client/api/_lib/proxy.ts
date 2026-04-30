/**
 * Cached proxy: forwards a GET to Railway, caches the result on Vercel's CDN
 * with stale-while-revalidate so the landing page keeps getting *something*
 * even if Railway is timing out or down.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const API_BASE = (process.env.API_BASE_URL || 'https://api.growthescalators.com').replace(/\/$/, '');

export interface ProxyOptions {
  fallback: unknown;
  timeoutMs?: number;
  // Cache-Control max-age + s-maxage in seconds.
  cacheSeconds?: number;
  // Stale-while-revalidate window in seconds.
  staleSeconds?: number;
}

export async function proxyGet(
  req: VercelRequest,
  res: VercelResponse,
  upstreamPath: string,
  opts: ProxyOptions,
): Promise<void> {
  const cacheSeconds = opts.cacheSeconds ?? 60;
  const staleSeconds = opts.staleSeconds ?? 600;
  const timeoutMs = opts.timeoutMs ?? 3000;

  res.setHeader(
    'Cache-Control',
    `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}, stale-while-revalidate=${staleSeconds}, stale-if-error=${staleSeconds}`,
  );

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const upstream = await fetch(`${API_BASE}${upstreamPath}`, {
      headers: { 'X-Forwarded-Host': String(req.headers.host || '') },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      // 404 from Railway means "we explicitly don't know this" — pass through
      // so the client's missing-data branch fires. Other errors fall through
      // to the fallback so the user always sees *something*.
      if (upstream.status === 404) {
        res.status(404).json(opts.fallback);
        return;
      }
      console.warn(`[edge-proxy] upstream ${upstreamPath} -> ${upstream.status}`);
      res.status(200).json(opts.fallback);
      return;
    }

    const data = await upstream.json();
    res.status(200).json(data);
  } catch (e) {
    clearTimeout(timer);
    console.warn(`[edge-proxy] ${upstreamPath} failed:`, (e as Error).message);
    res.status(200).json(opts.fallback);
  }
}
