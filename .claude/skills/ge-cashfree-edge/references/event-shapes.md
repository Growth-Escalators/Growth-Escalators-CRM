# Cashfree webhook event shapes

## v2023-08-01 (current — what production receives)

```json
{
  "type": "PAYMENT_SUCCESS_WEBHOOK",
  "data": {
    "order": {
      "order_id": "GE_1714502400000_AB12CD",
      "order_amount": 499,
      "order_tags": {
        "segment": "primary",
        "bump1": "true",
        "bump2": "false",
        "funnelSlug": "ecom",
        "fbp": "fb.1.123.456",
        "fbc": "fb.1.789.012",
        "utm_source": "facebook",
        "utm_medium": "cpc",
        "utm_campaign": "evergreen",
        "utm_content": "",
        "utm_term": ""
      },
      "order_meta": {
        "return_url": "https://ecom.growthescalators.com/thank-you",
        "notify_url": "https://ecom.growthescalators.com/api/cashfree/webhook"
      }
    },
    "payment": {
      "cf_payment_id": "1234567890",
      "payment_status": "SUCCESS"
    },
    "customer_details": {
      "customer_name": "Jatin Agrawal",
      "customer_email": "jatin@example.com",
      "customer_phone": "9876543210"
    }
  }
}
```

## Legacy / test fixture (still accepted)

```json
{
  "event_type": "PAYMENT_SUCCESS_WEBHOOK",
  "data": {
    "order": {
      "order_id": "...",
      "order_meta": {
        "segment": "primary",
        "bump1": true
      }
    },
    "payment": { "cf_payment_id": "...", "payment_status": "SUCCESS" }
  }
}
```

Differences:
- `type` (new) vs `event_type` (legacy)
- Custom fields in `order_tags` (new — preserved) vs `order_meta` (legacy — silently dropped by Cashfree on real orders, only present in our fixtures)
- `order_tags` values are strings; `order_meta` allowed booleans/numbers

## Processor's normalisation

`src/services/cashfreeEventProcessor.ts` reads:
```ts
const eventType = body.type ?? body.event_type;
const orderTags = body.data?.order?.order_tags ?? {};
const orderMeta = body.data?.order?.order_meta ?? {};
const segment = orderTags.segment ?? orderMeta.segment ?? 'primary';
const bump1 = orderTags.bump1 === 'true' || orderMeta.bump1 === true;
```

Note string-vs-boolean handling — `order_tags.bump1` is the literal string `"true"`, `order_meta.bump1` (legacy) was a boolean. Both must work.
