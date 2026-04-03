import logger from './logger';

/**
 * Fetch with automatic retry on transient failures.
 * Retries on: network errors, 429 (rate limit), 500/502/503/504 (server errors).
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = 3,
  delayMs = 1000,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        ...options,
      });

      // Don't retry on client errors (4xx) except 429
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        return res;
      }

      // Retry on 429 and 5xx
      if (attempt < retries) {
        const wait = delayMs * Math.pow(2, attempt - 1);
        logger.warn(`[fetchWithRetry] ${res.status} on attempt ${attempt}/${retries}, retrying in ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      return res; // last attempt, return whatever we got
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < retries) {
        const wait = delayMs * Math.pow(2, attempt - 1);
        logger.warn(`[fetchWithRetry] Error on attempt ${attempt}/${retries}: ${lastError.message}, retrying in ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }

  throw lastError ?? new Error('fetchWithRetry: all attempts failed');
}
