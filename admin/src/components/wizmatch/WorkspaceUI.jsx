import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Clock3, Loader2, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Button } from '../ui/index.js';

export const STATUS_TONE = {
  active: 'success', accepted: 'success', covered: 'success', filled: 'success', granted: 'success', placed: 'success', verified: 'success',
  draft: 'muted', new: 'info', qualifying: 'info', sourcing: 'info', submitted: 'info', interviewing: 'info', offered: 'info',
  watch: 'warning', needs_attribution: 'warning', pending_research: 'warning', identified_channel_pending: 'warning', overdue: 'danger',
  blocked: 'danger', rejected: 'danger', closed_lost: 'muted', cancelled: 'muted', withdrawn: 'muted', unknown: 'muted',
};

export function humanize(value, fallback = 'Unknown') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value).replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
}

export function WorkspacePage({ title, description, eyebrow, actions, children, className = '' }) {
  return (
    <main className={`mx-auto min-w-0 w-full max-w-[1680px] space-y-5 px-4 py-5 sm:px-6 lg:px-8 ${className}`}>
      <header className="flex flex-col gap-4 border-b border-neutral-200 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary-700">{eyebrow}</p>}
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-600">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </main>
  );
}

export function StatusBadge({ status, label, tone }) {
  const normalized = String(status || 'unknown').toLowerCase();
  return <Badge type={tone || STATUS_TONE[normalized] || 'muted'} dot>{label || humanize(normalized)}</Badge>;
}

export function DataState({ loading, error, empty, emptyTitle = 'Nothing here yet', emptyDescription, emptyAction, onRetry, children }) {
  if (loading) {
    return (
      <div className="card flex min-h-48 items-center justify-center gap-2 p-8 text-sm text-neutral-600" aria-busy="true">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-danger-500/30 bg-red-50 p-5" role="alert">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger-600" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-semibold text-danger-600">This view could not be loaded</h2>
            <p className="mt-1 text-sm text-neutral-700">{error}</p>
            {onRetry && <Button className="mt-3" size="compact" onClick={onRetry} icon={<RefreshCw />}>Retry</Button>}
          </div>
        </div>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="card flex min-h-48 flex-col items-center justify-center p-8 text-center">
        <CheckCircle2 className="h-8 w-8 text-neutral-400" aria-hidden="true" />
        <h2 className="mt-3 font-semibold text-neutral-900">{emptyTitle}</h2>
        {emptyDescription && <p className="mt-1 max-w-xl text-sm text-neutral-600">{emptyDescription}</p>}
        {emptyAction && <div className="mt-4">{emptyAction}</div>}
      </div>
    );
  }
  return children;
}

