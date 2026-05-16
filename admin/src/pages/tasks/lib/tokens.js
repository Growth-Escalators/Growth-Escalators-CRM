// Design tokens lifted verbatim from prototype tasks/data.jsx + atoms.jsx.
// Centralised here so every atom uses the same palette/hash.

// Due-chip ageing tones — must match the prototype exactly.
export const DUE_PILL = {
  overdue: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-100',
  soon:    'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100',
  week:    'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-100',
  later:   'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-100',
  neutral: 'bg-slate-50 text-slate-500 ring-1 ring-inset ring-slate-100',
};

export const PRIORITY_STYLES = {
  high:   { dot: 'bg-rose-500',  text: 'text-rose-600',  label: 'High' },
  medium: { dot: 'bg-sky-500',   text: 'text-sky-600',   label: 'Med' },
  low:    { dot: 'bg-slate-300', text: 'text-slate-500', label: 'Low' },
};

// Avatar background palette (matches prototype TONE_BG order/hue).
const AVATAR_TONES = [
  'bg-sky-500', 'bg-rose-500', 'bg-emerald-500',
  'bg-amber-500', 'bg-violet-500', 'bg-teal-500',
];

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function avatarTone(seed) {
  return AVATAR_TONES[hash(String(seed || '')) % AVATAR_TONES.length];
}

// Tag chip palette — same 8 tones as the prototype.
const TAG_PALETTE = [
  'bg-rose-50 text-rose-700',
  'bg-amber-50 text-amber-700',
  'bg-emerald-50 text-emerald-700',
  'bg-sky-50 text-sky-700',
  'bg-violet-50 text-violet-700',
  'bg-teal-50 text-teal-700',
  'bg-pink-50 text-pink-700',
  'bg-indigo-50 text-indigo-700',
];

export function tagColor(tag) {
  return TAG_PALETTE[hash(String(tag || '').toLowerCase()) % TAG_PALETTE.length];
}

// Board columns — keys must match backend task.status enum.
export const COLUMNS = [
  { key: 'not_started', label: 'Not Started', dot: '#94a3b8' },
  { key: 'in_progress', label: 'In Progress', dot: '#0ea5e9' },
  { key: 'review',      label: 'Review',      dot: '#f59e0b' },
  { key: 'done',        label: 'Done',        dot: '#10b981' },
];

export const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
