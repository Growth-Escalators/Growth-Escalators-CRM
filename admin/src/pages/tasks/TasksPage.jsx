// Tasks v2 — main shell. Mounts at /tasks/v2 alongside the legacy /tasks
// route (TasksBoardPage). Owns task fetching, top-level filter + view state,
// and renders the new Header, FilterBar, and a per-subView body.
//
// Layer A: shell only.
// Layer B: Board + atoms + DnD + quick-add + column collapse wired in.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Sidebar from '../../components/Sidebar.jsx';
import { apiFetch, getUser } from '../../lib/api.js';
import Header from './Header.jsx';
import Board from './Board.jsx';
import FocusView from './FocusView.jsx';
import { applyFilters } from './lib/filterPipeline.js';

// LocalStorage keys, exact per the redesign spec
const VIEW_KEY = 'ge-crm-tasks-view';              // mine | all | today
const SUBVIEW_KEY = 'ge-crm-tasks-subview';        // board | focus | list | calendar
const SMART_SORT_KEY = 'ge-crm-tasks-smart-sort';
const COLLAPSED_KEY = 'ge-crm-tasks-collapsed-cols';

const VALID_SCOPES = ['mine', 'all', 'today'];
const VALID_SUBVIEWS = ['board', 'focus', 'list', 'calendar'];

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

  // Data
  const [tasks, setTasks] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Persist
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, scope); } catch {} }, [scope]);
  useEffect(() => { try { localStorage.setItem(SUBVIEW_KEY, subView); } catch {} }, [subView]);
  useEffect(() => { try { localStorage.setItem(SMART_SORT_KEY, String(smartSort)); } catch {} }, [smartSort]);
  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsedCols)); } catch {}
  }, [collapsedCols]);

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
  const activeCount = visible.filter((t) => t.status !== 'done').length;
  const doneCount = visible.filter((t) => t.status === 'done').length;

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

  // Detail panel comes in Layer C; for now clicking a card is a no-op (logs)
  const onOpenTask = useCallback((t) => {
    // eslint-disable-next-line no-console
    console.log('[tasks/v2] open task', t.id, '(detail panel ships in Layer C)');
  }, []);

  // ── render ────────────────────────────────────────────────────────────
  return (
    <div className="h-screen w-screen flex bg-slate-100 text-slate-800 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 relative">
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
              tasks={visible}
              onOpenTask={onOpenTask}
              onQuickAdd={onQuickAdd}
              density="default"
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
        ) : (
          <div className="flex-1 flex items-center justify-center bg-slate-50/60">
            <div className="text-center max-w-sm px-6">
              <p className="text-sm font-medium text-slate-700">
                {subView === 'list' ? 'List view' : 'Calendar view'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Ships in a later layer. Switch back to Board to keep working.
              </p>
            </div>
          </div>
        )}
      </div>
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
