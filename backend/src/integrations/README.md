# integrations/

Placeholder directory per Backend Spec §1 — external provider adapters.

| Adapter | Phase | Notes |
|---|---|---|
| `email/email.provider.ts` | PH-08 | A-04; until configured, notifications stay in_app-only (AC-52) |
| `sms/sms.provider.ts` | PH-08 | A-04; NFR-16 — no clinical detail in messages |
| `payment/payment.provider.ts` + `webhook.handler.ts` | PH-07 | EP-63/64, SEC-25 webhook signature verification |
| `storage/storage.provider.ts` | PH-04+ | SEC-16 document upload validation |
| `channel-manager/` | out of scope | Not in the HMS spec; do not build (X-xx) |

Providers must implement the adapter interface consumed by services — never
called directly from routes/controllers.
