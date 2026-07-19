# Growth Escalators — SEO Automation System
## Complete Handoff Document (Phase 2 Upgrade)
**Updated:** 2026-03-29 | **Status:** 12/12 Workflows Active

---

## 1. COMPLETE WORKFLOW REGISTRY

| ID | Name | n8n ID | Schedule/Trigger | Status |
|----|------|--------|-----------------|--------|
| WF-SEO-01 | Weekly SEO Data Pull | `YXmClFSKZB9DMkyu` | Every Monday 1AM UTC | ✅ Active |
| WF-SEO-02 | Daily Alert Triggers | `5FVX2kEjuD7vWD0e` | Every day 9AM IST | ✅ Active |
| WF-SEO-03 | Weekly AI Insight Report | `as8HvuMPqAHhAdQ8` | Every Friday 4PM IST | ✅ Active |
| WF-SEO-04 | WordPress Content Publisher | `CBzwkCqVgeQOxOQl` | Webhook POST /seo-publish | ✅ Active |
| WF-SEO-05 | PageSpeed Monitor | `z21W6MDWBF0dukkT` | Every Sunday 7AM IST | ✅ Active |
| WF-SEO-06 | Rank Tracker | `BwO187curjMMA60i` | Every Tuesday 9AM IST | ✅ Active |
| WF-SEO-07 | Content Gap Analysis | `Isz1ui9PkjsqBMb8` | Every other Wednesday 11AM IST | ✅ Active |
| WF-SEO-08 | Backlink Monitor | `19R3BStSY2S1N9H1` | Every Friday 9AM IST | ✅ Active |
| WF-SEO-09 | Internal Linking Suggester | `akTW1dgtKtCpcz3R` | Webhook POST /seo-internal-linking | ✅ Active |
| WF-SEO-10 | Google Indexing Ping | `8l9kEQlRVUbL4Ku6` | Webhook POST /seo-indexing-ping | ✅ Active |
| WF-SEO-11 | Content Decay Detector | `Ss2Bfps5lXBWUUs4` | First Monday of month 9AM IST | ✅ Active |
| WF-SEO-12 | Weekly Opportunity Digest | `M4rbRZL5jh0jJHku` | Every Friday 5PM IST | ✅ Active |

**n8n URL:** https://primary-production-6c6f5.up.railway.app

**Webhook Base URL:** `https://primary-production-6c6f5.up.railway.app/webhook/`

---

## 2. ALL DATABASE TABLES

### Pre-existing SEO Tables (Phase 1)
| Table | Purpose |
|-------|---------|
| `seo_weekly_metrics` | GA4 + Search Console weekly KPIs |
| `seo_keyword_tracking` | Legacy keyword tracking |
| `seo_alerts_log` | Alert history |

### New SEO Tables (Phase 2 — Migration 0013)
| Table | Purpose |
|-------|---------|
| `client_knowledge_base` | Brand guidelines, voice, competitor domains, target keywords |
| `client_pages` | All published pages with WP post IDs, internal links |
| `keyword_rankings` | Weekly rank snapshots per keyword per project |
| `backlink_data` | Backlink inventory from DataForSEO |
| `content_gap_analysis` | AI-generated competitor gap analysis |
| `seo_opportunities` | Identified actionable SEO opportunities |
| `site_health_metrics` | PageSpeed, CWV (LCP/FID/CLS) weekly scores |
| `brand_mentions` | Brand mention tracking |

### Key Columns
```sql
-- keyword_rankings
SELECT project_name, keyword, current_position, position_change, search_volume, recorded_date
FROM keyword_rankings ORDER BY recorded_date DESC;

-- content_gap_analysis
SELECT project_name, target_keyword, priority_score, topics_missing, questions_missing
FROM content_gap_analysis ORDER BY priority_score DESC;

-- site_health_metrics
SELECT project_name, pagespeed_mobile, lcp, cls, checked_at
FROM site_health_metrics ORDER BY checked_at DESC;
```

---

## 3. API INTEGRATIONS & COSTS

| API | Used For | Cost | Plan |
|-----|----------|------|------|
| Google PageSpeed Insights | WF-SEO-05 | Free | No key needed |
| Google Natural Language API | WF-SEO-04 entity scoring | $0.001/1k chars | Free tier: 5k units/mo |
| Google Indexing API | WF-SEO-10 | Free | 200 URLs/day |
| Google Search Console API | WF-SEO-01 | Free | Via OAuth |
| Google Analytics Data API | WF-SEO-01 | Free | Via OAuth |
| ValueSERP | WF-SEO-06, 07 | ~$50/mo | 5k searches/mo |
| DataForSEO | WF-SEO-08 | ~$30/mo | Pay per call |
| Anthropic Claude API | WF-SEO-04, 07, 11, 12 | ~$20/mo | claude-sonnet-4-6 |
| Slack | All workflows | Free | Bot token |
| Brevo | WF-SEO-11 email | Free tier | 300 emails/day |

