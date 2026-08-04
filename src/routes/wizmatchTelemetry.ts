/**
 * Wizmatch admin route-view telemetry — 2-week nav-usage experiment.
 *
 * Mounted on /api/wizmatch in src/index.ts, BEFORE the wizmatchRequireAdmin
 * gate (the M-1 ordering described there). Two routes:
 *   POST /telemetry/route-view   staff+ — records one nav, always 204
 *   GET  /telemetry/route-usage  admin  — read-back, zero-view routes included
 *
 * Why not request logs: SPA navigations are client-side (BrowserRouter +
 * <Navigate>) and never reach Express, and the Sidebar polls
 * /api/inbox/unread-count every 30s and /api/finance/leaves/pending-count
 * every 60s on every page — a tab parked on an unused screen emits ~180
 * requests/hour, which would outvote every real navigation in the repo.
 *
 * Why not audit_events: it is a compliance log gated on AUDIT_VIEW, it records
 * IP and user-agent (more personal data than this needs), and AuditPage builds
 * its filter dropdown from the CURRENT PAGE of events — nav pings would push
 * LOGIN off page one and degrade the audit surface for everyone.
 *
 * PII boundary, and it is the point of the design: user + role + route +
 * timestamp, and nothing else. No IP, no user-agent, no referrer, and no query
 * string beyond a whitelisted `tab` (see sanitizeViewPath).
 *
 * The table is ensure-created rather than declared in src/db/schema.ts on
 * purpose: it is feature-scoped with a ~2-week lifetime, and schema.ts plus
 * src/db/migrations/ are guarded paths whose contents outlive the experiment.
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index';
import { requireRole } from '../middleware/rbac';
import { clampListLimit } from './wizmatch';
import logger from '../utils/logger';

const router = Router();

/**
 * Server-side mirror of admin/src/routes/wizmatchRouteRegistry.ts.
 *
 * It is a mirror rather than an import because tsconfig.json pins
 * `rootDir: "./src"`, so `npm run build` fails outright on a path that escapes
 * src/, and the registry additionally pulls in `react` and `lucide-react`
 * types the API has no business compiling. (The existing server-side import in
 * src/__tests__/wizmatchRouteRegistry.test.js only works because that file is
 * .js and `allowJs` is off, so tsc never sees it.)
 *
 * wizmatchTelemetryRegistry.test.js asserts this list is identical to the real
 * registry, so drift fails CI rather than silently dropping a route from the
 * read-back.
 */
export interface TelemetryRouteEntry {
  id: string;
  label: string;
}

export const WIZMATCH_TELEMETRY_ROUTES: TelemetryRouteEntry[] = [
  { id: 'today', label: 'Today' },
  { id: 'job-leads', label: 'Job Leads' },
  { id: 'companies', label: 'Companies' },
  { id: 'hiring-contacts', label: 'Hiring Contacts' },
  { id: 'requirements', label: 'Roles / Requirements' },
  { id: 'candidates', label: 'Candidates' },
  { id: 'submissions', label: 'Submissions' },
  { id: 'placements', label: 'Placements' },
  { id: 'reports', label: 'Reports' },
  { id: 'more-inbox', label: 'Inbox' },
  { id: 'more-outreach', label: 'Outreach' },
  { id: 'more-templates-email', label: 'Email Templates' },
  { id: 'more-templates-wa', label: 'WhatsApp Templates' },
  { id: 'more-contacts', label: 'CRM Contacts (all)' },
  { id: 'more-pipeline', label: 'Pipeline' },
  { id: 'more-tasks', label: 'Tasks' },
  { id: 'more-discovery', label: 'Local Business Finder (Growth CRM tool)' },
  { id: 'find-contact', label: 'Find Contact' },
  { id: 'more-system', label: 'System' },
  { id: 'more-provider-runs', label: 'Provider Runs' },
  { id: 'more-permissions', label: 'Permissions' },
  { id: 'more-audit', label: 'Audit' },
  { id: 'more-branding', label: 'Branding' },
  { id: 'more-configuration', label: 'Pipeline Manager' },
  { id: 'more-intelligence', label: 'AI Intelligence' },
  { id: 'more-primes', label: 'Primes' },
  { id: 'duplicate-review', label: 'Duplicate Companies' },
  { id: 'more-billing', label: 'Billing' },
  { id: 'more-contracts', label: 'Contracts' },
  { id: 'more-expenses', label: 'Expenses' },
  { id: 'my-work', label: 'My Work' },
  { id: 'review-workbench', label: 'Review Workbench' },
  { id: 'client-discovery', label: 'Client Discovery' },
  { id: 'requirement-priority', label: 'Requirement Priority' },
  { id: 'candidate-intelligence', label: 'Candidate Intelligence' },
  { id: 'talent-matching', label: 'Talent Matching' },
  { id: 'source-candidates', label: 'Source Candidates' },
];

/** Caps route_id cardinality at 36 so the column can never become a free-text sink. */
const KNOWN_ROUTE_IDS = new Set(WIZMATCH_TELEMETRY_ROUTES.map((r) => r.id));

export async function ensureWizmatchRouteViewsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wizmatch_route_views (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id  uuid NOT NULL,
      user_id    uuid,
      route_id   text NOT NULL,
      path       text NOT NULL,
      role       text,
      viewed_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Deliberately no FK on user_id: this table is disposable and a teammate
  // being offboarded mid-experiment must not leave rows that block their
  // deletion, nor make the cleanup of this table a prerequisite for theirs.
  await pool.query(`CREATE INDEX IF NOT EXISTS wizmatch_route_views_tenant_viewed_idx ON wizmatch_route_views (tenant_id, viewed_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS wizmatch_route_views_tenant_route_idx ON wizmatch_route_views (tenant_id, route_id)`);
  logger.info('[wizmatch-telemetry] wizmatch_route_views table ready');
}

const TAB_PATTERN = /^[a-z0-9-]{1,32}$/;

/**
 * Reduces a client-supplied path to pathname + a whitelisted `?tab=`.
 *
 * The tab survives because `more-provider-runs` (/wizmatch/system?tab=sourcing)
 * and `more-system` (/wizmatch/system) share a pathname — dropping the query
 * would make the two indistinguishable in the read-back. Everything else goes:
 * `?id=` drawer links carry record ids and search boxes carry free text, and
 * neither belongs in a nav-usage measurement.
 */
export function sanitizeViewPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (!raw.startsWith('/') || raw.length > 512) return null;
  const [pathname, query = ''] = raw.split('?');
  if (!pathname || pathname.length > 200) return null;
  const tab = new URLSearchParams(query).get('tab');
  return tab && TAB_PATTERN.test(tab) ? `${pathname}?tab=${tab}` : pathname;
}

/**
 * Records one navigation. ALWAYS 204 — including on an unknown routeId, a
 * malformed body, or a failed insert.
 *
 * A telemetry endpoint that can return an error is a telemetry endpoint that
 * can break navigation, and this one is called on every single route change.
 * Nothing the caller can send, and no state the database can be in, is worth
 * a non-204 here; failures go to the log where an operator will see them
 * instead of to a user who was only trying to change page.
 */
router.post('/telemetry/route-view', async (req: Request, res: Response) => {
  try {
    // Identity comes from the verified token, never from the body — a client
    // that could name its own tenant could write into another tenant's data.
    const tenantId = req.user?.tenantId;
    const routeId = (req.body as { routeId?: unknown } | undefined)?.routeId;
    const path = sanitizeViewPath((req.body as { path?: unknown } | undefined)?.path);

    if (tenantId && typeof routeId === 'string' && KNOWN_ROUTE_IDS.has(routeId) && path) {
      await pool.query(
        `INSERT INTO wizmatch_route_views (tenant_id, user_id, route_id, path, role)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, req.user?.id ?? null, routeId, path, req.user?.role ?? null],
      );
    }
  } catch (error) {
    logger.warn('[wizmatch-telemetry] route-view insert failed (swallowed)', error);
  }
  res.status(204).end();
});

/** Shape of one GROUP BY row as pg returns it (snake_case, counts already ::int). */
interface UsageAggregateRow {
  route_id: string;
  views: number;
  distinct_users: number;
  last_viewed_at: Date | null;
}

interface RouteUsageRow {
  routeId: string;
  label: string;
  views: number;
  distinctUsers: number;
  lastViewedAt: string | null;
}

/**
 * Read-back for the experiment.
 *
 * The full registry is left-joined in JS so a route with no rows comes back as
 * `views: 0` instead of being absent. A bare GROUP BY would omit exactly the
 * rows this whole exercise exists to find — "which screens does nobody open"
 * is answered by the routes missing from the aggregate, so they cannot be
 * allowed to be missing from the response.
 */
router.get('/telemetry/route-usage', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    // clampListLimit rather than a bare Number(): unclamped numeric query
    // params are swept repo-wide (commit aec301dc) and audited by
    // wizmatchQueuePaging.test.ts.
    const days = clampListLimit(req.query.days, 14, 90);

    const { rows } = await pool.query(
      `SELECT route_id,
              COUNT(*)::int                  AS views,
              COUNT(DISTINCT user_id)::int   AS distinct_users,
              MAX(viewed_at)                 AS last_viewed_at
         FROM wizmatch_route_views
        WHERE tenant_id = $1
          AND viewed_at >= now() - ($2::int * INTERVAL '1 day')
        GROUP BY route_id`,
      [req.user!.tenantId, days],
    );

    const byRouteId = new Map<string, UsageAggregateRow>(
      (rows as UsageAggregateRow[]).map((r) => [String(r.route_id), r]),
    );

    const items: RouteUsageRow[] = WIZMATCH_TELEMETRY_ROUTES.map((route) => {
      const agg = byRouteId.get(route.id);
      return {
        routeId: route.id,
        label: route.label,
        views: agg ? Number(agg.views) : 0,
        distinctUsers: agg ? Number(agg.distinct_users) : 0,
        lastViewedAt: agg?.last_viewed_at ? new Date(agg.last_viewed_at).toISOString() : null,
      };
    });

    // Zero-view routes first — they ARE the finding.
    items.sort((a, b) => (a.views - b.views) || a.label.localeCompare(b.label));

    res.json({ days, items });
  } catch (error) {
    logger.error('[wizmatch-telemetry] route-usage read failed', error);
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
