import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Clock, MessageSquareWarning, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../lib/api.js';
import { useToast } from './Toast.jsx';
import ErrorRetry from './ErrorRetry.jsx';
import EmptyState from './EmptyState.jsx';
import StatusBadge from './StatusBadge.jsx';
import DataTable from '../ui/DataTable.jsx';
import TodayActionDialog from './TodayActionDialog.jsx';
import TodayBulkActionBar from './TodayBulkActionBar.jsx';

// PRD-005 PR 6 §13 — the Decision Workbench. Re-buckets WizMatch Today into
// four canonical queues fed entirely by GET /api/wizmatch/today/queues
// (which itself derives every decision from the canonical policy resolver,
// src/modules/outreach/outreachGate.ts — this component creates no
// eligibility logic of its own; it only presents what the API already
// decided and lets an operator act on it via POST /api/wizmatch/today/actions).

const QUEUE_META = {
  readyToContact: { label: 'Ready to Contact', icon: CheckCircle2, tone: 'success' },
  needsReview: { label: 'Needs Review', icon: Clock, tone: 'warning' },
  pausedOrBlocked: { label: 'Paused or Blocked', icon: Ban, tone: 'danger' },
};

// Which contextual actions are OFFERED for a bulk (multi-select) operation on
// each queue. Only combinations that are safe and make sense together are
// exposed — e.g. `merge`/`confirm_separate` never appear here because they
// require every selected row to share the SAME pending-duplicate id, which a
// multi-company selection cannot guarantee; those stay single-row-only.
const BULK_ACTIONS_BY_QUEUE = {
  readyToContact: ['approve_queue', 'skip', 'pause', 'block', 'assign_owner', 'set_review_date'],
  needsReview: ['approve_queue', 'skip', 'pause', 'block', 'assign_owner', 'set_review_date'],
  pausedOrBlocked: ['resume', 'block', 'assign_owner', 'set_review_date'],
};

// D-31: `effectiveDecision` is the decision the API actually bucketed and
// gated this row on — it equals `canonicalDecision` under `enforce` and
// follows the stored policy row in shadow, so shadow mode never removes an
// affordance. `canonicalDecision` is shown as metadata but must never drive
// which actions exist, or shadow would silently block through the UI.
function effectiveDecisionOf(item) {
  return item.effectiveDecision || item.canonicalDecision;
}

function primaryActionFor(item) {
  if (effectiveDecisionOf(item) === 'deny') {
    return item.isNonOverridable ? null : { action: 'resume', label: 'Reclassify' };
  }
  if (item.duplicatePending) return { action: 'merge', label: 'Merge' };
  return { action: 'approve_queue', label: 'Approve & Queue' };
}

