---
name: ge-add-slack-alert
description: Use when adding, changing, or silencing a Slack notification from any backend service — a new lead/candidate/reply alert, a health or spend warning, or wiring an event to Slack. Triggers include "send a slack alert when X", "notify the team on Slack", "add a Slack ping for new leads", "why did Slack go quiet", "un-silence this alert". Skips: the SOD/EOD scheduled DMs (guardrail — do not touch), Slack app config, non-Slack notifications (email/WhatsApp).
---

# Adding / changing a Slack alert

There are 20+ Slack send sites across services. Two rules keep alerts from spamming humans or
breaking the scheduled DMs.

## Rule 1 — respect the pause, un-silence only client-acquisition
When notifications are globally paused, only **client-acquisition** alerts should still fire, via an
explicit `allowDuringPause: true`. These are: priority-signal lead, candidate-matched,
positive-reply, ATS new-jobs, new agency-lead pings. Everything else (SEO, system noise, digests)
stays paused. Don't add `allowDuringPause` to a non-client-acquisition alert.

## Rule 2 — never touch the SOD/EOD DM logic
[`src/services/sodEodService.ts`](../../../src/services/sodEodService.ts) Slack-DM logic is a
**guardrail** — it messages real people on a schedule. Do not modify it as part of an alert change.
If a task seems to require it, stop and confirm with a human first.

## Steps
1. Find the closest existing alert to copy (e.g. `outreachAlertService.ts`, `blockerAlertService.ts`,
   `spendAlertService.ts`) — match its call shape and channel selection.
2. Send only the fields needed; keep the message short and actionable (who/what/link).
3. Decide pause behaviour deliberately: client-acquisition → `allowDuringPause: true`; everything
   else → default (stays paused).
4. Don't hard-code tokens/webhooks — use the existing Slack env/config.
5. Test read-only where possible; if you must send a live test, send to a test channel, not a
   human DM.

## Never
- Never add `allowDuringPause` to non-client-acquisition alerts (defeats the quiet period).
- Never edit `sodEodService.ts` Slack-DM logic without explicit human confirmation.
- Never echo or hard-code the Slack bot token.
