import type { ComponentType } from 'react';

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
 * WizMatch navigation is retired. Keeping an empty registry preserves import
 * compatibility while removing every WizMatch destination from Sidebar,
 * Command Palette, breadcrumb metadata, and legacy-alias generation.
 */
export const WIZMATCH_ROUTES: WizmatchRouteDefinition[] = [];

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
