import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { logout, getUser, getPermissions, apiFetch } from '../lib/api.js';
import { getTenantConfig, getTenantFeatureFlags, getTenantSlug } from '../lib/auth.js';
import { refreshTenantBranding } from '../lib/branding.js';
import { refreshTenantFeatures } from '../lib/tenantFeatures.js';
import { ChevronRight, Menu, X, Wrench, Receipt, Settings as SettingsIcon, MoreHorizontal } from 'lucide-react';
import { GROUP_LABELS, getVisibleEntries, groupForPath } from './navEntries.js';
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
const DEFAULT_GROUPS = { tools: false, finance: false, settings: false, 'wizmatch-more': false };
const GROUP_ICONS = { tools: Wrench, finance: Receipt, settings: SettingsIcon, 'wizmatch-more': MoreHorizontal };
// 2026-08-02 — 'Communication' dropped: its three rows (Inbox, Email
// Templates, WhatsApp Templates) are Growth CRM surfaces and are now
// routable-but-hidden in wizmatchRouteRegistry.ts, leaving the bucket
// permanently empty. Re-adding a section here without a registry entry
// declaring it is inert; re-adding a registry `moreSection` without listing it
// here silently drops the row from the sidebar while leaving it in Cmd+K —
// src/__tests__/sidebarNavBucketCoverage.test.ts fails on the second case.
//
// DEFAULT_GROUPS/GROUP_ICONS above are deliberately untouched: 'wizmatch-more'
// still has rows (CRM Utilities, Administration, Finance) and tools/finance/
// settings are Growth's, which this change does not affect.
const MORE_SECTION_ORDER = ['CRM Utilities', 'Administration', 'Finance'];

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

// Is `entry` the row the current URL belongs to?
//
// This replaces NavLink's built-in isActive, which compares pathname ONLY.
// Two Administration rows point at the same page with different tabs —
// System (`/wizmatch/system`) and Provider Runs (`/wizmatch/system?tab=sourcing`)
// — so NavLink highlighted BOTH at once, on either URL. Rules:
//   • a row carrying query params is active only when every one of them
//     matches the current URL;
//   • a bare row loses to a sibling query row that matches, so landing on
//     ?tab=sourcing lights up Provider Runs and not System.
function isEntryActive(entry, location, siblings) {
  if (!entry.to || entry.external || entry.newTab) return false;
  const [toPath, toQuery = ''] = entry.to.split('?');
  const onPath = location.pathname === toPath || location.pathname.startsWith(`${toPath}/`);
  if (!onPath) return false;

  const current = new URLSearchParams(location.search);
  if (toQuery) {
    return [...new URLSearchParams(toQuery)].every(([k, v]) => current.get(k) === v);
  }
  // Bare row: yield to any query-bearing sibling on the same path that matches.
  return !siblings.some((s) => (
    s !== entry
    && s.to?.startsWith(`${toPath}?`)
    && [...new URLSearchParams(s.to.split('?')[1] || '')].every(([k, v]) => current.get(k) === v)
  ));
}

