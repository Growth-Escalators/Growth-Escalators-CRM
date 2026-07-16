import {
  Calendar, Home, Users, Kanban, CheckSquare, MessageSquare, TrendingUp,
  Megaphone, Share2, Target, Search, FileText, Brain, MapPin, Zap, Mail,
  Link as LinkIcon, CreditCard, Receipt, Shield, ShieldCheck, ClipboardList, Settings,
  Briefcase, UserCheck, BarChart3, Building2, UserRound, SendHorizontal,
} from 'lucide-react';
import { WIZMATCH_ROUTE_REGISTRY } from '../lib/wizmatchRouteRegistry.js';

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

function entryProduct(entry) {
  if (entry.product) return entry.product;
  return entry.section === 'Wizmatch' ? 'wizmatch' : 'growth';
}

export function computeFlags(role, perms = {}, tenantSlug = 'growth-escalators', staffingPhases = {}) {
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
    product,
    isGrowthProduct: product === 'growth',
    isWizmatchProduct: product === 'wizmatch',
    canCRM:        ['admin', 'manager_ops', 'team_lead', 'sales'].includes(role),
    canTasks:      ['admin', 'manager_ops', 'team_lead', 'sales'].includes(role) || isCreativeAssistant,
    canAds:        ['admin', 'manager_ads', 'team_lead', 'creative_assistant'].includes(role) || !!perms.reportsMetaAds,
    canReports:    ['admin', 'manager_ops', 'manager_ads'].includes(role),
    canSocial:     ['admin', 'manager_ops', 'team_lead', 'staff', 'creative_assistant'].includes(role) || !!perms.accessSocial,
    canInbox:      ['admin', 'manager_ops', 'team_lead', 'sales', 'creative_assistant'].includes(role),
    canBilling:    isAdmin || !!perms.billingView,
    canSequences:  ['admin', 'manager_ops', 'team_lead', 'sales'].includes(role),
    canDiscovery:  ['admin', 'manager_ops', 'team_lead', 'sales'].includes(role),
    canMarketing:  ['admin', 'manager_ads'].includes(role),
    canSEO:        ['admin', 'manager_ops', 'manager_ads'].includes(role),
    canWizmatch:   product === 'wizmatch' && isAdminTier,
    canStaffing:   product === 'wizmatch' && perms.staffingPilotAccess === true && ['admin', 'manager_ops', 'team_lead', 'sales', 'staff'].includes(role),
    staffingPhaseA: staffingPhases.A === true,
    staffingPhaseB: staffingPhases.B === true,
    staffingPhaseC: staffingPhases.C === true,
  };
}

const WIZMATCH_ICONS = {
  'wm-my-work': Home,
  'wm-signals': Zap,
  'wm-relationships': Building2,
  'wm-hiring-contacts': UserRound,
  'wm-requirements': FileText,
  'wm-talent-matching': UserCheck,
  'wm-delivery': SendHorizontal,
  'wm-placements': Briefcase,
  'wm-analytics-new': BarChart3,
  'wm-inbox': MessageSquare,
  'wm-outreach': Target,
  'wm-emails': Mail,
  'wm-wa-templates': MessageSquare,
  'wm-contacts': Users,
  'wm-pipeline': Kanban,
  'wm-tasks': CheckSquare,
  'wm-discover': MapPin,
  'wm-intelligence': Brain,
  'wm-primes': Users,
  'wm-billing': CreditCard,
  'wm-expenses': Receipt,
  'wm-system': Settings,
  'wm-permissions': Shield,
  'wm-audit': ClipboardList,
  'wm-pipeline-manager': Settings,
};

function canSeeWizmatchRoute(item, flags) {
  if (item.phase && flags[`staffingPhase${item.phase}`] !== true) return false;
  switch (item.permission) {
    case 'staffing': return flags.canStaffing;
    case 'staffing-or-admin': return flags.canStaffing || flags.canWizmatch;
    case 'commercial': return flags.canStaffing && flags.isAdminTier;
    case 'admin-tier': return flags.isAdminTier;
    case 'admin': return flags.isAdmin;
    case 'crm': return flags.canCRM;
    case 'tasks': return flags.canTasks;
    case 'inbox': return flags.canInbox;
    case 'billing': return flags.canBilling;
    case 'sequences': return flags.canSequences;
    case 'discovery': return flags.canDiscovery;
    default: return false;
  }
}

const WIZMATCH_NAV_ENTRIES = WIZMATCH_ROUTE_REGISTRY.map((item) => ({
  id: item.id,
  label: item.label,
  to: item.path,
  icon: WIZMATCH_ICONS[item.id] || FileText,
  section: item.section,
  group: item.group,
  product: 'wizmatch',
  keywords: item.keywords,
  description: item.description,
  aliases: item.aliases,
  phase: item.phase,
  badge: item.id === 'wm-inbox' ? 'inbox-unread' : item.id === 'wm-expenses' ? 'pending-leaves' : undefined,
  visible: (flags) => canSeeWizmatchRoute(item, flags),
}));

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
    id: 'expenses', label: 'Expenses', to: '/finance',
    icon: Receipt, section: 'Finance', group: 'finance',
    badge: 'pending-leaves',
    visible: f => f.canBilling,
  },
  {
    id: 'funnels', label: 'Funnels', to: '/funnels',
    icon: Zap, section: 'Finance', group: 'finance',
    visible: f => f.canBilling,
  },

  // ── WIZMATCH — generated from the product route registry ─────
  ...WIZMATCH_NAV_ENTRIES,

  // ── SETTINGS (collapsible, pinned to bottom) ──────────────────
  {
    id: 'permissions', label: 'Permissions', to: '/settings/permissions',
    icon: Shield, section: 'Settings', group: 'settings',
    visible: f => f.isAdmin,
  },
  {
    id: 'audit', label: 'Audit Log', to: '/settings/audit',
    icon: ClipboardList, section: 'Settings', group: 'settings',
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
];

export function getVisibleEntries(role, perms, tenantSlug, staffingPhases) {
  const flags = computeFlags(role, perms, tenantSlug, staffingPhases);
  return NAV_ENTRIES.filter(e => entryProduct(e) === flags.product && e.visible(flags));
}

// Map collapsible group name → entry's section label (for palette breadcrumbs)
export const GROUP_LABELS = {
  tools: 'Tools',
  finance: 'Finance',
  settings: 'Settings',
  'more-communication': 'More · Communication',
  'more-crm': 'More · CRM utilities',
  'more-admin': 'More · Administration',
};

// Find which collapsible group (if any) owns a given pathname.
// Used by Sidebar's auto-expand-on-route logic.
export function groupForPath(pathname, role, perms, tenantSlug, staffingPhases) {
  const entries = getVisibleEntries(role, perms, tenantSlug, staffingPhases);
  // Match longest "to" first so /settings/permissions wins over /settings.
  const sorted = [...entries].sort((a, b) => (b.to?.length || 0) - (a.to?.length || 0));
  for (const e of sorted) {
    if (!e.group) continue;
    const paths = [e.to, ...(e.aliases || []).map((alias) => alias.path)].filter(Boolean);
    if (paths.some((path) => pathname === path || pathname.startsWith(path + '/'))) {
      return e.group.startsWith('more-') ? 'more' : e.group;
    }
  }
  return null;
}
