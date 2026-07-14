import React from 'react';
import ConfirmDialog from '../ConfirmDialog.jsx';

const VERBS = { withdraw: 'Withdraw', cancel: 'Cancel', reject: 'Reject', decline: 'Decline', revoke: 'Revoke' };

/**
 * Generic destructive-with-reason dialog reused across submissions,
 * interviews, offers and consents — withdraw a submission, cancel an
 * interview round, decline/withdraw an offer, revoke a consent. The shape
 * (danger + required reason, nothing else) is exactly ConfirmDialog's
 * existing contract, so this is a thin, intention-revealing wrapper rather
 * than a reimplementation.
 *
 * Props:
 *   action        — 'withdraw' | 'cancel' | 'reject' | 'decline' | 'revoke'
 *   entityLabel    — e.g. "this submission", "the Java Developer interview"
 *   impactSummary  — optional override of the default explanation
 *   onConfirm(reason) / onCancel — same contract as ConfirmDialog
 */
export default function WithdrawCancelDialog({
  open,
  action = 'withdraw',
  entityLabel = 'this record',
  impactSummary,
  loading = false,
  error = null,
  onConfirm,
  onCancel,
}) {
  const verb = VERBS[action] || 'Withdraw';
  return (
    <ConfirmDialog
      open={open}
      title={`${verb} ${entityLabel}?`}
      impactSummary={
        impactSummary
        || `This records a ${action} with a reason. It cannot be undone, but the full history stays visible in the activity timeline.`
      }
      confirmLabel={verb}
      danger
      requireReason
      loading={loading}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
