/**
 * WizMatch route-view telemetry is retired.
 *
 * The legacy `wizmatch` tenant can temporarily expose shared Growth CRM pages
 * while its data/session namespace is consolidated, but those compatibility
 * routes must never restart the old WizMatch navigation experiment or call the
 * retired `/api/wizmatch/telemetry/route-view` endpoint.
 */
export function resolveRouteView() {
  return null;
}

/** Compatibility no-op retained until App.jsx removes RouteViewBeacon. */
export function sendRouteViewBeacon() {
  return undefined;
}
