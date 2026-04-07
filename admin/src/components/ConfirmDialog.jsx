import React from 'react';

export default function ConfirmDialog({ open, title, message, confirmLabel = 'Delete', confirmClass = 'bg-red-600 text-white', onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900 mb-2">{title}</h3>
        <p className="text-slate-600 text-sm mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
          <button onClick={onConfirm} className={`px-4 py-2 text-sm rounded-lg hover:opacity-90 ${confirmClass}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
