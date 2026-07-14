import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { logout, getUser, getPermissions, apiFetch } from '../lib/api.js';
import { getTenantConfig, getTenantSlug } from '../lib/auth.js';
import { ChevronRight, Menu, X, Wrench, Receipt, Settings as SettingsIcon } from 'lucide-react';
import { NAV_ENTRIES, GROUP_LABELS, getVisibleEntries, groupForPath } from './navEntries.js';
import CommandPalette from './CommandPalette.jsx';
import { closedStaffingPhases, normalizeStaffingAccess } from '../lib/staffingAccess.js';

const ROLE_BADGE_COLORS = {
  admin: 'bg-primary-700',
  manager_ops: 'bg-primary-400',
  manager_ads: 'bg-primary-500',
  sales: 'bg-accent-500',
  staff: 'bg-neutral-500',
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

function SectionLabel({ children }) {
  return (
    <p className="px-3 pt-5 pb-1 text-[10.5px] font-semibold text-primary-300 uppercase tracking-[0.1em]">
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

function NavEntry({ entry, unreadCount, pendingLeavesCount, nested = false }) {
  const Icon = entry.icon;
  const basePad = nested ? 'pl-5 pr-3' : 'px-3';

  if (entry.external) {
    return (
      <a href={entry.href} target="_blank" rel="noopener noreferrer"
        className={`relative flex items-center gap-3 ${basePad} py-2 rounded-md text-[13.5px] font-medium transition-all duration-150 text-[rgba(219,234,254,0.78)] hover:bg-white/5 hover:text-white`}>
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
      className={({ isActive }) =>
        `relative flex items-center gap-3 ${basePad} py-2 rounded-md text-[13.5px] font-medium transition-all duration-150 ${
          isActive ? 'bg-white/10 text-white font-semibold' : 'text-[rgba(219,234,254,0.78)] hover:bg-white/5 hover:text-white'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded-[2px] bg-primary-400" />
          )}
          <Icon className="w-4 h-4" />
          <span className="flex-1">{entry.label}</span>
          {entry.badge === 'inbox-unread' && unreadCount > 0 && (
            <span className="bg-accent-500 text-white text-[11px] rounded-full px-1.5 py-0.5 min-w-5 text-center font-semibold leading-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          {entry.badge === 'pending-leaves' && pendingLeavesCount > 0 && (
            <span className="bg-accent-500 text-white text-[11px] rounded-full px-1.5 py-0.5 min-w-5 text-center font-semibold leading-none">
              {pendingLeavesCount > 99 ? '99+' : pendingLeavesCount}
            </span>
          )}
          {entry.newTab && <ExternalChevron />}
        </>
      )}
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
      className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-[13.5px] font-medium text-[rgba(219,234,254,0.78)] hover:bg-white/5 hover:text-white transition-all duration-150"
    >
      <Icon className="w-4 h-4" />
      <span className="flex-1 text-left">{label}</span>
      <ChevronRight className={`w-3.5 h-3.5 text-primary-300 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
    </button>
  );
}

export default function Sidebar() {
  const user = getUser();
  const perms = getPermissions();
  const role = user?.role || 'staff';
  const tenantSlug = user?.tenantSlug || getTenantSlug();
  const tenant = getTenantConfig(tenantSlug);
  const location = useLocation();

  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingLeavesCount, setPendingLeavesCount] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState(readStoredGroups);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [staffingPhases, setStaffingPhases] = useState(closedStaffingPhases);

  // Phase visibility is a runtime server decision. Fail closed so a stale or
  // cached Vite bundle can never expose a phase that the API has disabled.
  useEffect(() => {
    let cancelled = false;
    setStaffingPhases(closedStaffingPhases());
    if (String(tenantSlug).toLowerCase() !== 'wizmatch' || perms.staffingPilotAccess !== true) {
      return () => { cancelled = true; };
    }
    apiFetch('/api/wizmatch/staffing/access')
      .then(response => {
        if (cancelled) return;
        const access = normalizeStaffingAccess(response);
        setStaffingPhases(access.allowed ? access.phases : closedStaffingPhases());
      })
      .catch(() => {
        if (!cancelled) setStaffingPhases(closedStaffingPhases());
      });
    return () => { cancelled = true; };
  }, [tenantSlug, perms.staffingPilotAccess]);

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

  // Pending leaves badge — poll every 60s. The Expenses entry (route /finance)
  // shows this; approval UI lives there in the Attendance tab.
  useEffect(() => {
    function fetchPending() {
      apiFetch('/api/finance/leaves/pending-count')
        .then(d => setPendingLeavesCount(d?.count ?? 0))
        .catch(() => {});
    }
    fetchPending();
    const interval = setInterval(fetchPending, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Auto-close mobile drawer on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Auto-expand group containing the active route. Re-runs on nav so Cmd+K
  // jumps into a closed group still open the right one.
  useEffect(() => {
    const target = groupForPath(location.pathname, role, perms, tenantSlug, staffingPhases);
    if (!target) return;
    setOpenGroups(prev => {
      if (prev[target]) return prev;
      const next = { ...prev, [target]: true };
      writeStoredGroups(next);
      return next;
    });
  }, [location.pathname, role, perms, tenantSlug, staffingPhases]);

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

  const visible = useMemo(
    () => getVisibleEntries(role, perms, tenantSlug, staffingPhases),
    [role, perms, tenantSlug, staffingPhases],
  );

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
  const FLAT_ORDER = ['Personal', 'CRM', 'Marketing', 'AI & Automation', 'Wizmatch'];

  return (
    <>
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        className="md:hidden fixed top-2 left-2 z-30 p-2 bg-white border border-neutral-200 rounded-lg shadow-card text-neutral-600 hover:text-neutral-900"
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
        className={`sidebar-fluent text-[rgba(219,234,254,0.78)] flex flex-col flex-shrink-0
          md:static md:w-64 md:min-h-screen md:translate-x-0
          fixed inset-y-0 left-0 z-50 w-64 h-screen
          transform transition-transform duration-200 ease-out
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Mobile close button */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
          className="md:hidden absolute top-3 right-3 text-primary-300 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <img src="/ge-mark.png" alt={tenant.shortLabel} className="w-9 h-9 rounded-lg border border-white/20" />
            <div>
              <p className="text-white font-semibold text-[13.5px] leading-tight">{tenant.label}</p>
              <p className="text-primary-300 text-[11.5px]">{tenant.productLabel || tenant.subtitle}</p>
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
                  <NavEntry key={e.id} entry={e} unreadCount={unreadCount} pendingLeavesCount={pendingLeavesCount} />
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
                <NavEntry key={e.id} entry={e} unreadCount={unreadCount} pendingLeavesCount={pendingLeavesCount} nested />
              ))}
            </>
          )}

          {/* Finance (collapsible) */}
          {grouped.finance.length > 0 && (
            <>
              <div className="pt-2" />
              <GroupHeader id="finance" label={GROUP_LABELS.finance} isOpen={openGroups.finance} onToggle={() => toggleGroup('finance')} />
              {openGroups.finance && grouped.finance.map(e => (
                <NavEntry key={e.id} entry={e} unreadCount={unreadCount} pendingLeavesCount={pendingLeavesCount} nested />
              ))}
            </>
          )}

          {/* Settings (collapsible, pinned to bottom of nav) */}
          {grouped.settings.length > 0 && (
            <div className="mt-auto pt-2">
              <GroupHeader id="settings" label={GROUP_LABELS.settings} isOpen={openGroups.settings} onToggle={() => toggleGroup('settings')} />
              {openGroups.settings && grouped.settings.map(e => (
                <NavEntry key={e.id} entry={e} unreadCount={unreadCount} pendingLeavesCount={pendingLeavesCount} nested />
              ))}
            </div>
          )}
        </nav>

        {/* User + logout */}
        <div className="px-4 py-4 border-t border-white/10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-xs font-bold text-white uppercase">
              {user?.name?.[0] ?? '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-medium truncate">{user?.name ?? 'User'}</p>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${ROLE_BADGE_COLORS[role] || ROLE_BADGE_COLORS.staff}`} />
                <span className="text-primary-300 text-xs">{ROLE_LABELS[role] || 'Staff'}</span>
              </div>
            </div>
          </div>
          <p className="inline-flex items-center border border-white/[0.08] bg-white/[0.08] rounded px-1.5 py-0.5 text-[10px] text-primary-300/70 mb-2">⌘K to search</p>
          <button
            onClick={logout}
            className="w-full text-left text-xs text-[rgba(219,234,254,0.6)] hover:text-white transition-colors px-1"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
