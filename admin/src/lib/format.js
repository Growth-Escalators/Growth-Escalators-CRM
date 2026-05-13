// Shared formatting helpers used across analytics components.

export function formatINR(amount) {
  const v = Number(amount || 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(v);
}

// Backend returns amounts in paise — divide by 100 for display.
export function formatINRFromPaise(paise) {
  return formatINR(Number(paise || 0) / 100);
}

// Compact INR (e.g. ₹1.2L, ₹2.4Cr) for chart axes and KPI tiles.
export function formatINRCompact(amount) {
  const v = Number(amount || 0);
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`;
  if (Math.abs(v) >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return `₹${v.toFixed(0)}`;
}

export function formatNumber(v) {
  return Number(v || 0).toLocaleString('en-IN');
}

export function formatPercent(v) {
  return `${Number(v || 0).toFixed(0)}%`;
}

export function formatValue(value, valueFormat) {
  if (valueFormat === 'currency') return formatINRCompact(value);
  if (valueFormat === 'percent') return formatPercent(value);
  return formatNumber(value);
}

// Format a delta percentage as "+12%" or "-4%".
export function formatDelta(delta) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const rounded = Math.round(delta);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}%`;
}
