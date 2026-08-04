import {
  Calendar, Home, Users, Kanban, CheckSquare, MessageSquare, TrendingUp,
  Megaphone, Share2, Target, Search, FileText, Brain, MapPin, Zap, Mail,
  Link as LinkIcon, CreditCard, Receipt, Shield, ShieldCheck, ClipboardList, Settings,
  Briefcase, Building2, Palette, Plug, UserPlus,
} from 'lucide-react';
import { WIZMATCH_ROUTES, evaluateWizmatchPermission } from '../routes/wizmatchRouteRegistry.ts';
import { companyPolicyUiEnabled } from '../lib/companyPolicyFlag.js';
import { decisionWorkbenchUiEnabled } from '../lib/decisionWorkbenchFlag.js';

// Permission flag bag — derived from user role + per-user permission overrides.
// Matches the gating that lived inline in Sidebar.jsx pre-refactor.
//
// Role hierarchy (low → high trust):
//   staff < sales < team_lead < manager_ops/manager_ads < admin
// `team_lead` = full operational tools (Outreach, AI Intelligence, Growth OS,
// Meta Ads) but NOT financial/security tools (Billing, Permissions, Audit).
function productForTenantSlug(tenantSlug = 'growth-escalators') {
  return String(tenantSlug || '').toLowerCase().trim() === 'wizmatch' ? 'wizmatch' : 'growth';
}

// Wizmatch nav entries are derived from the shared route registry (see
// wizmatchRouteRegistry.ts) rather than declared statically here, so the
// registry stays the single source of truth for routing + nav + breadcrumbs.
// `group: 'primary'` renders flat under the "Wizmatch" section (like any
// other always-visible section); every other group renders nested under one
// collapsible "More" entry, bucketed by `moreSection`.
function wizmatchEntriesFromRegistry() {
  return WIZMATCH_ROUTES
    .filter((route) => route.group !== undefined)
    .map((route) => ({
      id: route.id,
      label: route.label,
      to: route.path,
      icon: route.icon,
      section: 'Wizmatch',
      group: route.group === 'primary' ? null : 'wizmatch-more',
      moreSection: route.group === 'primary' ? undefined : route.moreSection,
      product: 'wizmatch',
      badge: route.badge,
      visible: (flags) => evaluateWizmatchPermission(flags, route.permission),
    }));
}

