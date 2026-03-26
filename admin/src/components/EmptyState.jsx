import React from 'react';

export default function EmptyState({ icon: Icon, title, description, ctaLabel, ctaAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6">
      {Icon && (
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <Icon className="w-8 h-8 text-slate-400" />
        </div>
      )}
      <h3 className="text-base font-semibold text-slate-700 mb-1">{title}</h3>
      {description && <p className="text-sm text-slate-400 text-center max-w-sm">{description}</p>}
      {ctaLabel && ctaAction && (
        <button
          onClick={ctaAction}
          className="mt-5 px-5 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors"
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
