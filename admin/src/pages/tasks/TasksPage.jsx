// Tasks v2 — main shell. Mounts at /tasks/v2 alongside the legacy /tasks
// route (TasksBoardPage). Owns task fetching, top-level filter + view state,
// and renders the new Header, FilterBar, and a per-subView body.
//
// Layer A: shell only.
// Layer B: Board + atoms + DnD + quick-add + column collapse wired in.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from '../../components/Sidebar.jsx';
import { apiFetch, getUser } from '../../lib/api.js';
import Header from './Header.jsx';
import Board from './Board.jsx';
import DetailPanel from './DetailPanel.jsx';
import FocusView from './FocusView.jsx';
import ListView from './ListView.jsx';
import CalendarView from './CalendarView.jsx';
import BulkToolbar from './BulkToolbar.jsx';
import TeamPerformanceTab from './TeamPerformanceTab.jsx';
import { applyFilters } from './lib/filterPipeline.js';
import { withSmartRanks } from './lib/smartRank.js';

// LocalStorage keys, exact per the redesign spec
const VIEW_KEY = 'ge-crm-tasks-view';              // mine | all | today
const SUBVIEW_KEY = 'ge-crm-tasks-subview';        // board | focus | list | calendar
const SMART_SORT_KEY = 'ge-crm-tasks-smart-sort';
const COLLAPSED_KEY = 'ge-crm-tasks-collapsed-cols';
const DENSITY_KEY = 'ge-crm-tasks-density';        // compact | default | cozy

const VALID_SCOPES = ['mine', 'all', 'today'];
const VALID_SUBVIEWS = ['board', 'focus', 'list', 'calendar', 'team'];
const VALID_DENSITIES = ['compact', 'default', 'cozy'];

function loadString(key, fallback, valid) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    if (valid) return valid.includes(raw) ? raw : fallback;
    return raw;
  } catch { return fallback; }
}
function loadBool(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true';
  } catch { return fallback; }
}
function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch { return fallback; }
}

