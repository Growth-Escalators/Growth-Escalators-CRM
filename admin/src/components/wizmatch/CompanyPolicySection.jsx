import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Pencil, History as HistoryIcon } from 'lucide-react';
import { apiFetch } from '../../lib/api.js';
import { getAuthUser } from '../../lib/auth.js';
import StatusBadge from './StatusBadge.jsx';
import { useToast } from './Toast.jsx';
import { companyPolicyUiEnabled } from '../../lib/companyPolicyFlag.js';

// PRD-005 §13 — the company drawer Policy section: effective policy per
// dimension with the supplying scope, all scoped rows, evidence, full
// history, owner, and review date. Approve/block/override actions are
// contextual and disabled with an inline reason rather than hidden — the
// PRD explicitly forbids silently hiding a disabled action (§13, resolves
// review H-10 for the analogous Today-page case).

const ELIGIBILITY_OPTIONS = ['eligible', 'needs_review', 'paused', 'blocked'];
const HIRING_POLICY_OPTIONS = [
  'accepts_external_vendors', 'fte_vendors_only', 'contract_vendors_only', 'preferred_vendors_only',
  'msp_vms_only', 'direct_hiring_only', 'no_external_agencies', 'unknown',
];
const RELATIONSHIP_OPTIONS = [
  'new_prospect', 'existing_prospect', 'existing_client', 'vendor_partner',
  'prime_partner', 'former_client', 'competitor', 'irrelevant',
];
const SCOPE_TYPE_OPTIONS = ['entire_company', 'region', 'business_unit', 'location'];
const EVIDENCE_KIND_OPTIONS = ['human_text', 'source_url', 'email_reply_ref', 'provider_event_ref', 'legal_document_ref', 'automated_detection'];

function scopeLabel(scopeKey) {
  if (!scopeKey || scopeKey === 'entire_company') return 'Entire company';
  return scopeKey.replace(':', ': ').replaceAll('_', ' ');
}

