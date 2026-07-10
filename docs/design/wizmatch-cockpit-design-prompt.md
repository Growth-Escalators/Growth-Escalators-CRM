# Wizmatch Cockpit — Claude-design prompt + setup guide

**Purpose:** collapse the ~14 Wizmatch pages into ONE operator cockpit. Redesign brief for
generating a high-fidelity prototype in Claude design (claude.ai artifacts), then bringing it
back into the admin React app.

Decisions locked with Jatin (2026-07-10):
- **Scope:** one unified cockpit; deep pages become drill-downs.
- **Audience:** both — status band up top (owner), action queue below (operator).
- **Pains to fix:** (1) too many pages, (2) jargon, (3) no clear next action, (4) numbers without context.
- **Deliverable:** a paste-ready design prompt + a setup guide (this file).

The prompt below is grounded in the **real data the backend produces** so the mockup matches
production: confidence tiers (high/medium/low), team classification (Talent Acquisition / HR /
Hiring Manager / Vendor / Careers inbox / Generic), mailbox host (Google Workspace / Microsoft 365 /
Other), qualification tier (A/B/C), hiring urgency (high/medium/low), the ₹ budget cap, and the
per-inbox daily send cap.

---

## PART 1 — THE PROMPT (copy everything between the lines into Claude design)

------------------------------------------------------------------------------------------------
You are a senior product designer + front-end engineer. Design and build a **single-screen
operator cockpit** called **"Wizmatch Cockpit"** as one interactive React + Tailwind artifact.
Use realistic dummy data. Do not ask me questions first — build a complete first version, then I'll
iterate.

## What Wizmatch is (context)
Wizmatch is a B2B staffing/recruiting outreach engine. It (1) finds companies that are actively
hiring, (2) scores how good a fit they are, (3) finds the RIGHT person to contact (Talent
Acquisition / HR / hiring manager), (4) sends a compliant, throttled cold email, and (5) tracks
replies and bounces. Today this is spread across 14 confusing pages. Collapse it into ONE cockpit.

## The 4 problems this redesign must solve (non-negotiable)
1. **Too many pages** → one screen. Show the whole funnel at once; anything deeper is a drill-in
   panel/drawer, never a separate page in the main flow.
2. **Jargon** → every technical term is replaced with plain English, with a small "?" tooltip that
   explains it in one sentence. (Mapping given below — use the plain labels as the primary text.)
3. **No clear next action** → every card and every stage has exactly ONE obvious primary button
   ("do this next"). Secondary actions are visually quieter.
