import { useState } from 'react';
import { useDialogA11y } from './useDialogA11y.js';

// PRD-005 PR 6 §13 — captures a reason code (and, for block/pause/reject,
// evidence/a review date) before a contextual Today action is submitted.
// Reused for both single-row and bulk-bar actions so the two paths behave
// identically. Evidence is REQUIRED for block/reject, matching the PRD's
// "Blocking and reclassifying require a structured reason code; evidence is
// required for block and for any admin override."
export default function TodayActionDialog({ open, action, targetLabel, defaultReasonCode, users = [], onCancel, onConfirm, submitting }) {
  const [reasonCode, setReasonCode] = useState(defaultReasonCode || '');
  const [reason, setReason] = useState('');
  const [evidenceText, setEvidenceText] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const { dialogRef, firstFieldRef } = useDialogA11y(open, onCancel);

  if (!open) return null;

  const isAssignOwner = action === 'assign_owner';
  const requiresEvidence = action === 'block' || action === 'reject';
  const requiresReviewDate = action === 'pause' || action === 'set_review_date';
  const canSubmit = isAssignOwner
    ? ownerUserId.trim().length > 0
    : reasonCode.trim().length > 0
      && (!requiresEvidence || evidenceText.trim().length > 0)
      && (!requiresReviewDate || reviewDate.trim().length > 0);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-900/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="today-action-dialog-title"
        className="card w-full max-w-md p-5"
      >
        <h2 id="today-action-dialog-title" className="text-[15px] font-bold text-neutral-900">
          {actionLabel(action)} — {targetLabel}
        </h2>

        <div className="mt-4 space-y-3">
          {isAssignOwner ? (
            <label className="block">
              <span className="text-[12px] font-semibold text-neutral-700">Account owner</span>
              <select
                ref={firstFieldRef}
                value={ownerUserId}
                onChange={(e) => setOwnerUserId(e.target.value)}
                aria-required="true"
                className="input-standard mt-1 w-full"
              >
                <option value="">Select an owner…</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          ) : (
            <label className="block">
              <span className="text-[12px] font-semibold text-neutral-700">Reason code</span>
              <input
                ref={firstFieldRef}
                type="text"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                aria-required="true"
                className="input-standard mt-1 w-full"
                placeholder="e.g. manual_block_by_operator"
              />
            </label>
          )}

          {!isAssignOwner && (
            <label className="block">
              <span className="text-[12px] font-semibold text-neutral-700">Note (optional)</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="input-standard mt-1 w-full"
                rows={2}
              />
            </label>
          )}

          {requiresEvidence && (
            <label className="block">
              <span className="text-[12px] font-semibold text-neutral-700">
                Evidence <span className="text-danger-600">(required)</span>
              </span>
              <textarea
                value={evidenceText}
                onChange={(e) => setEvidenceText(e.target.value)}
                aria-required="true"
                className="input-standard mt-1 w-full"
                rows={2}
                placeholder="Why is this blocked? A link, quote, or reference is required."
              />
            </label>
          )}

          {requiresReviewDate && (
            <label className="block">
              <span className="text-[12px] font-semibold text-neutral-700">
                Review date <span className="text-danger-600">(required)</span>
              </span>
              <input
                type="date"
                value={reviewDate}
                onChange={(e) => setReviewDate(e.target.value)}
                aria-required="true"
                className="input-standard mt-1 w-full"
              />
            </label>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-standard btn-compact">Cancel</button>
          <button
            type="button"
            disabled={!canSubmit || submitting}
            onClick={() => onConfirm(isAssignOwner ? { ownerUserId } : {
              reasonCode: reasonCode.trim(),
              reason: reason.trim() || undefined,
              evidenceKind: requiresEvidence ? 'human_text' : undefined,
              evidenceText: evidenceText.trim() || undefined,
              reviewDate: reviewDate || undefined,
            })}
            title={!canSubmit ? 'All required fields must be filled in.' : undefined}
            className="btn-primary btn-compact disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function actionLabel(action) {
  const labels = {
    approve_queue: 'Approve & Queue',
    skip: 'Skip for Now',
    pause: 'Pause',
    resume: 'Resume / Reclassify',
    block: 'Block',
    reject: 'Reject',
    assign_owner: 'Assign Owner',
    set_review_date: 'Set Review Date',
    merge: 'Merge',
    confirm_separate: 'Confirm Separate',
  };
  return labels[action] || action;
}
