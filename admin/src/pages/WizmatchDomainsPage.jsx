import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import EmptyState from '../components/wizmatch/EmptyState.jsx';
import ErrorRetry from '../components/wizmatch/ErrorRetry.jsx';
import { useToast } from '../components/wizmatch/Toast.jsx';

const STATUS_BADGE = { healthy: 'badge-success', warn: 'badge-warning', paused: 'badge-accent', blacklisted: 'badge-danger' };
const AUTO_REFRESH_MS = 300000;

// Keeps the card grid's shape during the first load instead of collapsing the
// page to the word "Loading...". Only the first load renders these; the 5-minute
// auto-refresh dims the real cards rather than replacing them.
function DomainCardSkeleton() {
  return (
    <div className="card p-4 space-y-3" aria-hidden="true">
      <div className="h-4 w-2/3 rounded bg-neutral-200/70 animate-pulse" />
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-2.5 rounded bg-neutral-200/70 animate-pulse" />)}
      </div>
      <div className="h-7 w-24 rounded bg-neutral-200/70 animate-pulse" />
    </div>
  );
}

export default function WizmatchDomainsPage() {
  const { showSuccess, showError } = useToast();
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [pauseTarget, setPauseTarget] = useState(null);
  const [pausing, setPausing] = useState(false);
  const [pauseError, setPauseError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    if (loadedOnce.current) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/api/wizmatch/domains');
      setDomains(data.items || []);
    } catch (e) {
      // Was `console.error(e)` only: a failed load rendered an empty grid, which
      // reads as "you have no sending domains" — the opposite of the truth on a
      // page whose whole job is telling you when sending is at risk.
      setError(e.message || 'Domain health could not be loaded.');
    } finally {
      loadedOnce.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const i = setInterval(load, AUTO_REFRESH_MS); return () => clearInterval(i); }, [load]);

  const pauseDomain = async (reason) => {
    setPausing(true);
    setPauseError(null);
    try {
      await apiFetch(`/api/wizmatch/domains/${pauseTarget.id}/pause`, { method: 'POST', body: JSON.stringify({ reason }) });
      showSuccess(`Paused sending on ${pauseTarget.domain}`);
      setPauseTarget(null);
      await load();
    } catch (e) {
      setPauseError(e.message || 'The domain could not be paused.');
    } finally {
      setPausing(false);
    }
  };

  const resumeDomain = async (domain) => {
    setBusyId(domain.id);
    try {
      await apiFetch(`/api/wizmatch/domains/${domain.id}/resume`, { method: 'POST' });
      showSuccess(`Resumed sending on ${domain.domain}`);
      await load();
    } catch (e) {
      showError(e.message || 'The domain could not be resumed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-[20px] font-bold text-neutral-900 mb-6">Domain Health</h1>

      {error && domains.length === 0 ? (
        <ErrorRetry message={error} onRetry={load} retrying={loading || refreshing} />
      ) : (
        <>
          {error && (
            <div role="alert" className="mb-4 flex items-center gap-2 rounded-md border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-[12px] text-danger-700">
              <span>{error} Showing the last successful check.</span>
              <button onClick={load} disabled={refreshing} className="btn-standard btn-compact ml-auto">
                {refreshing ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          )}
          {!loading && domains.length === 0 ? (
            <EmptyState title="No sending domains configured" description="Domains appear here once a sending domain is registered for this tenant." />
          ) : (
            <div className={`grid grid-cols-3 gap-4 transition-opacity ${refreshing ? 'opacity-60' : ''}`} aria-busy={loading || refreshing}>
              {loading
                ? Array.from({ length: 3 }).map((_, i) => <DomainCardSkeleton key={i} />)
                : domains.map(d => (
                  <div key={d.id} className="card p-4">
                    <div className="flex justify-between items-start mb-3">
                      <h3 className="text-[15px] font-semibold text-neutral-900">{d.domain}</h3>
                      <span className={STATUS_BADGE[d.status] || 'badge-muted'}>{d.status}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-3 text-neutral-600">
                      <div><span className="font-medium text-neutral-700">SPF:</span> {d.spf_ok === null ? '—' : d.spf_ok ? '✅' : '❌'}</div>
                      <div><span className="font-medium text-neutral-700">DKIM:</span> {d.dkim_ok === null ? 'unknown' : d.dkim_ok ? '✅' : '❌'}</div>
                      <div><span className="font-medium text-neutral-700">DMARC:</span> {d.dmarc_ok === null ? '—' : d.dmarc_ok ? '✅' : '❌'}</div>
                      <div><span className="font-medium text-neutral-700">Sends 7d:</span> {d.sends_7d ?? 0}</div>
                      {/* reply_rate_7d is null on a domain that has never sent — `null * 100`
                          renders NaN%, so an unused domain looked like a broken one. */}
                      <div><span className="font-medium text-neutral-700">Reply rate:</span> {d.reply_rate_7d == null ? '—' : `${(d.reply_rate_7d * 100).toFixed(1)}%`}</div>
                    </div>
                    <div className="text-xs text-neutral-400 mb-2">Last check: {d.last_check_at ? new Date(d.last_check_at).toLocaleString() : 'Never'}</div>
                    <div className="text-xs text-neutral-400 mb-3">Inboxes: {d.inbox_addresses?.length ? d.inbox_addresses.join(', ') : '—'}</div>
                    <div className="flex gap-2">
                      {d.status === 'healthy' ? (
                        <button onClick={() => { setPauseError(null); setPauseTarget(d); }} className="btn-accent btn-compact">Pause</button>
                      ) : (
                        <button onClick={() => resumeDomain(d)} disabled={busyId === d.id} className="btn-primary btn-compact disabled:opacity-50">
                          {busyId === d.id ? 'Resuming…' : 'Resume'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!pauseTarget}
        title={pauseTarget ? `Pause sending on ${pauseTarget.domain}?` : ''}
        impactSummary="Marks the domain paused with your reason and announces it in the Wizmatch Slack channel. Mailbox-health checks only pick 'healthy' domains, so its inboxes stop being selected for sending. Reversible — Resume puts it straight back to healthy."
        confirmLabel="Pause domain"
        requireReason
        loading={pausing}
        error={pauseError}
        onConfirm={pauseDomain}
        onCancel={() => { setPauseTarget(null); setPauseError(null); }}
      />
    </div>
  );
}
