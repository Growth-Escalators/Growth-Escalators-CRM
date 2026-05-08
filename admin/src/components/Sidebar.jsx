import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { logout, getUser, getPermissions, apiFetch } from '../lib/api.js';
import { ChevronRight, Menu, X, Wrench, Receipt, Settings as SettingsIcon } from 'lucide-react';
import { NAV_ENTRIES, GROUP_LABELS, getVisibleEntries, groupForPath } from './navEntries.js';
import CommandPalette from './CommandPalette.jsx';

const ROLE_BADGE_COLORS = {
  admin: 'bg-purple-600',
  manager_ops: 'bg-sky-500',
  manager_ads: 'bg-blue-500',
  sales: 'bg-orange-500',
  staff: 'bg-slate-500',
};

const ROLE_LABELS = {
  admin: 'Admin',
  manager_ops: 'Manager',
  manager_ads: 'Ads Mgr',
  sales: 'Sales',
  staff: 'Staff',
};

const STORAGE_KEY = 'ge-crm-nav-groups';
const DEFAULT_GROUPS = { tools: false, finance: false, settings: false };
const GROUP_ICONS = { tools: Wrench, finance: Receipt, settings: SettingsIcon };

function readStoredGroups() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GROUPS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_GROUPS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch { return { ...DEFAULT_GROUPS }; }
}

function writeStoredGroups(g) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(g)); } catch { /* ignore quota */ }
}

