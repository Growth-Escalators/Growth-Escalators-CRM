import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, X, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const STATUS_BADGE = {
  new: 'badge-info',
  scored: 'badge-info',
  enriched: 'badge-info',
  matched: 'badge-success',
  drafted: 'badge-warning',
  sent: 'badge-accent',
  replied_positive: 'badge-success',
  replied_other: 'badge-muted',
  dead: 'badge-muted',
  placed: 'badge-success',
};

export default function WizmatchSignalsPage() {
  const [signals, setSignals] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', min_score: '', source: '' });
  const [page, setPage] = useState(0);
  const [selectedSignal, setSelectedSignal] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sourcing, setSourcing] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const loadSignals = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 50, offset: page * 50 });
      if (filters.status) params.set('status', filters.status);
      if (filters.min_score) params.set('min_score', filters.min_score);
      if (filters.source) params.set('source', filters.source);
      const data = await apiFetch(`/api/wizmatch/signals?${params}`);
      setSignals(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error('Failed to load signals:', e);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { loadSignals(); }, [loadSignals]);
  const loadSourcing = useCallback(async () => {
    try { setSourcing(await apiFetch('/api/wizmatch/sourcing/status')); }
    catch (e) { setFeedback(e.message || 'Sourcing status could not be loaded.'); }
  }, []);
  useEffect(() => { loadSourcing(); }, [loadSourcing]);

  async function runAction(label, path, body) {
    setActionBusy(label); setFeedback('');
    try {
      const result = await apiFetch(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      setFeedback(`${label} completed.`); await loadSignals(); await loadSourcing();
      if (selectedSignal) await openDetail(selectedSignal);
      return result;
    } catch (e) { setFeedback(e.message || `${label} failed.`); }
    finally { setActionBusy(''); }
  }

  // Poll for new signals every 30s
  useEffect(() => {
    const interval = setInterval(loadSignals, 30000);
    return () => clearInterval(interval);
  }, [loadSignals]);

  const openDetail = async (signal) => {
    setSelectedSignal(signal);
    setDetailLoading(true);
    try {
      const detail = await apiFetch(`/api/wizmatch/signals/${signal.id}`);
      setSelectedSignal(detail);
    } catch (e) {
      console.error('Failed to load detail:', e);
    } finally {
      setDetailLoading(false);
    }
  };

  // Permanent delete via DELETE /signals/:id. The backend returns 409 with a
  // human message for signals that were promoted into a requirement or are
  // placed — surface it in the dialog and let the user Reject instead.
  const deleteSignal = async (reason) => {
    if (!selectedSignal) return;
    setDeleteBusy(true); setDeleteError(null);
    try {
      await apiFetch(`/api/wizmatch/signals/${selectedSignal.id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      setFeedback('Signal deleted.');
      setShowDeleteDialog(false);
      setSelectedSignal(null);
      await loadSignals();
    } catch (e) {
      setDeleteError(e.message || 'Delete failed.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const scoreColor = (score) => {
    if (score >= 8) return 'bg-success-500/10 text-success-600 border-success-500/20';
    if (score >= 7) return 'bg-warning-500/10 text-warning-700 border-warning-500/20';
    if (score >= 5) return 'bg-primary-500/10 text-primary-700 border-primary-500/20';
    return 'bg-neutral-200 text-neutral-500 border-neutral-300';
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[20px] font-bold text-neutral-900">Job Signals</h1>
        <p className="text-[12.5px] text-neutral-500 mt-1">{total} total signals · auto-refreshes every 30s</p>
      </div>

      {feedback && <div role="status" className="mb-4 rounded-md border border-info-200 bg-info-50 p-3 text-sm text-info-800">{feedback}</div>}
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {['theirstack','ats','xray'].map(provider => {
          const cfg = sourcing?.config || {}; const latest = (sourcing?.latestRuns || []).find(run => run.provider===provider);
          const enabled = provider==='theirstack' ? cfg.theirstackEnabled : provider==='ats' ? cfg.atsEnabled : cfg.xrayEnabled;
          const account = provider==='theirstack' ? sourcing?.providerAccounts?.theirstack : provider==='xray' ? sourcing?.providerAccounts?.searchapi : null;
          return <div className="card p-3" key={provider}><div className="flex justify-between"><span className="font-semibold">{provider==='xray'?'LinkedIn X-Ray':provider==='theirstack'?'TheirStack':'ATS polling'}</span><span className={enabled?'badge-success':'badge-muted'}>{enabled?'active':account?.configured?'configured, off':'off'}</span></div><div className="mt-1 text-xs text-neutral-500">{latest ? `${latest.status} · ${latest.inserted_count || 0} new · ${latest.duplicate_count || 0} duplicate` : 'No run recorded'}</div>{provider==='xray' && <div className="mt-1 text-xs text-neutral-500">SearchAPI shared allowance: {sourcing?.searchApiUsage?.daily || 0}/{sourcing?.searchApiUsage?.dailyLimit || 5} today · {sourcing?.searchApiUsage?.monthly || 0}/{sourcing?.searchApiUsage?.monthlyLimit || 80} this month. Requirement-first only.</div>}<div className="flex gap-2">{provider==='theirstack' && <button disabled={!account?.configured||actionBusy} className="btn-standard btn-compact mt-2" onClick={()=>runAction('Preview TheirStack','/api/wizmatch/sourcing/theirstack/preview')}>Free preview</button>}{provider!=='xray' && <button disabled={!enabled||actionBusy} className="btn-standard btn-compact mt-2" onClick={()=>runAction(`Run ${provider}`,`/api/wizmatch/sourcing/${provider}/run`)}>Run now</button>}</div></div>;
        })}
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3 items-center flex-wrap">
        <select
          value={filters.status}
          onChange={(e) => { setFilters({...filters, status: e.target.value}); setPage(0); }}
          className="input w-auto"
        >
          <option value="">All Status</option>
          <option value="new">New</option>
          <option value="scored">Scored</option>
          <option value="enriched">Enriched</option>
          <option value="matched">Matched</option>
          <option value="drafted">Drafted</option>
          <option value="sent">Sent</option>
          <option value="replied_positive">Positive Reply</option>
          <option value="dead">Dead</option>
        </select>
        <select
          value={filters.min_score}
          onChange={(e) => { setFilters({...filters, min_score: e.target.value}); setPage(0); }}
          className="input w-auto"
        >
          <option value="">Any Score</option>
          <option value="7">7+ (Priority)</option>
          <option value="8">8+ (High)</option>
          <option value="5">5+</option>
        </select>
        <input
          type="text"
          placeholder="Source filter..."
          value={filters.source}
          onChange={(e) => { setFilters({...filters, source: e.target.value}); setPage(0); }}
          className="input w-40"
        />
        <button onClick={loadSignals} className="btn-standard btn-compact">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="table-fluent">
          <thead>
            <tr>
              <th>Job Title</th>
              <th>Company</th>
              <th>Days Open</th>
              <th>Score</th>
              <th>Source</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" className="px-4 py-8 text-center text-neutral-400">Loading...</td></tr>
            ) : signals.length === 0 ? (
              <tr><td colSpan="6" className="px-4 py-8 text-center text-neutral-400">No signals found</td></tr>
            ) : signals.map((s) => (
              <tr key={s.id} onClick={() => openDetail(s)} className="cursor-pointer">
                <td className="font-medium text-neutral-900">{s.job_title}</td>
                <td>{s.company_name || '—'}</td>
                <td>
                  <span className={s.days_open >= 30 ? 'text-danger-600 font-bold' : 'text-neutral-600'}>
                    {s.days_open || 0}d
                  </span>
                </td>
                <td>
                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-sm font-bold border ${scoreColor(s.score || 0)}`}>
                    {s.score || 0}
                  </span>
                </td>
                <td className="text-neutral-500">{s.source}</td>
                <td>
                  <span className={STATUS_BADGE[s.status] || 'badge-muted'}>
                    {s.status?.replace(/_/g, ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 50 && (
        <div className="mt-4 flex justify-between items-center">
          <button
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            className="btn-standard btn-compact disabled:opacity-50"
          >Previous</button>
          <span className="text-sm text-neutral-500">Page {page + 1} of {Math.ceil(total / 50)}</span>
          <button
            disabled={(page + 1) * 50 >= total}
            onClick={() => setPage(page + 1)}
            className="btn-standard btn-compact disabled:opacity-50"
          >Next</button>
        </div>
      )}

      {/* Detail Drawer */}
      {selectedSignal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={() => setSelectedSignal(null)}>
          <div className="bg-white w-[480px] max-w-[90vw] h-full overflow-y-auto shadow-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-neutral-100 px-6 py-4 flex justify-between items-start">
              <div>
                <h2 className="text-[18px] font-bold text-neutral-900">{selectedSignal.job_title}</h2>
                <p className="text-[12.5px] text-neutral-500">{selectedSignal.company_name || 'Unknown'} · {selectedSignal.location || '—'}</p>
              </div>
              <button onClick={() => setSelectedSignal(null)} className="text-neutral-400 hover:text-neutral-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              {detailLoading ? (
                <p className="text-neutral-400">Loading details...</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-neutral-50 rounded-lg p-3">
                      <div className="text-[11px] text-neutral-500 uppercase font-semibold tracking-wider">Score</div>
                      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-md text-lg font-bold border mt-1 ${scoreColor(selectedSignal.score || 0)}`}>
                        {selectedSignal.score || 0}
                      </div>
                    </div>
                    <div className="bg-neutral-50 rounded-lg p-3">
                      <div className="text-[11px] text-neutral-500 uppercase font-semibold tracking-wider">Days Open</div>
                      <div className="text-2xl font-bold text-neutral-900 mt-1">{selectedSignal.days_open || 0}</div>
                    </div>
                    <div className="bg-neutral-50 rounded-lg p-3">
                      <div className="text-[11px] text-neutral-500 uppercase font-semibold tracking-wider">Status</div>
                      <div className={STATUS_BADGE[selectedSignal.status] || 'badge-muted'}>
                        {selectedSignal.status?.replace(/_/g, ' ')}
                      </div>
                    </div>
                  </div>

                  {/* Score Breakdown */}
                  {selectedSignal.score_breakdown && (
                    <div className="mb-6">
                      <h3 className="text-[15px] font-semibold text-neutral-700 mb-2">Score Breakdown</h3>
                      <pre className="bg-neutral-50 p-3 rounded-lg text-xs overflow-x-auto font-mono">
                        {JSON.stringify(selectedSignal.score_breakdown, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Decision Maker */}
                  {selectedSignal.contact_first_name && (
                    <div className="mb-6">
                      <h3 className="text-[15px] font-semibold text-neutral-700 mb-2">Decision Maker</h3>
                      <p className="text-sm text-neutral-600">{selectedSignal.contact_first_name} {selectedSignal.contact_last_name || ''}</p>
                    </div>
                  )}

                  {/* Keywords */}
                  {selectedSignal.keywords?.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-[15px] font-semibold text-neutral-700 mb-2">Keywords</h3>
                      <div className="flex flex-wrap gap-1">
                        {selectedSignal.keywords.map((k, i) => (
                          <span key={i} className="badge-info text-[11px]">{k}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Matched Candidates */}
                  {selectedSignal.matched_candidates?.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-[15px] font-semibold text-neutral-700 mb-2">Matched Candidates ({selectedSignal.matched_candidates.length})</h3>
                      {selectedSignal.matched_candidates.map((c, i) => (
                        <div key={i} className="card p-3 mb-2">
                          <div className="font-medium text-sm text-neutral-900">{c.first_name} {c.last_name}</div>
                          <div className="text-xs text-neutral-500">{c.skills?.join(', ')}</div>
                          <div className="text-xs text-neutral-500">{c.visa_status} · {c.rate_currency === 'INR' ? '₹' : '$'}{c.rate_hourly}/hr · {c.availability_status}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Drafts */}
                  {selectedSignal.drafts?.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-[15px] font-semibold text-neutral-700 mb-2">Email Drafts ({selectedSignal.drafts.length})</h3>
                      {selectedSignal.drafts.map((d, i) => (
                        <div key={i} className="card p-3 mb-2">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-medium text-sm text-neutral-900">{d.metadata?.subject || '(no subject)'}</span>
                            <span className="text-xs text-neutral-400">{d.metadata?.variant}</span>
                          </div>
                          <pre className="text-xs text-neutral-600 whitespace-pre-wrap font-mono">{d.content?.slice(0, 200)}...</pre>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    <button disabled={actionBusy} onClick={()=>runAction('Qualify signal',`/api/wizmatch/signals/${selectedSignal.id}/qualify`)} className="btn-primary">Qualify + POC task</button>
                    <button disabled={actionBusy||!sourcing?.config?.pocDiscoveryEnabled} onClick={()=>runAction('Find POC',`/api/wizmatch/signals/${selectedSignal.id}/discover-poc`)} className="btn-standard">Find POC</button>
                    <button disabled={actionBusy} onClick={()=>runAction('Create requirement draft',`/api/wizmatch/signals/${selectedSignal.id}/promote-to-requirement`)} className="btn-standard">Create requirement draft</button>
                    <button disabled={actionBusy} onClick={()=>runAction('Reject signal',`/api/wizmatch/signals/${selectedSignal.id}/reject`,{reason:'Not a workable staffing requirement'})} className="btn-standard text-danger-700">Reject</button>
                    <button
                      onClick={async () => {
                        try {
                          await apiFetch(`/api/wizmatch/signals/${selectedSignal.id}/draft`, { method: 'POST' });
                          alert('Drafts generated! Refresh to see them.');
                          openDetail(selectedSignal);
                        } catch (e) { alert('Failed: ' + e.message); }
                      }}
                      className="btn-primary"
                    >Generate Drafts</button>
                    <button
                      disabled={actionBusy || deleteBusy}
                      onClick={() => { setDeleteError(null); setShowDeleteDialog(true); }}
                      className="btn-standard text-danger-700 inline-flex items-center gap-1"
                    ><Trash2 className="w-3.5 h-3.5" /> Delete permanently</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showDeleteDialog}
        title="Delete this signal?"
        impactSummary={selectedSignal ? `This permanently deletes the job signal "${selectedSignal.job_title}"${selectedSignal.company_name ? ` at ${selectedSignal.company_name}` : ''}. Signals promoted into a requirement or already placed can't be deleted — Reject them instead.` : ''}
        confirmLabel="Delete permanently"
        danger
        requireReason
        loading={deleteBusy}
        error={deleteError}
        onConfirm={deleteSignal}
        onCancel={() => { setShowDeleteDialog(false); setDeleteError(null); }}
      />
    </div>
  );
}