export function computeFlags(role, perms = {}, tenantSlug = 'growth-escalators', staffingPhases = {}, tenantFeatures = {}) {
  const isAdmin = role === 'admin';
  const isTeamLead = role === 'team_lead';
  const isAdminTier = isAdmin || isTeamLead;
  const product = productForTenantSlug(tenantSlug);
  // Narrow-scope role: only Tasks + Inbox + Meta Ads + Social + (always-on)
  // Content link and My Attendance. Everything else (Contacts, Pipeline,
  // Clients, Billing, Sequences, Discovery, Outreach, Growth OS, Intelligence,
  // SEO, Analytics, Reports, etc.) stays hidden.
  const isCreativeAssistant = role === 'creative_assistant';
  return {
    isAdmin,
    isTeamLead,
    isAdminTier,
    isCreativeAssistant,
    // Tenant branding (name/logo/colors) is owner-only — same predicate as
    // the PUT /api/tenant-branding route's own check (src/routes/
    // tenantBranding.ts: `if (!myPerms?.isOwner)`). `perms.isOwner` reaches
    // the client in the /api/permissions/me payload, same as canBilling above.
    isOwner: !!perms.isOwner,
    // Platform superadmin — a GE-staff-only, opt-in cross-tenant flag (NOT a
    // role or a per-tenant grant; see src/middleware/rbac.ts's
    // requirePlatformSuperadmin doc comment). Reaches the client in the
    // /api/permissions/me payload for the caller's own session only. Gates
    // the "Provision Tenant" nav entry below — the backend route
    // (POST /api/platform/tenants) re-checks this from the DB independently,
    // so hiding the nav entry is defense-in-depth, not the actual boundary.
    isPlatformSuperadmin: !!perms.isPlatformSuperadmin,
    product,
    isGrowthProduct: product === 'growth',
    isWizmatchProduct: product === 'wizmatch',
    canCRM:        ['admin', 'manager_ops', 'team_lead', 'sales'].includes(role),
    canTasks:      ['admin', 'manager_ops', 'team_lead', 'sales'].includes(role) || isCreativeAssistant,
    canAds:        ['admin', 'manager_ads', 'team_lead', 'creative_assistant'].includes(role) || !!perms.reportsMetaAds,
    canReports:    ['admin', 'manager_ops', 'manager_ads'].includes(role),
    canSocial:     ['admin', 'manager_ops', 'team_lead', 'staff', 'creative_assistant'].includes(role) || !!perms.accessSocial,
    canInbox:      ['admin', 'manager_ops', 'team_lead', 'sales', 'creative_assistant'].includes(role),
    // Billing nav visibility must match the API's own rule, which is a DB
    // grant and NOT a role: every /api/billing handler gates on
    // `!p?.billingView && !p?.isOwner` (src/routes/billing.ts). The old
    // `isAdmin ||` shortcut showed the Billing page to any admin without the
    // grant, and all four of its endpoints then 403'd — verified in
    // production. `isOwner` is included because it is part of the same
    // backend predicate and reaches the client in the /api/permissions/me
    // payload (the endpoint spreads the whole userPermissions row).
    //
    // `tenantFeatures.gstBilling !== false` layers the PLAN entitlement on
    // top: `/api/billing` is also mounted behind
    // `requireTenantFeature('gstBilling')` (src/index.ts), so a reseller/
    // client tenant without that flag gets a 403 from every one of these
    // endpoints regardless of role or grant. `!== false` (not `=== true`) is
    // deliberate — tenantFeatures starts as `{}` before the
    // /api/tenant-features/me fetch resolves (see admin/src/lib/
    // tenantFeatures.js), and an unresolved fetch must never hide a nav
    // entry that would otherwise be visible; only an explicit `false`
    // (agency_internal's own default is `true` — PLAN_DEFAULTS in
    // src/services/tenantFeatures.ts — so this is a no-op for GE's own
    // tenant) hides it.
    //
    // wizmatch/seo/d2c do NOT get the same treatment here: as of this
    // writing only `gstBilling` (/api/billing) and `wizmatch` (/api/wizmatch)
    // are actually wired to requireTenantFeature (grep src/index.ts), and
    // the wizmatch nav is already isolated by `product === 'wizmatch'` below
    // — Wizmatch is its own tenant (wizmatch_internal), never a reseller's.
    // seo/d2c back no route requireTenantFeature currently gates, so there is
    // nothing to hide yet; add the same `!== false` pattern here if/when one
    // of their routes gets a requireTenantFeature mount, rather than
    // assuming this comment still covers it.
    canBilling:    (!!perms.billingView || !!perms.isOwner) && tenantFeatures.gstBilling !== false,
    // Expenses (/finance) and Funnels (/funnels) used to ride on canBilling,
    // but their APIs (src/routes/finance.ts, src/routes/funnel.ts) carry NO
    // billingView check — they work for any authenticated admin, and /finance
    // is where leave approvals live. Tightening canBilling to the grant would
    // therefore have hidden two pages that were never broken, so they keep the
    // old, deliberately looser predicate under their own name.
    canFinance:    isAdmin || !!perms.billingView || !!perms.isOwner,
    canContracts:  ['admin', 'manager_ops', 'team_lead', 'sales'].includes(role) || !!perms.contractsView,
    canSequences:  ['admin', 'manager_ops', 'team_lead', 'sales'].includes(role),
    canDiscovery:  ['admin', 'manager_ops', 'team_lead', 'sales'].includes(role),
    canMarketing:  ['admin', 'manager_ads'].includes(role),
    canSEO:        ['admin', 'manager_ops', 'manager_ads'].includes(role),
    canWizmatch:   product === 'wizmatch' && isAdminTier,
    canStaffing:   product === 'wizmatch' && perms.staffingPilotAccess === true && ['admin', 'manager_ops', 'team_lead', 'sales', 'staff'].includes(role),
    // H-11 / D-38: nav visibility for the Duplicate Companies entry (and any
    // future company-policy-only nav item) — the same build-time flag that
    // gates the company-drawer Policy section and the backend API.
    wizmatchCompanyPolicyEnabled: companyPolicyUiEnabled === true,
    // PR 6 — gates the re-bucketed Today decision workbench UI. The `/wizmatch/today`
    // route itself stays `permission: 'always'` (it's the landing page); this flag
    // instead switches WizmatchTodayPage.jsx between its legacy bucket view and the
    // new four-queue workbench, so flipping it off can never make Today unreachable.
    wizmatchDecisionWorkbenchEnabled: decisionWorkbenchUiEnabled === true,
    staffingPhaseA: staffingPhases.A === true,
    staffingPhaseB: staffingPhases.B === true,
    staffingPhaseC: staffingPhases.C === true,
  };
}

