import { useEffect, useRef } from 'react';

// Shared accessibility mechanics for Wizmatch staffing dialogs — focus trap,
// Escape-to-close, auto-focus first field. Extracted from ConfirmDialog.jsx so
// every staffing dialog (Consent/Submission/Interview/Offer/WithdrawCancel)
// behaves identically instead of duplicating the same keydown handler five times.
//
// PR 8A hardening: two defects fixed, both live-behaviour, not cosmetic —
//   1. The focusable-elements query never excluded `:disabled`. A disabled
//      `<button>` still matches `button`, so if it happened to be the first or
//      last element in DOM order, Tab/Shift+Tab tried to `.focus()` it — which
//      browsers silently no-op on a disabled element — and the trap broke:
//      focus fell through to whatever the browser default was (often the
//      document body), letting keyboard navigation escape the open dialog.
//   2. Nothing restored focus to the element that opened the dialog once it
//      closed. A keyboard-only operator who opened a Today action dialog from
//      a card button, then closed it, had focus silently reset to the top of
//      the document — effectively losing their place in a long queue list.
export function useDialogA11y(open, onCancel) {
  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    // Capture whatever had focus right before this dialog opened, so it can
    // be restored on close rather than lost.
    previouslyFocusedRef.current = document.activeElement;
    const t = setTimeout(() => firstFieldRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      const toRestore = previouslyFocusedRef.current;
      if (toRestore && typeof toRestore.focus === 'function' && document.contains(toRestore)) {
        toRestore.focus();
      }
    };
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
          'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
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

  return { dialogRef, firstFieldRef };
}