function CompanyCard({ item, onAction }) {
  const primary = primaryActionFor(item);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-neutral-900">{item.companyName}</span>
        {item.companyDomain && <span className="text-[11px] text-neutral-500">{item.companyDomain}</span>}
        <StatusBadge status={effectiveDecisionOf(item)} label={effectiveDecisionOf(item)} />
        {item.duplicatePending && <StatusBadge status="pending" label="possible duplicate" />}
        {/* D-31 disclosure: in shadow the canonical resolver may disagree with the
            stored policy row. Show that difference explicitly rather than either
            hiding it or letting it silently change the row's actions. */}
        {item.canonicalDecision && item.canonicalDecision !== effectiveDecisionOf(item) && (
          <StatusBadge status="pending" label={`shadow: would ${item.canonicalDecision}`} />
        )}
      </div>
      <p className="text-[12px] text-neutral-500">
        {item.outreachEligibility ? `Eligibility: ${item.outreachEligibility.replaceAll('_', ' ')}` : ''}
        {item.canonicalReasonCode ? ` · Reason: ${item.canonicalReasonCode.replaceAll('_', ' ')}` : ' · No reason code on file.'}
        {item.policyScopeKey ? ` · scope: ${item.policyScopeKey}` : ''}
        {item.contactConfidenceTier ? ` · contact confidence: ${item.contactConfidenceTier}` : ' · no contact identified'}
      </p>
      {item.requiresExplicitApproval && (
        <p className="text-[11.5px] text-warning-700">Requires explicit approval before queueing or export.</p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {primary ? (
          <button
            type="button"
            onClick={() => onAction(primary.action, item)}
            className="btn-primary btn-compact"
          >
            {primary.label}
          </button>
        ) : (
          <span
            className="text-[11.5px] text-neutral-500"
            title={item.disabledReason || 'No action is available at any scope for a non-overridable block.'}
          >
            No action available
          </span>
        )}
        {item.duplicatePending && (
          <button type="button" onClick={() => onAction('confirm_separate', item)} className="btn-standard btn-compact">
            Confirm Separate
          </button>
        )}
        <button type="button" onClick={() => onAction('assign_owner', item)} className="btn-standard btn-compact">
          Assign Owner
        </button>
        <button type="button" onClick={() => onAction('set_review_date', item)} className="btn-standard btn-compact">
          Set Review Date
        </button>
        {effectiveDecisionOf(item) !== 'deny' && (
          <>
            <button type="button" onClick={() => onAction('pause', item)} className="btn-standard btn-compact">Pause</button>
            <button type="button" onClick={() => onAction('block', item)} className="btn-standard btn-compact">Block</button>
            <button type="button" onClick={() => onAction('skip', item)} className="btn-standard btn-compact">Skip for Now</button>
          </>
        )}
        {item.disabledReason && (
          <span className="text-[11px] text-neutral-500" title={item.disabledReason} aria-label={`Disabled: ${item.disabledReason}`}>
            <AlertTriangle className="inline w-3 h-3 mr-0.5 -mt-0.5" aria-hidden="true" />
            {item.disabledReason}
          </span>
        )}
      </div>
    </div>
  );
}

function QueueSection({ queueKey, items, selectedIds, onToggleRow, onToggleAll, onAction, loading }) {
  const meta = QUEUE_META[queueKey];
  const Icon = meta.icon;
  const columns = useMemo(() => [
    {
      key: 'company',
      label: 'Company',
      render: (row) => <CompanyCard item={row} onAction={onAction} />,
    },
  ], [onAction]);

  const rows = items.map((item) => ({ ...item, id: item.companyId, rowAriaLabel: `Select ${item.companyName}` }));

  return (
    <section className="card p-4" aria-labelledby={`queue-heading-${queueKey}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-neutral-500" aria-hidden="true" />
        <h2 id={`queue-heading-${queueKey}`} className="font-bold text-neutral-900 text-[13.5px]">{meta.label}</h2>
        <span className="badge-muted text-[11px]">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-neutral-500">Nothing here right now.</p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="id"
          selectedIds={selectedIds}
          onToggleRow={onToggleRow}
          onToggleAll={onToggleAll}
          loading={loading}
          emptyText="Nothing here right now."
        />
      )}
    </section>
  );
}

function ReplyRow({ item }) {
  return (
    <a
      href={item.companyId ? `/wizmatch/companies?id=${item.companyId}` : '/wizmatch/companies'}
      className="flex items-center justify-between gap-3 rounded-md border border-neutral-100 bg-white px-3 py-2.5 hover:border-primary-300 transition"
    >
      <div className="min-w-0">
        <span className="font-medium text-neutral-900 truncate">{item.companyName || 'Unknown company'}</span>
        <p className="text-[12px] text-neutral-500 truncate">State: {item.state.replaceAll('_', ' ')}</p>
      </div>
      <div className="text-right shrink-0 text-[11px] text-neutral-500">
        {item.stateAt ? new Date(item.stateAt).toLocaleString() : ''}
      </div>
    </a>
  );
}

const EMPTY_QUEUES = { readyToContact: [], needsReview: [], pausedOrBlocked: [], repliesNeedingAction: [], counts: {}, partial: { skippedCompanyIds: [], skippedEnrolmentIds: [] } };

export default function TodayDecisionWorkbench() {
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState(null);
  const [queues, setQueues] = useState(EMPTY_QUEUES);
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState({ readyToContact: new Set(), needsReview: new Set(), pausedOrBlocked: new Set() });
  const [dialog, setDialog] = useState(null); // { action, targets: [{type,id}], targetLabel, defaultReasonCode }
  const [submitting, setSubmitting] = useState(false);
  const { showSuccess, showError } = useToast();

  const load = useCallback(async (isRetry = false) => {
    if (isRetry) setRetrying(true); else setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/api/wizmatch/today/queues?limit=200');
      setQueues(data);
      setSelected({ readyToContact: new Set(), needsReview: new Set(), pausedOrBlocked: new Set() });
    } catch (e) {
      setError(e.message || 'Failed to load the decision workbench.');
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiFetch('/api/wizmatch/staffing/users').then((d) => setUsers(d.items || [])).catch(() => setUsers([]));
  }, []);

  const toggleRow = (queueKey) => (id) => {
    setSelected((prev) => {
      const next = new Set(prev[queueKey]);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...prev, [queueKey]: next };
    });
  };
  const toggleAll = (queueKey, ids) => () => {
    setSelected((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev[queueKey].has(id));
      return { ...prev, [queueKey]: allSelected ? new Set() : new Set(ids) };
    });
  };

  const openDialogForSingle = (action, item) => {
    setDialog({
      action,
      targets: [{ type: action === 'merge' || action === 'confirm_separate' ? 'duplicate' : 'company', id: action === 'merge' || action === 'confirm_separate' ? item.duplicateId : item.companyId }],
      targetLabel: item.companyName,
    });
  };

  const openDialogForBulk = (queueKey, action) => {
    const ids = [...selected[queueKey]];
    setDialog({
      action,
      targets: ids.map((id) => ({ type: 'company', id })),
      targetLabel: `${ids.length} companies`,
    });
  };

  const submitAction = async (extra) => {
    if (!dialog) return;
    setSubmitting(true);
    try {
      const outcome = await apiFetch('/api/wizmatch/today/actions', {
        method: 'POST',
        body: JSON.stringify({ action: dialog.action, targets: dialog.targets, ...extra }),
      });
      const failed = outcome.results.filter((r) => !r.ok);
      if (failed.length === 0) {
        showSuccess(`${outcome.succeeded} of ${outcome.requested} succeeded.`);
      } else if (outcome.succeeded > 0) {
        showError(`${outcome.succeeded} succeeded, ${failed.length} failed: ${failed.map((f) => f.error).slice(0, 2).join('; ')}`);
      } else {
        showError(`All ${failed.length} failed: ${failed.map((f) => f.error).slice(0, 2).join('; ')}`);
      }
      setDialog(null);
      await load();
    } catch (e) {
      showError(e.message || 'Action failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="card p-8 text-center text-neutral-500">Loading the decision workbench…</div>;
  }
  if (error) {
    return <ErrorRetry message={error} onRetry={() => load(true)} retrying={retrying} />;
  }

  const totalDecisions = (queues.readyToContact?.length || 0) + (queues.needsReview?.length || 0)
    + (queues.repliesNeedingAction?.length || 0) + (queues.pausedOrBlocked?.length || 0);
  const skipped = (queues.partial?.skippedCompanyIds?.length || 0) + (queues.partial?.skippedEnrolmentIds?.length || 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] text-neutral-500">Every decision below is derived from the canonical WizMatch outreach policy.</p>
        <button onClick={() => load()} className="btn-standard btn-compact" aria-label="Refresh decision queues">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh
        </button>
      </div>

      {skipped > 0 && (
        <div role="alert" className="card p-3 border-warning-500/30 bg-warning-500/10 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-warning-700 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-[12.5px] text-warning-800">
            {skipped} item(s) could not be evaluated and were left out of the queues below (malformed data). Try Refresh, and contact an admin if this persists.
          </p>
        </div>
      )}

      {totalDecisions === 0 && (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing needs a decision right now"
          description="Companies appear here once they have a policy row, a signal, or a reply that needs your attention."
        />
      )}

      {(['readyToContact', 'needsReview', 'pausedOrBlocked']).map((queueKey) => (
        <div key={queueKey} className="relative">
          <QueueSection
            queueKey={queueKey}
            items={queues[queueKey] || []}
            selectedIds={selected[queueKey]}
            onToggleRow={toggleRow(queueKey)}
            onToggleAll={toggleAll(queueKey, (queues[queueKey] || []).map((i) => i.companyId))}
            onAction={openDialogForSingle}
            loading={false}
          />
          {selected[queueKey].size > 0 && (
            <TodayBulkActionBar
              count={selected[queueKey].size}
              actions={BULK_ACTIONS_BY_QUEUE[queueKey] || []}
              onClear={() => setSelected((prev) => ({ ...prev, [queueKey]: new Set() }))}
              onAction={(action) => openDialogForBulk(queueKey, action)}
            />
          )}
        </div>
      ))}

      <section className="card p-4" aria-labelledby="queue-heading-replies">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquareWarning className="w-4 h-4 text-neutral-500" aria-hidden="true" />
          <h2 id="queue-heading-replies" className="font-bold text-neutral-900 text-[13.5px]">Replies Needing Action</h2>
          <span className="badge-muted text-[11px]">{queues.repliesNeedingAction?.length || 0}</span>
        </div>
        {(queues.repliesNeedingAction || []).length === 0 ? (
          <p className="text-[12.5px] text-neutral-500">No live conversations waiting on a response.</p>
        ) : (
          <div className="space-y-2">
            {queues.repliesNeedingAction.map((item) => <ReplyRow key={item.enrolmentId} item={item} />)}
          </div>
        )}
      </section>

      {dialog && (
        <TodayActionDialog
          open
          action={dialog.action}
          targetLabel={dialog.targetLabel}
          defaultReasonCode={dialog.action === 'merge' || dialog.action === 'confirm_separate' ? 'manual_reclassified' : undefined}
          users={users}
          submitting={submitting}
          onCancel={() => setDialog(null)}
          onConfirm={submitAction}
        />
      )}
    </div>
  );
}
