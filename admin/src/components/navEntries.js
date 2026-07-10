import {
  Calendar, Home, Users, Kanban, CheckSquare, MessageSquare, TrendingUp,
  Megaphone, Share2, Target, Search, FileText, Brain, MapPin, Zap, Mail,
  Link as LinkIcon, CreditCard, Receipt, Shield, ShieldCheck, ClipboardList, Settings,
  Briefcase, UserCheck, BarChart3, Network, DatabaseZap,
} from 'lucide-react';

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

export function computeFlags(role, perms = {}, tenantSlug = 'growth-escalators') {
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

  // ── WIZMATCH STAFFING ─────────────────────────────────────────
  {
    id: 'wm-dashboard', label: 'Dashboard', to: '/wizmatch/dashboard',
    icon: Home, section: 'CRM', group: null, product: 'wizmatch',
    visible: () => true,
  },
  {
    id: 'wm-contacts', label: 'Contacts', to: '/wizmatch/contacts',
    icon: Users, section: 'CRM', group: null, product: 'wizmatch',
    visible: f => f.canCRM,
  },
  {
    id: 'wm-pipeline', label: 'Pipeline', to: '/wizmatch/pipeline',
    icon: Kanban, section: 'CRM', group: null, product: 'wizmatch',
    visible: f => f.canCRM,
  },
  {
    id: 'wm-tasks', label: 'Tasks', to: '/wizmatch/tasks',
    icon: CheckSquare, section: 'CRM', group: null, product: 'wizmatch',
    visible: f => f.canTasks,
  },
  {
    id: 'wm-inbox', label: 'Inbox', to: '/wizmatch/inbox',
    icon: MessageSquare, section: 'CRM', group: null, product: 'wizmatch',
    badge: 'inbox-unread',
    visible: f => f.canInbox,
  },
  {
    id: 'wm-outreach', label: 'Outreach', to: '/wizmatch/outreach',
    icon: Target, section: 'CRM', group: null, product: 'wizmatch',
    visible: f => f.isAdminTier,
  },
  {
    id: 'wm-intelligence', label: 'AI Intelligence', to: '/wizmatch/intelligence',
    icon: Brain, section: 'AI & Automation', group: null, product: 'wizmatch',
    visible: f => f.isAdminTier,
  },
  {
    id: 'wm-discover', label: 'Lead Discovery', to: '/wizmatch/discover',
    icon: MapPin, section: 'Tools', group: 'tools', product: 'wizmatch', newTab: true,
    visible: f => f.canDiscovery,
  },
  {
    id: 'wm-emails', label: 'Email Templates', to: '/wizmatch/emails',
    icon: Mail, section: 'Tools', group: 'tools', product: 'wizmatch', newTab: true,
    visible: f => f.canSequences,
  },
  {
    id: 'wm-wa-templates', label: 'WA Templates', to: '/wizmatch/whatsapp-templates',
    icon: MessageSquare, section: 'Tools', group: 'tools', product: 'wizmatch', newTab: true,
    visible: f => f.canSequences,
  },
  {
    id: 'wm-billing', label: 'Billing', to: '/wizmatch/billing',
    icon: CreditCard, section: 'Finance', group: 'finance', product: 'wizmatch',
    visible: f => f.canBilling,
  },
  {
    id: 'wm-expenses', label: 'Expenses', to: '/wizmatch/finance',
    icon: Receipt, section: 'Finance', group: 'finance', product: 'wizmatch',
    badge: 'pending-leaves',
    visible: f => f.canBilling,
  },
  {
    id: 'wm-permissions', label: 'Permissions', to: '/wizmatch/settings/permissions',
    icon: Shield, section: 'Settings', group: 'settings', product: 'wizmatch',
    visible: f => f.isAdmin,
  },
  {
    id: 'wm-audit', label: 'Audit Log', to: '/wizmatch/settings/audit',
    icon: ClipboardList, section: 'Settings', group: 'settings', product: 'wizmatch',
    visible: f => f.isAdmin,
  },
  {
    id: 'wm-pipeline-manager', label: 'Pipeline Manager', to: '/wizmatch/pipelines/settings',
    icon: Settings, section: 'Settings', group: 'settings', product: 'wizmatch',
    visible: f => f.isAdmin,
  },
  {
    id: 'wm-review-workbench', label: 'Review Workbench', to: '/wizmatch/review-workbench',
    icon: ClipboardList, section: 'Wizmatch', group: null,
    visible: f => f.canWizmatch,
  },
  {
    id: 'wm-readiness', label: 'Data Readiness', to: '/wizmatch/readiness',
    icon: DatabaseZap, section: 'Wizmatch', group: null,
    visible: f => f.canWizmatch,
  },
  {
    id: 'wm-client-discovery-new', label: 'Client Discovery', to: '/wizmatch/client-discovery',
    icon: Search, section: 'Wizmatch', group: null,
    visible: f => f.canWizmatch,
  },
  {
    id: 'wm-signals', label: 'Signals', to: '/wizmatch/signals',
    icon: Zap, section: 'Wizmatch', group: null,
    visible: f => f.canWizmatch,
  },
  {
    id: 'wm-candidate-intelligence-new', label: 'Candidate Intelligence', to: '/wizmatch/candidate-intelligence',
    icon: ClipboardList, section: 'Wizmatch', group: null,
    visible: f => f.canWizmatch,
  },
  {
    id: 'wm-candidates', label: 'Candidates', to: '/wizmatch/candidates',
    icon: UserCheck, section: 'Wizmatch', group: null,
    visible: f => f.canWizmatch,
  },
  {
    id: 'wm-contact-intelligence-new', label: 'Contact Intelligence', to: '/wizmatch/contact-intelligence',
    icon: Network, section: 'Wizmatch', group: null,
    visible: f => f.canWizmatch,
  },
  {
    id: 'wm-requirement-priority-new', label: 'Requirement Priority', to: '/wizmatch/requirement-priority-new',
    icon: Target, section: 'Wizmatch', group: null,
    visible: f => f.canWizmatch,
  },
  {
    id: 'wm-requirements', label: 'Requirements', to: '/wizmatch/requirements',
    icon: FileText, section: 'Wizmatch', group: null,
    visible: f => f.canWizmatch,
  },
  {
    id: 'wm-placements', label: 'Placements', to: '/wizmatch/placements',
    icon: Briefcase, section: 'Wizmatch', group: null,
    visible: f => f.canWizmatch,
  },
  {
    id: 'wm-primes', label: 'Primes', to: '/wizmatch/primes',
    icon: Users, section: 'Wizmatch', group: null,
    visible: f => f.canWizmatch,
  },
  {
    id: 'wm-guardrails-new', label: 'Guardrails', to: '/wizmatch/guardrails-new',
    icon: ShieldCheck, section: 'Wizmatch', group: null,
    visible: f => f.canWizmatch,
  },
  {
    id: 'wm-domains', label: 'Domains', to: '/wizmatch/domains',
    icon: Network, section: 'Wizmatch', group: null,
    visible: f => f.canWizmatch,
  },
  {
    id: 'wm-compliance', label: 'Compliance', to: '/wizmatch/compliance',
    icon: Shield, section: 'Wizmatch', group: null,
    visible: f => f.canWizmatch,
  },
  {
    id: 'wm-analytics-new', label: 'Analytics', to: '/wizmatch/analytics',
    icon: BarChart3, section: 'Wizmatch', group: null,
    visible: f => f.canWizmatch,
  },

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

export function getVisibleEntries(role, perms, tenantSlug) {
  const flags = computeFlags(role, perms, tenantSlug);
  return NAV_ENTRIES.filter(e => entryProduct(e) === flags.product && e.visible(flags));
}

// Map collapsible group name → entry's section label (for palette breadcrumbs)
export const GROUP_LABELS = {
  tools: 'Tools',
  finance: 'Finance',
  settings: 'Settings',
};

// Find which collapsible group (if any) owns a given pathname.
// Used by Sidebar's auto-expand-on-route logic.
export function groupForPath(pathname, role, perms, tenantSlug) {
  const entries = getVisibleEntries(role, perms, tenantSlug);
  // Match longest "to" first so /settings/permissions wins over /settings.
  const sorted = [...entries].sort((a, b) => (b.to?.length || 0) - (a.to?.length || 0));
  for (const e of sorted) {
    if (!e.to || !e.group) continue;
    if (pathname === e.to || pathname.startsWith(e.to + '/')) return e.group;
  }
  return null;
}
