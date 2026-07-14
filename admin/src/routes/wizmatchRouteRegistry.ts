import type { ComponentType } from 'react';
import {
  Home, Users, Kanban, CheckSquare, MessageSquare, Target, Brain, MapPin, Mail,
  CreditCard, Receipt, Shield, ClipboardList, Settings, Search, Zap, Network,
  FileText, UserCheck, Briefcase, BarChart3,
} from 'lucide-react';

/**
 * Single source of truth for Wizmatch navigation, routing aliases, and
 * breadcrumb labels — Phase 1A of the Entity-First redesign.
 *
 * Consumed by:
 *  - navEntries.js  (Sidebar + CommandPalette entries, permission gating)
 *  - App.jsx        (legacy-alias redirects, canonical path constants)
 *  - Breadcrumbs.jsx (segment label lookup, incl. legacy alias paths)
 *
 * Component mounting/guard-wrapping (PrivateRoute, StaffingPhaseRoute,
 * AppLayout) stays hand-written in App.jsx — that wrapping is heterogeneous
 * per page (some pages self-compose their own shell, some need a specific
 * staffing phase gate) and isn't safely auto-derivable from this metadata
 * alone. This registry is the metadata layer, not a route-JSX generator.
 */

export type WizmatchNavGroup =
  | 'primary'
  | 'more.communication'
  | 'more.crmUtilities'
  | 'more.administration'
  | 'more.finance';

/** Permission predicates that already exist in navEntries.js computeFlags(). */
export type WizmatchPermissionFlag =
  | 'always'
  | 'canWizmatch'
  | 'canCRM'
  | 'canTasks'
  | 'canInbox'
  | 'canSequences'
  | 'canDiscovery'
  | 'canBilling'
  | 'isAdmin'
  | 'isAdminTier'
  | 'canStaffing'
  | 'staffingPhaseA'
  | 'staffingPhaseB'
  | 'staffingPhaseC';

export interface WizmatchRouteDefinition {
  /** Stable id — used by nav, breadcrumbs, tests. Never reuse/rename once shipped. */
  id: string;
  /** Plain-language label shown in nav/breadcrumbs/search */
  label: string;
  /** Canonical path — the one users should bookmark going forward */
  path: string;
  icon: ComponentType<any>;
  /**
   * undefined = "pending-merge": routed and legacy-alias-protected, but
   * deliberately absent from Sidebar/CommandPalette until its Phase 2/3
   * entity merge lands (still reachable by direct URL or breadcrumb).
   */
  group?: WizmatchNavGroup;
  /** Sub-label under More, e.g. "Communication" — only set when group starts with "more." */
  moreSection?: 'Communication' | 'CRM Utilities' | 'Administration' | 'Finance';
  /** AND-combined permission predicates gating nav visibility */
  permission: WizmatchPermissionFlag | WizmatchPermissionFlag[];
  breadcrumb: { label: string };
  /** Old paths that must keep working, redirected to `path` */
  legacyAliases: string[];
  /** Whether this entry appears in the Cmd+K command palette */
  searchVisible: boolean;
  badge?: 'inbox-unread' | 'pending-leaves';
}

export function evaluateWizmatchPermission(
  flags: Record<string, boolean>,
  permission: WizmatchPermissionFlag | WizmatchPermissionFlag[],
): boolean {
  const list = Array.isArray(permission) ? permission : [permission];
  return list.every((flag) => (flag === 'always' ? true : !!flags[flag]));
}

