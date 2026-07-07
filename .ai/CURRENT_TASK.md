# CURRENT_TASK.md

## Active task

**Facebook Lead Forms -> CRM + Slack** — add a safe Facebook Lead Ads ingestion path so connected
Facebook pages can send lead-form submissions into CRM contacts and notify the BD/Sales Slack
channel.

Scope is **webhook ingestion, CRM contact creation/reuse, Slack notification, Social-page setup
visibility, tests, generated admin bundle, and AI context**. This task does not add schema,
migrations, auto-outreach, sequence enrollment, candidate submission, paid enrichment, worker/cron
automation, deployment config, `package.json`, or `package-lock.json` changes.

## Definition of done

- [x] Add public `GET /webhooks/meta-leads` verification route for Meta Lead Ads.
- [x] Add public `POST /webhooks/meta-leads` route for Page `leadgen` webhook events.
- [x] Verify `X-Hub-Signature-256` against `META_APP_SECRET` using the raw request body.
- [x] Dedupe successful lead events with `processed_events` keys like `facebook_leadgen:<id>`.
- [x] Fetch lead details from Meta using the connected Facebook Page token in `social_accounts`.
- [x] Map standard and custom lead form fields into CRM contact metadata.
- [x] Create or reuse CRM contacts through `findOrCreateContact`.
- [x] Add `facebook_lead`, `meta_lead_form`, and page tags; update `lastActivityAt`.
- [x] Send a Slack notification to the existing BD/Sales channel without blocking webhook success.
- [x] Add Social-page lead-form status/subscription endpoints.
- [x] Extend Facebook OAuth scopes for `pages_manage_metadata` and `leads_retrieval`.
- [x] Add Social Accounts UI visibility for webhook/config/page subscription status.
- [x] Run focused Facebook Lead tests, backend build, full Vitest suite, admin build, and refresh
  AI brief.

## Next task

Configure Meta App/Webhooks in the Meta dashboard and subscribe the connected Facebook Pages from
the CRM Social page. Then use Meta's Lead Ads testing tool to submit one controlled test lead and
confirm the CRM contact plus Slack notification.
