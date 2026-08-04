// ---------------------------------------------------------------------------
// CRM base URL — single source for the deep-links embedded in Slack DMs and
// emails (task assignment/mention notifications, white-label lead alerts,
// coaching reports, SEO weekly emails).
//
// This is env-first with the current production host as the fallback, so
// behaviour is unchanged by default. It is NOT per-tenant: every notification
// path that uses it today only ever fires for GE's own tenant/workspace (see
// the call sites), so one shared host is correct for now.
//
// Follow-up (not built yet): a genuinely per-tenant CRM host — e.g.
// resolving the link from the owning tenant's own custom domain — needs
// custom-domain infrastructure that doesn't exist yet. When that lands,
// callers that send to a specific tenant's own workspace should resolve
// their link from that tenant instead of this process-wide default.
// ---------------------------------------------------------------------------
export const CRM_BASE_URL = process.env.CRM_BASE_URL || 'https://crm.growthescalators.com';