const navClass = ({ isActive }) =>
  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
    isActive
      ? 'bg-slate-800 text-white border-l-2 border-l-emerald-400 ml-[-2px]'
      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
  }`;

const navClassNested = ({ isActive }) =>
  `flex items-center gap-3 pl-5 pr-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
    isActive
      ? 'bg-slate-800 text-white border-l-2 border-l-emerald-400 ml-[-2px]'
      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
  }`;

function SectionLabel({ children }) {
  return (
    <p className="px-3 pt-5 pb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-[0.12em]">
      {children}
    </p>
  );
}

function ExternalChevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 flex-shrink-0">
      <path d="M7 7h10v10" /><path d="M7 17 17 7" />
    </svg>
  );
}

function NavEntry({ entry, unreadCount, nested = false }) {
  const Icon = entry.icon;
  const cls = nested ? navClassNested : navClass;

  if (entry.external) {
    return (
      <a href={entry.href} target="_blank" rel="noopener noreferrer"
        className={`flex items-center gap-3 ${nested ? 'pl-5 pr-3' : 'px-3'} py-2 rounded-lg text-sm font-medium transition-all duration-150 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200`}>
        <Icon className="w-4 h-4" />
        <span className="flex-1">{entry.label}</span>
        <ExternalChevron />
      </a>
    );
  }

  return (
    <NavLink
      to={entry.to}
      {...(entry.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cls}
    >
      <Icon className="w-4 h-4" />
      <span className="flex-1">{entry.label}</span>
      {entry.badge === 'inbox-unread' && unreadCount > 0 && (
        <span className="bg-emerald-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-5 text-center font-semibold leading-none">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
      {entry.newTab && <ExternalChevron />}
    </NavLink>
  );
}

function GroupHeader({ id, label, isOpen, onToggle }) {
  const Icon = GROUP_ICONS[id] || SettingsIcon;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 transition-all duration-150"
    >
      <Icon className="w-4 h-4" />
      <span className="flex-1 text-left">{label}</span>
      <ChevronRight className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
    </button>
  );
}

export default function Sidebar() {
  const user = getUser();
  const perms = getPermissions();
  const role = user?.role || 'staff';
  const location = useLocation();

  const [unreadCount, setUnreadCount] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState(readStoredGroups);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Inbox unread badge — poll every 30s
  useEffect(() => {
    function fetchUnread() {
      apiFetch('/api/inbox/unread-count')
        .then(d => setUnreadCount(d?.count ?? 0))
        .catch(() => {});
    }
    fetchUnread();
    const interval = setInterval(fetchUnread, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Auto-close mobile drawer on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Auto-expand group containing the active route. Re-runs on nav so Cmd+K
  // jumps into a closed group still open the right one.
  useEffect(() => {
    const target = groupForPath(location.pathname, role, perms);
    if (!target) return;
    setOpenGroups(prev => {
      if (prev[target]) return prev;
      const next = { ...prev, [target]: true };
      writeStoredGroups(next);
      return next;
    });
  }, [location.pathname, role, perms]);

  // Cmd+K / Ctrl+K command palette
  useEffect(() => {
    function onKey(e) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function toggleGroup(id) {
    setOpenGroups(prev => {
      const next = { ...prev, [id]: !prev[id] };
      writeStoredGroups(next);
      return next;
    });
  }

  const visible = useMemo(() => getVisibleEntries(role, perms), [role, perms]);

  // Bucket visible entries: flat sections (group=null) keep their own label;
  // collapsibles get bucketed by group.
  const flatSections = useMemo(() => {
    const map = new Map();
    for (const e of visible) {
      if (e.group) continue;
      if (!map.has(e.section)) map.set(e.section, []);
      map.get(e.section).push(e);
    }
    return map; // Map<sectionLabel, entries[]>
  }, [visible]);

  const grouped = useMemo(() => {
    const map = { tools: [], finance: [], settings: [] };
    for (const e of visible) {
      if (e.group && map[e.group]) map[e.group].push(e);
    }
    return map;
  }, [visible]);

  // Order of flat sections
  const FLAT_ORDER = ['Personal', 'CRM', 'Marketing', 'AI & Automation'];

  return (
    <>
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        className="md:hidden fixed top-2 left-2 z-30 p-2 bg-white border border-slate-200 rounded-lg shadow-sm text-slate-600 hover:text-slate-900"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Command palette — sibling of aside so transforms don't clip it */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} entries={visible} />

      <aside
        className={`bg-slate-900 text-slate-300 flex flex-col flex-shrink-0
          md:static md:w-56 md:min-h-screen md:translate-x-0
          fixed inset-y-0 left-0 z-50 w-64 h-screen
          transform transition-transform duration-200 ease-out
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Mobile close button */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
          className="md:hidden absolute top-3 right-3 text-slate-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-700/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-sky-500 to-emerald-400 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-sky-500/20">
              GE
            </div>
            <div>
              <p className="text-white font-semibold text-sm leading-tight">Growth Escalators</p>
              <p className="text-slate-500 text-xs">CRM</p>
            </div>
          </div>
        </div>

        {/* Nav — flex column so Settings group can mt-auto to bottom */}
        <nav className="flex-1 flex flex-col px-3 py-2 overflow-y-auto">
          {/* Flat sections */}
          {FLAT_ORDER.map(section => {
            const entries = flatSections.get(section);
            if (!entries || entries.length === 0) return null;
            return (
              <React.Fragment key={section}>
                <SectionLabel>{section}</SectionLabel>
                {entries.map(e => (
                  <NavEntry key={e.id} entry={e} unreadCount={unreadCount} />
                ))}
              </React.Fragment>
            );
          })}

          {/* Tools (collapsible) */}
          {grouped.tools.length > 0 && (
            <>
              <div className="pt-3" />
              <GroupHeader id="tools" label={GROUP_LABELS.tools} isOpen={openGroups.tools} onToggle={() => toggleGroup('tools')} />
              {openGroups.tools && grouped.tools.map(e => (
                <NavEntry key={e.id} entry={e} unreadCount={unreadCount} nested />
              ))}
            </>
          )}

          {/* Finance (collapsible) */}
          {grouped.finance.length > 0 && (
            <>
              <div className="pt-2" />
              <GroupHeader id="finance" label={GROUP_LABELS.finance} isOpen={openGroups.finance} onToggle={() => toggleGroup('finance')} />
              {openGroups.finance && grouped.finance.map(e => (
                <NavEntry key={e.id} entry={e} unreadCount={unreadCount} nested />
              ))}
            </>
          )}

          {/* Settings (collapsible, pinned to bottom of nav) */}
          {grouped.settings.length > 0 && (
            <div className="mt-auto pt-2">
              <GroupHeader id="settings" label={GROUP_LABELS.settings} isOpen={openGroups.settings} onToggle={() => toggleGroup('settings')} />
              {openGroups.settings && grouped.settings.map(e => (
                <NavEntry key={e.id} entry={e} unreadCount={unreadCount} nested />
              ))}
            </div>
          )}
        </nav>

        {/* User + logout */}
        <div className="px-4 py-4 border-t border-slate-700/60">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white uppercase">
              {user?.name?.[0] ?? '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-medium truncate">{user?.name ?? 'User'}</p>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${ROLE_BADGE_COLORS[role] || ROLE_BADGE_COLORS.staff}`} />
                <span className="text-slate-500 text-xs">{ROLE_LABELS[role] || 'Staff'}</span>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-slate-600 mb-2">⌘K to search</p>
          <button
            onClick={logout}
            className="w-full text-left text-xs text-slate-500 hover:text-white transition-colors px-1"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
