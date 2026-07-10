---
name: wizmatch-go-live-sending
description: Use when enabling or expanding Wizmatch cold-email sending — flipping WIZMATCH_SENDING_ENABLED, the first real send, adding a new sending domain/inbox, or opening sends to a new prospect segment. Triggers include "enable wizmatch sending", "let's start sending", "turn on outreach emails", "send to real prospects", "go live on the sending flow". Skips: Growth outreach (that goes via Saleshandy, not this path), template copy edits with sending still off, inbound reply handling.
---

# Wizmatch sending go-live — the un-skippable ramp

Sending real cold email is the highest-consequence outward-facing action here. Mistakes burn
**domain reputation** (slow + expensive to repair) and can make you non-compliant (missing
unsubscribe / physical address). This skill enforces the safe ramp every time.

**Critical:** Wizmatch sends via **`multiDomainMailer.sendColdEmail`** (Purelymail SMTP, direct) from
[`src/routes/wizmatch.ts`](../../../src/routes/wizmatch.ts). The **Growth** funnel uses **Saleshandy**
— a different system. Never cross the two. Data map: [`docs/wizmatch/DATAFLOW.md`](../../../docs/wizmatch/DATAFLOW.md).

**This is a pause-and-confirm, outward-facing operation.** The first real send needs an explicit human "go".

## The ramp (in order — do not skip a step)

1. **Template exists and is compliant.** Confirm a `wizmatch_outreach_templates` row with merge
   fields (`{{firstName}}/{{company}}/{{team}}/{{title}}`) and the required footer placeholders
   (unsubscribe link + physical address). The renderer auto-appends them, but verify on the
   rendered preview.

2. **Turn on the flag.** `WIZMATCH_SENDING_ENABLED=true`. Until this is set, all send routes are
   inert (gated in `wizmatch.ts` ~line 3727). This is a deliberate env change → note it.

3. **Turn on bounce suppression.** `WIZMATCH_BOUNCE_SUPPRESSION_ENABLED=true` so hard bounces
   auto-suppress (parser from PR #21). This is what makes low-confidence "Guess" emails safe to try.

4. **Confirm the daily cap.** `WIZMATCH_MAX_SENDS_PER_INBOX_DAY` (default 30). Paused domains are
   excluded; least-used inbox is chosen first.

5. **Supervised FIRST send — one internal address, not a batch.** Send a single email to a safe
   internal inbox. Verify on receipt:
   - it arrived,
   - the **unsubscribe link works** (one-click, HMAC-signed),
   - the **physical address** is present,
   - the per-inbox daily-cap counter **incremented**,
   - a deliberately-bounced test address **auto-suppresses**.

6. **Only then, real prospects — one at a time, under the cap.** Work approved contacts from the
   review workbench (`wizmatch-daily-ops`). Never bulk-blast.

## Never
- Never flip the flag and fire at a real prospect list without the internal test first.
- Never send from a `paused` domain.
- Never route Wizmatch sends through Saleshandy (that's Growth's system).
- Never send without a working unsubscribe link + physical address in the rendered email.
