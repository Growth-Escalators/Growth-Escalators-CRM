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

  const push = useCallback((kind, message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => dismiss(id), 5000);
  }, [dismiss]);

  const value = {
    showSuccess: (message) => push('success', message),
    showError: (message) => push('error', message),
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
            <button type="button" onClick={() => dismiss(t.id)} className="ml-2 opacity-80 hover:opacity-100">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fail soft rather than crash a page that forgot to mount the provider —
    // this should never happen once AppLayout wraps it, but pages might be
    // unit-rendered in isolation during tests.
    return { showSuccess: () => {}, showError: () => {} };
  }
  return ctx;
}