// Shape of a nav entry:
//   id        — stable key
//   label     — display text + Cmd+K search target
//   to        — internal route (NavLink target)
//   href      — external URL (only when external: true)
//   icon      — lucide-react component
//   section   — 'Personal' | 'CRM' | 'Marketing' | 'AI & Automation' | 'Tools' | 'Finance' | 'Settings'
//   group     — null (always-visible section) | 'tools' | 'finance' | 'settings' (collapsible)
//   external  — opens in new tab
//   newTab    — internal route but opens via target="_blank" (Tools entries)
//   badge     — 'inbox-unread' | undefined (Sidebar-only, palette ignores)
//   visible   — (flags) => boolean
export const NAV_ENTRIES = [
  // ── PERSONAL ──────────────────────────────────────────────────
  {
    id: 'my-attendance', label: 'My Attendance', to: '/my-attendance',
    icon: Calendar, section: 'Personal', group: null,
    visible: () => true,
  },

  // ── CRM ───────────────────────────────────────────────────────
  {
    id: 'dashboard', label: 'Dashboard', to: '/dashboard',
    icon: Home, section: 'CRM', group: null,
    visible: () => true,
  },
  {
    id: 'contacts', label: 'Contacts', to: '/contacts',
    icon: Users, section: 'CRM', group: null,
    visible: f => f.canCRM,
  },
  {
    // UX audit 2026-07-31 — /clients (ClientsPage, ~400 lines) and its
    // /client/:clientId detail page shipped with no nav entry anywhere, so the
    // only way in was typing the URL. The detail route is reached from this
    // list, which is why only the list gets a row.
    id: 'clients', label: 'Clients', to: '/clients',
    icon: Building2, section: 'CRM', group: null,
    visible: f => f.canCRM,
  },
  {
    id: 'pipeline', label: 'Pipeline', to: '/pipeline',
    icon: Kanban, section: 'CRM', group: null,
    visible: f => f.canCRM,
  },
  {
    id: 'tasks', label: 'Tasks', to: '/tasks',
    icon: CheckSquare, section: 'CRM', group: null,
    visible: f => f.canTasks,
  },
  {
    id: 'inbox', label: 'Inbox', to: '/inbox',
    icon: MessageSquare, section: 'CRM', group: null,
    badge: 'inbox-unread',
    visible: f => f.canInbox,
  },

  // ── MARKETING ─────────────────────────────────────────────────
  {
    id: 'ads', label: 'Meta Ads', to: '/ads',
    icon: Megaphone, section: 'Marketing', group: null,
    visible: f => f.canAds,
  },
  {
    id: 'meta-assets', label: 'Meta Assets', to: '/meta-assets',
    icon: ShieldCheck, section: 'Marketing', group: null,
    visible: f => f.canAds,
  },
  {
    id: 'social', label: 'Social', to: '/social',
    icon: Share2, section: 'Marketing', group: null,
    visible: f => f.canSocial,
  },
  {
    id: 'outreach', label: 'Outreach', to: '/outreach-dashboard',
    icon: Target, section: 'Marketing', group: null,
    visible: f => f.isAdminTier,
  },
  {
    id: 'outbound', label: 'Outbound', to: '/outbound',
    icon: Briefcase, section: 'Marketing', group: null,
    visible: f => f.isAdminTier,
  },
  {
    id: 'content', label: 'Content', href: 'https://content.growthescalators.com',
    icon: FileText, section: 'Marketing', group: null, external: true,
    visible: () => true,
  },

  // ── AI & AUTOMATION ───────────────────────────────────────────
  {
    id: 'intelligence', label: 'AI Intelligence', to: '/intelligence',
    icon: Brain, section: 'AI & Automation', group: null,
    visible: f => f.isAdminTier,
  },

  // ── TOOLS (collapsible) ───────────────────────────────────────
  {
    id: 'discover', label: 'Lead Discovery', to: '/discover',
    icon: MapPin, section: 'Tools', group: 'tools', newTab: true,
    visible: f => f.canDiscovery,
  },
  {
    id: 'growth-os', label: 'Growth OS', to: '/growth-os',
    icon: Zap, section: 'Tools', group: 'tools', newTab: true,
    visible: f => f.isAdminTier,
  },
  {
    id: 'emails', label: 'Email Templates', to: '/emails',
    icon: Mail, section: 'Tools', group: 'tools', newTab: true,
    visible: f => f.canSequences,
  },
  {
    id: 'wa-templates', label: 'WA Templates', to: '/whatsapp-templates',
    icon: MessageSquare, section: 'Tools', group: 'tools', newTab: true,
    visible: f => f.canSequences,
  },
  {
    id: 'links', label: 'Short Links', to: '/links',
    icon: LinkIcon, section: 'Tools', group: 'tools',
    visible: f => f.canCRM,
  },

  // ── FINANCE (collapsible) ─────────────────────────────────────
  {
    id: 'billing', label: 'Billing', to: '/billing',
    icon: CreditCard, section: 'Finance', group: 'finance',
    visible: f => f.canBilling,
  },
  {
    id: 'contracts', label: 'Contracts', to: '/contracts',
    icon: FileText, section: 'Finance', group: 'finance',
    visible: f => f.canContracts,
  },
  {
    id: 'expenses', label: 'Expenses', to: '/finance',
    icon: Receipt, section: 'Finance', group: 'finance',
    badge: 'pending-leaves',
    visible: f => f.canFinance,
  },
  {
    id: 'funnels', label: 'Funnels', to: '/funnels',
    icon: Zap, section: 'Finance', group: 'finance',
    visible: f => f.canFinance,
  },

  // ── SETTINGS (collapsible, pinned to bottom) ──────────────────
  {
    id: 'permissions', label: 'Permissions', to: '/settings/permissions',
    icon: Shield, section: 'Settings', group: 'settings',
    visible: f => f.isAdmin,
  },
  {
    id: 'branding', label: 'Branding', to: '/settings/branding',
    icon: Palette, section: 'Settings', group: 'settings',
    visible: f => f.isOwner,
  },
  {
    id: 'audit', label: 'Audit Log', to: '/settings/audit',
    icon: ClipboardList, section: 'Settings', group: 'settings',
    visible: f => f.isAdmin,
  },
  {
    // Per-tenant OAuth connections (currently: Meta Ads). Separate from the
    // shared-account "Connect Facebook" buttons on Social/Meta Assets — see
    // IntegrationsPage.jsx header comment.
    id: 'integrations', label: 'Integrations', to: '/settings/integrations',
    icon: Plug, section: 'Settings', group: 'settings',
    visible: f => f.isAdmin,
  },
  {
    id: 'analytics', label: 'Analytics', to: '/analytics',
    icon: TrendingUp, section: 'Settings', group: 'settings',
    visible: f => f.canReports,
  },
  {
    id: 'seo', label: 'SEO', to: '/seo',
    icon: Search, section: 'Settings', group: 'settings',
    visible: f => f.canSEO,
  },
  {
    id: 'pipeline-manager', label: 'Pipeline Manager', to: '/pipelines/settings',
    icon: Settings, section: 'Settings', group: 'settings',
    visible: f => f.isAdmin,
  },
  {
    // Platform-superadmin only — onboards a new reseller-pilot tenant from
    // the admin panel instead of the CLI (npm run onboarding:provision-
    // reseller-tenant). See src/routes/platformTenants.ts.
    id: 'provision-tenant', label: 'Provision Tenant', to: '/settings/provision-tenant',
    icon: UserPlus, section: 'Settings', group: 'settings',
    visible: f => f.isPlatformSuperadmin,
  },
];

