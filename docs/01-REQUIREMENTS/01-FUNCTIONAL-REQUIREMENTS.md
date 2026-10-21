# 01 — Functional Requirements

> **Document:** Functional requirements for the Healthcare Management System (HMS)
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** Developers and AI coding agents
> **Related documents:** `03-SCOPE-AND-ASSUMPTIONS.md` (S-xx source), `01-ROLES-AND-PERMISSIONS.md`, `02-PROJECT-GLOSSARY.md`
> **Rule:** Every requirement traces to an in-scope feature (S-xx). Features marked X-xx in scope must never appear here.

---

## 1. How to Read This Document

- Requirements are grouped by module and numbered `FR-xx`.
- **Priority:** `MUST` = required for release · `SHOULD` = strongly expected · `MAY` = optional.
- Each requirement lists its **scope source** (S-xx) and the roles involved.
- Acceptance criteria for every FR are in `03-ACCEPTANCE-CRITERIA.md`.
- Canonical status values used here are defined in `02-PROJECT-GLOSSARY.md §13`.

---

## 2. Public Website Module

| ID | Requirement | Priority | Roles | Scope |
|----|-------------|----------|-------|-------|
| FR-01 | The system SHALL display a public Home Page with hospital introduction, departments, services, contact details, and visiting/appointment guidance, without requiring login. | MUST | Public | S-01, S-04 |
| FR-02 | The system SHALL provide a public browsable directory of departments and doctors (name, specialty, department, availability summary). The directory SHALL NOT display personal contact details of doctors. | MUST | Public | S-02 |
| FR-03 | The system SHALL display emergency contact details and location on public pages; this content SHALL be served even when core services require authentication. | MUST | Public | S-03 |
| FR-56 | The system SHALL expose the public directory via API (departments; doctors with specialty/availability summary) sourced from the `departments` and `doctor_schedules` data model; content SHALL follow FR-02 visibility limits. *(Numbered out of sequence to preserve existing references.)* | MUST | Public | S-02 |

## 3. Authentication & Account Module

| ID | Requirement | Priority | Roles | Scope |
|----|-------------|----------|-------|-------|
| FR-04 | The system SHALL allow users to log in with email/username and password; passwords SHALL be verified against Argon2id hashes. | MUST | All | S-05, C-07 |
| FR-05 | The system SHALL allow public self-registration that creates accounts with the `Patient` role only; self-registration SHALL NOT grant any staff role. | MUST | Public | S-06, A-05 |
| FR-06 | The system SHALL provide password recovery that does not reveal whether an email address is registered. | MUST | All | S-07 |
| FR-07 | The system SHALL require MFA for privileged users (Admin at minimum; configurable for other staff roles). | MUST | Admin | S-08 |
| FR-08 | The system SHALL expire sessions after a configurable idle timeout and absolute lifetime, and SHALL re-verify authorization on every protected API request. | MUST | All | S-10, C-02 |
| FR-09 | The system SHALL enforce server-side RBAC plus object-level and scope-based authorization on every protected operation. | MUST | All | S-11, C-02 |

## 4. Patient Management Module

| ID | Requirement | Priority | Roles | Scope |
|----|-------------|----------|-------|-------|
| FR-10 | Reception and Admin SHALL be able to create and manage full patient records (demographics, contact, identity reference). | MUST | Receptionist, Admin | S-12 |
| FR-11 | Patients SHALL be able to view and edit their own demographics; edits to identity-critical fields MAY require staff review. | SHOULD | Patient | S-12 |
| FR-12 | The system SHALL record patient consent flags for data sharing and display a privacy notice at registration. | MUST | Receptionist, Admin, Patient | S-44 |
| FR-13 | The system SHALL enforce assignment-based visibility: a user accesses a patient's record only if their role and scope authorize it. | MUST | All | S-11, A-06 |

## 5. Appointment & Queue Module

