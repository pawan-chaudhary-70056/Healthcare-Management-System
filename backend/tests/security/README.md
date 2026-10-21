# tests/security — negative-authorization & attack-suite (Testing Strategy §3)

Security test suite per `docs/08-QUALITY-AND-OPERATIONS/01-TESTING-STRATEGY.md §3`
and Build TODOs PH-09. Coverage map (cases land as their phases complete):

| Case | Status | Where |
|---|---|---|
| IDOR sweep (object access across roles) | ✅ | `idor-sweep.test.ts` — cross-patient + cross-clinician record access over patients/clinical/lab/billing: 403 + `security.access_denied`; scoped lists never leak foreign rows |
| Session cookie flags (`httpOnly`, `sameSite=lax`, `secure` per env) | ✅ | `security-posture.test.ts` |
| Role/permission forgery rejected | ✅ | `tests/integration/mfa.test.ts` (AC-09) |
| NoSQL injection (`$gt`, `$where`, bracket-notation operators on auth + search) | ✅ | `nosql-injection.test.ts` — bodies → 422; query operators → no 5xx, no scope broadening |
| XSS stored/reflected via input fields | ✅ | `xss.test.ts` — script payloads stored verbatim as inert data; responses JSON + `nosniff` + CSP `script-src 'self'`; errors/routes never reflect into markup (client-side encoding assertion remains ⏳) |
| Webhook unsigned rejection (SEC-25) | ✅ | `tests/integration/billing.test.ts` |
| Money replay / idempotency replay | ✅ | `tests/integration/appointments.test.ts` (AC-16), `tests/integration/billing.test.ts` (AC-45/47) |
| Unverified lab result invisible to patient (NFR-17) | ✅ | `tests/integration/lab.test.ts` (AC-30/31) |
| CSRF posture (SameSite + no cross-site form flows) | ✅ | `csrf.test.ts` — HttpOnly + SameSite=Lax cookie; form-encoded / text-plain bodies cannot forge a write even with the victim cookie; JSON-only writes; unauthenticated mutations 401 |
| Brute-force login rate limit (NFR-10) | ⏳ planned | limiter disabled under `NODE_ENV=test`; verified live in `scripts/verify-live.mjs` |

Every case asserts the **standard error envelope** and, where applicable, an
audited `security.access_denied` entry.

## Findings fixed by this suite

- **Query-operator deserialization (SEC-17/19).** Express' default `extended`
  query parser turned `?q[$ne]=` into a Mongo operator object; services then
  threw on `.replace(...)` or `new Types.ObjectId({...})` → 500. Fixed by
  `app.set('query parser', 'simple')` (app.ts), so bracket notation stays a
  literal key and operators never reach Mongoose.
- **Malformed id → 500.** `new Types.ObjectId('not-an-objectid')` in list
  filters threw a CastError → 500. Fixed by `core/utils/object-id.ts`
  (`asObjectId`), which returns a 422 `VALIDATION_ERROR` for invalid ids; applied
  to the appointments, waitlist, platform (audit), billing, clinical, and lab
  list filters.
