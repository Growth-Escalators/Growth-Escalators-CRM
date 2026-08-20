/**
 * Compatibility entrypoint retained while worker wiring is cleaned up.
 * WizMatch is retired, so starting this worker must never schedule polling or
 * touch WizMatch source-run data.
 */
export function startStaleWizmatchSourceRunWorker(): void {
  // Intentionally no-op.
}