export function EntityHeader({ trail = [], title, subtitle, status, metadata = [], action }) {
  return (
    <section className="card p-5">
      {trail.length > 0 && (
        <nav aria-label="Record context" className="mb-3 flex flex-wrap items-center gap-1 text-xs text-neutral-600">
          {trail.map((item, index) => (
            <React.Fragment key={`${item.label}-${index}`}>
              {index > 0 && <ChevronRight className="h-3 w-3 text-neutral-400" aria-hidden="true" />}
              {item.to ? <Link className="font-medium hover:text-primary-700" to={item.to}>{item.label}</Link> : <span>{item.label}</span>}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words text-xl font-bold text-neutral-900">{title}</h2>
            {status && <StatusBadge status={status} />}
          </div>
          {subtitle && <p className="mt-1 text-sm text-neutral-600">{subtitle}</p>}
          {metadata.length > 0 && (
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {metadata.map(item => (
                <div key={item.label} className="rounded-md bg-neutral-50 px-3 py-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-600">{item.label}</dt>
                  <dd className="mt-1 break-words text-sm font-medium text-neutral-900">{item.value || '—'}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </section>
  );
}

export function StageStepper({ stages, current }) {
  const currentIndex = Math.max(0, stages.findIndex(stage => stage.id === current));
  return (
    <ol className="card grid overflow-hidden sm:grid-flow-col sm:auto-cols-fr" aria-label="Workflow progress">
      {stages.map((stage, index) => {
        const complete = index < currentIndex;
        const active = stage.id === current;
        return (
          <li key={stage.id} className={`border-b border-neutral-200 px-3 py-3 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${active ? 'bg-primary-50' : ''}`} aria-current={active ? 'step' : undefined}>
            <div className="flex items-center gap-2">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${complete ? 'bg-success-600 text-white' : active ? 'bg-primary-600 text-white' : 'bg-neutral-200 text-neutral-700'}`}>
                {complete ? '✓' : index + 1}
              </span>
              <span className={`text-xs font-semibold ${active ? 'text-primary-800' : 'text-neutral-700'}`}>{stage.label}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ReadinessChecklist({ items = [], title = 'Readiness' }) {
  const missing = items.filter(item => !item.complete);
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-neutral-900">{title}</h3>
        <StatusBadge status={missing.length ? 'watch' : 'verified'} label={missing.length ? `${missing.length} missing` : 'Ready'} />
      </div>
      <ul className="mt-3 space-y-2">
        {items.map(item => (
          <li key={item.label} className="flex items-start gap-2 text-sm">
            {item.complete ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-700" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-700" />}
            <span className={item.complete ? 'text-neutral-700' : 'font-medium text-neutral-900'}>{item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NextActionPanel({ title = 'Next best action', description, dueAt, blocked = false, action }) {
  return (
    <aside className={`rounded-lg border p-4 ${blocked ? 'border-warning-500/40 bg-amber-50' : 'border-primary-200 bg-primary-50'}`}>
      <div className="flex items-start gap-3">
        {blocked ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-700" /> : <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" />}
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-neutral-900">{title}</h3>
          {description && <p className="mt-1 text-sm leading-5 text-neutral-700">{description}</p>}
          {dueAt && <p className="mt-2 text-xs font-medium text-neutral-600">Due {new Date(dueAt).toLocaleString()}</p>}
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </aside>
  );
}

export function WorkspaceTabs({ tabs, active, onChange, label = 'Workspace views' }) {
  const handleKeyDown = (event, index) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const targetIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[targetIndex].id);
    event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')?.[targetIndex]?.focus();
  };
  return (
    <div className="flex gap-1 overflow-x-auto rounded-lg border border-neutral-200 bg-white p-1" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id} tabIndex={active === tab.id ? 0 : -1} onClick={() => onChange(tab.id)} onKeyDown={event => handleKeyDown(event, index)} className={`min-h-10 whitespace-nowrap rounded-md px-3 text-sm font-semibold ${active === tab.id ? 'bg-primary-600 text-white' : 'text-neutral-700 hover:bg-neutral-100'}`}>
          {tab.label}{tab.count !== undefined ? ` (${tab.count})` : ''}
        </button>
      ))}
    </div>
  );
}

export function ActivityTimeline({ items = [], emptyText = 'No activity recorded yet.' }) {
  if (!items.length) return <p className="rounded-md bg-neutral-50 p-4 text-sm text-neutral-600">{emptyText}</p>;
  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li key={item.id || index} className="relative border-l-2 border-primary-200 py-1 pl-4">
          <span className="absolute -left-[5px] top-2 h-2 w-2 rounded-full bg-primary-600" />
          <p className="text-sm font-semibold text-neutral-900">{humanize(item.event_type || item.title)}</p>
          {item.description && <p className="mt-0.5 text-sm text-neutral-600">{item.description}</p>}
          <p className="mt-1 text-xs text-neutral-600">{item.actor_name ? `${item.actor_name} · ` : ''}{new Date(item.occurred_at || item.created_at).toLocaleString()}</p>
        </li>
      ))}
    </ol>
  );
}