function NavEntry({ entry, unreadCount, pendingLeavesCount, nested = false, active = false }) {
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
    <Link
      to={entry.to}
      aria-current={active ? 'page' : undefined}
      {...(entry.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={`relative flex items-center gap-3 ${basePad} py-2 rounded-md text-[13.5px] font-medium transition-all duration-150 ${
        active ? 'bg-white/10 text-white font-semibold' : 'text-[rgba(219,234,254,0.78)] hover:bg-white/5 hover:text-white'
      }`}
    >
      {active && (
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
    </Link>
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
  const [, forceRerenderForBranding] = useState(0);
  const [tenantFeatures, setTenantFeatures] = useState(() => getTenantFeatureFlags(tenantSlug));

  // `tenant` (above) reads branding from the localStorage cache synchronously
  // at render time via getTenantConfig — this effect's only job is to refresh
  // that cache from the server and trigger a re-render when it changes, so
  // the Sidebar is correctly on-brand even if it mounted before App.jsx's own
  // boot-time fetch (see App.jsx) resolved, e.g. right after the login page's
  // navigate().
  useEffect(() => {
    let cancelled = false;
    refreshTenantBranding().then((branding) => {
      if (!cancelled && branding) forceRerenderForBranding((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [tenantSlug]);

  // Same shape as the branding effect above, for the tenant's feature-flag
  // entitlements (navEntries.js's canBilling etc). `tenantFeatures` state
  // seeds synchronously from cache (getTenantFeatureFlags) so a returning
  // tenant's nav is correct on first paint; this refreshes it from the server
  // in case the cache is stale or this is the first session on this device.
  useEffect(() => {
    let cancelled = false;
    setTenantFeatures(getTenantFeatureFlags(tenantSlug));
    refreshTenantFeatures().then((features) => {
      if (!cancelled && features) setTenantFeatures(features);
    });
    return () => { cancelled = true; };
  }, [tenantSlug]);

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

  const visible = useMemo(
    () => getVisibleEntries(role, perms, tenantSlug, staffingPhases, tenantFeatures),
    [role, perms, tenantSlug, staffingPhases, tenantFeatures],
  );

  // Sidebar renders on every authenticated page, so anything it polls is a
  // request on every page. Both badge polls below used to run with an empty
  // dependency array — unconditionally, for every user, on every route. A
  // production audit found them among the 3 slowest calls on 25 and 22 of 37
  // pages respectively, including for users who could not see the badge they
  // were fetching.
  //
  // Gate on the only thing that can consume the number: a nav row this user
  // actually sees carrying that badge. `visible` is already permission- and
  // tenant-filtered, so this covers both "no permission" and "not in this
  // product's nav" without a second rule to keep in sync. Same shape as the
  // fail-closed guard in the staffing-phase effect above.
  const showsInboxBadge = useMemo(
    () => visible.some(e => e.badge === 'inbox-unread'),
    [visible],
  );
  const showsPendingLeavesBadge = useMemo(
    () => visible.some(e => e.badge === 'pending-leaves'),
    [visible],
  );

  // Inbox unread badge — poll every 30s, only while a visible row shows it.
  useEffect(() => {
    if (!showsInboxBadge) {
      // Drop any count fetched before the gate closed, so a permission or
      // tenant switch can't leave a stale badge painted on the new nav.
      setUnreadCount(0);
      return undefined;
    }
    function fetchUnread() {
      apiFetch('/api/inbox/unread-count')
        .then(d => setUnreadCount(d?.count ?? 0))
        .catch(() => {});
    }
    fetchUnread();
    const interval = setInterval(fetchUnread, 30_000);
    return () => clearInterval(interval);
  }, [showsInboxBadge]);

  // Pending leaves badge — poll every 60s, only while a visible row shows it.
  // The Expenses entry (route /finance) shows this; approval UI lives there in
  // the Attendance tab.
  useEffect(() => {
    if (!showsPendingLeavesBadge) {
      setPendingLeavesCount(0);
      return undefined;
    }
    function fetchPending() {
      apiFetch('/api/finance/leaves/pending-count')
        .then(d => setPendingLeavesCount(d?.count ?? 0))
        .catch(() => {});
    }
    fetchPending();
    const interval = setInterval(fetchPending, 60_000);
    return () => clearInterval(interval);
  }, [showsPendingLeavesBadge]);

  // Auto-close mobile drawer on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Auto-expand group containing the active route. Re-runs on nav so Cmd+K
  // jumps into a closed group still open the right one.
  useEffect(() => {
    const target = groupForPath(location.pathname, role, perms, tenantSlug, staffingPhases, tenantFeatures);
    if (!target) return;
    setOpenGroups(prev => {
      if (prev[target]) return prev;
      const next = { ...prev, [target]: true };
      writeStoredGroups(next);
      return next;
    });
  }, [location.pathname, role, perms, tenantSlug, staffingPhases, tenantFeatures]);

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

  // Query-aware active state — see isEntryActive above for why NavLink's own
  // isActive isn't enough. `visible` is passed so a bare row can defer to a
  // query-bearing sibling on the same path.
  const isActive = useCallback(
    (entry) => isEntryActive(entry, location, visible),
    [location, visible],
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
    const map = { tools: [], finance: [], settings: [], 'wizmatch-more': [] };
    for (const e of visible) {
      if (e.group && map[e.group]) map[e.group].push(e);
    }
    return map;
  }, [visible]);

  // Sub-bucket the unified Wizmatch "More" group by its labeled section
  // (Communication / CRM Utilities / Administration / Finance), driven by
  // wizmatchRouteRegistry.ts via navEntries.js's wizmatchEntriesFromRegistry().
  const moreByCategory = useMemo(() => {
    const map = {};
    for (const section of MORE_SECTION_ORDER) map[section] = [];
    for (const e of grouped['wizmatch-more']) {
      if (e.moreSection && map[e.moreSection]) map[e.moreSection].push(e);
    }
    return map;
  }, [grouped]);

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
        aria-label="Sidebar"
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
            <img src={tenant.logoUrl || '/ge-mark.png'} alt={tenant.shortLabel} className="w-9 h-9 rounded-lg border border-white/20" />
            <div>
              <p className="text-white font-semibold text-[13.5px] leading-tight">{tenant.label}</p>
              <p className="text-primary-300 text-[11.5px]">{tenant.productLabel || tenant.subtitle}</p>
            </div>
          </div>
        </div>

        {/* Nav — flex column so Settings group can mt-auto to bottom.
            aria-label is required, not cosmetic: this <nav> and Breadcrumbs'
            <nav> are two navigation landmarks on every page, and axe's
            landmark-unique rule flags both when neither has an accessible
            name (26 nodes across the audited pages). Attribute only — no
            markup or styling change. */}
        <nav aria-label="Main navigation" className="flex-1 flex flex-col px-3 py-2 overflow-y-auto">
          {/* Flat sections */}
          {FLAT_ORDER.map(section => {
            const entries = flatSections.get(section);
            if (!entries || entries.length === 0) return null;
            return (
              <React.Fragment key={section}>
                <SectionLabel>{section}</SectionLabel>
                {entries.map(e => (
                  <NavEntry key={e.id} entry={e} unreadCount={unreadCount} pendingLeavesCount={pendingLeavesCount} active={isActive(e)} />
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
                <NavEntry key={e.id} entry={e} unreadCount={unreadCount} pendingLeavesCount={pendingLeavesCount} nested active={isActive(e)} />
              ))}
            </>
          )}

          {/* Finance (collapsible) */}
          {grouped.finance.length > 0 && (
            <>
              <div className="pt-2" />
              <GroupHeader id="finance" label={GROUP_LABELS.finance} isOpen={openGroups.finance} onToggle={() => toggleGroup('finance')} />
              {openGroups.finance && grouped.finance.map(e => (
                <NavEntry key={e.id} entry={e} unreadCount={unreadCount} pendingLeavesCount={pendingLeavesCount} nested active={isActive(e)} />
              ))}
            </>
          )}

          {/* Settings (collapsible, pinned to bottom of nav) */}
          {grouped.settings.length > 0 && (
            <div className="mt-auto pt-2">
              <GroupHeader id="settings" label={GROUP_LABELS.settings} isOpen={openGroups.settings} onToggle={() => toggleGroup('settings')} />
              {openGroups.settings && grouped.settings.map(e => (
                <NavEntry key={e.id} entry={e} unreadCount={unreadCount} pendingLeavesCount={pendingLeavesCount} nested active={isActive(e)} />
              ))}
            </div>
          )}

          {/* More (collapsible, pinned to bottom of nav — Wizmatch product only) */}
          {grouped['wizmatch-more'].length > 0 && (
            <div className="mt-auto pt-2">
              <GroupHeader id="wizmatch-more" label={GROUP_LABELS['wizmatch-more']} isOpen={openGroups['wizmatch-more']} onToggle={() => toggleGroup('wizmatch-more')} />
              {openGroups['wizmatch-more'] && MORE_SECTION_ORDER.map(section => (
                moreByCategory[section].length > 0 && (
                  <React.Fragment key={section}>
                    <p className="pl-5 pr-3 pt-2 pb-1 text-[10px] font-semibold text-primary-300/70 uppercase tracking-[0.08em]">{section}</p>
                    {moreByCategory[section].map(e => (
                      <NavEntry key={e.id} entry={e} unreadCount={unreadCount} pendingLeavesCount={pendingLeavesCount} nested active={isActive(e)} />
                    ))}
                  </React.Fragment>
                )
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
          <p className="inline-flex items-center border border-white/[0.08] bg-white/[0.08] rounded px-1.5 py-0.5 text-[10px] text-primary-300/70 mb-2">⌘K to search or jump</p>
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
