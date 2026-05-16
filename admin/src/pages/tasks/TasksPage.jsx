// Tasks v2 — main shell. Mounts at /tasks/v2 alongside the legacy /tasks
// route (TasksBoardPage). Owns top-level filter + view state and renders the
// new Header, FilterBar, and a per-subView body.
//
// Layer A: shell only — no Board/Focus/List/Calendar bodies wired up yet.
// Subsequent layers will fill in the body components.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Sidebar from '../../components/Sidebar.jsx';
import { apiFetch, getUser } from '../../lib/api.js';
import Header from './Header.jsx';

// LocalStorage keys, exact per the redesign spec
const VIEW_KEY = 'ge-crm-tasks-view';            // mine | all | today
const SUBVIEW_KEY = 'ge-crm-tasks-subview';      // board | focus | list | calendar
const SMART_SORT_KEY = 'ge-crm-tasks-smart-sort';

const VALID_SCOPES = ['mine', 'all', 'today'];
const VALID_SUBVIEWS = ['board', 'focus', 'list', 'calendar'];

function loadInitial(key, fallback, valid) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    if (valid) return valid.includes(raw) ? raw : fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

export default function TasksPage() {
  const currentUser = useMemo(() => getUser(), []);

  // View state
  const [scope, setScope] = useState(() => loadInitial(VIEW_KEY, 'mine', VALID_SCOPES));
  const [subView, setSubView] = useState(() => loadInitial(SUBVIEW_KEY, 'board', VALID_SUBVIEWS));
  const [smartSort, setSmartSort] = useState(() => loadInitial(SMART_SORT_KEY, false, null));
  const [filters, setFilters] = useState({ assignee: null, priority: null, due: null });

  // Team for the avatar quick-toggle chips in FilterBar
  const [team, setTeam] = useState([]);

  // Persist
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, scope); } catch {} }, [scope]);
  useEffect(() => { try { localStorage.setItem(SUBVIEW_KEY, subView); } catch {} }, [subView]);
  useEffect(() => { try { localStorage.setItem(SMART_SORT_KEY, String(smartSort)); } catch {} }, [smartSort]);

  // Load team (best-effort — chips just hide if empty)
  useEffect(() => {
    apiFetch('/api/team')
      .then((d) => setTeam(d?.team || []))
      .catch(() => setTeam([]));
  }, []);

  // Stub create handler — Layer D wires the real natural-language parser
  const onCreate = useCallback(async (parsed) => {
    if (!parsed?.title) return;
    try {
      await apiFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: parsed.title,
          priority: parsed.priority || 'medium',
          assignedTo: parsed.assignee || null,
          tags: parsed.tags || [],
          status: 'not_started',
        }),
      });
      // Layer B will refetch tasks list; for now this is a fire-and-forget.
    } catch (e) {
      console.error('[tasks/v2] create failed', e);
    }
  }, []);

  // Counts come from the (yet-unbuilt) tasks list. Placeholders for Layer A.
  const count = 0;
  const doneCount = 0;

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
          onCreate={onCreate}
          count={count}
          doneCount={doneCount}
          team={team}
          currentUser={currentUser}
        />

        {/* Layer A: empty body. Layers B/D/etc. drop in Board/Focus/List/Calendar. */}
        <div className="flex-1 flex items-center justify-center bg-slate-50/60">
          <div className="text-center max-w-sm px-6">
            <p className="text-sm font-medium text-slate-700">Tasks v2 — Layer A shell</p>
            <p className="text-xs text-slate-500 mt-1">
              Header, filter bar, and view-switcher are live. The Board, Focus,
              List, and Calendar bodies arrive in subsequent layers.
            </p>
            <p className="text-[11px] text-slate-400 mt-3">
              Current view: <span className="font-medium text-slate-600">{subView}</span> · scope:{' '}
              <span className="font-medium text-slate-600">{scope}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
