import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useDialogA11y } from './useDialogA11y.js';

/**
 * Shared visual + accessibility shell for Wizmatch staffing form dialogs —
 * same overlay/backdrop/focus-trap/Escape-to-close mechanics as ConfirmDialog,
 * but sized for multi-field forms instead of a single reason/typed-name input.
 *
 * `children` may be a render-prop `({ firstFieldRef }) => node` so the caller
 * can attach the ref to whichever field should receive initial focus.
 */
export default function DialogShell({ open, title, danger = false, width = 460, error, loading = false, onCancel, footer, children }) {
  const { dialogRef, firstFieldRef } = useDialogA11y(open, onCancel);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" role="presentation">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="wizmatch-dialog-title"
        style={{ width, maxWidth: '100%' }}
        className="bg-white rounded-xl shadow-modal border border-neutral-200 overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="px-5 py-4 border-b border-neutral-100 flex items-start gap-3 shrink-0">
          {danger && <AlertTriangle className="w-5 h-5 text-danger-600 mt-0.5 flex-shrink-0" />}
          <h2 id="wizmatch-dialog-title" className="text-[15px] font-bold text-neutral-900">{title}</h2>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
          {error && (
            <div role="alert" className="text-[12.5px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">
              {error}
            </div>
          )}
          {typeof children === 'function' ? children({ firstFieldRef, loading }) : children}
        </div>
        {footer && (
          <div className="border-t border-neutral-100 px-5 py-3 flex justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
