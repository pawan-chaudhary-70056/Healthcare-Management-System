# 02 — Phased Implementation Plan

> **Document:** Build order for the HMS from empty repo to production-ready release
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** AI coding agents and developers
> **Related documents:** `01-AI-AGENT-DEVELOPMENT-RULES.md`, `03-DEFINITION-OF-DONE.md`, `01-TESTING-STRATEGY.md`
> **Rule:** Phases are sequential — each phase's exit criteria must pass before the next begins. Within a phase, features may parallelize.

---

## Phase Overview

| Phase | Name | Outcome |
|-------|------|---------|
| PH-01 | Foundation | Repo, tooling, env skeleton, CI running |
| PH-02 | Auth & RBAC core | Login/registration/sessions/permissions enforced |
| PH-03 | Patients & Appointments | Booking lifecycle + queue working end-to-end |
| PH-04 | Clinical & Nursing | Encounters, EMR, prescriptions created |
| PH-05 | Laboratory | Orders → results → verified release |
| PH-06 | Pharmacy | Dispensing + inventory integrity |
| PH-07 | Billing | Invoices, payments, reconciliation |
| PH-08 | Platform features | Notifications, reports, inventory/assets, admin, audit UI, break-glass |
| PH-09 | Hardening & release | Security suite, NFR verification, UAT, deployment readiness |

---

## PH-01 — Foundation

**Tasks**
1. Monorepo layout per `04-BACKEND-SPECIFICATION.md §1` and `03-FRONTEND-SPECIFICATION.md §1`.
2. Env/config loading, MongoDB connection (replica set), health endpoint, structured logging.
3. CI: lint, typecheck, unit+integration harness, dependency audit.
4. Seed scripts: permission catalog, roles, admin bootstrap user.
5. Reference data: `departments`, `doctor_schedules`, `schedule_exceptions` collections + admin CRUD (FR-57) — slot generation and the public directory depend on them.

**Exit criteria**
- CI green on empty skeleton; `/health` OK; seed loads roles/permissions from catalog (PERM-xx); reference data manageable by Admin.

## PH-02 — Authentication & RBAC Core

**Tasks**
1. Auth endpoints (EP-01…07): login/logout/me/register/recovery/MFA — with anti-enumeration and rate limits.
2. Public directory endpoints (EP-08/09, FR-56) backed by PH-01 reference data.
3. Session model + middleware chain (`requireAuth`, `requirePermission`, `requireScope`, object-level check).
4. RBAC seed + enforcement; audit events for auth.
5. Public pages + auth pages; role dashboard shells (permission-driven sidebar).
6. Tests: AC-04…AC-09.

**Exit criteria**
- All AC-04 → AC-09 pass; no route without declared permission; audit records auth events.

## PH-03 — Patients & Appointments

**Tasks**
1. Patient module (EP-10…14): records, consents, projections, scope checks.
2. Slot model + booking with transaction re-check + idempotency (EP-20/21).
3. Lifecycle transitions T-01…T-08, T-11 incl. reschedule/cancel policy windows; waitlist.
4. Check-in + queue tokens (EP-25/26).
5. Frontend: patient portal + reception flows.
6. Tests: AC-10…AC-21 incl. concurrency suite.

**Exit criteria**
- 0 double bookings under concurrency; idempotent retries; lifecycle transitions enforce table; AC-10 → AC-21 pass.

## PH-04 — Clinical & Nursing

**Tasks**
1. Encounters (EP-30) bound to CHECKED_IN appointments; appointment T-05/T-06.
2. EMR entries: draft → finalize → amend with versions (EP-31…34).
3. Prescriptions (EP-35/36) with statuses; patient released-data views.
4. Nursing entries with assigned scope (EP-37/38).
5. Tests: AC-22…AC-27.

**Exit criteria**
- Finalization/amendment integrity proven; scope denials audited; AC-22 → AC-27 pass.

## PH-05 — Laboratory

**Tasks**
1. Orders + charges linkage (EP-40, AC-34).
2. Specimen recording + custody (EP-41).
3. Results entry, verification, critical alerts + acknowledgment, release, amendments (EP-42…46).
4. Patient visibility rules (released only).
5. Tests: AC-28…AC-34.

**Exit criteria**
- Unverified results invisible to patients; critical flow recorded; AC-28 → AC-34 pass.

## PH-06 — Pharmacy

**Tasks**
1. Validation queue + dispense transaction (FEFO, negative-stock guard, batch records, charge creation) — EP-50/51.
2. Inventory: receipts, batches, movements, adjustments with authorization (EP-52…54).
3. Quarantine/recall + expiry sweep job (EP-55).
4. Prescription status sync (PARTIALLY/FULLY_DISPENSED, EXPIRED job).
5. Tests: AC-35…AC-42.

**Exit criteria**
- Stock integrity under concurrency (no negatives, no dupes); expired/quarantined blocked; AC-35 → AC-42 pass.

## PH-07 — Billing

**Tasks**
1. Charge consolidation → draft/issue invoices (EP-60/61); immutability after issue.
2. Payments: gateway adapter (sandbox) + cash/POS recording; idempotency; webhook signature verification (EP-63/64).
3. Refunds/discounts with approval + credit adjustments (EP-65/66).
4. Reconciliation view (EP-67).
5. Patient billing views.
6. Tests: AC-43…AC-49.

**Exit criteria**
- Money integrity: idempotent payments, exact balances, no silent edits; AC-43 → AC-49 pass.

## PH-08 — Platform Features

**Tasks**
1. Notifications: outbox processor, email/SMS adapters, in-app bell (privacy rules enforced).
2. Reports/dashboards per role (EP-75).
3. Inventory/assets module (FR-45/46).
4. Admin: users/roles, settings (policy engine), audit viewer, backups UI (EP-70…74).
5. Break-glass: request/revoke/review (EP-76/77) with immediate oversight alerts.
6. Tests: AC-50…AC-61.

**Exit criteria**
- Cross-module matrix (`08-CROSS-MODULE-INTEGRATION-FLOW.md §2`) verified row by row; AC-50 → AC-61 pass.

## PH-09 — Hardening & Release

**Tasks**
1. Security test suite full pass (IDOR sweep, tampering, injection, session flags).
2. NFR verification: load tests (NFR-01…05), accessibility scan, restore drill (NFR-38).
3. Documentation sync check (docs ↔ code).
4. Staging UAT with facility; fix cycle.
5. Production deployment per `02-DEPLOYMENT-AND-INFRASTRUCTURE.md §6`; post-deploy smoke + audit.

**Exit criteria**
- Release gate in `01-TESTING-STRATEGY.md §5` fully green; sign-offs recorded.

---

## Dependency Notes

- PH-02 blocks everything (permissions everywhere).
- PH-03 blocks PH-04 (encounters need checked-in appointments).
- PH-04 blocks PH-05/06 (orders/prescriptions originate in encounters).
- PH-05/06 produce charges consumed by PH-07.
- PH-08 integrates and completes the matrix; PH-09 hardens and ships.

---

*End of document — Phased Implementation Plan v1.0*
