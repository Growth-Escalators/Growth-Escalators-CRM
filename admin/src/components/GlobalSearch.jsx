import React from 'react';
import CommandPalette, { RESULT_TYPES } from './CommandPalette.jsx';

/**
 * GlobalSearch — now a thin alias onto CommandPalette.
 *
 * There used to be two competing search surfaces: the TopBar box (labelled
 * "Search contacts, deals, signals… ⌘K") opened this record-only search,
 * while actually pressing ⌘K opened CommandPalette, which could only
 * navigate. One label and one shortcut, two different answers.
 *
 * CommandPalette is now the single surface — Actions + "Go to" + Records —
 * and this stays as an alias so the mount points that reference it by name
 * (AppLayout.jsx, DashboardPage, AnalyticsPage, AuditPage) keep working
 * without every one of them having to be edited. New code should import
 * CommandPalette directly.
 */
export default function GlobalSearch({ open, onClose }) {
  return <CommandPalette open={open} onClose={onClose} />;
}

export { RESULT_TYPES };
