import { useState, useEffect, useCallback } from 'react';
import { Shield, GitMerge, GitBranch } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import EmptyState from '../components/wizmatch/EmptyState.jsx';
import ErrorRetry from '../components/wizmatch/ErrorRetry.jsx';
import StatusBadge from '../components/wizmatch/StatusBadge.jsx';
import { useToast } from '../components/wizmatch/Toast.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { companyPolicyUiEnabled } from '../lib/companyPolicyFlag.js';

// PRD-005 §8.8, §12, §13 — duplicate-company review. A dedicated page rather
// than a drawer extension, since the comparison is inherently a two-company
// side-by-side layout (no existing page renders anything duplicate-related —
// verified before adding this route). Resolving a pair (Merge or Confirm
// Separate) does not migrate any company data — see duplicateService.ts's
// header comment for why that is a deliberate PR 4 scope limit, not an
// oversight.

const RESOLUTION_TABS = [
  { value: 'pending', label: 'Pending' },
  { value: 'merged', label: 'Merged' },
  { value: 'confirmed_separate', label: 'Confirmed separate' },
];

function CompanyCard({ company }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 flex-1 min-w-0">
      <p className="font-semibold text-neutral-900 text-[13px] truncate">{company.name || 'Unnamed company'}</p>
      <p className="text-[11.5px] text-neutral-500 mt-0.5">{company.domain || 'No domain on file'}</p>
    </div>
  );
}

export default function WizmatchDuplicateReviewPage() {
  // H-11 / D-38 fix: the API (`/api/wizmatch/companies/duplicates*`) already
  // 404s when WIZMATCH_COMPANY_POLICY_ENABLED is off, but this page, its
  // route and its nav entry had no flag check at all — the PR 4 marker's
  // claim that "both surfaces are behind the flag" was false. Gated the same
  // way CompanyPolicySection.jsx gates the company-drawer Policy section.
  if (!companyPolicyUiEnabled) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Shield}
          title="Duplicate Companies is not enabled"
          description="Set WIZMATCH_COMPANY_POLICY_ENABLED to turn on company-policy review, including duplicate resolution."
          variant="true-empty"
        />
      </div>
    );
  }
  return <WizmatchDuplicateReviewPageContent />;
}

function WizmatchDuplicateReviewPageContent() {
  const { showSuccess, showError } = useToast();
  const [resolution, setResolution] = useState('pending');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [dialog, setDialog] = useState(null); // { duplicateId, target: 'merged' | 'confirmed_separate' }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch(`/api/wizmatch/companies/duplicates?resolution=${resolution}`);
      setItems(data.duplicates || []);
    } catch (e) {
      setError(e.message || 'Failed to load duplicates');
    } finally {
      setLoading(false);
    }
  }, [resolution]);

  useEffect(() => { load(); }, [load]);

  const openDialog = (duplicateId, target) => {
    setDialog({ duplicateId, target });
  };

  // H-14 fix: the mandatory justification the reviewer types (`reason`) is
  // the free-text evidence; `reasonCode` is the machine-readable taxonomy
  // value the service now requires and previously never received (it was a
  // dead, always-empty piece of local state that was silently discarded
  // server-side too).
  const resolve = async (reason) => {
    if (!dialog) return;
    const reasonCode = dialog.target === 'merged' ? 'duplicate_confirmed_same_company' : 'duplicate_confirmed_separate_companies';
    setResolvingId(dialog.duplicateId);
    try {
      await apiFetch(`/api/wizmatch/companies/duplicates/${dialog.duplicateId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution: dialog.target, reasonCode, evidence: reason }),
      });
      showSuccess(dialog.target === 'merged' ? 'Marked as merged' : 'Confirmed as separate companies');
      setDialog(null);
      await load();
    } catch (e) {
      showError(e.message || 'Failed to resolve duplicate');
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-2.5 mb-1">
        <Shield className="w-5 h-5 text-neutral-700" />
        <h1 className="text-[20px] font-bold text-neutral-900 tracking-[-0.01em]">Duplicate Companies</h1>
      </div>
      <p className="text-[12.5px] text-neutral-500 mt-1 mb-5">
        Exact-after-normalisation duplicate suspects (PRD-005 §8.8). While a pair is pending, both companies are blocked from
        queueing and export — preparation still runs. Resolve as Merge (same real company) or Confirm Separate to lift
        containment.
      </p>

      <div className="flex items-center gap-1 mb-4 border-b border-neutral-100">
        {RESOLUTION_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setResolution(t.value)}
            className={`px-3 py-2 text-[12.5px] font-semibold border-b-2 -mb-px ${resolution === t.value ? 'border-primary-600 text-primary-700' : 'border-transparent text-neutral-500 hover:text-neutral-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorRetry message={error} onRetry={load} retrying={loading} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Shield}
          title={resolution === 'pending' ? 'No pending duplicates' : `No ${resolution.replace('_', ' ')} pairs`}
          description={resolution === 'pending' ? 'Nothing is currently blocked on a duplicate-suspect review.' : undefined}
          variant="true-empty"
        />
      ) : (
        <div className="space-y-3">
          {items.map((d) => (
            <div key={d.id} className="rounded-lg border border-neutral-200 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-[11.5px] text-neutral-500">
                  <StatusBadge status={d.resolution} />
                  <span>{d.detectionRule === 'domain' ? 'Same domain' : 'Normalised name match'}</span>
                </div>
                {d.resolution === 'pending' && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openDialog(d.id, 'merged')}
                      disabled={resolvingId === d.id}
                      className="btn-standard btn-compact"
                    >
                      <GitMerge className="w-3.5 h-3.5" /> Merge
                    </button>
                    <button
                      onClick={() => openDialog(d.id, 'confirmed_separate')}
                      disabled={resolvingId === d.id}
                      className="btn-standard btn-compact"
                    >
                      <GitBranch className="w-3.5 h-3.5" /> Confirm Separate
                    </button>
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <CompanyCard company={d.companyA} />
                <CompanyCard company={d.companyB} />
              </div>
              {d.resolution !== 'pending' && d.resolvedAt && (
                <p className="text-[11px] text-neutral-400 mt-2">
                  Resolved {new Date(d.resolvedAt).toLocaleString()}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {dialog && (
        <ConfirmDialog
          open
          title={dialog.target === 'merged' ? 'Mark as the same company?' : 'Confirm these are separate companies?'}
          impactSummary={
            dialog.target === 'merged'
              ? 'This lifts the duplicate-suspect containment on both companies. No company records, contacts or requirements are moved automatically.'
              : 'This lifts the duplicate-suspect containment on both companies; each keeps its own independent policy.'
          }
          confirmLabel={dialog.target === 'merged' ? 'Confirm merge' : 'Confirm separate'}
          requireReason
          loading={resolvingId === dialog.duplicateId}
          onConfirm={resolve}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