**GCP Project:** `clickup-auto-prod-260311` (project ID: 605266695454)

---

## 4. ENVIRONMENT VARIABLES

### Currently Set in Railway (web service)
```
DATABASE_URL         postgresql://postgres:***@postgres.railway.internal:5432/railway
BREVO_API_KEY        xkeysib-***
SLACK_BOT_TOKEN      xoxb-***
SLACK_SOD_EOD_CHANNEL C08EMRX2HHN
GOOGLE_PLACES_API_KEY AIzaSyD8hm9c75Ob_***  (Places API key)
GCP_NL_API_KEY       AIzaSyBu6ZkzPyXbYK1QK*** (Natural Language API key)
GCP_OAUTH_CLIENT_ID  605266695454-ppkgsbl441grhftqgbr5f***.apps.googleusercontent.com
GCP_OAUTH_CLIENT_SECRET GOCSPX-c-k3UvohUlPat***
WP_AAROHAOM_URL      https://aarohaom.com
WP_AAROHAOM_USER     admin
WP_AAROHAOM_PASS     ***REDACTED 2026-07-19 — plaintext value found committed here, removed from working tree; still in git history and matches the live Railway env var as of this writing — treat as compromised until rotated***
WP_BLACKPANDA_URL    https://blackpandaenterprises.com
WP_BLACKPANDA_USER   admin
WP_BLACKPANDA_PASS   ***REDACTED 2026-07-19 — plaintext value found committed here, removed from working tree; still in git history and matches the live Railway env var as of this writing — treat as compromised until rotated***
WP_AGEDDENTISTRY_URL https://ageddentistry.org
WP_AGEDDENTISTRY_USER admin
WP_AGEDDENTISTRY_PASS ***REDACTED 2026-07-19 — plaintext value found committed here, removed from working tree; still in git history and matches the live Railway env var as of this writing — treat as compromised until rotated***
```

### ⚠️ MUST ADD to Railway (n8n service)
```
CLAUDE_API_KEY        [Your Anthropic API key]
DATAFORSEO_LOGIN      [DataForSEO account email]
DATAFORSEO_PASSWORD   [DataForSEO account password]
VALUESREP_API_KEY     [ValueSERP API key from valueserp.com]
GCP_PROJECT_ID        clickup-auto-prod-260311
```

### n8n Credential IDs (already configured)
```
Google SEO OAuth:          YxrNZeLdvBfNxEsZ
Growth Escalators Postgres: N7nIyQgdtKFT9Ye8
Slack Bot:                 VaNm8cr89lLAGlpJ
```

---

## 5. WEEKLY AUTOMATION SCHEDULE

```
MONDAY
  1:00 AM UTC  — WF-SEO-01: Weekly SEO Data Pull (GA4 + Search Console)

TUESDAY
  3:30 AM UTC  — WF-SEO-06: Rank Tracker (ValueSERP for all keywords)

WEDNESDAY (every other week)
  5:30 AM UTC  — WF-SEO-07: Content Gap Analysis (Claude analysis)

FRIDAY
  3:30 AM UTC  — WF-SEO-08: Backlink Monitor (DataForSEO)
  4:00 PM IST  — WF-SEO-03: Weekly AI Insight Report (existing)
  5:00 PM IST  — WF-SEO-12: Weekly Opportunity Digest (AI-ranked actions)

SUNDAY
  1:30 AM UTC  — WF-SEO-05: PageSpeed Monitor (CWV scores)

DAILY
  9:00 AM IST  — WF-SEO-02: Daily Alert Triggers

WEEKLY (every Monday)
  9:00 AM IST  — WF-SEO-11: Content Decay Detector (backend-native)

ON-DEMAND (webhooks)
  POST /webhook/seo-publish          — WF-SEO-04: Publish content to WordPress
  POST /webhook/seo-indexing-ping    — WF-SEO-10: Google Indexing Ping
  POST /webhook/seo-internal-linking — WF-SEO-09: Internal Linking Suggestions
```

---

## 6. HOW TO ADD A NEW CLIENT

