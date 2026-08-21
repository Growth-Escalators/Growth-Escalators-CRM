import type { ComponentType } from 'react';
import {
  Users, Kanban, CheckSquare, MessageSquare, Mail, CreditCard,
  Receipt, Shield, ClipboardList, Settings, FileText, Palette,
} from 'lucide-react';

export type WizmatchNavGroup =
  | 'primary'
  | 'more.crmUtilities'
  | 'more.administration'
  | 'more.finance';

export type WizmatchPermissionFlag =
  | 'always'
  | 'canWizmatch'
  | 'canCRM'
  | 'canTasks'
  | 'canInbox'
  | 'canSequences'
  | 'canBilling'
  | 'canFinance'
  | 'canContracts'
  | 'isAdmin'
  | 'isAdminTier'
  | 'isOwner'
  | 'canStaffing'
  | 'staffingPhaseA'
  | 'staffingPhaseB'
  | 'staffingPhaseC'
  | 'wizmatchCompanyPolicyEnabled'
  | 'wizmatchDecisionWorkbenchEnabled';

export interface WizmatchRouteDefinition {
  id: string;
  label: string;
  path: string;
  icon: ComponentType<any>;
  group?: WizmatchNavGroup;
  moreSection?: 'CRM Utilities' | 'Administration' | 'Finance';
  permission: WizmatchPermissionFlag | WizmatchPermissionFlag[];
  breadcrumb: { label: string };
  legacyAliases: string[];
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

/**
 * Transitional compatibility registry for the legacy `wizmatch` tenant slug.
 *
 * WizMatch product functionality is retired. The entries below are ONLY
 * Growth Escalators CRM surfaces that are still mounted under `/wizmatch/*`
 * so existing sessions/data in the legacy tenant namespace remain usable
 * until the data/tenant consolidation is completed.
 *
 * No staffing, sourcing, candidate, requirement, matching, signals, reports,
 * placements, system/provider-run, or other WizMatch product destinations are
 * allowed back into this registry.
 */
export const WIZMATCH_ROUTES: WizmatchRouteDefinition[] = [
  {
    id: 'more-contacts', label: 'Contacts', path: '/wizmatch/contacts', icon: Users,
    group: 'more.crmUtilities', moreSection: 'CRM Utilities', permission: 'canCRM',
    breadcrumb: { label: 'Contacts' }, legacyAliases: [], searchVisible: true,
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
    id: 'more-inbox', label: 'Inbox', path: '/wizmatch/inbox', icon: MessageSquare,
    group: 'more.crmUtilities', moreSection: 'CRM Utilities', permission: 'canInbox',
    breadcrumb: { label: 'Inbox' }, legacyAliases: [], searchVisible: true,
    badge: 'inbox-unread',
  },
  {
    id: 'more-templates-email', label: 'Email Templates', path: '/wizmatch/emails', icon: Mail,
    group: 'more.crmUtilities', moreSection: 'CRM Utilities', permission: 'canSequences',
    breadcrumb: { label: 'Email Templates' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-templates-wa', label: 'WhatsApp Templates', path: '/wizmatch/whatsapp-templates', icon: MessageSquare,
    group: 'more.crmUtilities', moreSection: 'CRM Utilities', permission: 'canSequences',
    breadcrumb: { label: 'WhatsApp Templates' }, legacyAliases: [], searchVisible: true,
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
    id: 'more-branding', label: 'Branding', path: '/wizmatch/settings/branding', icon: Palette,
    group: 'more.administration', moreSection: 'Administration', permission: 'isOwner',
    breadcrumb: { label: 'Branding' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-configuration', label: 'Pipeline Manager', path: '/wizmatch/pipelines/settings', icon: Settings,
    group: 'more.administration', moreSection: 'Administration', permission: 'isAdmin',
    breadcrumb: { label: 'Pipeline Manager' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-billing', label: 'Billing', path: '/wizmatch/billing', icon: CreditCard,
    group: 'more.finance', moreSection: 'Finance', permission: 'canBilling',
    breadcrumb: { label: 'Billing' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-contracts', label: 'Contracts', path: '/wizmatch/contracts', icon: FileText,
    group: 'more.finance', moreSection: 'Finance', permission: 'canContracts',
    breadcrumb: { label: 'Contracts' }, legacyAliases: [], searchVisible: true,
  },
  {
    id: 'more-expenses', label: 'Expenses', path: '/wizmatch/finance', icon: Receipt,
    group: 'more.finance', moreSection: 'Finance', permission: 'canFinance',
    breadcrumb: { label: 'Expenses' }, legacyAliases: [], searchVisible: true,
    badge: 'pending-leaves',
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