export function getVisibleEntries(role, perms, tenantSlug, staffingPhases, tenantFeatures) {
  const flags = computeFlags(role, perms, tenantSlug, staffingPhases, tenantFeatures);
  if (flags.product === 'wizmatch') {
    return wizmatchEntriesFromRegistry().filter(e => e.visible(flags));
  }
  return NAV_ENTRIES.filter(e => !e.product && e.visible(flags));
}

// Map collapsible group name → entry's section label (for palette breadcrumbs)
export const GROUP_LABELS = {
  tools: 'Tools',
  finance: 'Finance',
  settings: 'Settings',
  'wizmatch-more': 'More',
};

// Find which collapsible group (if any) owns a given pathname.
// Used by Sidebar's auto-expand-on-route logic.
export function groupForPath(pathname, role, perms, tenantSlug, staffingPhases, tenantFeatures) {
  const entries = getVisibleEntries(role, perms, tenantSlug, staffingPhases, tenantFeatures);
  // Compare pathnames only. Some entries deep-link to a tab
  // (`/wizmatch/system?tab=sourcing`); a raw `pathname === e.to` can never
  // match one of those, so the group holding them never auto-expanded.
  const withPath = entries
    .filter((e) => e.to && e.group)
    .map((e) => ({ group: e.group, path: e.to.split('?')[0] }));
  // Match longest path first so /settings/permissions wins over /settings.
  withPath.sort((a, b) => b.path.length - a.path.length);
  for (const e of withPath) {
    if (pathname === e.path || pathname.startsWith(e.path + '/')) return e.group;
  }
  return null;
}
