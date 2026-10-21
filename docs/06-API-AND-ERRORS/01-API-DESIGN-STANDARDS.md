# 01 — API Design Standards

> **Document:** REST conventions, endpoint catalog, and request/response standards for the HMS API
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** Developers and AI coding agents
> **Related documents:** `02-ERROR-HANDLING-AND-VALIDATION.md`, `01-ROLES-AND-PERMISSIONS.md` (PERM mapping), `04-BACKEND-SPECIFICATION.md`
> **Rule:** Every endpoint declares: method, path, required permission, scope, request schema, response shape, and error codes. Undeclared endpoints must not be implemented.

---

## 1. Global Conventions

| Aspect | Standard |
|--------|----------|
| Style | REST, JSON only, `/api/v1` prefix |
| Auth | Session cookie (HTTP-only) via `requireAuth`; `/auth/me` returns profile + permissions |
| Authorization | Each route declares its PERM-xx requirement(s) + scope type (patient/encounter/lab/pharmacy/finance) |
| Idempotency | `Idempotency-Key` header on POST /payments and POST /appointments (required) |
| Pagination | `?page=1&limit=20` → response `{ data, page, limit, total }`; max limit 100 |
| Filtering/sort | Explicit allow-listed query params (e.g., `status`, `dateFrom`, `doctorId`) |
| Dates | ISO 8601 UTC in API; facility-local rendering in UI (A-01) |
| Money | Integer minor units + `currency` field |
| Statuses | Canonical glossary strings only |
| Versioning | Path version (`/api/v1`); breaking changes → `/api/v2` |
| Rate limits | Global default; stricter on `/auth/*` (NFR-10) |

---

## 2. Standard Response Envelope

```json
// Success
{ "data": { … }, "meta": { "page": 1, "limit": 20, "total": 143 } }

// Error — see 02-ERROR-HANDLING-AND-VALIDATION.md
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [ … ], "traceId": "…" } }
```

---

## 3. Endpoint Catalog

Legend: 🔒 = permission; permissions from `01-ROLES-AND-PERMISSIONS.md §4`.

### 3.1 Auth (`/api/v1/auth`)
| EP | Method & Path | Permission | Notes |
|----|---------------|------------|-------|
| EP-01 | `POST /login` | public | Rate-limited; generic errors |
| EP-02 | `POST /logout` | authed | Invalidates session |
| EP-03 | `GET /me` | authed | Profile + server permissions |
| EP-04 | `POST /register` | public | Patient role only |
| EP-05 | `POST /forgot-password` | public | Neutral response |
| EP-06 | `POST /reset-password` | token | Single-use token |
| EP-07 | `POST /mfa/enroll` · `POST /mfa/verify` | authed | Privileged forced |

### 3.2 Directory (`/api/v1/public`)
| EP | Method & Path | Permission |
|----|---------------|------------|
| EP-08 | `GET /departments` | public (active, publicVisible only) |
| EP-09 | `GET /doctors?departmentId` | public (name, specialty, department, availability summary; no personal contacts) |

### 3.3 Patients (`/api/v1/patients`)
| EP | Method & Path | Permission |
|----|---------------|------------|
| EP-10 | `POST /` | `patient.create` |
| EP-11 | `GET /:id` | `patient.read.*` + object/scope |
| EP-12 | `PATCH /:id` | `patient.update` / `patient.update.own` |
| EP-13 | `GET /:id/summary` | care-team scope (assigned) |
| EP-14 | `PUT /:id/consents` | `patient.consent.manage` |

### 3.4 Appointments (`/api/v1/appointments`)
| EP | Method & Path | Permission |
|----|---------------|------------|
| EP-20 | `GET /slots?doctorId&date` | authed (booking-capable roles) |
| EP-21 | `POST /` | `appointment.create.any` / `.own`; Idempotency-Key required |
| EP-22 | `GET /mine` · `GET /` (staff) | scoped by role |
| EP-23 | `POST /:id/reschedule` | `appointment.reschedule` |
| EP-24 | `POST /:id/cancel` | `appointment.cancel` |
| EP-25 | `POST /:id/checkin` | `appointment.checkin` |
| EP-26 | `GET /queue?departmentId` | `appointment.queue.manage`/doctor |
| EP-27 | `POST /waitlist` · `DELETE /waitlist/:id` | `appointment.create.*` |

