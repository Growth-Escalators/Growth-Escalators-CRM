# SLO Pipeline Auto-Population Fix — Superpowers Plan

## Date: 15 April 2026
## Priority: Critical
## Estimated Sessions: 2

---

## Problem Statement

SLO funnel purchases are NOT auto-populating into the D2C Prospects pipeline. The pipeline stages (Paid ₹9, ₹208, ₹508, ₹707) exist visually but show "No deals yet" / "Empty" for all stages.

---

## Root Cause Analysis

### Issue 1: D2C Prospects Pipeline Never Created in Database
- `ensureOutreachPipelines()` in `pipelineService.ts` creates **Agency Owners** and **Freelancer** pipelines only
- The `PIPELINE_MAP` routes `ecom_brand` → `'D2C Prospects'` but that pipeline doesn't exist
- Pipeline lookup fails silently (`logger.warn` only), no deal is placed
- **Impact**: ALL D2C purchases go nowhere — contacts exist, deals exist, but pipeline is empty

### Issue 2: Deal Created Without pipelineId
- `cashfree.ts:179-182` creates deal with `pipelineId: null`
- The pipeline placement cron (every 30s) is supposed to fix this, but it fails due to Issue 1

### Issue 3: Segment Routing Not Reaching Pipeline
- Checkout passes `ecom_brand` / `agency_owner` / `freelancer` as segment
- Contact gets tagged correctly (`slo_buyer`, `ecom_brand`)
- But pipeline placement fails → no assets delivered → no follow-up emails/WA

---

## Current Post-Purchase Flow (What Works vs What's Broken)

```
Cashfree PAYMENT_SUCCESS webhook
  ✅ Contact created (with slo_buyer tag + segment tag)
  ✅ Deal created (stage = paid_9 etc, but pipelineId = NULL)
  ✅ CAPI Purchase event → Meta (but missing FBP/FBC cookies)
  ✅ WhatsApp template ge_welcome_d2c → customer (with PDF link)
  ✅ Event logged (slo_purchase)
  ✅ Idempotency via processedEvents table
  
  [30 sec later — Pipeline Placement Cron]
  ❌ Looks up 'D2C Prospects' pipeline → NOT FOUND
  ❌ Returns success: false → silently fails
  ❌ No Brevo email sent (depends on successful placement)
  ❌ No email sequence enrollment
  ❌ No follow-up WhatsApp sequence
```

---

## Fix Plan

### Task 1: Create D2C Prospects Pipeline (CRITICAL)
**File:** `src/services/pipelineService.ts`
**What:** Add D2C pipeline to `ensureOutreachPipelines()` with same 8 stages:
- Paid ₹9, Paid ₹208, Paid ₹508, Paid ₹707
- Appointment Booked, No Show, Converted, Lost

**Test:** After deploy, check `/api/pipelines` returns 3 pipelines

### Task 2: Auto-Populate Based on Segment
**File:** `src/services/pipelineService.ts`
**What:** The `PIPELINE_MAP` already handles routing:
- `ecom_brand` → D2C Prospects
- `agency_owner` → Agency Owners
- `freelancer` → Freelancer

Once pipeline exists (Task 1), this will auto-work. Verify by checking `placePipelineContact()` logs.

### Task 3: Post-Purchase Email via Brevo
**File:** `src/services/assetDeliveryService.ts`
**What:** Currently sends email after pipeline placement. Ensure:
- Welcome email with correct product links
- Segment-specific content (D2C vs Agency vs Freelancer)

### Task 4: Post-Purchase WA Sequence Enrollment
**File:** `src/routes/cashfree.ts` + `src/services/sequenceService.ts`
**What:** After purchase, auto-enrol in WhatsApp nurture sequence:
- Day 0: ge_welcome_d2c (already sent)
- Day 3: ge_followup_d3
- Day 7: ge_nudge_d7

### Task 5: CAPI Status Audit
**File:** `src/services/metaCapi.ts` + `src/routes/capi.ts`
**Current status:**
- CAPI fires on every purchase via `sendPurchaseEvent()`
- Uses `META_PIXEL_ID` + `META_CAPI_TOKEN` env vars
- Logs events to `events` table as `capi_purchase_sent`
- **Missing:** FBP/FBC cookies (no pixel-to-server attribution)
- **Missing:** Event deduplication ID not being used
- **Verification:** `GET /api/capi/status` shows recent events

**Fix needed:**
- Pass `event_id` for deduplication (pixel fires same event client-side)
- Capture `_fbp` / `_fbc` cookies from checkout page JS, pass to webhook body

---

## CAPI Status Summary

| Aspect | Status |
|--------|--------|
| Purchase events firing | ✅ Working — fires on every Cashfree webhook |
| Meta Pixel ID configured | ✅ Set via META_PIXEL_ID env var |
| CAPI Token configured | ✅ Set via META_CAPI_TOKEN env var |
| User data hashed | ✅ SHA256 hashing for email, phone, name |
| FBP/FBC cookies | ❌ Not captured from client |
| Dedup event_id | ❌ Not passed (causes potential double-counting) |
| Last triggered | Check via `GET /api/capi/status` on live server |
| Event log | ✅ All events in `events` table (event_type = capi_purchase_sent) |

---

## Verification Checklist

After all fixes:
1. Make test purchase on SLO funnel
2. Check Pipeline page → D2C Prospects → deal should appear in correct stage
3. Check contact tags → should have slo_buyer + segment
4. Check WhatsApp → customer should receive ge_welcome_d2c
5. Check email → customer should receive Brevo welcome
6. Check `/api/capi/status` → purchase event should be logged
7. Check Meta Events Manager → server event should appear
