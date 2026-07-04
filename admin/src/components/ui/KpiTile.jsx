import React from 'react';

/**
 * Fluent KPI tile — blue accent line on top, 28px number,
 * trend arrow in success/danger.
 *
 * <KpiTile label="Monthly MRR" value="₹8.4L" trend={+8.1} trendLabel="vs June" />
 * <KpiTile label="Outstanding" value="₹2.1L" accent="accent" trend={-3} trendLabel="3 overdue" />
 */
export default function KpiTile({
  label,
  value,
  sub,
  trend = null,        // number: positive = up/green, negative = down/red
  trendLabel = '',
  accent = 'primary',  // 'primary' | 'accent'
  onClick,
}) {
  const up = trend != null && trend >= 0;
  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden bg-white border border-neutral-200 rounded-lg shadow-card
        px-5 py-4 transition-shadow duration-200 ${onClick ? 'cursor-pointer hover:shadow-hover' : ''}`}
    >
      <span className={`absolute top-0 inset-x-0 h-[3px] ${accent === 'accent' ? 'bg-accent-500' : 'bg-primary-500'}`} />
      <p className="text-[12.5px] font-medium text-neutral-500 mb-1.5">{label}</p>
      <p className="text-[28px] leading-none font-bold text-neutral-900 tracking-tight">{value}</p>
      {(trend != null || sub) && (
        <p className={`mt-2 text-xs font-semibold flex items-center gap-1
          ${trend == null ? 'text-neutral-400 font-normal' : up ? 'text-success-600' : 'text-danger-600'}`}
        >
          {trend != null && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={up ? '' : 'rotate-180'}>
              <path d="m5 12 7-7 7 7" /><path d="M12 19V5" />
            </svg>
          )}
          {trend != null ? `${up ? '+' : ''}${trend}%` : null}
          <span className="text-neutral-400 font-normal">{trendLabel || sub}</span>
        </p>
      )}
    </div>
  );
}