| ID | Requirement | Priority | Roles | Scope |
|----|-------------|----------|-------|-------|
| FR-14 | Patients (own) and Reception (any patient) SHALL be able to book appointments; booking SHALL re-verify slot availability inside a transaction (double-booking protection). | MUST | Patient, Receptionist | S-13 |
| FR-15 | Booking requests SHALL support idempotency: retrying the same request SHALL NOT create duplicate appointments. | MUST | Patient, Receptionist | S-13, C-06 |
| FR-16 | The system SHALL implement the appointment status lifecycle: `REQUESTED → SCHEDULED → CONFIRMED → CHECKED_IN → IN_CONSULTATION → COMPLETED`, with `CANCELLED`, `RESCHEDULED`, `NO_SHOW` per transition rules. | MUST | Staff, Patient | S-14 |
| FR-17 | Reception SHALL check in arriving patients after identity verification and issue a queue token. | MUST | Receptionist | S-15, S-16 |
| FR-18 | The system SHALL support a waitlist for fully booked slots and offer waitlisted patients a slot when one opens, per facility policy. | SHOULD | Receptionist, Patient | S-17 |
| FR-19 | The system SHALL send appointment confirmations, reminders, reschedule, and cancellation notifications; reminders SHALL NOT contain diagnoses or clinical details. | MUST | System | S-18 |
| FR-20 | Doctors SHALL view their own schedule; nurses SHALL view schedules of assigned patients only. | MUST | Doctor, Nurse | S-14, A-06 |

## 6. Clinical Care Module (EMR)

| ID | Requirement | Priority | Roles | Scope |
|----|-------------|----------|-------|-------|
| FR-21 | Doctors SHALL create clinical encounters linked to a checked-in appointment and patient; the encounter SHALL be the parent of all clinical activity for the visit. | MUST | Doctor | S-19 |
| FR-22 | Doctors SHALL record diagnoses, clinical notes, and documents in the EMR; records SHALL support finalization, amendment with reason, and version history. | MUST | Doctor | S-20, C-04 |
| FR-23 | Nurses SHALL create nursing entries for assigned patients and view relevant clinical context. | MUST | Nurse | S-21 |
| FR-24 | Doctors SHALL create prescriptions (medicine, dose, frequency, duration); prescriptions SHALL be visible to the pharmacy for validation and dispensing and to the patient as own records. | MUST | Doctor, Pharmacist, Patient | S-22 |
| FR-25 | Patients SHALL view only their own released clinical data; unverified lab results SHALL NOT be visible to patients. | MUST | Patient | S-23 |
| FR-26 | Finalized clinical records SHALL NOT be editable; changes SHALL be recorded as amendments with author, reason, and timestamp, preserving prior versions. | MUST | Doctor | S-20, C-04 |

## 7. Laboratory Module

| ID | Requirement | Priority | Roles | Scope |
|----|-------------|----------|-------|-------|
| FR-27 | Doctors SHALL order lab tests linked to a patient and encounter. | MUST | Doctor | S-24 |
| FR-28 | Lab staff SHALL record specimen collection details: time, collector, specimen type, and status; chain-of-custody fields SHALL be supported where required. | MUST | Lab Technician | S-25 |
| FR-29 | Result entry SHALL be restricted to authorized lab personnel; results SHALL require verification by authorized personnel before release. | MUST | Lab Technician | S-26 |
| FR-30 | Critical results SHALL trigger an alert to the responsible clinician with recorded acknowledgment. | MUST | Lab Technician, Doctor | S-27 |
| FR-31 | Result amendments SHALL preserve the original result and record who amended, when, and why. | MUST | Lab Technician | S-28 |
| FR-32 | Lab orders SHALL be linked to billing charges for the correct patient and encounter. | MUST | Lab Technician, Accountant | S-24, S-34 |

## 8. Pharmacy Module

| ID | Requirement | Priority | Roles | Scope |
|----|-------------|----------|-------|-------|
| FR-33 | Pharmacists SHALL validate prescriptions (active, correct patient, valid dose fields, not already fully dispensed) before dispensing. | MUST | Pharmacist | S-29 |
| FR-34 | Dispensing SHALL record medicine, batch number, quantity, dispenser, and timestamp; dispensing SHALL be blocked for expired batches. | MUST | Pharmacist | S-29, S-30 |
| FR-35 | Inventory SHALL track medicines by batch and expiry, support FEFO picking, and prevent negative stock via controlled transactions. | MUST | Pharmacist | S-30, S-31 |
| FR-36 | The system SHALL support quarantine and recall of batches; quarantined/recalled stock SHALL NOT be dispensable. | SHOULD | Pharmacist | S-32 |
| FR-37 | Stock adjustments SHALL require authorization and SHALL be fully audited with reason. | MUST | Pharmacist, Admin | S-33 |
| FR-38 | Dispensing SHALL generate billing charges linked to the patient and encounter. | MUST | Pharmacist, Accountant | S-34 |

## 9. Billing & Payments Module