export default function TasksPage() {
  const currentUser = useMemo(() => getUser(), []);

  // View state
  const [scope, setScope] = useState(() => loadString(VIEW_KEY, 'mine', VALID_SCOPES));
  const [subView, setSubView] = useState(() => loadString(SUBVIEW_KEY, 'board', VALID_SUBVIEWS));
  const [smartSort, setSmartSort] = useState(() => loadBool(SMART_SORT_KEY, false));
  const [filters, setFilters] = useState({ assignee: null, priority: null, due: null });
  const [listFilter] = useState(null); // wired in a later layer (sidebar Lists nav)
  const [collapsedCols, setCollapsedCols] = useState(() => {
    const v = loadJson(COLLAPSED_KEY, []);
    return Array.isArray(v) ? v : [];
  });
  const [density, setDensity] = useState(() => loadString(DENSITY_KEY, 'default', VALID_DENSITIES));

  // Data
  const [tasks, setTasks] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Detail panel (Layer C) — id of the task the user has open in the side panel
  const [openTaskId, setOpenTaskId] = useState(null);

  // Multi-select state — used by ListView checkboxes + BulkToolbar
  const [selectedIds, setSelectedIds] = useState([]);
  const toggleSelect = useCallback((id) => {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }, []);
  const clearSelection = useCallback(() => setSelectedIds([]), []);

  // Force-bust admin-only views when scope changes (admin demoted, etc.)
  useEffect(() => {
    if (subView === 'team' && currentUser?.role !== 'admin') setSubView('board');
  }, [subView, currentUser]);

  // Clear bulk-select when switching subViews. ListView is the only place
  // where multi-select is exposed; if a user selects 3 tasks, switches to
  // Board, then back to List, the stale selection used to persist and the
  // BulkToolbar would re-mount with rows that may not be visible.
  useEffect(() => { setSelectedIds([]); }, [subView]);

  // Persist
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, scope); } catch {} }, [scope]);
  useEffect(() => { try { localStorage.setItem(SUBVIEW_KEY, subView); } catch {} }, [subView]);
  useEffect(() => { try { localStorage.setItem(SMART_SORT_KEY, String(smartSort)); } catch {} }, [smartSort]);
  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsedCols)); } catch {}
  }, [collapsedCols]);
  useEffect(() => { try { localStorage.setItem(DENSITY_KEY, density); } catch {} }, [density]);

  // Load tasks + team in parallel
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasksResp, teamResp] = await Promise.all([
        apiFetch('/api/tasks'),
        apiFetch('/api/team').catch(() => ({ team: [] })),
      ]);
      setTasks(tasksResp?.tasks || []);
      setTeam(teamResp?.team || []);
    } catch (e) {
      setError(e.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);

  // ── derived ────────────────────────────────────────────────────────────
  const visible = useMemo(
    () => applyFilters(tasks, { scope, filters, listFilter, currentUserId: currentUser?.id }),
    [tasks, scope, filters, listFilter, currentUser]
  );
  // Annotate the top 5 tasks with `smartRank` so SmartBadge has data to show
  // and Board's sortTasks can prioritise them when smart-sort is on.
  const visibleRanked = useMemo(
    () => withSmartRanks(visible, currentUser?.id),
    [visible, currentUser]
  );
  const activeCount = visibleRanked.filter((t) => t.status !== 'done').length;
  const doneCount = visibleRanked.filter((t) => t.status === 'done').length;

  // ── mutations ─────────────────────────────────────────────────────────
  const patchTask = useCallback(async (id, patch) => {
    let snapshot = null;
    setTasks((ts) => {
      snapshot = ts;
      return ts.map((t) => (t.id === id ? { ...t, ...patch } : t));
    });
    try {
      const data = await apiFetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (data?.task) setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...data.task } : t)));
    } catch (e) {
      if (snapshot) setTasks(snapshot);
      setError(e.message || 'Update failed');
    }
  }, []);

  const onMoveTask = useCallback((id, status) => patchTask(id, { status }), [patchTask]);

  const onToggleDone = useCallback((task) => {
    const next = task.status === 'done' ? 'in_progress' : 'done';
    patchTask(task.id, { status: next });
  }, [patchTask]);

  const onQuickAdd = useCallback(async (columnKey, title, extra = {}) => {
    // Optimistic: insert a temp row with a synthetic id
    const tempId = `temp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      title,
      status: columnKey,
      priority: extra.priority || 'medium',
      assignedTo: extra.assignedTo ?? currentUser?.id ?? null,
      tags: extra.tags || [],
      dueAt: extra.dueAt || null,
      subtasksDone: 0,
      subtasksTotal: 0,
      commentCount: 0,
      attachmentCount: 0,
      _pending: true,
    };
    setTasks((ts) => [optimistic, ...ts]);
    try {
      const data = await apiFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title,
          status: columnKey,
          priority: extra.priority || 'medium',
          assignedTo: extra.assignedTo ?? currentUser?.id ?? null,
          tags: extra.tags || [],
          dueAt: extra.dueAt || null,
        }),
      });
      if (data?.task) {
        setTasks((ts) => ts.map((t) => (t.id === tempId ? { ...data.task } : t)));
      }
    } catch (e) {
      setTasks((ts) => ts.filter((t) => t.id !== tempId));
      setError(e.message || 'Create failed');
    }
  }, [currentUser]);

  const onCreateFromHeader = useCallback((parsed) => {
    if (!parsed?.title) return;
    onQuickAdd('not_started', parsed.title, {
      priority: parsed.priority,
      assignedTo: parsed.assignee,
      tags: parsed.tags,
      dueAt: parsed.dueAt,
    });
  }, [onQuickAdd]);

  const onToggleCollapse = useCallback((k) => {
    setCollapsedCols((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  }, []);

  const removeTask = useCallback(async (id) => {
    let snapshot = null;
    setTasks((ts) => { snapshot = ts; return ts.filter((t) => t.id !== id); });
    setSelectedIds((ids) => ids.filter((x) => x !== id));
    try {
      await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
    } catch (e) {
      if (snapshot) setTasks(snapshot);
      setError(e.message || 'Delete failed');
    }
  }, []);

  const onCreateOnDay = useCallback((d) => {
    const dueIso = new Date(`${d.toISOString().slice(0, 10)}T12:00:00`).toISOString();
    onQuickAdd('not_started', 'New task', { dueAt: dueIso });
  }, [onQuickAdd]);

  const onBulkApplied = useCallback((updatedTasks) => {
    if (!Array.isArray(updatedTasks)) { loadAll(); return; }
    setTasks((ts) => {
      const byId = new Map(updatedTasks.map((u) => [u.id, u]));
      return ts.map((t) => (byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t));
    });
    clearSelection();
  }, [clearSelection, loadAll]);

  const onBulkDeleted = useCallback((ids) => {
    setTasks((ts) => ts.filter((t) => !ids.includes(t.id)));
    clearSelection();
  }, [clearSelection]);

  // Detail panel: clicking a card opens the right-side slide-in. We also
  // remember the last-opened task id so we can restore focus to its card
  // when the panel closes (a11y — Layer E focus-management). The card
  // identifies itself via `data-task-id`.
  const lastOpenedTaskIdRef = useRef(null);

  const onOpenTask = useCallback((t) => {
    lastOpenedTaskIdRef.current = t?.id ?? null;
    setOpenTaskId(t.id);
  }, []);

  // Restores focus to the originating card. Runs after the panel unmounts so
  // the focus target is in the DOM.
  const restoreFocusToLastTask = useCallback(() => {
    const id = lastOpenedTaskIdRef.current;
    if (!id) return;
    requestAnimationFrame(() => {
      try {
        const el = document.querySelector(`[data-task-id="${CSS.escape(String(id))}"]`);
        if (el && typeof el.focus === 'function') el.focus();
      } catch { /* noop */ }
    });
  }, []);

  const closeDetailPanel = useCallback(() => {
    setOpenTaskId(null);
    restoreFocusToLastTask();
  }, [restoreFocusToLastTask]);

  // Resolve the openTask off the live `tasks` array so optimistic edits
  // performed inside the panel re-render with fresh data.
  const openTask = useMemo(
    () => (openTaskId ? tasks.find((t) => t.id === openTaskId) || null : null),
    [tasks, openTaskId],
  );

  // If the open task is removed from the list (deleted, filtered out, or
  // disappears after a reload) reset openTaskId so it can't quietly re-open
  // when the task reappears via undo / refetch. The panel is already hidden
  // via the `{openTask && ...}` guard at render time, but the id needs to
  // come along.
  useEffect(() => {
    if (openTaskId && !openTask) setOpenTaskId(null);
  }, [openTaskId, openTask]);

  // ESC closes the panel — only listen while it's open.
  useEffect(() => {
    if (!openTaskId) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeDetailPanel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openTaskId, closeDetailPanel]);

  // Re-bind patchTask to the open task so the panel can call onPatch(patch).
  const patchOpenTask = useCallback(
    (patch) => { if (openTaskId) patchTask(openTaskId, patch); },
    [openTaskId, patchTask],
  );

  // ── render ────────────────────────────────────────────────────────────
  return (
    <div className="h-screen w-screen flex bg-slate-100 text-slate-800 overflow-hidden">
      <Sidebar />
      {/* <main>, not a bare <div>: this page renders its own Sidebar shell (it is
          never wrapped in AppLayout), so without this every control on the page
          sits outside any landmark — axe `region`. Same shape the other
          Sidebar-owning pages already use. */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        <Header
          subView={subView}
          onSubView={setSubView}
          scope={scope}
          onScope={setScope}
          filters={filters}
          onFilters={setFilters}
          smartSort={smartSort}
          onSmartSort={setSmartSort}
          onCreate={onCreateFromHeader}
          count={activeCount}
          doneCount={doneCount}
          team={team}
          currentUser={currentUser}
          density={density}
          onDensityChange={setDensity}
        />

        {error && (
          <div className="bg-rose-50 border-b border-rose-200 px-5 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}

        {subView === 'board' ? (
          loading && tasks.length === 0 ? (
            <BoardSkeleton />
          ) : (
            <Board
              tasks={visibleRanked}
              onOpenTask={onOpenTask}
              onQuickAdd={onQuickAdd}
              density={density}
              smartSort={smartSort}
              onMoveTask={onMoveTask}
              onToggleDone={onToggleDone}
              team={team}
              collapsedColumns={collapsedCols}
              onToggleCollapse={onToggleCollapse}
            />
          )
        ) : subView === 'focus' ? (
          <FocusView
            tasks={tasks}
            team={team}
            currentUserId={currentUser?.id}
            onOpenTask={onOpenTask}
            onToggleDone={onToggleDone}
            onPatchTask={patchTask}
            smartSort={smartSort}
          />
        ) : subView === 'list' ? (
          <div className="flex-1 flex flex-col min-h-0">
            <ListView
              tasks={visibleRanked}
              team={team}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onOpen={onOpenTask}
              onPatchTask={patchTask}
              onDelete={removeTask}
            />
          </div>
        ) : subView === 'calendar' ? (
          <div className="flex-1 flex flex-col min-h-0">
            <CalendarView
              tasks={visibleRanked}
              team={team}
              onOpen={onOpenTask}
              onCreateOnDay={onCreateOnDay}
              onPatchTask={patchTask}
            />
          </div>
        ) : subView === 'team' ? (
          <div className="flex-1 min-h-0 overflow-auto">
            <TeamPerformanceTab />
          </div>
        ) : null}

        {selectedIds.length > 0 && (
          <BulkToolbar
            selectedIds={selectedIds}
            team={team}
            onClear={clearSelection}
            onApplied={onBulkApplied}
            onDeleted={onBulkDeleted}
          />
        )}

        {openTask && (
          <DetailPanel
            task={openTask}
            team={team}
            visibleTasks={visible}
            onPatch={patchOpenTask}
            onNavigate={(t) => setOpenTaskId(t.id)}
            onClose={closeDetailPanel}
          />
        )}
      </main>
    </div>
  );
}

// ── skeleton for initial load -------------------------------------------------
function BoardSkeleton() {
  return (
    <div className="flex-1 min-w-0 overflow-hidden bg-slate-100/60">
      <div className="flex gap-3 px-5 py-4 h-full">
        {['Not Started', 'In Progress', 'Review', 'Done'].map((label) => (
          <div key={label} className="w-[300px] shrink-0 rounded-xl border border-slate-200 bg-slate-50/60">
            <div className="px-3 pt-3 pb-2 flex items-center gap-2">
              <div className="h-3 w-20 bg-slate-200 rounded animate-pulse" />
            </div>
            <div className="px-2 pb-2 space-y-1.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-white border border-slate-200 rounded-lg p-2.5 animate-pulse">
                  <div className="h-3 bg-slate-200 rounded w-3/4 mb-2" />
                  <div className="h-2 bg-slate-100 rounded w-1/2" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
