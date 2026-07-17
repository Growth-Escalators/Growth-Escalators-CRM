import logger from '../utils/logger';
import { recoverStaleWizmatchSourceRuns } from '../services/wizmatchSourcing';

const POLL_INTERVAL_MS = 10 * 60 * 1000; // run every 10 minutes, matching stuckJobWorker's cadence

async function recover(): Promise<void> {
  try {
    const count = await recoverStaleWizmatchSourceRuns();
    if (count > 0) {
      logger.warn(`[staleWizmatchSourceRunWorker] recovered ${count} stale 'running' wizmatch_source_runs row(s)`);
    }
  } catch (error) {
    logger.error('[staleWizmatchSourceRunWorker] error during recovery:', error instanceof Error ? error.message : String(error));
  }
}

export function startStaleWizmatchSourceRunWorker(): void {
  console.log('[staleWizmatchSourceRunWorker] Started — polling every 10 minutes for stale wizmatch_source_runs.');
  setInterval(() => {
    recover().catch((err) =>
      logger.error('[staleWizmatchSourceRunWorker] error during recovery:', err instanceof Error ? err.message : String(err)),
    );
  }, POLL_INTERVAL_MS);
}
