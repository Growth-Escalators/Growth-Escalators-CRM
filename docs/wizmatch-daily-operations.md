# Wizmatch Daily Operations SOP

Status: Active operator note
Owner: Growth Escalators / Wizmatch
Last updated: 2026-07-07

This note explains how to use the live Wizmatch operating workbench without triggering unsafe
automation. Wizmatch is internal-only for Growth Escalators and only for IT/Tech staffing.

## 1. Start With Data Readiness

Open `/wizmatch/readiness`.

Check:

- Database connectivity is OK.
- Wizmatch tables exist.
- Companies, job signals, candidates, requirements, contact intelligence records, placements,
  domains, and suppressions show realistic counts.
- Module statuses do not show missing-table or auth/API blockers.
- Cost controls show paid discovery as disabled unless a pilot is intentionally active.

If readiness is red or blocked, stop there. Fix data/schema/auth/provider configuration before
running operational actions.

## 2. Score Clients And Companies

Open `/wizmatch/client-discovery-new`.

Use it to find companies worth working:

- Prefer IT/Tech hiring signals.
- Prefer India-first opportunities by default.
- Keep US opportunities only when the signal is strong.
- Send only qualified companies to Contact Intelligence.

Do not run paid discovery for weak, non-tech, suppressed, duplicate, or bad-domain companies.

## 3. Add Candidate Profiles

Open `/wizmatch/candidate-intelligence`.

Use the Candidate Profile Intake panel:

1. Paste CSV rows with headers such as:
   `name,email,phone,skills,location,visa_status,rate_hourly,rate_currency,availability_status,source,linkedin_url,resume_url`
2. Click **Preview scores**.
3. Review score, warnings, and skipped rows.
4. Click **Import candidates** only for vetted profiles.

The import creates/reuses CRM contacts and creates Wizmatch candidate records. It does not submit
candidates, send outreach, call enrichment providers, or change placement state.

## 4. Review Candidate Fit

Open `/wizmatch/candidate-intelligence-new` or `/wizmatch/candidate-intelligence`.

Use:

- Hot candidates for urgent requirements.
- Warm candidates for manual follow-up.
- Blocked candidates only after blockers are resolved.

The **Mark reviewed** and **Shortlist** actions persist review intent only. They do not submit a
candidate to a client.

## 5. Contact Discovery

Open `/wizmatch/contact-intelligence-new`.

Use **Discovery Preview** first. A paid run should execute only when:

- The company is eligible.
- Cost controls allow it.
- Provider env vars are configured for the intended environment.
- A logged-in user confirms the run.

Paid discovery is manual-only and preview-first. It never sends outreach.

## 6. Review Workbench

Open `/wizmatch/review-workbench`.

Use it as the daily command board:

- Review priority companies.
- Review candidate readiness.
- Check requirement priorities.
- Check guardrails before moving work forward.

If a page is empty, go back to `/wizmatch/readiness` to see whether the issue is missing data,
auth, schema, provider config, or a normal empty queue.

## 7. Guardrails That Stay Blocked

These are intentionally not part of day-to-day automation:

- Automatic outreach sending.
- Automatic candidate submission.
- Worker/cron-based paid discovery.
- Bulk paid enrichment.
- Schema/migration changes without explicit approval.
- Non-tech staffing, HRMS, payroll, attendance, or generic SaaS workflows.

## 8. Healthy Daily Loop

Recommended daily sequence:

1. Check Data Readiness.
2. Review Client Discovery for qualified IT/Tech companies.
3. Import or refresh vetted candidate profiles.
4. Review Candidate Intelligence hot/warm queue.
5. Run Contact Intelligence preview for the best Tier A companies.
6. Manually approve contacts and candidates.
7. Track replies, placements, and ROI in the Analytics pages.

The current build is safe for operational review and controlled manual intake. Paid discovery should
remain a small pilot until cost and provider behavior are proven.