4. **Numbers without context** → never show a bare number. Every metric is paired with its target,
   benchmark, or trend (e.g. "₹142 / ₹500 budget", "8 / 30 sends today", "3 replies ▲ +2 vs
   yesterday", a colored confidence badge with a one-line meaning).

## Layout — two zones on one screen

### ZONE A — STATUS BAND (top, for the owner: "is anything wrong?")
A slim horizontal band of 5–6 tiles, each a number WITH context and a color state
(green = healthy, amber = watch, red = act):
- **Budget** — "₹142 / ₹500 this month" (progress bar; amber >80%, red at cap).
- **Sends today** — "18 / 30 per-inbox cap" (so we never burn a domain).
- **Replies** — "3 new ▲ +2 vs yesterday".
- **Bounces** — "0 today" (green) — bad addresses auto-removed.
- **Domain health** — "4 healthy · 1 warming · 0 paused".
- **Pipeline value** (optional) — "₹4.2L in play · 2 placements this month".

### ZONE B — THE WORK (below, for the operator: "what do I do next?")
Two parts, top to bottom.

**B1 — Funnel strip (glanceable).** A slim horizontal strip showing the 5 stages with a
count-with-context under each, connected by arrows so the flow reads left-to-right:
FIND 12 new ▶ QUALIFY 5 strong / 3 to approve ▶ CONTACT 5 found / 2 searching ▶
SEND 5 ready · 18/30 today ▶ REPLIES 3 new · 1 interested.
Clicking a stage **filters the queue below** to that stage — it never opens a new page.

**B2 — "⚡ Needs you now" queue (the hero — most of the screen).** ONE prioritised list of only the
items waiting on a human decision, each a single row carrying just enough context to act, with ONE
primary button. Nothing that doesn't need a decision appears here. Show the ranking rule, don't hide
it: **hiring urgency → fit tier → contact confidence → age of item.** Each row has a tiny "why it's
here" tag (e.g. "🔥 urgent + Verified contact").

Row examples (mix the stages so the queue feels real):
- **Logix Guru** · Strong · 🔥 Urgent · contact: Priya Sharma (Talent Acquisition, Verified, Google)
  → primary **[Compose & send ▸]**
- **Acme Staffing** · Strong · ◐ Warm · contact: careers@acme (Careers inbox, Likely)
  → primary **[Compose & send ▸]**
- **Infosys** · Maybe · needs your OK before we spend to find a contact
  → primary **[Approve to find contact ▸]**
- **Zeta Corp** · reply received · classified "Interested"
  → primary **[Open reply ▸]**

**Clicking a row opens a right-side drawer** (never a new page) with full detail for that stage:
- **CONTACT drawer:** the 2–3 contact cards for that company. Each card shows name OR role inbox; a
  **Right team** tag (Talent Acquisition / HR / Hiring Manager / Vendor / Careers inbox / Generic); a
  **Confidence** badge (**Verified** green / **Likely** amber / **Guess** grey) with a one-line
  tooltip; a **Mailbox host** chip ("Google"/"Microsoft", tooltip: "hosted mailbox — we confirm by
  sending, not probing"); a LinkedIn icon if present. Actions: **Approve / Reject**, then
  **Compose & send**.
- **SEND / compose drawer:** a **template picker**, a rendered preview with merge fields already
  filled ({{firstName}}, {{company}}, {{team}}, {{title}}), an **✨ AI polish** button, an editable
  body, and a compliance strip "✓ Unsubscribe ✓ Physical address ✓ Within daily cap". Primary
  **[Send ▸]** (show the disabled state for "sending is turned off" or "daily cap reached").
- **REPLIES drawer:** the message thread + the auto-classified tag (Interested / Not now / Out of
  office / Unsubscribe).

**Secondary surfaces (collapsed by default, reachable via a quiet "More" menu — NOT part of the daily
flow):** Analytics / ROI, Domain-health detail, Do-not-contact list, Guardrails / caps, Data
readiness. These are occasional drill-downs, shown as calm links that never compete with the queue.

**Scope note (important):** this cockpit is the OUTREACH funnel only — finding and emailing hiring
companies. The candidate / talent-supply side (candidate pool, placements) is a SEPARATE workflow;
do NOT include it here.

## Plain-language mapping (use the PLAIN label as primary text; keep the technical term only in a tooltip)
- Qualification Tier A / B / C  → **Fit: Strong / Maybe / Skip**
- Confidence high / medium / low → **Verified / Likely / Guess**
- Team = Talent Acquisition / HR / Hiring Manager / Vendor / Careers inbox / Generic → **Right team to talk to**
- MX = Google / Microsoft → **Mailbox host** ("affects how we confirm the address is real")
- Data Readiness → **Ready to contact?** (has a domain + at least one good contact)
- Requirement Priority → **Which roles to chase first**
- Primes → **Prime vendors** (big companies that sub-contract staffing)
- Catch-all domain → **Accepts any address** ("so we can't fully verify — we verify by sending")
- Hiring urgency → **How urgently they're hiring** (stale open roles, reposts, "urgent" wording)
- Suppression list → **Do-not-contact list**
- Discovery run / cascade → **Find a contact**
- Cost guard / budget cap → **Spend limit**

## Visual style
- Clean, modern SaaS admin. Light theme, generous whitespace, rounded-2xl cards, soft shadows.
- One primary accent color for primary buttons only (pick a confident indigo/violet). Status colors:
  green/amber/red used ONLY for health states, not decoration.
- Confidence + fit + urgency are **badges/pills**, instantly scannable.
- Clear type hierarchy: big numbers, small context labels underneath.
- Empty/loading/disabled states shown for at least the Send button and one contact card.
- Fully responsive: 5 columns on desktop → stacked cards on mobile. Status band wraps to 2 rows.
- Add a tiny "?" info icon next to every jargon term that shows the plain-English tooltip.

## Deliverable
One self-contained React component (Tailwind, lucide-react icons ok) with realistic dummy data:
the status band populated; the funnel strip with counts for all 5 stages; the **"Needs you now"
queue** filled with ~5 prioritised rows spanning mixed stages (in the ranked order); clicking a
row opens the correct right-side drawer; one contact card in each confidence state (Verified /
Likely / Guess); and the compose drawer openable with a filled preview + AI-polish + compliance
strip. Make it feel like a real working screen, not a static image.
------------------------------------------------------------------------------------------------

---

## PART 2 — SETUP GUIDE (how to run it properly)

### Step 1 — Start it
1. Go to **claude.ai** → start a **new chat** (fresh context = best results).
2. Paste the entire prompt from PART 1. Send it. Claude builds an **interactive artifact** (a live
   preview panel on the right) — a real clickable screen, not a picture.

### Step 2 — Feed it reality (optional but makes it 10× better)
Right after the first version renders, paste real texture so the dummy data looks like your world:
- 3–5 **real target company names** + their tiers (e.g. "Logix Guru — Strong fit, urgent; Infosys —
  Maybe, 40 open roles").
- 2–3 **real contact examples** in each confidence state (a verified `careers@`, a likely
  `first.last@`, a pure guess).
- Say: *"Replace the dummy data with these so it feels real."*
- You can also **drag in a screenshot** of a current Wizmatch page and say *"here's the messy
  version we're replacing — keep the useful data, drop the clutter."*

### Step 3 — Iterate (one change at a time)
Ask for small, specific changes and it edits the same artifact:
- *"Make the CONTACT card bigger and move it to the center — it's the most important."*
- *"The status band is too busy; keep only Budget, Sends, Replies, Domain health."*
- *"Add a tooltip on every badge explaining it in one sentence."*
- *"Show the compose drawer sliding in from the right when I click Compose & send."*
- *"Try a version with the funnel as a vertical timeline instead of 5 columns."*
Ask for **2–3 variations** of anything you're unsure about, then pick.

### Step 4 — Lock the look (design tokens)
Once you like it, ask:
- *"List the exact colors, font sizes, spacing, and badge styles you used as a design-token table."*
Keep that table — it's what makes the real app match the mockup.

### Step 5 — Bring it back into the product
Two ways, pick one:
- **Fastest:** copy the artifact's **React code** (or its share link) and paste it back to me here.
  I'll adapt it into `admin/src/pages/` wired to the real Wizmatch APIs (contact discovery, compose,
  send, cost guard, replies). You get the exact look, on live data.
- **Design-first:** export/share the artifact, refine visuals in Canva if you want a marketing-grade
  polish, then hand me the final layout + token table and I build it in code.

### What "done" looks like
- One screen shows the whole FIND → QUALIFY → CONTACT → SEND → REPLIES funnel.
- Every number has context; every card has one obvious next button; no unexplained jargon.
- Then I wire it to real data behind the `WIZMATCH_SENDING_ENABLED` flag and we do a supervised
  first send — per the standing test plan (build → verify → make live → then feedback).

### Guardrails (so the mockup stays honest)
- It's a **prototype** — dummy data only, no real sends, no secrets pasted in.
- The real "Send" stays gated off (`WIZMATCH_SENDING_ENABLED=false`) until you explicitly turn it on.
- When I implement it, no schema/auth/cashfree/migration changes — same rules as always.
