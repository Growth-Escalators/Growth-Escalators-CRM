import React from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Shared Error + Retry block for authenticated API failures. Never pair this
 * with demo/fallback data — show this INSTEAD of stale or fabricated rows,
 * per the house rule ("no demo-data fallback after a failure").
 */
export default function ErrorRetry({ message, onRetry, retrying = false }) {
  return (
    <div role="alert" className="card p-6 text-center">
      <AlertTriangle className="mx-auto w-6 h-6 text-danger-600" />
      <p className="mt-2 text-[13px] text-neutral-700">{message || 'Something went wrong loading this data.'}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} disabled={retrying} className="btn-primary btn-compact mt-3">
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      )}
    </div>
  );
}
