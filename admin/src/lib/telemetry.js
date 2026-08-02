import { getAuthToken } from './auth.js';
import { findWizmatchRouteForPath } from '../routes/wizmatchRouteRegistry.ts';

/**
 * Route-view beacon for the 2-week nav-usage experiment.
 * Server side + rationale: src/routes/wizmatchTelemetry.ts.
 */

const TAB_PATTERN = /^[a-z0-9-]{1,32}$/;

/**
 * Maps a browser location to the registry entry it belongs to, or null when
 * the location is not a Wizmatch route (nothing to attribute — skip the ping
 * entirely rather than send an unattributable one).
 *
 * The `?tab=` handling is not cosmetic. A registry `path` may itself embed a
 * query: `more-provider-runs` is `/wizmatch/system?tab=sourcing` and shares a
 * pathname with `more-system`. Resolving on pathname alone silently collapses
 * the two, so the deep-linked "Provider Runs" entry would report zero views no
 * matter how often it is opened — a manufactured false negative in the one
 * column the experiment is read for. Matching the query-bearing entry first
 * mirrors what Sidebar.jsx's isEntryActive already does for highlighting.
 *
 * The returned `path` carries only pathname + that whitelisted tab. Every other
 * query param is dropped here, before it can reach the network.
 */
export function resolveRouteView(pathname, search) {
  const tab = new URLSearchParams(search || '').get('tab');
  const keptTab = tab && TAB_PATTERN.test(tab) ? tab : null;
  const qualifiedPath = keptTab ? `${pathname}?tab=${keptTab}` : pathname;

  const route = (keptTab && findWizmatchRouteForPath(qualifiedPath)) || findWizmatchRouteForPath(pathname);
  if (!route) return null;
  return { routeId: route.id, path: qualifiedPath };
}

/**
 * Fire-and-forget POST. Swallows every error, including a 401.
 *
 * Deliberately NOT apiFetch: apiFetch clears the session and hard-redirects to
 * /login on any 401 (lib/api.js:19-22). This runs on every navigation, so a
 * telemetry ping that raced an expiring token would log a working user out
 * mid-click — a measurement nobody asked for must never be able to do that.
 *
 * navigator.sendBeacon is not an alternative: it cannot set an Authorization
 * header, and this endpoint takes identity from the verified token only.
 * `keepalive` gets the equivalent survive-the-teardown behaviour from fetch.
 */
export function sendRouteViewBeacon(routeId, path) {
  try {
    const token = getAuthToken();
    if (!token) return;
    fetch('/api/wizmatch/telemetry/route-view', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ routeId, path }),
    }).catch(() => {});
  } catch {
    // Instrumentation must never surface to the user in any form.
  }
}
