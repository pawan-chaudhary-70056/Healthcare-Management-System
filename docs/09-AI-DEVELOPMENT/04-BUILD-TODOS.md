# 04 — Build TODOs

> **Document:** Consolidated, phase-by-phase build checklist for the HMS
> **Version:** 1.1
> **Status:** Active tracker
> **Audience:** Developers and AI coding agents
> **Source of truth:** `02-PHASED-IMPLEMENTATION-PLAN.md` (phases, exit criteria), `03-DEFINITION-OF-DONE.md` (task/feature/phase/release DoD), `01-TESTING-STRATEGY.md` (test gates), `03-ACCEPTANCE-CRITERIA.md` (AC-xx), `01-API-DESIGN-STANDARDS.md` (EP-xx)
> **Rule:** Phases are sequential. Do not start a phase until the previous phase's exit criteria are all checked. Within a phase, tasks may parallelize. Every task must satisfy the Task-Level DoD (`03-DEFINITION-OF-DONE.md §1`) before its checkbox is ticked.

---

## How to Use This File

1. Work top to bottom. Each `- [ ]` becomes `- [x]` only when its exit criterion is verifiably met.
2. Every feature task carries its traceability IDs: **FR → AC → EP**. Locate them in the source docs before implementing (per `01-AI-AGENT-DEVELOPMENT-RULES.md §2.5`).
3. After each phase, complete the **Phase Gate** checklist before moving on. Record the phase summary (AC coverage %, security checklist status, known gaps) in the build log (`01-AI-AGENT-DEVELOPMENT-RULES.md §7`).
4. If a doc conflicts or a detail is missing: stop, report, wait — do not invent (`01-AI-AGENT-DEVELOPMENT-RULES.md §6`).

---

## PH-01 — Foundation

**Reference data first:** slot generation and the public directory depend on departments/schedules being seeded and admin-manageable.

- [x] Monorepo layout per `04-SYSTEM-DESIGN/04-BACKEND-SPECIFICATION.md §1` and `04-SYSTEM-DESIGN/03-FRONTEND-SPECIFICATION.md §1`
- [x] Env/config loading; MongoDB connection (replica set — required for transactions); `/health` endpoint; structured JSON logging (pino)
- [x] CI pipeline: lint + typecheck (NFR-33), unit + integration harness, dependency audit (SEC-22)
- [x] Seed scripts: permission catalog (PERM-01…68 from `02-USER-ACCESS/01-ROLES-AND-PERMISSIONS.md §4`), roles, admin bootstrap user
- [x] Reference data: `departments`, `doctor_schedules`, `schedule_exceptions` collections + admin CRUD (FR-57, EP-71a/71b)
- [x] Config constants: canonical status strings from `02-PROJECT-GLOSSARY.md §13` — no magic strings

**Phase Gate (exit criteria)**
- [x] CI green on skeleton; `/health` OK
- [x] Seed loads roles/permissions from the catalog (PERM-xx) — no invented permission strings
- [x] Reference data manageable by Admin; slot computation input ready

---

## PH-02 — Authentication & RBAC Core

*Blocks everything: permissions everywhere (FR-04…09, S-05…11).*

- [x] Auth endpoints EP-01…07: login/logout/me/register/forgot/reset/MFA — anti-enumeration (SEC-02), rate limits (SEC-03), MFA forced for privileged roles (SEC-04)
- [x] Public website pages: Home, Directory, Emergency Info (FR-01…03) — emergency content served independently of auth/DB (NFR-22, S-03) — AC-01…03
- [x] Public directory endpoints EP-08/09 (FR-56) backed by PH-01 reference data; only active/public-visible entries, no personal contacts — AC-62
- [x] Session model: HTTP-only Secure SameSite cookies; idle 30 min / absolute 12 h defaults, configurable (SEC-06, NFR-11)
- [x] Middleware chain in mandatory order: `requireAuth` → `requirePermission` → `requireScope` → object-level check (`04-BACKEND-SPECIFICATION.md §2`)
- [x] RBAC seed + server-side enforcement; audit events for all auth actions (FR-54)
- [x] Auth pages + permission-driven dashboard shells
- [x] Tests: AC-04…AC-09 (incl. forged-role rejection AC-09, IDOR denial AC-12 pattern)

**Phase Gate (exit criteria)**
- [x] AC-01 → AC-09 all pass (public pages incl. emergency info + auth flows)
- [x] No route without a declared permission + scope
- [x] Auth events audited (success and failure paths)

---

## PH-03 — Patients & Appointments

*Booking lifecycle + queue working end-to-end.*