| ID | Requirement | Priority | Roles | Scope |
|----|-------------|----------|-------|-------|
| FR-39 | The system SHALL generate invoices from services, lab tests, and dispensed medicines; invoices SHALL follow `DRAFT → ISSUED → PARTIALLY_PAID → PAID` with `REFUNDED`/`CANCELLED` states. | MUST | Accountant | S-34 |
| FR-40 | Payments SHALL support full and partial payment with idempotency keys; duplicate payment submissions SHALL be rejected. | MUST | Accountant, Patient | S-35, C-06 |
| FR-41 | Payment success SHALL be established only by trusted gateway response or manual verification with recorded actor — never from client-side claims. | MUST | Accountant | S-35, C-02 |
| FR-42 | Refunds and discounts SHALL require authorization per policy and SHALL be recorded with approver and reason. | MUST | Accountant, Admin | S-36 |
| FR-43 | Issued invoices SHALL NOT be silently editable; corrections SHALL be audited amendments or credit adjustments. | MUST | Accountant | C-04 |
| FR-44 | The system SHALL support reconciliation of gateway payments, cash collections, and invoice records. | SHOULD | Accountant | S-37 |

## 10. Inventory & Assets Module

| ID | Requirement | Priority | Roles | Scope |
|----|-------------|----------|-------|-------|
| FR-45 | The system SHALL track hospital assets (equipment) with status and location. | SHOULD | Admin | S-40 |
| FR-46 | The system SHALL track general (non-medicine) inventory with stock movements. | SHOULD | Admin | S-40 |

## 11. Notifications Module

| ID | Requirement | Priority | Roles | Scope |
|----|-------------|----------|-------|-------|
| FR-47 | The system SHALL deliver in-app notifications for role-relevant events and email/SMS where providers are configured. | MUST | System | S-38, A-04 |
| FR-48 | Notification content SHALL follow the minimum-necessary principle; clinical details SHALL NOT be included in reminders or external messages. | MUST | System | S-18, C-09 |

## 12. Reports & Dashboards Module

| ID | Requirement | Priority | Roles | Scope |
|----|-------------|----------|-------|-------|
| FR-49 | Each role SHALL see a dashboard scoped to their permissions (e.g., Reception: today's appointments and queue; Doctor: own schedule and results; Accountant: billing summary). | MUST | All | S-09, S-39 |
| FR-50 | The system SHALL provide operational, clinical-scope, and financial reports restricted by role. | MUST | Admin, Accountant, others per matrix | S-39 |

## 13. Administration Module

| ID | Requirement | Priority | Roles | Scope |
|----|-------------|----------|-------|-------|
| FR-51 | Admin SHALL manage users and role assignments; permission changes SHALL require validation and audit logging. | MUST | Admin | S-43 |
| FR-52 | Admin SHALL configure facility policies (cancellation windows, no-show rules, session timeout, queue rules) that are enforced by the system. | MUST | Admin | S-43, A-07 |
| FR-53 | Admin SHALL trigger and verify backups and view system health. | MUST | Admin | S-43 |
| FR-57 | Admin SHALL manage the department catalog and doctor working schedules (weekly template + date exceptions such as leave/holidays) that drive slot availability and the public directory. *(Numbered out of sequence to preserve existing references.)* | MUST | Admin | S-02, S-13, A-01 |

## 14. Audit & Security Module

| ID | Requirement | Priority | Roles | Scope |
|----|-------------|----------|-------|-------|
| FR-54 | The system SHALL record audit events for authentication, access to patient data, record changes, permission changes, payments, dispensing, result release, and break-glass access. | MUST | System | S-41, C-03 |
| FR-55 | The system SHALL provide break-glass emergency access with reason, time limit, scope restriction, and full audit, reviewed by oversight staff. | MUST | Authorized staff | S-42 |

---

## 15. Traceability Check

An AI agent must be able to trace every FR above to:

1. Its scope source (S-xx in `03-SCOPE-AND-ASSUMPTIONS.md`)
2. Its permission requirements (PERM-xx in `01-ROLES-AND-PERMISSIONS.md`)
3. Its acceptance criteria (AC-xx in `03-ACCEPTANCE-CRITERIA.md`)
4. Its workflow steps (`03-APPLICATION-FLOWS/`)
5. Its API endpoints (`06-API-AND-ERRORS/01-API-DESIGN-STANDARDS.md`)

If any trace fails, stop and report the gap — do not implement from guesswork.

---

*End of document — Functional Requirements v1.0*
