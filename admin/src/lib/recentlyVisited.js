/**
 * recentlyVisited — small localStorage helper for tracking last-visited pages.
 *
 * Stored as JSON array under key `ge-crm-recent-paths`, newest first,
 * deduped by `path`, capped at MAX entries. All ops are wrapped in try/catch
 * so quota errors, SSR, or disabled storage never throw to the caller.
 */

const KEY = 'ge-crm-recent-paths';
const MAX = 5;

function safeRead() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordVisit(path, label) {
  try {
    if (!path) return;
    const existing = safeRead();
    const filtered = existing.filter((entry) => entry && entry.path !== path);
    filtered.unshift({ path, label, ts: Date.now() });
    const trimmed = filtered.slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // swallow — quota / disabled storage / SSR
  }
}

export function getRecentVisits() {
  try {
    return safeRead();
  } catch {
    return [];
  }
}
