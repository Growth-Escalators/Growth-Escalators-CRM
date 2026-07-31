import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

const ToastContext = createContext(null);

/**
 * Minimal, honest toast system — never shows a success toast unless the
 * action actually succeeded (callers must only invoke showSuccess after an
 * awaited API call resolves without throwing).
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind, message, opts = {}) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, kind, message, action: opts.action }]);
    // An undoable toast stays up longer — 5s is not enough time to notice a
    // mistake, read the message and reach the button.
    setTimeout(() => dismiss(id), opts.action ? 9000 : 5000);
  }, [dismiss]);

  const value = {
    showSuccess: (message, opts) => push('success', message, opts),
    showError: (message, opts) => push('error', message, opts),
    // showUndoable('Archived 12 companies', () => restore())
    // The label is deliberately not configurable: "Undo" should mean the same
    // thing everywhere in the app.
    showUndoable: (message, onUndo) => push('success', message, { action: { label: 'Undo', onClick: onUndo } }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[80] flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`flex items-center gap-2 rounded-lg shadow-modal px-3 py-2.5 text-[12.5px] font-medium max-w-sm ${
              t.kind === 'success' ? 'bg-success-600 text-white' : 'bg-danger-600 text-white'
            }`}
          >
            {t.kind === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => { t.action.onClick(); dismiss(t.id); }}
                className="ml-1 shrink-0 rounded px-2 py-0.5 text-[12px] font-semibold underline underline-offset-2 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/70"
              >
                {t.action.label}
              </button>
            )}
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="ml-2 opacity-80 hover:opacity-100">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fail soft rather than crash a page unit-rendered in isolation during
    // tests. In the app itself this branch is unreachable: the provider is
    // mounted once in App.jsx around <Routes>, above every page including the
    // 27 that render their own bare <Sidebar/> shell instead of AppLayout.
    // It used to live inside AppLayout, so on those pages every toast silently
    // vanished — showSuccess was a no-op and nothing said so.
    return { showSuccess: () => {}, showError: () => {}, showUndoable: () => {} };
  }
  return ctx;
}
