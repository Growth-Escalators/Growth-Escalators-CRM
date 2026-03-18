# Booking Rotation System

Round-robin Cal.com booking rotation for Growth Escalators. Visitors hitting a strategy page URL
get redirected to whichever team member is next in rotation for that funnel, based on weighted
assignment tracking.

---

## Redirect URL format

```
https://web-production-311da.up.railway.app/book/FUNNEL-SLUG
```

Example: `https://web-production-311da.up.railway.app/book/d2c-strategy`

Use this URL on your strategy/landing pages, in ads, or anywhere you want visitors to book calls.
The system handles the rotation automatically — visitors never see any selection page.

---

## How it works

Each funnel has members with a **weight** (0–100, all weights sum to 100). The algorithm always
assigns to whoever is most "behind" their target percentage. With 50/50 weights the system
alternates perfectly. With 70/30 weights, member A gets roughly 7 out of every 10 assignments.

Every assignment is logged in `funnel_assignments` with a timestamp and visitor IP.

---

## Managing funnels

### Create a new funnel

```bash
curl -X POST https://web-production-311da.up.railway.app/book/funnels \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "3ff1e516-7612-477b-a778-4b84659767fa",
    "name": "Healthcare Strategy Page",
    "slug": "healthcare-strategy",
    "members": [
      {
        "memberName": "Jatin",
        "calcomUrl": "https://cal.com/jatin-agrawal/discovery-call",
        "weight": 50
      },
      {
        "memberName": "Vishal",
        "calcomUrl": "https://cal.com/vishal-malakar/discovery-call",
        "weight": 50
      }
    ]
  }'
```

> Weights must sum to exactly 100 or the request returns a 400 error.

---

### Add a new member to an existing funnel

```bash
curl -X POST https://web-production-311da.up.railway.app/book/funnels/d2c-strategy/members \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "3ff1e516-7612-477b-a778-4b84659767fa",
    "memberName": "Rahul",
    "calcomUrl": "https://cal.com/rahul/discovery-call",
    "weight": 25
  }'
```

> Note: After adding a new member, the existing members' weights will no longer sum to 100.
> Use the PATCH endpoint to rebalance them, or reset and recreate.

---

### Temporarily deactivate a member (on leave, sick day, etc.)

First get the member's ID from the stats endpoint, then:

```bash
curl -X PATCH "https://web-production-311da.up.railway.app/book/funnels/d2c-strategy/members/MEMBER-UUID" \
  -H "Content-Type: application/json" \
  -d '{"isActive": false}'
```

To reactivate:

```bash
curl -X PATCH "https://web-production-311da.up.railway.app/book/funnels/d2c-strategy/members/MEMBER-UUID" \
  -H "Content-Type: application/json" \
  -d '{"isActive": true}'
```

---

### Update a member's Cal.com link

```bash
curl -X PATCH "https://web-production-311da.up.railway.app/book/funnels/d2c-strategy/members/MEMBER-UUID" \
  -H "Content-Type: application/json" \
  -d '{"calcomUrl": "https://cal.com/vishal-malakar/discovery-call"}'
```

---

### Check stats for a funnel

```bash
curl "https://web-production-311da.up.railway.app/book/funnels/d2c-strategy/stats?tenantId=3ff1e516-7612-477b-a778-4b84659767fa"
```

Returns:
- Funnel details
- Each member with `totalAssigned` count and `percentage` of total
- Last 10 assignments (who got it, when, visitor IP)

---

### List all funnels

```bash
curl "https://web-production-311da.up.railway.app/book/funnels?tenantId=3ff1e516-7612-477b-a778-4b84659767fa"
```

---

### Reset assignment counts (rebalance)

Use this when adding/removing members and you want a clean slate:

```bash
curl -X POST https://web-production-311da.up.railway.app/book/funnels/d2c-strategy/reset \
  -H "Content-Type: application/json" \
  -d '{"tenantId": "3ff1e516-7612-477b-a778-4b84659767fa"}'
```

This sets `totalAssigned = 0` for all members in the funnel. The next assignment starts fresh.

---

## Tenant ID

Growth Escalators tenant ID: `3ff1e516-7612-477b-a778-4b84659767fa`

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/book/:slug` | **Redirect** visitor to next member's Cal.com URL |
| POST | `/book/funnels` | Create funnel + members |
| GET | `/book/funnels` | List all funnels (`?tenantId=`) |
| GET | `/book/funnels/:slug/stats` | Funnel stats + last 10 assignments |
| POST | `/book/funnels/:slug/members` | Add member to existing funnel |
| PATCH | `/book/funnels/:slug/members/:memberId` | Update member (URL, weight, active) |
| POST | `/book/funnels/:slug/reset` | Reset all assignment counts |
