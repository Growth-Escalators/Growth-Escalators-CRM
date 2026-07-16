import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';

export function WorkspaceHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="flex flex-col gap-4 border-b border-neutral-200 bg-white px-4 py-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary-600">{eyebrow}</p>}
        <h1 className="mt-1 text-xl font-bold tracking-[-0.02em] text-neutral-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13px] leading-5 text-neutral-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EntityTabs({ items, value, onChange, label = 'Workspace views' }) {
  const moveFocus = (event, index) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    onChange(items[nextIndex].value);
    event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')?.[nextIndex]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-neutral-200 px-4 sm:px-6">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          tabIndex={value === item.value ? 0 : -1}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => moveFocus(event, items.indexOf(item))}
          className={`whitespace-nowrap border-b-2 px-3 py-3 text-[13px] font-semibold transition-colors ${
            value === item.value
              ? 'border-primary-500 text-primary-700'
              : 'border-transparent text-neutral-500 hover:text-neutral-800'
          }`}
        >
          {item.label}
          {Number.isFinite(item.count) && <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function StatePanel({ state = 'empty', title, description, onRetry, compact = false }) {
  const isError = state === 'error' || state === 'permission';
  const Icon = state === 'loading' ? Loader2 : isError ? AlertTriangle : CheckCircle2;
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`rounded-xl border px-5 text-center ${compact ? 'py-6' : 'py-10'} ${
        isError ? 'border-danger-200 bg-danger-50' : 'border-neutral-200 bg-white'
      }`}
    >
      <Icon className={`mx-auto h-5 w-5 ${state === 'loading' ? 'animate-spin text-primary-500' : isError ? 'text-danger-600' : 'text-neutral-400'}`} />
      <p className={`mt-2 text-sm font-semibold ${isError ? 'text-danger-800' : 'text-neutral-800'}`}>{title}</p>
      {description && <p className={`mx-auto mt-1 max-w-xl text-[12.5px] leading-5 ${isError ? 'text-danger-700' : 'text-neutral-500'}`}>{description}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-standard btn-compact mt-4">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      )}
    </div>
  );
}

export function MetricCard({ label, value, helper, tone = 'neutral' }) {
  const toneClass = tone === 'danger' ? 'text-danger-700' : tone === 'success' ? 'text-success-700' : 'text-neutral-900';
  return (
    <div className="card min-w-0 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`mt-1 truncate text-xl font-bold ${toneClass}`}>{value ?? '—'}</p>
      {helper && <p className="mt-1 text-[11.5px] text-neutral-500">{helper}</p>}
    </div>
  );
}

export function Lifecycle({ stages, current }) {
  const activeIndex = Math.max(0, stages.findIndex((stage) => stage.value === current));
  return (
    <ol aria-label="Delivery lifecycle" className="flex min-w-max items-center gap-1">
      {stages.map((stage, index) => {
        const complete = index < activeIndex;
        const active = index === activeIndex;
        return (
          <li key={stage.value} className="flex items-center">
            <span
              aria-current={active ? 'step' : undefined}
              className={`inline-flex h-7 items-center rounded-full px-2.5 text-[10.5px] font-semibold ${
                active ? 'bg-primary-700 text-white' : complete ? 'bg-success-50 text-success-700' : 'bg-neutral-100 text-neutral-700'
              }`}
            >
              {stage.label}
            </span>
            {index < stages.length - 1 && <span aria-hidden className="mx-1 h-px w-3 bg-neutral-200" />}
          </li>
        );
      })}
    </ol>
  );
}

export function formatDate(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

export function formatMoney(value, currency = 'INR') {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

export function candidateName(candidate) {
  return candidate?.name || [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' ') || 'Unnamed candidate';
}