1. **Add knowledge base entry:**
```sql
INSERT INTO client_knowledge_base (
  project_name, brand_summary, ideal_customer, unique_value_proposition,
  brand_voice, words_always_use, words_never_use, competitor_domains, target_keywords_priority
) VALUES (
  'newclient',
  'Brand summary here',
  'Target audience description',
  'What makes them unique',
  'Professional, warm, clear',
  '["word1","word2"]'::jsonb,
  '["avoid1","avoid2"]'::jsonb,
  '["competitor.com"]'::jsonb,
  '["primary keyword","secondary keyword"]'::jsonb
);
```

2. **Add WP credentials to Railway:**
```
railway variable set WP_NEWCLIENT_URL=https://newclientdomain.com
railway variable set WP_NEWCLIENT_USER=admin
railway variable set WP_NEWCLIENT_PASS=their-app-password
```

3. **Update WF-SEO-04 Validate Input node** to include the new project slug in the `allowed` array.

4. **Update WF-SEO-05, 06, 08** — add the client to the `clients` array in their respective "Define Client Sites/Domains" nodes.

5. **Add initial keywords to track:**
```sql
INSERT INTO keyword_rankings (project_name, keyword, search_volume, recorded_date)
VALUES
  ('newclient', 'target keyword 1', 1500, CURRENT_DATE),
  ('newclient', 'target keyword 2', 800, CURRENT_DATE);
```

6. Redeploy n8n service to apply env changes.

---

## 7. HOW TO ADD NEW KEYWORDS TO RANK TRACKER

```sql
-- Add keywords to be tracked on next Tuesday's run
INSERT INTO keyword_rankings (project_name, keyword, search_volume, recorded_date)
VALUES
  ('aarohaom', 'new keyword to track', 1200, CURRENT_DATE),
  ('blackpanda', 'another keyword', 500, CURRENT_DATE);
```

WF-SEO-06 will automatically pick these up on the next Tuesday run.

**To track a keyword immediately:**
1. Open n8n → WF-SEO-06 → Execute workflow
2. The workflow reads from `keyword_rankings` and adds any new keywords

---

## 8. HOW TO TRIGGER CONTENT GAP ANALYSIS MANUALLY

**Via n8n:**
1. Open n8n: https://primary-production-6c6f5.up.railway.app
2. Open WF-SEO-07
3. Click "Execute Workflow" (top right)

**Prerequisite:** Keywords must have rankings in `keyword_rankings` table (positions 5-20)

**To force analysis for a specific keyword:**
```sql
-- Temporarily set a keyword to position 10 to trigger analysis
UPDATE keyword_rankings
SET current_position = 10
WHERE project_name = 'aarohaom' AND keyword = 'ayurvedic treatment'
  AND recorded_date = (SELECT MAX(recorded_date) FROM keyword_rankings WHERE project_name = 'aarohaom');
```

Then execute WF-SEO-07 in n8n.

---

## 9. THURSDAY MEETING CHECKLIST (UPDATED)

**15 min before the meeting:**
```bash
# Run quick health check
railway run npx tsx scripts/test-seo-system.ts
```

**During the meeting, pull these dashboards:**

1. **Rankings this week:**
```sql
SELECT project_name, keyword, current_position, position_change, search_volume
FROM keyword_rankings
WHERE recorded_date >= CURRENT_DATE - 7
ORDER BY position_change DESC
LIMIT 20;
```

2. **Top content opportunities:**
```sql
SELECT project_name, target_keyword, our_position, priority_score, topics_missing
FROM content_gap_analysis
WHERE status = 'pending'
ORDER BY priority_score DESC
LIMIT 5;
```

3. **PageSpeed scores:**
```sql
SELECT project_name, pagespeed_mobile, pagespeed_desktop, lcp, cls, checked_at
FROM site_health_metrics
ORDER BY checked_at DESC LIMIT 10;
```

4. **Open opportunities:**
```sql
SELECT project_name, opportunity_type, description, effort_level
FROM seo_opportunities
WHERE status = 'open'
ORDER BY identified_at DESC LIMIT 10;
```

5. **Check Friday's Slack digest** in #performance-marketing for the AI-ranked action list.

---

## 10. TROUBLESHOOTING GUIDE

### WF-SEO-04 not publishing to WordPress
- **Check:** WP credentials in Railway env (`WP_*_USER`, `WP_*_PASS`)
- **Test:** `curl -u admin:APP_PASSWORD https://site.com/wp-json/wp/v2/pages?per_page=1`
- **Fix:** WP admin → Users → Application Passwords → Generate new password

