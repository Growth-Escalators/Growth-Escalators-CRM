# CURRENT_TASK.md

## Active task

**Growth + Wizmatch tenant-separated CRM correction** — make Wizmatch a full CRM profile that
reuses the shared Growth CRM modules while showing only Wizmatch tenant data, plus Wizmatch-specific
staffing pages.

Scope is **routing, navigation, tenant-aware product shell, Wizmatch dashboard, manual
Wizmatch AI Intelligence, generated admin bundle, tests, and AI context**. This task does not add
schema, migrations, auto-outreach, automatic candidate submission, worker/cron automation, package,
or deployment config changes.

## Definition of done

- [x] Keep Growth routes as-is for Growth Escalators users.
- [x] Add Wizmatch-prefixed routes for shared modules:
  `/wizmatch/dashboard`, `/wizmatch/contacts`, `/wizmatch/pipeline`, `/wizmatch/tasks`,
  `/wizmatch/inbox`, `/wizmatch/billing`, `/wizmatch/finance`, `/wizmatch/emails`,
  `/wizmatch/whatsapp-templates`, `/wizmatch/discover`, `/wizmatch/outreach`,
  `/wizmatch/intelligence`, `/wizmatch/settings/permissions`, `/wizmatch/settings/audit`,
  and `/wizmatch/pipelines/settings`.
- [x] Route Wizmatch home to `/wizmatch/dashboard`.
- [x] Redirect Wizmatch users from shared Growth paths to matching `/wizmatch/*` paths.
- [x] Keep Growth-only marketing modules out of the Wizmatch sidebar by default.
- [x] Keep Wizmatch staffing pages visible in the Wizmatch profile.
- [x] Add a live Wizmatch dashboard summary endpoint/page.
- [x] Add manual Claude-powered Wizmatch AI Intelligence endpoint/page focused on staffing data.
- [x] Preserve tenant separation through existing authenticated tenant-scoped backend routes.
- [x] Run backend build, full Vitest suite, admin build, and refresh AI brief.

## Next task

Log in as Growth and Wizmatch users on localhost/live and manually confirm that shared modules show
the correct tenant data in both profiles, especially Contacts, Pipeline, Tasks, Inbox, Templates,
Billing, Finance, Outreach, and AI Intelligence.