export const WIZMATCH_ROUTES: WizmatchRouteDefinition[] = [
  // ── PRIMARY (approved 10-item entity-first nav, "More" is #10) ──────────
  {
    id: 'today', label: 'Today', path: '/wizmatch/today', icon: Home,
    group: 'primary', permission: 'always',
    breadcrumb: { label: 'Today' }, legacyAliases: ['/wizmatch/dashboard'],
    searchVisible: true,
  },
  {
    id: 'job-leads', label: 'Job Leads', path: '/wizmatch/job-leads', icon: Zap,
    group: 'primary', permission: 'canWizmatch',
    breadcrumb: { label: 'Job Leads' }, legacyAliases: ['/wizmatch/signals'],
    searchVisible: true,
  },
  {
    id: 'companies', label: 'Companies', path: '/wizmatch/companies', icon: Users,
    group: 'primary', permission: ['canStaffing', 'staffingPhaseA'],
    breadcrumb: { label: 'Companies' }, legacyAliases: ['/wizmatch/relationships'],
    searchVisible: true,
  },
  {
    id: 'hiring-contacts', label: 'Hiring Contacts', path: '/wizmatch/hiring-contacts', icon: Network,
    group: 'primary', permission: 'canWizmatch',
    breadcrumb: { label: 'Hiring Contacts' }, legacyAliases: ['/wizmatch/contact-intelligence'],
    searchVisible: true,
  },
  {
    id: 'requirements', label: 'Roles / Requirements', path: '/wizmatch/requirements', icon: FileText,
    group: 'primary', permission: 'canWizmatch',
    breadcrumb: { label: 'Roles / Requirements' }, legacyAliases: [],
    searchVisible: true,
  },
  {
    id: 'candidates', label: 'Candidates', path: '/wizmatch/candidates', icon: UserCheck,
    group: 'primary', permission: 'canWizmatch',
    breadcrumb: { label: 'Candidates' }, legacyAliases: [],
    searchVisible: true,
  },
  {
    id: 'submissions', label: 'Submissions', path: '/wizmatch/submissions', icon: Briefcase,
    group: 'primary', permission: ['canStaffing', 'staffingPhaseC'],
    breadcrumb: { label: 'Submissions' }, legacyAliases: ['/wizmatch/delivery'],
    searchVisible: true,
  },
  {
    id: 'placements', label: 'Placements', path: '/wizmatch/placements', icon: Briefcase,
    group: 'primary', permission: 'canWizmatch',
    breadcrumb: { label: 'Placements' }, legacyAliases: [],
    searchVisible: true,
  },
  {
    id: 'reports', label: 'Reports', path: '/wizmatch/reports', icon: BarChart3,
    group: 'primary', permission: 'canWizmatch',
    breadcrumb: { label: 'Reports' }, legacyAliases: ['/wizmatch/analytics'],
    searchVisible: true,
  },

  // ── MORE → Communication ─────────────────────────────────────────────
  {
    id: 'more-inbox', label: 'Inbox', path: '/wizmatch/inbox', icon: MessageSquare,
    group: 'more.communication', moreSection: 'Communication', permission: 'canInbox',
    breadcrumb: { label: 'Inbox' }, legacyAliases: [], searchVisible: true,
    badge: 'inbox-unread',
  },
  {
    id: 'more-outreach', label: 'Outreach', path: '/wizmatch/outreach', icon: Target,
    group: 'more.communication', moreSection: 'Communication', permission: 'isAdminTier',
    breadcrumb: { label: 'Outreach' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-templates-email', label: 'Email Templates', path: '/wizmatch/emails', icon: Mail,
    group: 'more.communication', moreSection: 'Communication', permission: 'canSequences',
    breadcrumb: { label: 'Email Templates' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-templates-wa', label: 'WhatsApp Templates', path: '/wizmatch/whatsapp-templates', icon: MessageSquare,
    group: 'more.communication', moreSection: 'Communication', permission: 'canSequences',
    breadcrumb: { label: 'WhatsApp Templates' }, legacyAliases: [], searchVisible: true,
  },

  // ── MORE → CRM Utilities ─────────────────────────────────────────────
  {
    id: 'more-contacts', label: 'Generic Contacts', path: '/wizmatch/contacts', icon: Users,
    group: 'more.crmUtilities', moreSection: 'CRM Utilities', permission: 'canCRM',
    breadcrumb: { label: 'Generic Contacts' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-pipeline', label: 'Pipeline', path: '/wizmatch/pipeline', icon: Kanban,
    group: 'more.crmUtilities', moreSection: 'CRM Utilities', permission: 'canCRM',
    breadcrumb: { label: 'Pipeline' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-tasks', label: 'Tasks', path: '/wizmatch/tasks', icon: CheckSquare,
    group: 'more.crmUtilities', moreSection: 'CRM Utilities', permission: 'canTasks',
    breadcrumb: { label: 'Tasks' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-discovery', label: 'Lead Discovery', path: '/wizmatch/discover', icon: MapPin,
    group: 'more.crmUtilities', moreSection: 'CRM Utilities', permission: 'canDiscovery',
    breadcrumb: { label: 'Lead Discovery' }, legacyAliases: [], searchVisible: true,
  },

  // ── MORE → Administration ────────────────────────────────────────────
  {
    id: 'more-system', label: 'System', path: '/wizmatch/system', icon: Settings,
    group: 'more.administration', moreSection: 'Administration', permission: 'canWizmatch',
    breadcrumb: { label: 'System' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-provider-runs', label: 'Provider Runs', path: '/wizmatch/system?tab=sourcing', icon: Zap,
    group: 'more.administration', moreSection: 'Administration', permission: 'canWizmatch',
    breadcrumb: { label: 'Provider Runs' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-permissions', label: 'Permissions', path: '/wizmatch/settings/permissions', icon: Shield,
    group: 'more.administration', moreSection: 'Administration', permission: 'isAdmin',
    breadcrumb: { label: 'Permissions' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-audit', label: 'Audit', path: '/wizmatch/settings/audit', icon: ClipboardList,
    group: 'more.administration', moreSection: 'Administration', permission: 'isAdmin',
    breadcrumb: { label: 'Audit' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-configuration', label: 'Configuration', path: '/wizmatch/pipelines/settings', icon: Settings,
    group: 'more.administration', moreSection: 'Administration', permission: 'isAdmin',
    breadcrumb: { label: 'Configuration' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-intelligence', label: 'AI Intelligence', path: '/wizmatch/intelligence', icon: Brain,
    group: 'more.administration', moreSection: 'Administration', permission: 'isAdminTier',
    breadcrumb: { label: 'AI Intelligence' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-primes', label: 'Primes', path: '/wizmatch/primes', icon: Users,
    group: 'more.administration', moreSection: 'Administration', permission: 'canWizmatch',
    breadcrumb: { label: 'Primes' }, legacyAliases: [], searchVisible: true,
  },

  // ── MORE → Finance ───────────────────────────────────────────────────
  {
    id: 'more-billing', label: 'Billing', path: '/wizmatch/billing', icon: CreditCard,
    group: 'more.finance', moreSection: 'Finance', permission: 'canBilling',
    breadcrumb: { label: 'Billing' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-expenses', label: 'Expenses', path: '/wizmatch/finance', icon: Receipt,
    group: 'more.finance', moreSection: 'Finance', permission: 'canBilling',
    breadcrumb: { label: 'Expenses' }, legacyAliases: [], searchVisible: true,
    badge: 'pending-leaves',
  },

  // ── Pending-merge (routed + alias-protected, deliberately absent from
  //    nav/search until their Phase 2/3 entity merge lands) ──────────────
  {
    id: 'my-work', label: 'My Work', path: '/wizmatch/my-work', icon: CheckSquare,
    permission: ['canStaffing', 'staffingPhaseA'],
    breadcrumb: { label: 'My Work' }, legacyAliases: [], searchVisible: false,
  },
  {
    id: 'review-workbench', label: 'Review Workbench', path: '/wizmatch/review-workbench', icon: ClipboardList,
    permission: 'canWizmatch',
    breadcrumb: { label: 'Review Workbench' }, legacyAliases: [], searchVisible: false,
  },
  {
    id: 'client-discovery', label: 'Client Discovery', path: '/wizmatch/client-discovery', icon: Search,
    permission: 'canWizmatch',
    breadcrumb: { label: 'Client Discovery' }, legacyAliases: [], searchVisible: false,
  },
  {
    id: 'requirement-priority', label: 'Requirement Priority', path: '/wizmatch/requirement-priority-new', icon: Target,
    permission: 'canWizmatch',
    breadcrumb: { label: 'Requirement Priority' }, legacyAliases: [], searchVisible: false,
  },
  {
    id: 'candidate-intelligence', label: 'Candidate Intelligence', path: '/wizmatch/candidate-intelligence', icon: ClipboardList,
    permission: 'canWizmatch',
    breadcrumb: { label: 'Candidate Intelligence' }, legacyAliases: [], searchVisible: false,
  },
  {
    id: 'talent-matching', label: 'Talent Matching', path: '/wizmatch/talent-matching', icon: Target,
    permission: ['canStaffing', 'staffingPhaseB'],
    breadcrumb: { label: 'Talent Matching' }, legacyAliases: [], searchVisible: false,
  },
  {
    id: 'source-candidates', label: 'Source Candidates', path: '/wizmatch/source-candidates', icon: Search,
    permission: 'canWizmatch',
    breadcrumb: { label: 'Source Candidates' }, legacyAliases: [], searchVisible: false,
  },
];

export function findWizmatchRouteForPath(pathname: string): WizmatchRouteDefinition | undefined {
  return WIZMATCH_ROUTES.find(
    (route) => route.path === pathname || route.legacyAliases.includes(pathname),
  );
}

export function getWizmatchLegacyRedirects(): Array<{ from: string; to: string }> {
  return WIZMATCH_ROUTES.flatMap((route) =>
    route.legacyAliases.map((from) => ({ from, to: route.path })),
  );
}
