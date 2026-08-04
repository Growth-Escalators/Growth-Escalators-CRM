import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';
import { productPath } from '../lib/auth.js';
import { Card } from './ui/index.js';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

// ---------------------------------------------------------------------------
// SetupChecklistCard — the first-run "finish setting up" card at the top of
// the Dashboard.
//
// Self-contained by design: it fetches its own status from
// GET /api/onboarding/status (tenant-scoped server-side, derived purely
// from existing tenant_branding / contacts / pipelines rows — no new
// tables, no persisted dismiss flag) and renders nothing at all once every
// item is done. That means a tenant that already has data — Growth
// Escalators' own tenant included — gets `allComplete: true` back and this
// component returns null. No tenant-slug special-casing lives here.
//
// "Dismissible" here means collapsible for the current page view (plain
// React state) rather than a persisted per-user flag: once the underlying
// data changes (a contact gets added, a pipeline gets created), the item
// flips to done on the next load and the card shrinks on its own — nothing
// to remember, nothing to reset.
// ---------------------------------------------------------------------------
export default function SetupChecklistCard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/onboarding/status');
      setStatus(data);
    } catch {
      // Best-effort: this is a helper banner, not core dashboard data — a
      // failed fetch should never block or error out the rest of the page.
      setStatus(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading || !status || status.allComplete || !Array.isArray(status.items) || status.items.length === 0) {
    return null;
  }

  const doneCount = status.items.filter((item) => item.done).length;

  return (
    <Card accent="primary">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between gap-3 px-5 pt-4 pb-3 text-left"
        aria-expanded={!collapsed}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-primary-600 flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-neutral-900">Finish setting up your workspace</h3>
            <p className="text-xs text-neutral-500 mt-0.5">{doneCount} of {status.items.length} done</p>
          </div>
        </div>
        {collapsed ? (
          <ChevronDown className="w-4 h-4 text-neutral-400 flex-shrink-0" />
        ) : (
          <ChevronUp className="w-4 h-4 text-neutral-400 flex-shrink-0" />
        )}
      </button>
      {!collapsed && (
        <div className="divide-y divide-neutral-100 border-t border-neutral-100">
          {status.items.map((item) => (
            <a
              key={item.key}
              href={productPath(item.link)}
              className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50 transition-colors"
            >
              {item.done ? (
                <CheckCircle2 className="w-4 h-4 text-success-600 flex-shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-neutral-300 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${item.done ? 'text-neutral-400 line-through' : 'text-neutral-800'}`}>
                  {item.label}
                </p>
                {!item.done && item.description && (
                  <p className="text-xs text-neutral-500 mt-0.5">{item.description}</p>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </Card>
  );
}
