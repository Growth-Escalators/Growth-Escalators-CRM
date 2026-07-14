import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Accessible confirmation modal for destructive/archival actions — replaces
 * native confirm()/prompt(). Traps focus, closes on Escape, requires an
 * explicit reason for destructive actions, and optionally requires the user
 * to type the record's name before the confirm button enables.
 *
 * Props:
 *   open            — boolean
 *   title           — e.g. "Delete this requirement?"
 *   impactSummary   — string or node describing what will happen / dependencies
 *   confirmLabel    — button text, e.g. "Delete permanently"
 *   danger          — boolean, styles the confirm button red
 *   requireTypedName — if set, user must type this exact string to enable confirm
 *   requireReason   — boolean, shows a required reason textarea
 *   loading         — boolean, disables actions and shows a loading state
 *   error           — string | null, shown as an inline Error+Retry-style banner
 *   onConfirm(reason) — called with the typed reason (or '' if not required)
 *   onCancel        — called on Escape / Cancel button
 */
export default function ConfirmDialog({
  open,
  title,
  impactSummary,
  confirmLabel = 'Confirm',
  danger = false,
  requireTypedName,
  requireReason = false,
  loading = false,
  error = null,
  onConfirm,
  onCancel,
}) {
  const [typedName, setTypedName] = useState('');
  const [reason, setReason] = useState('');
  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setTypedName('');
    setReason('');
    const t = setTimeout(() => firstFieldRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll(
          'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const nameMatches = !requireTypedName || typedName.trim() === requireTypedName;
  const reasonProvided = !requireReason || reason.trim().length > 0;
  const canConfirm = nameMatches && reasonProvided && !loading;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-[440px] max-w-full bg-white rounded-xl shadow-modal border border-neutral-200 overflow-hidden"
      >
        <div className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            {danger && <AlertTriangle className="w-5 h-5 text-danger-600 mt-0.5 flex-shrink-0" />}
            <h2 id="confirm-dialog-title" className="text-[15px] font-bold text-neutral-900">{title}</h2>
          </div>
          {impactSummary && (
            <div className="text-[12.5px] text-neutral-600 leading-relaxed">{impactSummary}</div>
          )}
          {error && (
            <div role="alert" className="text-[12.5px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">
              {error}
            </div>
          )}
          {requireReason && (
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider" htmlFor="confirm-dialog-reason">
                Reason (required)
              </label>
              <textarea
                id="confirm-dialog-reason"
                ref={requireTypedName ? undefined : firstFieldRef}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="input w-full mt-1 resize-y"
                placeholder="Why is this being removed?"
              />
            </div>
          )}
          {requireTypedName && (
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider" htmlFor="confirm-dialog-typed-name">
                Type <span className="font-mono text-neutral-800">{requireTypedName}</span> to confirm
              </label>
              <input
                id="confirm-dialog-typed-name"
                ref={firstFieldRef}
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                className="input w-full mt-1"
                autoComplete="off"
              />
            </div>
          )}
        </div>
        <div className="border-t border-neutral-100 px-5 py-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={loading} className="btn-standard">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={!canConfirm}
            className={`btn-primary disabled:opacity-50 ${danger ? 'bg-danger-600 hover:bg-danger-700 border-danger-600' : ''}`}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
