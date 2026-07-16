import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, X, Trash2, CheckCircle2, XCircle, Link2 } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import EmptyState from '../components/wizmatch/EmptyState.jsx';
import ErrorRetry from '../components/wizmatch/ErrorRetry.jsx';
import StatusBadge from '../components/wizmatch/StatusBadge.jsx';
import { useToast } from '../components/wizmatch/Toast.jsx';
import DataTable from '../components/ui/DataTable.jsx';
import FilterBar from '../components/wizmatch/filters/FilterBar.jsx';
import { useTableControls } from '../components/wizmatch/filters/useTableControls.js';
import { exportRowsToCsv } from '../components/wizmatch/filters/exportCsv.js';

const RELATIONSHIP_STAGES = ['active', 'inactive', 'do_not_contact'];
const HC_ROLES = ['talent_acquisition', 'hiring_manager', 'coordinator', 'approver', 'interviewer', 'procurement', 'vendor_manager', 'source', 'other'];
const QUEUE_STATUSES = ['needs_review', 'approved', 'rejected', 'linked_to_crm'];
const optsHC = (arr) => arr.map((v) => ({ value: v, label: v.replaceAll('_', ' ') }));

const LINKED_FILTERS = [
  { key: 'q', label: 'Search', type: 'search', placeholder: 'Name, company, email…', fields: ['first_name', 'last_name', 'company_name', 'email', 'phone'] },
  { key: 'relationship_stage', label: 'Relationship', type: 'multiselect', options: optsHC(RELATIONSHIP_STAGES) },
  { key: 'roles', label: 'Role', type: 'multiselect', options: optsHC(HC_ROLES) },
  { key: 'active_reqs', label: 'Active reqs', type: 'numberRange', accessor: (r) => r.active_requirement_count },
  { key: 'has_next_action', label: 'Has next action', type: 'toggle', predicate: (r) => Boolean(r.next_action) },
];
const LINKED_COLUMNS = [
  { key: 'name', label: 'Contact', sortable: true, sortAccessor: (r) => [r.first_name, r.last_name].filter(Boolean).join(' '), exportValue: (r) => [r.first_name, r.last_name].filter(Boolean).join(' '),
    render: (c) => (<div><div className="font-medium text-neutral-900">{[c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unnamed contact'}</div><div className="text-[11px] text-neutral-500">{c.email || c.phone || '—'}</div></div>) },
  { key: 'company_name', label: 'Company', sortable: true, render: (c) => <span className="text-neutral-700">{c.company_name}</span> },
  { key: 'roles', label: 'Roles', exportValue: (c) => (c.roles || []).join('; '), render: (c) => ((c.roles || []).length ? <div className="flex flex-wrap gap-1">{c.roles.slice(0, 2).map(r => <span key={r} className="badge-info text-[10px]">{r.replaceAll('_', ' ')}</span>)}</div> : <span className="text-neutral-500">—</span>) },
  { key: 'relationship_stage', label: 'Relationship', sortable: true, render: (c) => <StatusBadge status={c.relationship_stage} /> },
  { key: 'active_requirement_count', label: 'Active reqs', sortable: true, exportValue: (c) => c.active_requirement_count || 0, render: (c) => <span className="tabular-nums">{c.active_requirement_count || 0}</span> },
  { key: 'next_action', label: 'Next action', render: (c) => <span className="text-warning-700 text-[11.5px]">{c.next_action || '—'}</span> },
];

const QUEUE_FILTERS = [
  { key: 'q', label: 'Search', type: 'search', placeholder: 'Name, title, company…', fields: ['name', 'title', 'companyName', 'email'] },
  { key: 'status', label: 'Status', type: 'multiselect', options: optsHC(QUEUE_STATUSES) },
  { key: 'roleCategory', label: 'Category', type: 'search', placeholder: 'Category…', fields: ['roleCategory'] },
  { key: 'confidenceTier', label: 'Confidence', type: 'search', placeholder: 'Confidence…', fields: ['confidenceTier'] },
  { key: 'reviewable', label: 'Reviewable only', type: 'toggle', predicate: (c) => c.deliverabilityStatus !== undefined },
];

const TABS = [
  { id: 'linked', label: 'Linked hiring contacts' },
  { id: 'queue', label: 'Discovery queue' },
];

export default function WizmatchHiringContactsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'queue' ? 'queue' : 'linked';
  // Switching tabs resets the query string (to just the tab) so one tab's filter
  // params never leak into the other's URL-backed state.
  const switchTab = (id) => setSearchParams(id === 'linked' ? {} : { tab: id }, { replace: true });

  return (
    <div className="p-6">
      <div className="flex items-center gap-2.5 mb-1">
        <h1 className="text-[20px] font-bold text-neutral-900 tracking-[-0.01em]">Hiring Contacts</h1>
      </div>
      <p className="text-[12.5px] text-neutral-500 mt-1 mb-4">
        People already linked to a company as a hiring contact, plus discovered candidates still waiting on review.
      </p>

      <div className="mb-5 flex gap-1">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => t.id !== activeTab && switchTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${
              activeTab === t.id ? 'bg-primary-700 text-white' : 'text-neutral-500 hover:bg-neutral-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'linked' ? <LinkedContactsTab /> : <DiscoveryQueueTab />}
    </div>
  );
}

// ============================================================
// Linked hiring contacts — wizmatch_company_contacts, aggregated across
// companies (there is no single cross-company list endpoint, so this fans
// out one request per company from the companies list).
// ============================================================

function LinkedContactsTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const ctl = useTableControls({ pageId: 'wizmatch-hiring-linked', spec: LINKED_FILTERS, columns: LINKED_COLUMNS });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const companies = await apiFetch('/api/wizmatch/staffing/companies');
      const perCompany = await Promise.all(
        (companies.items || []).map(async (company) => {
          try {
            const data = await apiFetch(`/api/wizmatch/companies/${company.id}/contacts`);
            return (data.items || []).map(c => ({ ...c, company_name: company.name }));
          } catch {
            return [];
          }
        }),
      );
      setRows(perCompany.flat());
    } catch (e) {
      setError(e.message || 'Failed to load hiring contacts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = ctl.applyClient(rows);

  return (
    <div>
      {error ? (
        <ErrorRetry message={error} onRetry={load} retrying={loading} />
      ) : (
        <>
          <FilterBar
            spec={LINKED_FILTERS}
            filters={ctl.filters}
            setFilter={ctl.setFilter}
            activeChips={ctl.activeChips}
            clearFilter={ctl.clearFilter}
            clearAll={ctl.clearAll}
            columns={LINKED_COLUMNS}
            hiddenColumns={ctl.hiddenColumns}
            toggleColumn={ctl.toggleColumn}
            onExport={() => exportRowsToCsv(filtered, ctl.visibleColumns, 'hiring-contacts.csv')}
            presets={ctl.presets}
            savePreset={ctl.savePreset}
            applyPreset={ctl.applyPreset}
            deletePreset={ctl.deletePreset}
          />
          <DataTable
            columns={ctl.visibleColumns}
            rows={filtered}
            rowKey="id"
            onRowClick={setSelected}
            loading={loading}
            emptyText={rows.length === 0 ? 'No hiring contacts linked yet — link a CRM contact from the Companies page, or approve a discovery candidate.' : 'No hiring contacts match these filters.'}
            sort={ctl.sort}
            onSort={ctl.setSort}
          />
        </>
      )}

      {selected && (
        <LinkedContactDetailDrawer
          companyContactId={selected.id}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function LinkedContactDetailDrawer({ companyContactId, onClose, onChanged }) {
  const { showSuccess, showError } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);
  const [relationshipStage, setRelationshipStage] = useState('active');
  const [nextAction, setNextAction] = useState('');
  const [nextActionDueAt, setNextActionDueAt] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await apiFetch(`/api/wizmatch/staffing/company-contacts/${companyContactId}`);
      setData(detail);
      setRelationshipStage(detail.contact.relationship_stage || 'active');
      setNextAction(detail.contact.next_action || '');
      setNextActionDueAt(detail.contact.next_action_due_at ? detail.contact.next_action_due_at.slice(0, 16) : '');
      setOwnerUserId(detail.contact.owner_user_id || '');
    } catch (e) {
      setError(e.message || 'Failed to load hiring contact');
    } finally {
      setLoading(false);
    }
  }, [companyContactId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiFetch('/api/wizmatch/staffing/users').then(d => setUsers(d.items || [])).catch(() => setUsers([]));
  }, []);

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await apiFetch(`/api/wizmatch/companies/${data.contact.company_id}/contacts/${companyContactId}`, {
        method: 'PUT',
        body: JSON.stringify({
          relationshipStage,
          ownerUserId: ownerUserId || null,
          nextAction: nextAction || null,
          nextActionDueAt: nextActionDueAt ? new Date(nextActionDueAt).toISOString() : null,
        }),
      });
      showSuccess('Hiring contact updated');
      await load();
      onChanged();
    } catch (e) {
      setFeedback(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    setDeactivating(true);
    setDeactivateError(null);
    try {
      await apiFetch(`/api/wizmatch/companies/${data.contact.company_id}/contacts/${companyContactId}`, { method: 'DELETE' });
      showSuccess('Hiring contact deactivated');
      onChanged();
      onClose();
    } catch (e) {
      setDeactivateError(e.message || 'Deactivate failed.');
    } finally {
      setDeactivating(false);
    }
  };

  // Permanent hard-delete of the hiring-contact relationship. The CRM contact
  // record itself is always kept — this only removes the person's link to this
  // company. Backend returns 409 when they still have an active attribution,
  // submission or interview; surface that and steer the user to Deactivate.
  const hardDelete = async (reason) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch(`/api/wizmatch/companies/${data.contact.company_id}/contacts/${companyContactId}/hard`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      showSuccess('Hiring contact deleted');
      onChanged();
      onClose();
    } catch (e) {
      setDeleteError(e.message || 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
        <div className="bg-white w-[560px] max-w-[95vw] h-full shadow-modal flex items-center justify-center" onClick={e => e.stopPropagation()}>
          <p className="text-neutral-500">Loading hiring contact…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
        <div className="bg-white w-[560px] max-w-[95vw] h-full shadow-modal p-6" onClick={e => e.stopPropagation()}>
          <div className="flex justify-end mb-4"><button onClick={onClose} className="text-neutral-500 hover:text-neutral-600"><X className="w-5 h-5" /></button></div>
          <ErrorRetry message={error} onRetry={load} retrying={loading} />
        </div>
      </div>
    );
  }

  if (!data) return null;
  const { contact, requirements, events, tasks } = data;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
      <div className="bg-white w-[560px] max-w-[95vw] h-full overflow-y-auto shadow-modal" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-neutral-100 px-6 py-4 flex justify-between items-center z-10">
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold text-neutral-900 truncate">{[contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unnamed contact'}</h2>
            <p className="text-[12px] text-neutral-500 mt-0.5">{contact.company_name}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-neutral-500 hover:text-neutral-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex flex-wrap gap-1.5">
            {(contact.roles || []).map(r => <span key={r} className="badge-info text-[10px]">{r.replaceAll('_', ' ')}</span>)}
            {!(contact.roles || []).length && <span className="text-[11.5px] text-neutral-500">No role tags on file</span>}
          </div>

          <div className="text-[12.5px] text-neutral-600 space-y-1">
            <div><b className="text-neutral-900">Email:</b> {contact.email || '—'}</div>
            <div><b className="text-neutral-900">Phone:</b> {contact.phone || '—'}</div>
            <div><b className="text-neutral-900">Seniority:</b> {contact.seniority || '—'}</div>
            <div><b className="text-neutral-900">Business unit:</b> {contact.business_unit || '—'}</div>
            <div><b className="text-neutral-900">Source:</b> {contact.source_type}{contact.source_confidence != null ? ` · confidence ${contact.source_confidence}` : ''}</div>
          </div>

          {feedback && (
            <div role="alert" className="text-[12.5px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">{feedback}</div>
          )}

          <div className="border-t border-neutral-100 pt-4 space-y-3">
            <h3 className="text-[13px] font-bold text-neutral-900">Coordination</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="hc-relationship-stage" className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Relationship stage</label>
                <select id="hc-relationship-stage" value={relationshipStage} onChange={e => setRelationshipStage(e.target.value)} className="input w-full mt-1">
                  {RELATIONSHIP_STAGES.map(s => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="hc-owner" className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Owner</label>
                <select id="hc-owner" value={ownerUserId} onChange={e => setOwnerUserId(e.target.value)} className="input w-full mt-1">
                  <option value="">Unassigned</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="hc-next-action" className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Dated next action</label>
              <input id="hc-next-action" value={nextAction} onChange={e => setNextAction(e.target.value)} className="input w-full mt-1" placeholder="e.g. Confirm interview slot for Java role" />
            </div>
            <div>
              <label htmlFor="hc-next-action-due" className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Due</label>
              <input id="hc-next-action-due" type="datetime-local" value={nextActionDueAt} onChange={e => setNextActionDueAt(e.target.value)} className="input w-full mt-1" />
            </div>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <button onClick={() => setShowDeactivateDialog(true)} className="text-[12.5px] font-semibold text-danger-600 hover:text-danger-700">
                  Deactivate relationship
                </button>
                <button onClick={() => { setDeleteError(null); setShowDeleteDialog(true); }} className="text-[12.5px] font-semibold text-danger-700 hover:text-danger-800">
                  Delete permanently
                </button>
              </div>
              <button onClick={save} disabled={saving} className="btn-primary btn-compact disabled:opacity-50">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>

          <section className="border-t border-neutral-100 pt-4">
            <h3 className="text-[13px] font-bold text-neutral-900 mb-2">Requirements supplied by this person</h3>
            {(requirements?.length || 0) === 0 ? (
              <p className="text-[12px] text-neutral-500">No requirements attributed to this person yet.</p>
            ) : (
              <div className="space-y-2">
                {requirements.map(r => (
                  <div key={r.id} className="rounded-lg border border-neutral-200 p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-neutral-900 text-[13px] truncate">{r.title}</p>
                      <p className="text-[11.5px] text-neutral-500 mt-0.5">
                        {r.contact_role}{r.is_primary_source ? ' · primary source' : ''}
                      </p>
                    </div>
                    <StatusBadge status={r.stage || 'draft'} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="border-t border-neutral-100 pt-4">
            <h3 className="text-[13px] font-bold text-neutral-900 mb-2">Open work</h3>
            {(tasks?.length || 0) === 0 ? (
              <p className="text-[12px] text-neutral-500">No open tasks linked to this person.</p>
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

          <section className="border-t border-neutral-100 pt-4">
            <h3 className="text-[13px] font-bold text-neutral-900 mb-2">Activity</h3>
            {(events?.length || 0) === 0 ? (
              <p className="text-[12px] text-neutral-500">No activity recorded yet.</p>
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

        {/* Must stay inside the stopPropagation() panel above — the outer
            backdrop's onClick={onClose} would otherwise catch bubbled clicks
            from inside ConfirmDialog (including Cancel) and close the whole
            drawer, not just the dialog. */}
        <ConfirmDialog
          open={showDeactivateDialog}
          title="Deactivate this hiring contact?"
          impactSummary="This marks the relationship inactive. It stays reversible — you can re-link the same CRM contact from the Companies page later. Blocked if this person still has an active requirement attribution."
          confirmLabel="Deactivate"
          loading={deactivating}
          error={deactivateError}
          onConfirm={deactivate}
          onCancel={() => { setShowDeactivateDialog(false); setDeactivateError(null); }}
        />

        <ConfirmDialog
          open={showDeleteDialog}
          title="Delete this hiring contact?"
          impactSummary={`This permanently removes ${[contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'this person'} as a hiring contact at ${contact.company_name}, including their role tags and inactive attributions. The underlying CRM contact record, its channels and history are kept. Blocked if they still have an active requirement attribution, a submission, or an interview — deactivate instead in that case.`}
          confirmLabel="Delete permanently"
          danger
          requireReason
          loading={deleting}
          error={deleteError}
          onConfirm={hardDelete}
          onCancel={() => { setShowDeleteDialog(false); setDeleteError(null); }}
        />
      </div>
    </div>
  );
}

// ============================================================
// Discovery queue — wizmatch_contact_candidates, pre-CRM-link. Scoped per
// candidate (buildContactIntelligenceResult already scopes reasons/evidence
// by candidate row, so two candidates at the same company never share state).
// ============================================================

const isLinked = (c) => c.status === 'linked_to_crm' || !!c.crmContactId;
// Rows computed live from internal CRM-contact matching (no discovery run or
// manual add has happened yet) carry a raw contacts.id as `id` — the review/
// link/delete routes below all look up wizmatch_contact_candidates by id and
// 404 on that. mapPersistedCandidate() always emits deliverabilityStatus (even
// as null); the live-computed shape never has the key, so its presence reliably
// tells the two apart.
const isPersisted = (c) => c.deliverabilityStatus !== undefined;

function DiscoveryQueueTab() {
  const { showSuccess, showError } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/api/wizmatch/contact-intelligence/queue?limit=50');
      const flattened = (data.items || []).flatMap(company =>
        (company.contactCandidates || []).map(candidate => ({
          ...candidate,
          companyId: company.companyId,
          companyName: company.companyName,
        })),
      );
      setItems(flattened);
    } catch (e) {
      setError(e.message || 'Failed to load the discovery queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const review = useCallback(async (candidate, action) => {
    setBusyId(candidate.id);
    try {
      await apiFetch(`/api/wizmatch/contact-intelligence/contacts/${candidate.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      showSuccess(action === 'approve_contact' ? 'Candidate approved' : 'Candidate rejected');
      await load();
      setSelected(null);
    } catch (e) {
      showError(e.message || 'Review action failed.');
    } finally {
      setBusyId(null);
    }
  }, [load, showSuccess, showError]);

  // Two-step: link the discovery candidate to a CRM contact, then attach that
  // CRM contact to the company as a hiring contact — the review endpoint only
  // does the first step (wizmatch_contact_candidates → contacts), it does not
  // create a wizmatch_company_contacts relationship on its own.
  const linkAndAttach = useCallback(async (candidate) => {
    setBusyId(candidate.id);
    try {
      const { crmContactId } = await apiFetch(`/api/wizmatch/contact-intelligence/contacts/${candidate.id}/link-crm-contact`, { method: 'POST' });
      try {
        await apiFetch(`/api/wizmatch/companies/${candidate.companyId}/contacts`, {
          method: 'POST',
          body: JSON.stringify({ contactId: crmContactId, relationshipStage: 'active' }),
        });
      } catch (attachError) {
        if (!/already linked/i.test(attachError.message || '')) throw attachError;
      }
      showSuccess('Candidate linked to CRM and attached as a hiring contact');
      await load();
      setSelected(null);
    } catch (e) {
      showError(e.message || 'Link failed.');
    } finally {
      setBusyId(null);
    }
  }, [load, showSuccess, showError]);

  const deleteCandidate = async (reason) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch(`/api/wizmatch/contact-intelligence/contacts/${deleteTarget.id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      showSuccess('Candidate deleted');
      setDeleteTarget(null);
      setSelected(null);
      await load();
    } catch (e) {
      setDeleteError(e.message || 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  };

  const columns = useMemo(() => [
    { key: 'name', label: 'Candidate', sortable: true, exportValue: (c) => c.name, render: (c) => (<div><div className="font-medium text-neutral-900">{c.name}</div><div className="text-[11px] text-neutral-500">{c.email || c.phone || '—'}</div></div>) },
    { key: 'title', label: 'Title', sortable: true, render: (c) => <span className="text-neutral-700">{c.title || '—'}</span> },
    { key: 'roleCategory', label: 'Category', sortable: true, render: (c) => <span className="text-neutral-500">{c.roleCategory || '—'}</span> },
    { key: 'companyName', label: 'Company', sortable: true, render: (c) => <span className="text-neutral-700">{c.companyName}</span> },
    { key: 'status', label: 'Status', sortable: true, render: (c) => <StatusBadge status={c.status} /> },
    { key: 'actions', label: 'Actions', exportable: false, render: (c) => (
      <div className="flex justify-end gap-1.5" onClick={e => e.stopPropagation()}>
        {!isPersisted(c) ? (
          <span className="text-[11px] text-neutral-500" title="This candidate is only computed from CRM contact matching so far — it has no discovery-run or manual-add record yet, so there is nothing to approve/reject/link/delete until one is created.">
            Not yet reviewable
          </span>
        ) : (
          <>
            {c.status === 'needs_review' && (
              <>
                <button disabled={busyId === c.id} onClick={() => review(c, 'approve_contact')} className="text-success-600 hover:text-success-700" title="Approve"><CheckCircle2 className="w-4 h-4" /></button>
                <button disabled={busyId === c.id} onClick={() => review(c, 'reject_contact')} className="text-danger-600 hover:text-danger-700" title="Reject"><XCircle className="w-4 h-4" /></button>
              </>
            )}
            {c.status === 'approved' && (
              <button disabled={busyId === c.id} onClick={() => linkAndAttach(c)} className="text-primary-700 hover:text-primary-800" title="Link to CRM and attach to company"><Link2 className="w-4 h-4" /></button>
            )}
            {!isLinked(c) && (
              <button disabled={busyId === c.id} onClick={() => setDeleteTarget(c)} className="text-neutral-500 hover:text-danger-600" title="Delete permanently"><Trash2 className="w-4 h-4" /></button>
            )}
          </>
        )}
      </div>
    ) },
  ], [busyId, review, linkAndAttach]);

  const ctl = useTableControls({ pageId: 'wizmatch-hiring-queue', spec: QUEUE_FILTERS, columns });
  const filtered = ctl.applyClient(items);

  return (
    <div>
      {error ? (
        <ErrorRetry message={error} onRetry={load} retrying={loading} />
      ) : (
        <>
          <FilterBar
            spec={QUEUE_FILTERS}
            filters={ctl.filters}
            setFilter={ctl.setFilter}
            activeChips={ctl.activeChips}
            clearFilter={ctl.clearFilter}
            clearAll={ctl.clearAll}
            columns={columns}
            hiddenColumns={ctl.hiddenColumns}
            toggleColumn={ctl.toggleColumn}
            onExport={() => exportRowsToCsv(filtered, ctl.visibleColumns, 'discovery-queue.csv')}
            presets={ctl.presets}
            savePreset={ctl.savePreset}
            applyPreset={ctl.applyPreset}
            deletePreset={ctl.deletePreset}
          />
          <DataTable
            columns={ctl.visibleColumns}
            rows={filtered}
            rowKey="id"
            onRowClick={setSelected}
            loading={loading}
            emptyText={items.length === 0 ? 'Discovery queue is empty — candidates appear once a company enters contact discovery.' : 'No candidates match these filters.'}
            sort={ctl.sort}
            onSort={ctl.setSort}
          />
        </>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={() => setSelected(null)}>
          <div className="bg-white w-[520px] max-w-[95vw] h-full overflow-y-auto shadow-modal" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-neutral-100 px-6 py-4 flex justify-between items-center z-10">
              <div className="min-w-0">
                <h2 className="text-[18px] font-bold text-neutral-900 truncate">{selected.name}</h2>
                <p className="text-[12px] text-neutral-500 mt-0.5">{selected.title || 'No title on file'} · {selected.companyName}</p>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="text-neutral-500 hover:text-neutral-600 shrink-0"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-2">
                <StatusBadge status={selected.status} />
                {selected.confidenceTier && <span className="badge-muted text-[11px]">confidence {selected.confidenceTier}</span>}
                {selected.deliverabilityStatus && <span className="badge-muted text-[11px]">{selected.deliverabilityStatus.replaceAll('_', ' ')}</span>}
              </div>

              <div className="text-[12.5px] text-neutral-600 space-y-1">
                <div><b className="text-neutral-900">Email:</b> {selected.email || '—'}</div>
                <div><b className="text-neutral-900">Phone:</b> {selected.phone || '—'}</div>
                <div><b className="text-neutral-900">LinkedIn:</b> {selected.linkedinUrl ? <a href={selected.linkedinUrl} target="_blank" rel="noreferrer" className="text-primary-700 underline">{selected.linkedinUrl}</a> : '—'}</div>
                <div><b className="text-neutral-900">Category:</b> {selected.roleCategory || '—'}</div>
                <div><b className="text-neutral-900">Team:</b> {selected.team || '—'}</div>
                <div><b className="text-neutral-900">Source:</b> {selected.source}{selected.sourceUrl ? <> · <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="text-primary-700 underline">evidence</a></> : ''}</div>
                {selected.rejectionReason && <div><b className="text-neutral-900">Rejection reason:</b> {selected.rejectionReason}</div>}
              </div>

              {(selected.reasons || []).length > 0 && (
                <div>
                  <h3 className="text-[13px] font-bold text-neutral-900 mb-1.5">Evidence reasons</h3>
                  <ul className="space-y-1">
                    {selected.reasons.map((reason, i) => <li key={i} className="text-[12px] text-neutral-500">{reason}</li>)}
                  </ul>
                </div>
              )}

              <div className="border-t border-neutral-100 pt-4">
                {!isPersisted(selected) ? (
                  <p className="text-[12px] text-neutral-500">
                    This candidate is only computed from CRM contact matching so far — it has no discovery-run or manual-add record yet, so there is nothing to approve, reject, link or delete until one is created.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {selected.status === 'needs_review' && (
                      <>
                        <button disabled={busyId === selected.id} onClick={() => review(selected, 'approve_contact')} className="btn-primary btn-compact">Approve</button>
                        <button disabled={busyId === selected.id} onClick={() => review(selected, 'reject_contact')} className="btn-standard btn-compact">Reject</button>
                      </>
                    )}
                    {selected.status === 'approved' && (
                      <button disabled={busyId === selected.id} onClick={() => linkAndAttach(selected)} className="btn-primary btn-compact">
                        {busyId === selected.id ? 'Linking…' : 'Link to CRM & attach to company'}
                      </button>
                    )}
                    {!isLinked(selected) && (
                      <button onClick={() => setDeleteTarget(selected)} className="text-[12.5px] font-semibold text-danger-600 hover:text-danger-700">
                        Delete permanently
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this candidate?"
        impactSummary={deleteTarget ? `This permanently deletes "${deleteTarget.name}" from the discovery queue. Only allowed while unlinked to a CRM contact.` : ''}
        confirmLabel="Delete permanently"
        danger
        requireReason
        loading={deleting}
        error={deleteError}
        onConfirm={deleteCandidate}
        onCancel={() => { setDeleteTarget(null); setDeleteError(null); }}
      />
    </div>
  );
}