### WF-SEO-05 PageSpeed shows no data
- **Check:** PageSpeed API quota (25 queries/day free, 25k/day with paid project)
- **Fix:** Either wait for quota reset or use a new GCP project

### WF-SEO-06 ValueSERP fails
- **Check:** `VALUESREP_API_KEY` is set in n8n service Railway variables
- **Check:** API credits remaining at valueserp.com/dashboard
- **Fix:** Top up credits or rotate API key

### WF-SEO-08 DataForSEO fails
- **Check:** `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` set in Railway
- **Check:** Credits remaining at app.dataforseo.com
- **Fix:** Top up or rotate credentials

### WF-SEO-09 Internal linking returns no suggestions
- **Check:** `client_pages` table has entries for that project
- **Fix:** Pages register automatically after WF-SEO-04 publishes. OR manually insert:
```sql
INSERT INTO client_pages (project_name, page_url, page_title, target_keyword)
VALUES ('aarohaom', 'https://aarohaom.com/page/', 'Page Title', 'target keyword');
```

### WF-SEO-10 Indexing ping fails
- **Check:** Google OAuth credential `YxrNZeLdvBfNxEsZ` in n8n is still valid
- **Fix:** n8n → Credentials → Google SEO OAuth → Re-authorize

### WF-SEO-11 shows no decaying pages
- Needs ~35 days of ranking history. Backend-native service compares last 7 days vs 7–35-day baseline.
- **First check:** open the SEO → Workflows tab. The "Content Decay Detection" card shows an amber banner if `keyword_rankings` has 0 rows in the last 10 days — that means the upstream Rank Tracking cron (Tuesday 9 AM IST) is not writing.
- **Most common cause:** `SERPER_API_KEY` missing on the Railway worker → rank tracker silently skips.

### WF-SEO-12 Digest shows "Unable to generate AI summary"
- **Check:** `CLAUDE_API_KEY` is set in Railway env
- **Check:** Claude API credits at console.anthropic.com

### Claude API (WF-SEO-04) fails entity scoring
- NL API key used: `GCP_NL_API_KEY` = `***REDACTED-ROTATED-2026-07-23***`
- GCP Project: `clickup-auto-prod-260311`
- Free tier: 5,000 natural language units/month
- If quota exceeded, the workflow continues without entity scoring

---

## 11. TEST SUITE INSTRUCTIONS

```bash
# Run against Railway production (recommended)
railway run npx tsx scripts/test-seo-system.ts

# Run with external DB (from local machine)
DATABASE_URL="postgresql://postgres:PASSWORD@nozomi.proxy.rlwy.net:46852/railway" \
  GOOGLE_PLACES_API_KEY="***REDACTED-ROTATED-2026-07-23***" \
  SLACK_BOT_TOKEN="xoxb-***" \
  npx tsx scripts/test-seo-system.ts
```

**Current Expected Results:**
- ✅ TEST 1: Database + 8 new tables (49 total)
- ✅ TEST 2: Knowledge base (3 clients)
- ✅ TEST 3: PageSpeed API (quota OK)
- ⚠️ TEST 4: ValueSERP — needs VALUESREP_API_KEY
- ⚠️ TEST 5: DataForSEO — needs DATAFORSEO_LOGIN + PASSWORD
- ✅ TEST 6: Google Indexing API (OAuth ready in n8n)
- ✅ TEST 7: Natural Language API (2 entities detected)
- ✅ TEST 8: All 12 n8n workflows active
- ✅ TEST 9: WordPress REST API (3 sites)
- ⚠️ TEST 10: Claude API — needs CLAUDE_API_KEY in web service env
- ✅ TEST 11: Internal linking query
- ✅ TEST 12: Slack posting

**Tests 4, 5, 10 will pass once new API keys are added to Railway.**

---

## 12. MONTHLY MAINTENANCE CHECKLIST

**1st of every month:**
- [ ] Review `seo_opportunities` table — close resolved items
- [ ] Review content decay report from WF-SEO-11 (runs first Monday)
- [ ] Check DataForSEO and ValueSERP credit balance
- [ ] Verify Claude API spend at console.anthropic.com
- [ ] Archive old ranking data (>6 months) to save DB space:
```sql
DELETE FROM keyword_rankings WHERE recorded_date < CURRENT_DATE - INTERVAL '180 days';
```
- [ ] Update `client_knowledge_base` if brand info has changed
- [ ] Review and close resolved `seo_opportunities`