function DimensionRow({ label, dimension }) {
  if (!dimension) {
    return (
      <div className="flex items-center justify-between text-[12px] py-1">
        <span className="text-neutral-500">{label}</span>
        <span className="text-neutral-400">—</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between text-[12px] py-1">
      <span className="text-neutral-500">{label}</span>
      <div className="text-right">
        <StatusBadge status={dimension.value} />
        <div className="text-[10.5px] text-neutral-400 mt-0.5">from {scopeLabel(dimension.scopeKey)}</div>
      </div>
    </div>
  );
}

export default function CompanyPolicySection({ companyId, users, onChanged }) {
  const { showSuccess, showError } = useToast();
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showWriteForm, setShowWriteForm] = useState(false);
  const [showOwnerForm, setShowOwnerForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const role = getAuthUser()?.role;
  const canWrite = ['team_lead', 'admin'].includes(role);
  const canOverride = role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch(`/api/wizmatch/companies/${companyId}/policy`);
      if (!data || !data.effective) {
        throw new Error('Policy response was malformed.');
      }
      setView(data);
    } catch (e) {
      setError(e.message || 'Failed to load policy');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { if (companyPolicyUiEnabled) load(); }, [load]);

  if (!companyPolicyUiEnabled) return null;

  const refresh = async () => {
    await load();
    onChanged?.();
  };

  if (loading && !view) {
    return (
      <section>
        <h3 className="text-[13px] font-bold text-neutral-900 mb-2 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Policy</h3>
        <p className="text-[12px] text-neutral-500">Loading policy…</p>
      </section>
    );
  }

  if (error || !view) {
    return (
      <section>
        <h3 className="text-[13px] font-bold text-neutral-900 mb-2 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Policy</h3>
        <p className="text-[12px] text-danger-600">{error || 'Policy unavailable.'}</p>
      </section>
    );
  }

  const { effective, scoped = [], history = [], accountOwnerUserId = null } = view;
  const root = scoped.find((r) => r.scopeType === 'entire_company');
  const rootLocked = Boolean(root?.isNonOverridable);
  const ownerName = users.find((u) => u.id === accountOwnerUserId)?.name || null;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13px] font-bold text-neutral-900 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Policy</h3>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowHistory((v) => !v)} className="btn-standard btn-compact">
            <HistoryIcon className="w-3.5 h-3.5" /> History ({history.length})
          </button>
          {canWrite && (
            <button
              onClick={() => (rootLocked && !canOverride ? null : setShowWriteForm((v) => !v))}
              disabled={rootLocked && !canOverride}
              title={rootLocked && !canOverride ? 'The root scope is non-overridable; only an admin override can change it.' : undefined}
              className="btn-standard btn-compact disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Pencil className="w-3.5 h-3.5" /> {rootLocked ? 'Admin override' : 'Write policy'}
            </button>
          )}
        </div>
      </div>

      {effective.rootRow ? (
        <div className="rounded-lg border border-neutral-200 p-3">
          <DimensionRow label="Outreach eligibility" dimension={effective.outreachEligibility} />
          <DimensionRow label="Hiring policy" dimension={effective.externalHiringPolicy} />
          <DimensionRow label="Relationship" dimension={effective.relationshipType} />
          {root?.reviewDate && (
            <div className="flex items-center justify-between text-[12px] py-1 border-t border-neutral-100 mt-1 pt-1">
              <span className="text-neutral-500">Review date</span>
              <span className="text-neutral-700">{new Date(root.reviewDate).toLocaleDateString()}</span>
            </div>
          )}
          {root?.isNonOverridable && (
            <div className="text-[11px] text-danger-600 mt-1">
              Non-overridable{root.blockClass && root.blockClass !== 'standard' ? ` (${root.blockClass})` : ''} — only an admin
              override with evidence can change this.
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-danger-200 bg-danger-500/5 p-3 text-[12px] text-danger-700">
          No root policy row — this company denies at L0 (<code>policy_missing_root</code>). This should never happen for a
          company created after PR 2; if seen, it predates the bootstrap and needs the PR 4 backfill.
        </div>
      )}

      <div className="flex items-center justify-between text-[12px] mt-2">
        <span className="text-neutral-500">Account owner</span>
        <div className="flex items-center gap-2">
          <span className="text-neutral-800">{ownerName || 'Unassigned'}</span>
          {canWrite && (
            <button onClick={() => setShowOwnerForm((v) => !v)} className="text-primary-600 hover:text-primary-700 font-semibold">
              Change
            </button>
          )}
        </div>
      </div>

      {showOwnerForm && (
        <AssignOwnerForm
          companyId={companyId}
          users={users}
          onDone={async (msg) => { setShowOwnerForm(false); showSuccess(msg); await refresh(); }}
          onError={(msg) => showError(msg)}
        />
      )}

      {showWriteForm && (
        <PolicyWriteForm
          companyId={companyId}
          asOverride={rootLocked}
          submitting={submitting}
          setSubmitting={setSubmitting}
          onDone={async (msg) => { setShowWriteForm(false); showSuccess(msg); await refresh(); }}
          onError={(msg) => showError(msg)}
        />
      )}

      {scoped.length > 1 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold text-neutral-500 mb-1">Scoped rows ({scoped.length})</p>
          <div className="space-y-1.5">
            {scoped.map((row) => (
              <div key={row.id} className="text-[11.5px] border-l-2 border-primary-200 pl-2 py-1">
                <b>{scopeLabel(row.scopeKey)}</b>
                {row.outreachEligibility && <> · eligibility <StatusBadge status={row.outreachEligibility} /></>}
                {row.reasonCode && <span className="text-neutral-500"> · {row.reasonCode.replaceAll('_', ' ')}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {showHistory && (
        <div className="mt-3">
          {history.length === 0 ? (
            <p className="text-[12px] text-neutral-500">No policy changes recorded yet.</p>
          ) : (
            <div className="space-y-1.5">
              {history.map((h) => (
                <div key={h.id} className="text-[11.5px] border-l-2 border-neutral-200 pl-2 py-1">
                  <b>{(h.reasonCode || '').replaceAll('_', ' ')}</b> · {new Date(h.createdAt).toLocaleString()}
                  {h.reason && <div className="text-neutral-500">{h.reason}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AssignOwnerForm({ companyId, users, onDone, onError }) {
  const [ownerUserId, setOwnerUserId] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/wizmatch/companies/${companyId}/owner`, {
        method: 'POST',
        body: JSON.stringify({ accountOwnerUserId: ownerUserId || null }),
      });
      onDone('Account owner updated');
    } catch (e) {
      onError(e.message || 'Failed to assign owner');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-neutral-200 p-3 flex items-center gap-2">
      <select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} className="input-standard flex-1">
        <option value="">Unassigned</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <button onClick={submit} disabled={saving} className="btn-primary btn-compact">{saving ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

function PolicyWriteForm({ companyId, asOverride, submitting, setSubmitting, onDone, onError }) {
  const [scopeType, setScopeType] = useState('entire_company');
  const [scopeRefLabel, setScopeRefLabel] = useState('');
  const [outreachEligibility, setOutreachEligibility] = useState('');
  const [externalHiringPolicy, setExternalHiringPolicy] = useState('');
  const [relationshipType, setRelationshipType] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [reason, setReason] = useState('');
  const [isNonOverridable, setIsNonOverridable] = useState(false);
  const [isPermanent, setIsPermanent] = useState(false);
  const [blockClass, setBlockClass] = useState('standard');
  const [reviewDate, setReviewDate] = useState('');
  const [evidenceKind, setEvidenceKind] = useState('human_text');
  const [evidenceText, setEvidenceText] = useState('');

  const submit = async () => {
    setSubmitting(true);
    try {
      const body = {
        scopeType,
        scopeRefLabel: ['region', 'business_unit', 'location'].includes(scopeType) ? scopeRefLabel : undefined,
        outreachEligibility: outreachEligibility || undefined,
        externalHiringPolicy: scopeType === 'entire_company' ? (externalHiringPolicy || undefined) : undefined,
        relationshipType: scopeType === 'entire_company' ? (relationshipType || undefined) : undefined,
        reasonCode: asOverride ? undefined : reasonCode,
        reason: reason || undefined,
        isNonOverridable,
        isPermanent,
        blockClass,
        reviewDate: reviewDate || undefined,
        evidenceKind,
        evidenceText: evidenceText || undefined,
      };
      const path = asOverride
        ? `/api/wizmatch/companies/${companyId}/policy/override`
        : `/api/wizmatch/companies/${companyId}/policy`;
      await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
      onDone(asOverride ? 'Policy overridden' : 'Policy updated');
    } catch (e) {
      onError(e.message || 'Failed to write policy');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-neutral-200 p-3 space-y-2">
      {!asOverride && (
        <select value={scopeType} onChange={(e) => setScopeType(e.target.value)} className="input-standard w-full">
          {SCOPE_TYPE_OPTIONS.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
        </select>
      )}
      {!asOverride && ['region', 'business_unit', 'location'].includes(scopeType) && (
        <input
          value={scopeRefLabel}
          onChange={(e) => setScopeRefLabel(e.target.value)}
          placeholder={scopeType === 'region' ? 'india or us' : 'label, e.g. bengaluru'}
          className="input-standard w-full"
        />
      )}
      <select value={outreachEligibility} onChange={(e) => setOutreachEligibility(e.target.value)} className="input-standard w-full">
        <option value="">Outreach eligibility — unchanged / inherit</option>
        {ELIGIBILITY_OPTIONS.map((o) => <option key={o} value={o}>{o.replaceAll('_', ' ')}</option>)}
      </select>
      {(asOverride || scopeType === 'entire_company') && (
        <>
          <select value={externalHiringPolicy} onChange={(e) => setExternalHiringPolicy(e.target.value)} className="input-standard w-full">
            <option value="">Hiring policy — unchanged</option>
            {HIRING_POLICY_OPTIONS.map((o) => <option key={o} value={o}>{o.replaceAll('_', ' ')}</option>)}
          </select>
          <select value={relationshipType} onChange={(e) => setRelationshipType(e.target.value)} className="input-standard w-full">
            <option value="">Relationship — unchanged</option>
            {RELATIONSHIP_OPTIONS.map((o) => <option key={o} value={o}>{o.replaceAll('_', ' ')}</option>)}
          </select>
        </>
      )}
      {!asOverride && (
        <input value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} placeholder="Reason code (required, §9 taxonomy)" className="input-standard w-full" />
      )}
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional free text)" className="input-standard w-full" rows={2} />
      <div className="flex items-center gap-4 text-[12px]">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={isNonOverridable} onChange={(e) => setIsNonOverridable(e.target.checked)} /> Non-overridable</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={isPermanent} onChange={(e) => setIsPermanent(e.target.checked)} /> Permanent</label>
      </div>
      <select value={blockClass} onChange={(e) => setBlockClass(e.target.value)} className="input-standard w-full">
        <option value="standard">Block class: standard</option>
        <option value="compliance">Block class: compliance</option>
        <option value="legal">Block class: legal</option>
      </select>
      <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className="input-standard w-full" />
      <div className="grid grid-cols-2 gap-2">
        <select value={evidenceKind} onChange={(e) => setEvidenceKind(e.target.value)} className="input-standard">
          {EVIDENCE_KIND_OPTIONS.map((o) => <option key={o} value={o}>{o.replaceAll('_', ' ')}</option>)}
        </select>
        <input value={evidenceText} onChange={(e) => setEvidenceText(e.target.value)} placeholder="Evidence text" className="input-standard" />
      </div>
      <p className="text-[10.5px] text-neutral-400">
        A permanent or non-overridable row requires evidence — the server rejects the write otherwise (PRD-005 §10.1 D-7).
      </p>
      <button onClick={submit} disabled={submitting || (!asOverride && !reasonCode)} className="btn-primary btn-compact">
        {submitting ? 'Saving…' : asOverride ? 'Submit override' : 'Save policy'}
      </button>
    </div>
  );
}
