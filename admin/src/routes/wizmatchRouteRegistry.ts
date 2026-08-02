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

// 2026-08-02 — `more.communication` was retired along with the Communication
// bucket in Sidebar.jsx's MORE_SECTION_ORDER: every entry that lived in it
// (Inbox, Email Templates, WhatsApp Templates) is a Growth CRM surface with no
// WizMatch semantics and is now routable-but-hidden (see the block comment on
// `more-inbox` below). Re-adding the member here without also re-adding
// 'Communication' to MORE_SECTION_ORDER would silently drop the entry from the
// sidebar while leaving it in Cmd+K — the exact ghost state
// src/__tests__/sidebarNavBucketCoverage.test.ts exists to prevent.
export type WizmatchNavGroup =
  | 'primary'
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
  | 'canFinance'
  | 'canContracts'
  | 'isAdmin'
  | 'isAdminTier'
  | 'canStaffing'
  | 'staffingPhaseA'
  | 'staffingPhaseB'
  | 'staffingPhaseC'
  | 'wizmatchCompanyPolicyEnabled'
  | 'wizmatchDecisionWorkbenchEnabled';

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
  /**
   * Sub-label under More, e.g. "Administration" — only set when group starts
   * with "more.". MUST be a member of Sidebar.jsx's MORE_SECTION_ORDER;
   * anything else is silently dropped from the sidebar.
   */
  moreSection?: 'CRM Utilities' | 'Administration' | 'Finance';
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
    // "Job Leads" is the CURRENT name and stays. `/wizmatch/signals` sits in
    // legacyAliases below precisely because the product migrated
    // signals → job-leads; "Job Signals" is the retired term. So when
    // WizmatchSignalsPage.jsx's own <h1> disagrees with this label, the page
    // is the stale artefact and the page is what moves — do not "fix" the
    // mismatch by dragging this label back to the legacy wording.
    // src/__tests__/wizmatchRouteRegistry.test.js pins the approved 9 primary
    // labels and will fail if it is changed.
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

  // ── Growth CRM surfaces mounted under /wizmatch/* — ROUTABLE, NOT IN NAV ──
  //
  // 2026-08-02 — the same treatment `more-outreach` and `more-discovery`
  // already carry, applied to the rest of the Growth CRM pages that a
  // /wizmatch/ path was pointed at: no `group` (filtered out of the sidebar at
  // navEntries.js's `route.group !== undefined`), `searchVisible: false` (out
  // of Cmd+K), path and `legacyAliases` untouched so every one of them still
  // resolves by direct URL and breadcrumb. Hidden is not deleted; this is a
  // one-field-per-entry change to reverse.
  //
  // Why: none of these are WizMatch surfaces. Inbox / Email Templates /
  // WhatsApp Templates / CRM Contacts / Pipeline / Tasks / Billing / Expenses
  // all render the Growth tenant's own pages, against Growth's data, and they
  // made up most of a "More" menu whose problem is that it has too many rows.
  // Two of them (Inbox, Expenses) also carried the badges that forced a
  // global poll on every single page — see the gating in Sidebar.jsx.
  {
    id: 'more-inbox', label: 'Inbox', path: '/wizmatch/inbox', icon: MessageSquare,
    permission: 'canInbox',
    breadcrumb: { label: 'Inbox' }, legacyAliases: [], searchVisible: false,
    badge: 'inbox-unread',
  },
  {
    // Out of Wizmatch nav + search on purpose: /wizmatch/outreach renders the
    // Growth tenant's Saleshandy dashboard, which is unrelated to Wizmatch's own
    // (Purelymail) sending and misleads users hunting for "where do I send".
    // Kept URL-routable for the Growth tenant; a real Wizmatch outreach surface
    // is a separate future effort. See docs/wizmatch flow audit (2026-07-16).
    id: 'more-outreach', label: 'Outreach', path: '/wizmatch/outreach', icon: Target,
    permission: 'isAdminTier',
    breadcrumb: { label: 'Outreach' }, legacyAliases: [], searchVisible: false,
  },
  {
    id: 'more-templates-email', label: 'Email Templates', path: '/wizmatch/emails', icon: Mail,
    permission: 'canSequences',
    breadcrumb: { label: 'Email Templates' }, legacyAliases: [], searchVisible: false,
  },
  {
    id: 'more-templates-wa', label: 'WhatsApp Templates', path: '/wizmatch/whatsapp-templates', icon: MessageSquare,
    permission: 'canSequences',
    breadcrumb: { label: 'WhatsApp Templates' }, legacyAliases: [], searchVisible: false,
  },

  // ── MORE → CRM Utilities ─────────────────────────────────────────────
  {
    // "Generic Contacts" described nothing a user could act on. This route
    // mounts the Growth CRM's own ContactsPage (<h1>Contacts</h1>) — the
    // whole shared contact book, not a Wizmatch-specific list — so the label
    // now says which system it belongs to and reads as the sibling of
    // "Hiring Contacts" that it is.
    id: 'more-contacts', label: 'CRM Contacts (all)', path: '/wizmatch/contacts', icon: Users,
    permission: 'canCRM',
    breadcrumb: { label: 'CRM Contacts' }, legacyAliases: [], searchVisible: false,
  },
  {
    id: 'more-pipeline', label: 'Pipeline', path: '/wizmatch/pipeline', icon: Kanban,
    permission: 'canCRM',
    breadcrumb: { label: 'Pipeline' }, legacyAliases: [], searchVisible: false,
  },
  {
    id: 'more-tasks', label: 'Tasks', path: '/wizmatch/tasks', icon: CheckSquare,
    permission: 'canTasks',
    breadcrumb: { label: 'Tasks' }, legacyAliases: [], searchVisible: false,
  },
  {
    // UX audit 2026-07-31 (top-10 finding #2) — this label used to read
    // "Lead Discovery", which every Wizmatch operator reasonably reads as
    // "find more hiring companies/signals". It is not: `/wizmatch/discover`
    // renders the SAME `LeadDiscoveryPage.jsx` the Growth CRM tenant mounts
    // at plain `/discover` (see navEntries.js `id: 'discover'`) — a Google
    // Places local-business search (defaults to "United Kingdom") built for
    // Growth's outbound sales prospecting, with zero connection to Wizmatch
    // job signals, companies, or candidates, and a visually distinct dark
    // theme that breaks continuity with the rest of the Wizmatch admin. A
    // Wizmatch operator who clicks this looking for "more companies to
    // pursue" lands somewhere irrelevant. Same trap already called out for
    // `more-outreach` above; renamed honestly rather than repeating it.
    // Wizmatch's own company/signal sourcing lives on the Job Leads page.
    //
    // 2026-08-01 — renaming it honestly was the half-measure. A row whose own
    // label has to disclaim itself does not belong in the nav of a product it
    // has nothing to do with, and it costs a slot in a menu whose problem is
    // that it has too many. Given the same treatment `more-outreach` already
    // has: no `group` (out of the sidebar), `searchVisible: false` (out of
    // Cmd+K), still routed and still reachable by direct URL for anyone who
    // genuinely wants Growth's tool. This is a correctness call, not a
    // popularity one — it needs no usage data.
    id: 'more-discovery', label: 'Local Business Finder (Growth CRM tool)', path: '/wizmatch/discover', icon: MapPin,
    permission: 'canDiscovery',
    breadcrumb: { label: 'Local Business Finder' }, legacyAliases: [], searchVisible: false,
  },
  {
    id: 'find-contact', label: 'Find Contact', path: '/wizmatch/find-contact', icon: Search,
    group: 'more.crmUtilities', moreSection: 'CRM Utilities', permission: 'canWizmatch',
    breadcrumb: { label: 'Find Contact' }, legacyAliases: [], searchVisible: true,
  },

  // ── MORE → Administration ────────────────────────────────────────────
  {
    id: 'more-system', label: 'System', path: '/wizmatch/system', icon: Settings,
    group: 'more.administration', moreSection: 'Administration', permission: 'canWizmatch',
    breadcrumb: { label: 'System' }, legacyAliases: [], searchVisible: true,
  },
  {
    // 2026-08-01 — OUT OF NAV: this row pointed at `?tab=sourcing`, and the
    // System page has no `sourcing` tab. It never has. Clicking "Provider Runs"
    // silently rendered Readiness, so the row promised a destination that does
    // not exist while costing a slot in the menu we are trying to shrink.
    //
    // Earlier work fixed the SYMPTOM — two nav rows resolving to one pathname
    // used to highlight simultaneously, since NavLink's isActive ignores the
    // query string, and Sidebar's isEntryActive now matches on path + query.
    // That made exactly one row light up. Nobody checked whether the row it lit
    // up went anywhere.
    //
    // The need the old comment cited — "where did my sourcing run go" — is REAL
    // and is now explicitly UNMET rather than falsely served. Meeting it means
    // building a sourcing tab, which is a feature, not cleanup. The entry stays
    // (id preserved, still routable) so telemetry can attribute a direct hit,
    // but it is out of the sidebar and out of Cmd+K.
    id: 'more-provider-runs', label: 'Provider Runs', path: '/wizmatch/system?tab=sourcing', icon: Zap,
    permission: 'canWizmatch',
    // 2026-08-02 — this literal declared `searchVisible` TWICE
    // (`searchVisible: false, legacyAliases: [], searchVisible: true`). The
    // later key wins, so the entry was live in Cmd+K the whole time, directly
    // contradicting the comment above it. Deduped to the documented intent.
    breadcrumb: { label: 'Provider Runs' }, legacyAliases: [], searchVisible: false,
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
    // Was "Configuration", which promised a general settings page. The route
    // renders PipelineManagerPage (<h1>Pipeline Manager</h1>) — a deal-pipeline
    // stage editor and nothing else. Growth CRM already calls the same page
    // "Pipeline Manager" in its own nav; matching that ends the divergence.
    id: 'more-configuration', label: 'Pipeline Manager', path: '/wizmatch/pipelines/settings', icon: Settings,
    group: 'more.administration', moreSection: 'Administration', permission: 'isAdmin',
    breadcrumb: { label: 'Pipeline Manager' }, legacyAliases: [], searchVisible: true,
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
  {
    // PRD-005 §8.8/§12 — duplicate-company review (Merge / Confirm Separate).
    // team_lead+ resolves per the API's own RBAC; isAdminTier just controls
    // nav/search visibility, matching the other Administration entries above.
    id: 'duplicate-review', label: 'Duplicate Companies', path: '/wizmatch/duplicates', icon: Shield,
    group: 'more.administration', moreSection: 'Administration',
    // H-11 / D-38: also requires the company-policy flag — this page and its
    // API are both no-ops while WIZMATCH_COMPANY_POLICY_ENABLED is off.
    permission: ['isAdminTier', 'wizmatchCompanyPolicyEnabled'],
    breadcrumb: { label: 'Duplicate Companies' }, legacyAliases: [], searchVisible: true,
  },

  // ── MORE → Finance ───────────────────────────────────────────────────
  {
    id: 'more-billing', label: 'Billing', path: '/wizmatch/billing', icon: CreditCard,
    permission: 'canBilling',
    breadcrumb: { label: 'Billing' }, legacyAliases: [], searchVisible: false,
  },
  {
    id: 'more-contracts', label: 'Contracts', path: '/wizmatch/contracts', icon: FileText,
    group: 'more.finance', moreSection: 'Finance', permission: 'canContracts',
    breadcrumb: { label: 'Contracts' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-expenses', label: 'Expenses', path: '/wizmatch/finance', icon: Receipt,
    // `canFinance`, not `canBilling` — /wizmatch/finance renders the expenses +
    // attendance page, whose API has no billingView requirement. See the
    // canBilling/canFinance split in navEntries.js computeFlags().
    permission: 'canFinance',
    breadcrumb: { label: 'Expenses' }, legacyAliases: [], searchVisible: false,
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
    group: 'more.crmUtilities', moreSection: 'CRM Utilities', permission: ['canStaffing', 'staffingPhaseB'],
    breadcrumb: { label: 'Talent Matching' }, legacyAliases: [], searchVisible: true,
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