### 3.5 Clinical & Nursing (`/api/v1/encounters`, `/prescriptions`, `/nursing`)
| EP | Method & Path | Permission |
|----|---------------|------------|
| EP-30 | `POST /encounters` | `encounter.create` (appointment CHECKED_IN) |
| EP-31 | `POST /encounters/:id/emr` · `PATCH /emr/:entryId` | `emr.write` |
| EP-32 | `POST /emr/:entryId/finalize` | `emr.write` (author) |
| EP-33 | `POST /emr/:entryId/amend` | `emr.amend` + reason |
| EP-34 | `GET /patients/:id/emr` | `emr.read.assigned` / `.released.own` |
| EP-35 | `POST /prescriptions` | `prescription.create` |
| EP-36 | `POST /prescriptions/:id/cancel` | prescriber |
| EP-37 | `POST /nursing/entries` | `nursing.entry.create` (assigned patient) |
| EP-38 | `GET /nursing/entries?patientId=` | `emr.read.assigned` (nurse assigned scope) |

### 3.6 Laboratory (`/api/v1/lab`)
| EP | Method & Path | Permission |
|----|---------------|------------|
| EP-40 | `POST /orders` | `lab.order.create` |
| EP-41 | `POST /orders/:id/specimen` | `lab.specimen.record` |
| EP-42 | `POST /orders/:id/results` | `lab.result.enter` |
| EP-43 | `POST /results/:id/verify` | `lab.result.verify` |
| EP-44 | `POST /results/:id/release` | `lab.result.release` |
| EP-45 | `POST /results/:id/amend` | `lab.result.enter` + reason |
| EP-46 | `POST /results/:id/acknowledge-critical` | ordering doctor |
| EP-47 | `GET /orders?status=` | lab scope / ordering doctor |

### 3.7 Pharmacy (`/api/v1/pharmacy`)
| EP | Method & Path | Permission |
|----|---------------|------------|
| EP-50 | `GET /prescriptions/queue` | `prescription.validate` |
| EP-51 | `POST /dispense` | `prescription.dispense` |
| EP-52 | `GET /inventory?medicineId` | `pharmacy.inventory.manage` |
| EP-53 | `POST /batches` (receipt) | `pharmacy.inventory.manage` |
| EP-54 | `POST /stock/adjust` | `pharmacy.stock.adjust` + reason |
| EP-55 | `POST /batches/:id/quarantine` · `/recall` | `pharmacy.inventory.manage` |

### 3.8 Billing (`/api/v1/billing`)
| EP | Method & Path | Permission |
|----|---------------|------------|
| EP-60 | `POST /invoices` (draft from charges) | `invoice.create` |
| EP-61 | `POST /invoices/:id/issue` | `invoice.create` |
| EP-62 | `GET /invoices?patientId=` | `invoice.read.any` / `.own` |
| EP-63 | `POST /invoices/:id/payments` | `payment.record`; Idempotency-Key required |
| EP-64 | `POST /payments/webhook` | gateway signature (public) |
| EP-65 | `POST /invoices/:id/refunds` | `payment.refund.approve` |
| EP-66 | `POST /invoices/:id/adjustments` | `invoice.amend` |
| EP-67 | `GET /reconciliation?period=` | accountant |

### 3.9 Admin, Reports, Audit, Break-glass
| EP | Method & Path | Permission |
|----|---------------|------------|
| EP-70 | `GET/POST /admin/users` · `PATCH /admin/users/:id` | `user.manage` (staff roles only) |
| EP-71 | `PUT /admin/users/:id/role` | `role.assign` (re-auth) |
| EP-71a | `CRUD /admin/departments` | `settings.manage` |
| EP-71b | `CRUD /admin/schedules` (doctor weekly templates + date exceptions) | `settings.manage` |
| EP-72 | `GET /platform/settings/policy` · `PUT /platform/settings/policy/:key` | `settings.manage` |
| EP-73 | `GET /platform/audit?filters=` | `audit.read.*` |
| EP-74 | `POST /admin/backups` | `backup.manage` |
| EP-75 | Scoped reports: pharmacy reorder (`GET /pharmacy/reorder`), billing reconciliation (`GET /billing/reconciliation`), queue (`GET /appointments/queue`) | role-scoped |
| EP-76 | `POST /platform/break-glass` · `POST /platform/break-glass/:id/revoke` | `breakglass.use` |
| EP-77 | `GET /platform/break-glass` (review queue) · `POST /platform/break-glass/:id/review` | `breakglass.review` |

> **Mount note:** user management (EP-70/71) and backups (EP-74) live under `/api/v1/admin`;
the platform features (EP-72/73/76/77) are mounted under `/api/v1/platform`. Both are
the same module boundary — paths differ only to keep admin CRUD and platform
(settings/audit/break-glass) routers separate.

---

## 4. Contract Rules for AI Agents

1. No endpoint without a permission and scope declaration.
2. No response field outside the role's projection (minimum-necessary).
3. POST money/booking endpoints must honor `Idempotency-Key` (reject missing with `428 IDEMPOTENCY_KEY_REQUIRED`).
4. Status writes only via documented transition endpoints — no generic PATCH of status fields.
5. Errors follow the standard envelope and code list in `02-ERROR-HANDLING-AND-VALIDATION.md`.

---

*End of document — API Design Standards v1.0*
