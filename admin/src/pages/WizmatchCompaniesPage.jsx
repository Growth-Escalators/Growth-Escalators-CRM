import { useState, useEffect, useCallback } from 'react';
import { Building2, Search, X, UserPlus, Trash2, Radar } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import EmptyState from '../components/wizmatch/EmptyState.jsx';
import ErrorRetry from '../components/wizmatch/ErrorRetry.jsx';
import StatusBadge from '../components/wizmatch/StatusBadge.jsx';
import { useToast } from '../components/wizmatch/Toast.jsx';

// Mirrors COMPANY_CONTACT_ROLES in src/services/wizmatchStaffingDomain.ts —
// kept in sync by hand like OPERATING_STAGES in WizmatchRequirementsPage.jsx.
const COMPANY_CONTACT_ROLES = [
  'talent_acquisition', 'hiring_manager', 'coordinator', 'approver',
  'interviewer', 'procurement', 'vendor_manager', 'source', 'other',
];

function formatMinorCurrency(value, currency = 'INR') {
  const amount = Number(value || 0) / 100;
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency || 'INR'} ${amount.toFixed(2)}`;
  }
}

export default function WizmatchCompaniesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      const data = await apiFetch(`/api/wizmatch/staffing/companies?${params}`);
      setItems(data.items || []);
    } catch (e) {
      setError(e.message || 'Failed to load companies');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[20px] font-bold text-neutral-900 tracking-[-0.01em]">Companies</h1>
          <span className="text-[12.5px] font-semibold text-primary-700 bg-primary-500/10 border border-primary-500/20 px-2.5 py-0.5 rounded-full">
            {items.length} companies
          </span>
        </div>
      </div>
      <p className="text-[12.5px] text-neutral-500 mt-1 mb-5">
        Client companies in the staffing pipeline — hiring contacts, open requirements and delivery activity.
      </p>

      <div className="mb-4 flex flex-wrap gap-2.5">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            placeholder="Search name or domain…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input w-[260px] pl-8"
          />
        </div>
        {search && (
          <button onClick={() => setSearch('')} className="text-[12.5px] text-neutral-400 hover:text-neutral-600">Clear</button>
        )}
      </div>

      {error ? (
        <ErrorRetry message={error} onRetry={load} retrying={loading} />
      ) : loading && items.length === 0 ? (
        <div className="card p-8 text-center text-neutral-400">Loading companies…</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={search ? 'No companies match this search' : 'No companies yet'}
          description={search ? 'Try a different name or domain.' : 'Companies appear here once they enter the staffing pipeline.'}
          variant={search ? 'filtered-empty' : 'true-empty'}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="table-fluent">
            <thead>
              <tr>
                <th>Company</th>
                <th>Domain</th>
                <th>Industry</th>
                <th>Country</th>
                <th className="text-right">Open requirements</th>
                <th className="text-right">Hiring contacts</th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id} onClick={() => setSelectedId(c.id)} className="cursor-pointer hover:bg-neutral-50">
                  <td className="font-medium text-neutral-900">{c.name}</td>
                  <td className="text-neutral-500">{c.domain || '—'}</td>
                  <td className="text-neutral-500">{c.industry || '—'}</td>
                  <td className="text-neutral-500">{c.country || '—'}</td>
                  <td className="text-right">
                    {c.open_requirement_count > 0
                      ? <span className="badge-info">{c.open_requirement_count}</span>
                      : <span className="text-neutral-400">0</span>}
                  </td>
                  <td className="text-right">
                    {c.contact_count > 0
                      ? <span className="badge-success">{c.contact_count}</span>
                      : <span className="text-neutral-400">0</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId && (
        <CompanyDetailDrawer
          companyId={selectedId}
          onClose={() => setSelectedId(null)}
          onDeleted={() => { setSelectedId(null); load(); }}
          onChanged={load}
        />
      )}
    </div>
  );
}

function CompanyDetailDrawer({ companyId, onClose, onDeleted, onChanged }) {
  const { showSuccess, showError } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [dependencyNotice, setDependencyNotice] = useState(null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await apiFetch(`/api/wizmatch/staffing/companies/${companyId}`);
      setData(detail);
    } catch (e) {
      setError(e.message || 'Failed to load company');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiFetch('/api/wizmatch/staffing/users').then(d => setUsers(d.items || [])).catch(() => setUsers([]));
  }, []);

  const ownerName = (id) => users.find(u => u.id === id)?.name || null;

  const refreshAfterChange = async () => {
    await load();
    onChanged();
  };

  // The delete endpoint returns 409 { error:'has_dependencies', message,
  // dependencies:[...] } which apiFetch surfaces as e.message — matched here
  // instead of a status code because apiFetch does not expose one.
  const deleteCompany = async (reason) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch(`/api/wizmatch/staffing/companies/${companyId}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      showSuccess('Company deleted permanently');
      onDeleted();
    } catch (e) {
      if (e.message && /cannot delete/i.test(e.message)) {
        setShowDeleteDialog(false);
        setDependencyNotice(e.message);
      } else {
        setDeleteError(e.message || 'Delete failed.');
      }
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
        <div className="bg-white w-[600px] max-w-[95vw] h-full shadow-modal flex items-center justify-center" onClick={e => e.stopPropagation()}>
          <p className="text-neutral-400">Loading company…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
        <div className="bg-white w-[600px] max-w-[95vw] h-full shadow-modal p-6" onClick={e => e.stopPropagation()}>
          <div className="flex justify-end mb-4"><button onClick={onClose} className="text-neutral-400 hover:text-neutral-600"><X className="w-5 h-5" /></button></div>
          <ErrorRetry message={error} onRetry={load} retrying={loading} />
        </div>
      </div>
    );
  }

  if (!data) return null;
  const { company, contacts, requirements, events, tasks } = data;
  const canOfferDelete = !dependencyNotice && (contacts?.length || 0) === 0 && (requirements?.length || 0) === 0;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
      <div className="bg-white w-[600px] max-w-[95vw] h-full overflow-y-auto shadow-modal" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-neutral-100 px-6 py-4 flex justify-between items-center z-10">
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold text-neutral-900 truncate">{company.name}</h2>
            <p className="text-[12px] text-neutral-500 mt-0.5">
              {company.domain || 'No domain on file'}{company.country ? ` · ${company.country}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex justify-between items-center">
            <div className="flex gap-4 text-[12.5px] text-neutral-500">
              <span><b className="text-neutral-900">{requirements?.length || 0}</b> requirements</span>
              <span><b className="text-neutral-900">{contacts?.length || 0}</b> hiring contacts</span>
              <span><b className="text-neutral-900">{tasks?.length || 0}</b> open tasks</span>
            </div>
            {canOfferDelete && (
              <button onClick={() => setShowDeleteDialog(true)} className="text-[12.5px] font-semibold text-danger-600 hover:text-danger-700 inline-flex items-center gap-1">
                <Trash2 className="w-3.5 h-3.5" /> Delete permanently
              </button>
            )}
          </div>

          {dependencyNotice && (
            <div role="alert" className="text-[12.5px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">
              {dependencyNotice}
            </div>
          )}

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13px] font-bold text-neutral-900">Hiring contacts</h3>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowDiscovery(v => !v)} className="btn-standard btn-compact">
                  <Radar className="w-3.5 h-3.5" /> Discover contacts
                </button>
                <button onClick={() => setShowAddContact(v => !v)} className="btn-standard btn-compact">
                  <UserPlus className="w-3.5 h-3.5" /> Link contact
                </button>
              </div>
            </div>
            {showDiscovery && (
              <DiscoveryPreviewPanel
                companyId={companyId}
                onClose={() => setShowDiscovery(false)}
                onDiscovered={async (message) => { showSuccess(message); await refreshAfterChange(); }}
                onError={(msg) => showError(msg)}
              />
            )}
            {showAddContact && (
              <AddHiringContactPanel
                companyId={companyId}
                onClose={() => setShowAddContact(false)}
                onAdded={async () => { setShowAddContact(false); showSuccess('Hiring contact linked'); await refreshAfterChange(); }}
                onError={(msg) => showError(msg)}
              />
            )}
            {(contacts?.length || 0) === 0 ? (
              <EmptyState icon={UserPlus} title="No hiring contacts yet" description="Link an existing CRM contact to this company." variant="true-empty" />
            ) : (
              <div className="space-y-2">
                {contacts.map(c => (
                  <div key={c.id} className="rounded-lg border border-neutral-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-neutral-900 text-[13px]">{[c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || 'Unnamed contact'}</p>
                        <p className="text-[11.5px] text-neutral-500 mt-0.5">{c.email || c.phone || 'No channel on file'}</p>
                      </div>
                      <StatusBadge status={c.relationship_stage} />
                    </div>
                    {(c.roles || []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {c.roles.map(r => <span key={r} className="badge-info text-[10px]">{r.replaceAll('_', ' ')}</span>)}
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500">
                      <span>{c.active_requirement_count || 0} active requirement(s){ownerName(c.owner_user_id) ? ` · owner ${ownerName(c.owner_user_id)}` : ''}</span>
                      {c.next_action && <span className="text-warning-700">{c.next_action}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-[13px] font-bold text-neutral-900 mb-2">Requirements</h3>
            {(requirements?.length || 0) === 0 ? (
              <EmptyState icon={Building2} title="No requirements yet" description="No job leads have been created for this company." variant="true-empty" />
            ) : (
              <div className="space-y-2">
                {requirements.map(r => (
                  <div key={r.id} className="rounded-lg border border-neutral-200 p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-neutral-900 text-[13px] truncate">{r.title}</p>
                      <p className="text-[11.5px] text-neutral-500 mt-0.5">
                        {r.location || '—'}{r.work_mode ? ` · ${r.work_mode}` : ''} · {r.positions || 1} position(s)
                        {r.source_first_name ? ` · source ${[r.source_first_name, r.source_last_name].filter(Boolean).join(' ')}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={r.stage || 'draft'} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-[13px] font-bold text-neutral-900 mb-2">Open work</h3>
            {(tasks?.length || 0) === 0 ? (
              <p className="text-[12px] text-neutral-400">No open tasks linked to this company.</p>
            ) : (
              <div className="space-y-1.5">
                {tasks.map(t => (
                  <div key={t.id} className="text-[12px] flex items-center justify-between border-l-2 border-warning-300 pl-2 py-1">
                    <span className="font-medium text-neutral-800">{t.title}</span>
                    <span className="text-neutral-500">{t.due_at ? new Date(t.due_at).toLocaleDateString() : 'No due date'}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-[13px] font-bold text-neutral-900 mb-2">Activity</h3>
            {(events?.length || 0) === 0 ? (
              <p className="text-[12px] text-neutral-400">No activity recorded yet.</p>
            ) : (
              <div className="space-y-1.5">
                {events.slice(0, 15).map(e => (
                  <div key={e.id} className="text-[11.5px] border-l-2 border-primary-200 pl-2 py-1">
                    <b>{e.event_type.replaceAll('_', ' ')}</b> · {new Date(e.occurred_at).toLocaleString()}{e.actor_name ? ` · ${e.actor_name}` : ''}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteDialog}
        title="Delete this company?"
        impactSummary={`This permanently deletes "${company.name}" and cannot be undone. Only allowed while it has zero requirements, hiring contacts and job signals.`}
        confirmLabel="Delete permanently"
        danger
        requireTypedName={company.name}
        requireReason
        loading={deleting}
        error={deleteError}
        onConfirm={deleteCompany}
        onCancel={() => { setShowDeleteDialog(false); setDeleteError(null); }}
      />
    </div>
  );
}

// Cost-gated preview/confirm discovery flow — same contract as the retired
// WizmatchContactIntelligencePage (POST .../discovery-preview then
// POST .../discover with confirmPreview:true), moved here since discovery is
// company-scoped and this is the company's natural detail view. Found
// candidates land in wizmatch_contact_candidates and show up on the Hiring
// Contacts page's discovery queue tab for review.
function DiscoveryPreviewPanel({ companyId, onClose, onDiscovered, onError }) {
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const runPreview = async () => {
    setPreviewing(true);
    setFeedback(null);
    setPreview(null);
    setConfirmed(false);
    try {
      const result = await apiFetch(`/api/wizmatch/contact-intelligence/companies/${companyId}/discovery-preview`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setPreview(result.preview || null);
      if (!result.preview?.eligible) setFeedback('Preview blocked — review the reasons below. No provider call was made.');
    } catch (e) {
      setFeedback(e.message || 'Discovery preview failed.');
    } finally {
      setPreviewing(false);
    }
  };

  const runDiscovery = async () => {
    if (!preview?.eligible || !confirmed) return;
    setRunning(true);
    setFeedback(null);
    try {
      const result = await apiFetch(`/api/wizmatch/contact-intelligence/companies/${companyId}/discover`, {
        method: 'POST',
        body: JSON.stringify({ confirmPreview: true }),
      });
      const count = result.contactCandidates?.length || 0;
      const cost = formatMinorCurrency(result.costCents, result.preview?.costGuard?.currency);
      onDiscovered(`Discovery ${result.status || 'completed'}: ${count} reviewable contact(s) found, ${cost} recorded cost. No outreach was sent.`);
    } catch (e) {
      const msg = e.message || 'Discovery run failed.';
      setFeedback(msg);
      onError(msg);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="card p-3 mb-3 space-y-2.5 bg-neutral-50/50">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-neutral-500">Preview is read-only — it shows eligibility, provider order and estimated cost without calling a provider.</p>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 shrink-0"><X className="w-4 h-4" /></button>
      </div>
      {feedback && (
        <div role="alert" className="text-[12px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">{feedback}</div>
      )}
      {!preview ? (
        <button onClick={runPreview} disabled={previewing} className="btn-standard btn-compact disabled:opacity-50">
          {previewing ? 'Preparing…' : 'Preview discovery'}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={preview.eligible ? 'badge-success' : 'badge-warning'}>
              {preview.status?.replaceAll('_', ' ') || (preview.eligible ? 'eligible' : 'blocked')}
            </span>
            <span className="badge-muted text-[11px]">Est. cost {formatMinorCurrency(preview.estimatedCostCents, preview.costGuard?.currency)}</span>
            <span className="badge-muted text-[11px]">Cooldown {preview.capStatus?.rediscoveryCooldownDays ?? 30}d</span>
          </div>
          <p className="text-[11.5px] text-neutral-500">
            Providers: {(preview.providerOrder || []).map(p => p.replaceAll('_', ' ')).join(' → ') || 'No provider path available'}
          </p>
          {(preview.blockedReasons || []).length > 0 && (
            <ul className="text-[11.5px] text-warning-700 list-disc list-inside">
              {preview.blockedReasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
          {preview.eligible && (
            <label className="flex items-center gap-2 text-[12px] text-neutral-600">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I've reviewed the cost and provider order — run this discovery now
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={runPreview} disabled={previewing} className="btn-standard btn-compact">Re-preview</button>
            {preview.eligible && (
              <button onClick={runDiscovery} disabled={running || !confirmed} className="btn-primary btn-compact disabled:opacity-50">
                {running ? 'Running…' : 'Run discovery'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AddHiringContactPanel({ companyId, onClose, onAdded, onError }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [roles, setRoles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set('search', search.trim());
        const data = await apiFetch(`/api/wizmatch/staffing/contacts?${params}`);
        if (!cancelled) setResults(data.items || []);
      } catch (e) {
        if (!cancelled) setFeedback(e.message || 'Search failed.');
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search]);

  const toggleRole = (role) => setRoles(r => r.includes(role) ? r.filter(x => x !== role) : [...r, role]);

  const link = async () => {
    if (!selected) { setFeedback({ kind: 'error', message: 'Select a CRM contact first.' }); return; }
    setSaving(true);
    setFeedback(null);
    try {
      await apiFetch(`/api/wizmatch/companies/${companyId}/contacts`, {
        method: 'POST',
        body: JSON.stringify({ contactId: selected.id, roles, relationshipStage: 'active' }),
      });
      onAdded();
    } catch (e) {
      const msg = e.message || 'Failed to link contact.';
      setFeedback({ kind: 'error', message: msg });
      onError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-3 mb-3 space-y-2.5 bg-neutral-50/50">
      <input
        placeholder="Search CRM contacts by name, company, email or phone…"
        value={search}
        onChange={e => { setSearch(e.target.value); setSelected(null); }}
        className="input w-full"
        autoFocus
      />
      {feedback && (
        <div role="alert" className="text-[12px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">
          {typeof feedback === 'string' ? feedback : feedback.message}
        </div>
      )}
      {searching ? (
        <p className="text-[12px] text-neutral-400">Searching…</p>
      ) : results.length === 0 ? (
        <p className="text-[12px] text-neutral-400">{search ? 'No CRM contacts match this search.' : 'Type to search CRM contacts.'}</p>
      ) : (
        <div className="max-h-40 overflow-y-auto space-y-1">
          {results.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r)}
              className={`w-full text-left text-[12.5px] px-2.5 py-1.5 rounded-md border ${selected?.id === r.id ? 'border-primary-500 bg-primary-50' : 'border-transparent hover:bg-neutral-100'}`}
            >
              <span className="font-medium">{[r.first_name, r.last_name].filter(Boolean).join(' ') || r.company_name || 'Unnamed'}</span>
              <span className="text-neutral-500"> · {r.email || r.phone || 'no channel'}</span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="flex flex-wrap gap-1.5">
          {COMPANY_CONTACT_ROLES.map(role => (
            <button
              key={role}
              type="button"
              onClick={() => toggleRole(role)}
              className={`text-[11px] font-semibold px-2 py-1 rounded-full border ${roles.includes(role) ? 'border-primary-500 text-primary-700 bg-primary-50' : 'border-neutral-200 text-neutral-500'}`}
            >
              {role.replaceAll('_', ' ')}
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-standard btn-compact">Cancel</button>
        <button onClick={link} disabled={saving || !selected} className="btn-primary btn-compact disabled:opacity-50">
          {saving ? 'Linking…' : 'Link as hiring contact'}
        </button>
      </div>
    </div>
  );
}