- [x] Patient module EP-10…14: records, consents (PERM-07), role-based projections (SEC-14), scope checks (R-01…R-09) — AC-10…13
- [x] Slot model: computed on read from `doctor_schedules` − appointments − `schedule_exceptions` − booking horizon (FR-57/AC-63); no stored slots collection (EP-20)
- [x] Booking with transaction re-check + idempotency key (EP-21, FR-14/15, SEC-23) — AC-14…16, concurrency suite NFR-05
- [x] Lifecycle transitions via shared transition table (T-01…T-09, T-11 per plan; T-10 approved-exception path included for table completeness); reschedule/cancel endpoints EP-23/24; policy windows configurable (A-07) — AC-18/19
- [x] Check-in + queue tokens (EP-25/26, FR-17) — AC-17
- [x] Waitlist join/offer/expire flow (EP-27, FR-18) — audited
- [x] Notifications for booking/confirm/reschedule/cancel — minimal queue in this phase (full outbox stack lands in PH-08); reminders via scheduler job; date/time/department only (NFR-16) — AC-20
- [x] Frontend: patient portal + reception flows (`/appointments/*`, `/checkin`, `/queue`, `/waitlist`)
- [x] Tests: AC-10…AC-21 incl. parallel-booking concurrency suite

**Phase Gate (exit criteria)**
- [x] 0 double bookings under concurrent load
- [x] Idempotent retries return original result — no duplicates
- [x] All lifecycle changes via transition table; violations → `422 INVALID_TRANSITION`
- [x] AC-10 → AC-21 all pass

---

## PH-04 — Clinical & Nursing

*Encounters, EMR, prescriptions created.*

- [x] Encounters (EP-30) bound to CHECKED_IN appointments; transitions T-05/T-06 — AC-22
- [x] EMR entries: draft → finalize → amend with version history (EP-31…34, C-04); document uploads validated per SEC-16 — AC-23/24
- [x] Prescriptions (EP-35/36) with canonical statuses; visible to pharmacy queue + patient own-records — AC-26
- [x] Nursing entries with assigned scope (EP-37/38, PERM-24) — AC-25
- [x] Patient released-data views only (EP-34 `.released.own`) — AC-27
- [x] Audit: encounter create/finalize, every EMR write/amendment, prescription create/cancel (FR-54)
- [x] Tests: AC-22…AC-27

**Phase Gate (exit criteria)**
- [x] Finalization/amendment integrity proven (no silent edits; originals preserved)
- [x] Scope denials audited (`403 FORBIDDEN` + audit entry)
- [x] AC-22 → AC-27 all pass

---

## PH-05 — Laboratory

*Orders → results → verified release.*

- [x] Orders + auto-created billing charges linked to patient + encounter (EP-40, FR-32) — AC-28/34
- [x] Specimen recording + chain of custody (EP-41, FR-28) — AC-29
- [x] Result entry (EP-42) / verification (EP-43) as separable duties (PERM-32/33) — AC-30/31
- [x] Critical results: detection → alert → recorded acknowledgment → escalation (EP-46, FR-30) — AC-32
- [x] Release (EP-44): status-gated on VERIFIED; critical ack enforced (AC-31/32); patient sees released only (FR-25) — AC-30
- [x] Amendments preserve originals; re-verification required (EP-45, FR-31) — AC-33
- [x] Attachments/reports via authorized endpoints only (SEC-15)
- [x] Tests: AC-28…AC-34

**Phase Gate (exit criteria)**
- [x] Unverified results invisible to patients (NFR-17 — 0 violations)
- [x] Critical flow fully recorded (detection/ack/escalation logged)
- [x] AC-28 → AC-34 all pass

---

## PH-06 — Pharmacy

*Dispensing + inventory integrity.*

- [x] Validation queue (EP-50): prescription validity gauntlet per `03-APPLICATION-FLOWS/05-PHARMACY-WORKFLOW.md §1` — AC-35
- [x] Dispense transaction (EP-51): FEFO batch pick, batch deductions, dispense record, prescription status update, billing charge — one atomic transaction — AC-36
- [x] Guards: expired batch blocked (AC-37), zero/negative stock impossible (AC-38), quarantined/recalled blocked (AC-40)
- [x] Inventory: receipts, batches, movements, authorized adjustments with reason (EP-52…54, PERM-44) — AC-41
- [x] Quarantine/recall + expiry sweep job (EP-55)
- [x] Prescription status sync jobs: PARTIALLY/FULLY_DISPENSED; daily EXPIRED sweep
- [x] Tests: AC-35…AC-42 incl. concurrent dispense integrity

**Phase Gate (exit criteria)**
- [x] Stock integrity under concurrency — no negatives, no duplicate deductions
- [x] Expired/quarantined stock blocked with audit entries
- [x] AC-35 → AC-42 all pass

---

## PH-07 — Billing

*Invoices, payments, reconciliation.*