**Quarterly:**
- [ ] Review and update target keywords in `keyword_rankings` seed list
- [ ] Update competitor domains in `client_knowledge_base`
- [ ] Audit `client_pages` — remove deleted pages
- [ ] Run full test suite and document results

---

## 13. HOW TO PUBLISH CONTENT (WF-SEO-04)

**Trigger via webhook:**
```bash
curl -X POST "https://primary-production-6c6f5.up.railway.app/webhook/seo-publish" \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "aarohaom",
    "targetKeyword": "ayurvedic treatment Mumbai",
    "serviceType": "Panchakarma Therapy",
    "location": "Mumbai",
    "supportingData": "Over 500 patients treated, 15 years experience",
    "faqQuestions": [
      "What is Panchakarma therapy?",
      "How long does treatment take?",
      "Is it safe for all ages?"
    ]
  }'
```

**What happens automatically:**
1. Knowledge base context fetched for `aarohaom`
2. Claude generates full SEO page (H1, meta, content, FAQs)
3. NL API scores keyword entity salience
4. WordPress draft created with canonical URL and RankMath meta
5. Page registered in `client_pages` table
6. Google Indexing API pinged
7. Internal linking suggestions generated
8. Slack confirmation sent to #seo-publishing

---

## 14. TECHNICAL ARCHITECTURE

```
                     RAILWAY INFRASTRUCTURE
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  n8n (primary-production-6c6f5.up.railway.app)         │
│  ├── WF-SEO-01: GSC + GA4 weekly pull                  │
│  ├── WF-SEO-02: Daily alert triggers                   │
│  ├── WF-SEO-03: AI weekly insight report               │
│  ├── WF-SEO-04: WordPress publisher (upgraded)         │
│  ├── WF-SEO-05: PageSpeed monitor                      │
│  ├── WF-SEO-06: Rank tracker (ValueSERP)               │
│  ├── WF-SEO-07: Content gap (Claude)                   │
│  ├── WF-SEO-08: Backlink monitor (DataForSEO)          │
│  ├── WF-SEO-09: Internal linking (webhook)             │
│  ├── WF-SEO-10: Indexing ping (webhook)                │
│  ├── WF-SEO-11: Content decay (monthly)                │
│  └── WF-SEO-12: Weekly opportunity digest              │
│                                                         │
│  Express API (web-production-311da.up.railway.app)      │
│  └── /health, /stats, all CRM routes                   │
│                                                         │
│  PostgreSQL (nozomi.proxy.rlwy.net:46852)              │
│  └── 49 tables (35 CRM + 3 legacy SEO + 8 new SEO +   │
│      2 outreach + 1 errors)                            │
└─────────────────────────────────────────────────────────┘

EXTERNAL APIs
├── Google PageSpeed Insights (free, no key needed)
├── Google Natural Language API (key: GCP_NL_API_KEY)
├── Google Indexing API (OAuth: YxrNZeLdvBfNxEsZ in n8n)
├── Google Search Console (OAuth: YxrNZeLdvBfNxEsZ in n8n)
├── ValueSERP (key: VALUESREP_API_KEY)
├── DataForSEO (login/password: DATAFORSEO_*)
├── Anthropic Claude API (key: CLAUDE_API_KEY)
├── WordPress REST API (per-site app passwords)
└── Slack (bot token: SLACK_BOT_TOKEN)

WORDPRESS SITES
├── aarohaom.com (WP_AAROHAOM_*)
├── blackpandaenterprises.com (WP_BLACKPANDA_*)
└── ageddentistry.org (WP_AGEDDENTISTRY_*)
```

---

## 15. CLIENT KNOWLEDGE BASE STATUS

| Client | Project Key | Voice | Priority Keywords | Status |
|--------|------------|-------|------------------|--------|
| Aarogaom | `aarohaom` | Warm, holistic | ayurvedic treatment, wellness | ✅ Seeded |
| Black Panda | `blackpanda` | Professional, data-driven | India market entry, GCC | ✅ Seeded |
| Aged Dentistry | `ageddentistry` | Reassuring, professional | dentist, dental implants | ✅ Seeded |

**To update a client's knowledge base:**
```sql
UPDATE client_knowledge_base
SET brand_summary = 'Updated summary...',
    proof_points = '["New proof point 1", "Point 2"]'::jsonb,
    updated_at = NOW()
WHERE project_name = 'aarohaom';
```

---

*Generated by Growth Escalators SEO Automation — Phase 2*
*Backend: https://web-production-311da.up.railway.app*
*n8n: https://primary-production-6c6f5.up.railway.app*