- [x] Charge consolidation → draft/issue invoices (EP-60/61); immutability after issue (SEC-26) — AC-43/44
- [x] Payments: gateway adapter (sandbox, webhook signature verification SEC-25) + cash/POS recording with receipts; idempotency keys (EP-63/64) — AC-45/47
- [x] Partial payments: exact outstanding balance; status transitions per Glossary §13.2 — AC-46
- [x] Refunds/discounts with approval + credit adjustments (EP-65/66, PERM-54/55) — AC-48
- [x] Reconciliation view (EP-67, FR-44) — AC-49
- [x] Patient billing views (own invoices only)
- [x] Money rules: integer minor units; server-computed totals; never trust client (C-02)
- [x] Tests: AC-43…AC-49 incl. payment replay (same idempotency key → single record)

**Phase Gate (exit criteria)**
- [x] Money integrity: idempotent payments, exact balances, no silent edits
- [x] Webhooks without valid signature rejected (`400 WEBHOOK_SIGNATURE_INVALID`)
- [x] AC-43 → AC-49 all pass

---

## PH-08 — Platform Features

*Notifications, reports, inventory/assets, admin, audit UI, break-glass.*

- [x] Notifications: outbox processor, email/SMS adapters (A-04), in-app bell; no clinical detail in external messages (NFR-16) — AC-52/53
- [x] Reports/dashboards per role, scoped (EP-75, FR-49/50) — AC-54/55 (reconciliation + reorder + queue views)
- [x] Inventory/assets module (FR-45/46) — AC-50/51 (pharmacy batches/movements/reorder)
- [x] Admin: users/roles (EP-70/71, re-auth on change NFR-41), settings/policy engine (EP-72, AC-57), audit viewer (EP-73), backups UI (EP-74) — AC-56…58
- [x] Break-glass: request/revoke/review (EP-76/77, PERM-66/67): mandatory reason, time-limited scope, read-only, immediate oversight alert, 72 h review (AC-60/61)
- [x] Audit log immutability enforced; tamper attempts blocked + alerted (SEC-27) — AC-59 (append-only service, denied webhooks audited)
- [x] Tests: AC-50…AC-61

**Phase Gate (exit criteria)**
- [x] Cross-module matrix (`03-APPLICATION-FLOWS/08-CROSS-MODULE-INTEGRATION-FLOW.md §2`) verified row by row
- [x] AC-50 → AC-61 all pass

---

## PH-09 — Hardening & Release

*Security suite, NFR verification, UAT, deployment readiness.*

- [x] Security test suite full pass: IDOR sweep, role tampering, NoSQL injection, XSS, session cookie flags, CSRF (SEC-20), webhook unsigned rejection, money replay, unverified-result access (`01-TESTING-STRATEGY.md §3`)
- [ ] Load tests NFR-01…05 (≤ 500 ms p95 reads; ≤ 1,000 ms p95 writes; 200+ sessions; 0 duplicate bookings)
- [ ] Accessibility scan (NFR-27) + responsive checks at 360 px (NFR-24)
- [ ] Restore drill passed (NFR-38) — backup proven restorable
- [ ] Monitoring + alerts verified live (NFR-37)
- [ ] Documentation sync check: docs ↔ code, zero contradictions
- [ ] Staging UAT with facility; fix cycle completed
- [ ] Dependency audit: zero high/critical (SEC-22)
- [ ] Final security checklist SEC-01…SEC-28 signed off (`03-DEFINITION-OF-DONE.md §4`)
- [ ] Production deployment per `08-QUALITY-AND-OPERATIONS/02-DEPLOYMENT-AND-INFRASTRUCTURE.md §6`; post-deploy smoke + audit entry

**Phase Gate (exit criteria)**
- [ ] Release gate in `08-QUALITY-AND-OPERATIONS/01-TESTING-STRATEGY.md §5` fully green
- [ ] UAT sign-off recorded
- [ ] Release-level DoD (`03-DEFINITION-OF-DONE.md §4`) all checked

---

## Ongoing Rules (apply to every task in every phase)

- [ ] Traceability recorded: S-xx → FR-xx → AC-xx → EP-xx
- [ ] Permission + scope declared on every route; object-level checks on record access
- [ ] Server-side validation with canonical enums; standard error envelope codes only
- [ ] Transactions where mandated (`04-SYSTEM-DESIGN/02-DATABASE-DESIGN.md §6`)
- [ ] Audit entries for every FR-54-listed action touched
- [ ] Minimum-necessary projections — no over-exposed fields
- [ ] Unit + integration tests written with the feature, including negative authorization cases
- [ ] Lint/typecheck/tests green before proceeding (NFR-33/34)
- [ ] No secrets committed; no hard-coded policy values (A-07)
- [ ] Out-of-scope items (X-01…X-12) never built

---

## AC Coverage Map (verification aid)

Every AC-01…AC-63 is assigned to exactly one phase: PH-02 → AC-01…09, 62 · PH-03 → AC-10…21, 63 · PH-04 → AC-22…27 · PH-05 → AC-28…34 · PH-06 → AC-35…42 · PH-07 → AC-43…49 · PH-08 → AC-50…61.

---

*End of document — Build TODOs v1.1*
