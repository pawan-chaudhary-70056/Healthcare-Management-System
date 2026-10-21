# 03 — Acceptance Criteria

> **Document:** Acceptance criteria for every functional requirement (FR-xx) in the HMS
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** QA, developers, and AI coding agents
> **Related documents:** `01-FUNCTIONAL-REQUIREMENTS.md` (source), `02-NON-FUNCTIONAL-REQUIREMENTS.md`, `01-TESTING-STRATEGY.md`
> **Rule:** A feature is "done" only when every criterion tied to its FR passes. See `09-AI-DEVELOPMENT/03-DEFINITION-OF-DONE.md`.

---

## 1. How to Read This Document

- Each FR has one or more acceptance criteria (AC-xx) with **Given / When / Then** format.
- Criteria are written so they can become automated tests wherever possible.
- Role names and status values follow `02-PROJECT-GLOSSARY.md`.

---

## 2. Public Website (FR-01 → FR-03)

| ID | Given / When / Then |
|----|---------------------|
| AC-01 | **Given** an anonymous visitor, **when** they open the Home Page, **then** hospital introduction, departments, services, contacts, and emergency info are visible without login. |
| AC-02 | **Given** the public directory, **when** a visitor browses departments/doctors, **then** names, specialties, and availability summaries appear but personal contact details do not. |
| AC-03 | **Given** any user, **when** they open emergency info, **then** it renders even if they are logged out and core services are degraded. |
| AC-62 | **Given** the public directory API, **when** departments/doctors are fetched, **then** only active/public-visible entries with availability summaries are returned; personal contact details never appear. *(Numbered out of sequence to preserve existing references.)* |
| AC-63 | **Given** a doctor schedule with a leave exception on a date, **when** slots for that date are fetched, **then** no slots are offered for the closed period; changing the schedule updates the public directory and slot availability without deploy. |

## 3. Authentication & Accounts (FR-04 → FR-09)

| ID | Given / When / Then |
|----|---------------------|
| AC-04 | **Given** a valid account, **when** correct credentials are entered, **then** login succeeds and the role-based dashboard loads. **When** wrong credentials are entered, **then** a generic failure message appears (no hint whether the email exists). |
| AC-05 | **Given** the public registration form, **when** a visitor registers, **then** an account with the `Patient` role only is created; no staff role can be selected. |
| AC-06 | **Given** password recovery, **when** any email is submitted, **then** the same neutral response is returned whether or not the email is registered. |
| AC-07 | **Given** a privileged user without MFA configured, **when** they log in, **then** they are forced through MFA setup before reaching the dashboard. |
| AC-08 | **Given** an idle session beyond the timeout, **when** the user acts, **then** they are required to re-authenticate. |
| AC-09 | **Given** any API request with a forged role header or body field, **when** the server processes it, **then** authorization is derived from the server session only and the forged values are ignored. |

## 4. Patient Management (FR-10 → FR-13)

| ID | Given / When / Then |
|----|---------------------|
| AC-10 | **Given** a Receptionist, **when** they create a patient with valid demographics, **then** the record is created and audited. |
| AC-11 | **Given** a Patient, **when** they edit their own profile, **then** only permitted fields change; identity-critical changes follow configured policy. |
| AC-12 | **Given** a user requesting another patient's record ID directly, **when** they are not authorized for that patient, **then** the request fails with `FORBIDDEN` and the attempt is audited. |
| AC-13 | **Given** registration, **when** completed, **then** the privacy notice was displayed and consent flags were stored. |

## 5. Appointments & Queue (FR-14 → FR-20)

| ID | Given / When / Then |
|----|---------------------|
| AC-14 | **Given** an available slot, **when** a booking is created, **then** status starts at `REQUESTED`/`SCHEDULED` per policy and a confirmation notification is queued. |
| AC-15 | **Given** two simultaneous bookings for the same slot, **when** both transactions commit, **then** exactly one succeeds and the other receives a conflict error (no double booking). |
| AC-16 | **Given** the same booking request retried with the same idempotency key, **when** processed, **then** no duplicate appointment is created. |
| AC-17 | **Given** a patient arrives, **when** Reception verifies identity and checks them in, **then** status becomes `CHECKED_IN` and a queue token is issued. |
| AC-18 | **Given** a reschedule within the cancellation window and policy, **when** either party reschedules, **then** status moves `RESCHEDULED → SCHEDULED` with audit and notification. |
| AC-19 | **Given** a no-show beyond the configured grace period, **when** staff mark it, **then** status becomes `NO_SHOW` and the appointment is retained (not deleted). |
| AC-20 | **Given** a reminder notification, **when** sent, **then** it contains date/time/department only — no diagnosis or clinical details. |
| AC-21 | **Given** a Doctor's schedule view, **when** opened, **then** only their own appointments appear; a Nurse sees only assigned patients. |

## 6. Clinical Care / EMR (FR-21 → FR-26)

| ID | Given / When / Then |
|----|---------------------|
| AC-22 | **Given** a `CHECKED_IN` appointment, **when** the Doctor starts the consultation, **then** an encounter is created linked to appointment and patient. |
| AC-23 | **Given** a finalized EMR entry, **when** the Doctor attempts direct edit, **then** the system rejects it and offers an audited amendment flow with reason. |
| AC-24 | **Given** an amended record, **when** viewed, **then** version history shows the original and each amendment with author, reason, timestamp. |
| AC-25 | **Given** a Nurse, **when** they add a nursing entry for an assigned patient, **then** it is saved and audited; entries for non-assigned patients are rejected. |
| AC-26 | **Given** a prescription, **when** created, **then** it appears in pharmacy validation queue and in the patient's own records with status `ACTIVE`. |
| AC-27 | **Given** a Patient viewing records, **when** they open results/documents, **then** only released items appear; unverified lab results are invisible. |

## 7. Laboratory (FR-27 → FR-32)

| ID | Given / When / Then |
|----|---------------------|
| AC-28 | **Given** a consultation, **when** the Doctor orders a test, **then** the lab order is linked to patient + encounter and appears in the lab queue. |
| AC-29 | **Given** specimen collection, **when** recorded, **then** time, collector, type, and status are stored with chain-of-custody fields. |
| AC-30 | **Given** a result entered by lab staff, **when** not yet verified, **then** it is invisible to the patient and marked `RESULT_ENTERED`. |
| AC-31 | **Given** verification by authorized personnel, **when** confirmed, **then** status becomes `VERIFIED` and release is possible. |
| AC-32 | **Given** a critical result, **when** verified, **then** the responsible clinician is alerted and acknowledgment is recorded. |
| AC-33 | **Given** a result amendment, **when** saved, **then** the original remains retrievable and the amendment is audited. |
| AC-34 | **Given** a lab order, **when** created, **then** a corresponding billing charge exists for the same patient and encounter. |

## 8. Pharmacy (FR-33 → FR-38)

| ID | Given / When / Then |
|----|---------------------|
| AC-35 | **Given** an active prescription, **when** the Pharmacist validates it, **then** patient, dose fields, and prior dispensing are checked before dispensing is allowed. |
| AC-36 | **Given** a dispense action, **when** completed, **then** batch number, quantity, dispenser, and timestamp are recorded and stock decreases in one transaction. |
| AC-37 | **Given** an expired batch selected for dispensing, **when** confirmed, **then** the action is blocked with an expiry error. |
| AC-38 | **Given** stock at zero, **when** a dispense is attempted, **then** it is blocked; inventory can never go negative. |
| AC-39 | **Given** FEFO picking, **when** the pharmacist dispenses, **then** the earliest-expiry valid batch is suggested first. |
| AC-40 | **Given** a quarantined or recalled batch, **when** dispensing is attempted, **then** it is blocked and an audit entry is written. |
| AC-41 | **Given** a stock adjustment without authorization, **when** submitted, **then** it is rejected; with authorization, it is applied with reason and audit. |
| AC-42 | **Given** a dispense, **when** completed, **then** a billing charge is created for the patient/encounter. |

## 9. Billing & Payments (FR-39 → FR-44)

| ID | Given / When / Then |
|----|---------------------|
| AC-43 | **Given** services, lab tests, and medicines for an encounter, **when** an invoice is drafted, **then** all charges are itemized with correct linkage. |
| AC-44 | **Given** a `DRAFT` invoice, **when** issued, **then** it becomes `ISSUED`, is visible to the patient, and can no longer be silently edited. |
| AC-45 | **Given** a payment with an idempotency key, **when** the same key is retried, **then** payment is recorded once. |
| AC-46 | **Given** a partial payment, **when** recorded, **then** invoice status becomes `PARTIALLY_PAID` and the outstanding balance is exact. |
| AC-47 | **Given** a client message claiming "payment successful" without a trusted gateway/verification record, **when** received, **then** it is not treated as proof of payment. |
| AC-48 | **Given** a refund or discount, **when** submitted by an unauthorized user, **then** it is rejected; when authorized, approver and reason are recorded. |
| AC-49 | **Given** reconciliation, **when** run, **then** gateway records, cash collections, and invoices are matched with discrepancies listed. |

## 10. Inventory & Assets (FR-45 → FR-46)

| ID | Given / When / Then |
|----|---------------------|
| AC-50 | **Given** an asset, **when** registered, **then** status and location are tracked and changes are audited. |
| AC-51 | **Given** general inventory, **when** stock moves, **then** movements are recorded with actor and reason. |

## 11. Notifications (FR-47 → FR-48)

| ID | Given / When / Then |
|----|---------------------|
| AC-52 | **Given** an appointment event, **when** triggered, **then** the relevant party receives in-app notification, and email/SMS only if providers are configured. |
| AC-53 | **Given** any external notification, **when** inspected, **then** it contains no diagnosis or clinical detail. |

## 12. Reports & Dashboards (FR-49 → FR-50)

| ID | Given / When / Then |
|----|---------------------|
| AC-54 | **Given** each role, **when** they open their dashboard, **then** only authorized modules and data scopes appear. |
| AC-55 | **Given** a financial report, **when** opened by a non-financial role, **then** access is denied; Accountant/Admin see scoped data. |

## 13. Administration (FR-51 → FR-53)

| ID | Given / When / Then |
|----|---------------------|
| AC-56 | **Given** an Admin, **when** they change a user's role, **then** the change requires validation, is audited, and takes effect on next authorization check. |
| AC-57 | **Given** a facility policy change (e.g., cancellation window), **when** saved, **then** the new value is enforced system-wide without code changes. |
| AC-58 | **Given** a backup, **when** triggered by Admin, **then** it completes with a verifiable result and is logged. |

## 14. Audit & Security (FR-54 → FR-55)

| ID | Given / When / Then |
|----|---------------------|
| AC-59 | **Given** any action listed in FR-54, **when** performed, **then** an audit entry with actor, action, resource, timestamp, and outcome exists and cannot be modified via the application. |
| AC-60 | **Given** a genuine emergency, **when** approved staff use break-glass, **then** access requires a reason, is time-limited, fully audited, and appears in the oversight review queue. |
| AC-61 | **Given** break-glass use without a reason, **when** submitted, **then** it is rejected. |

---

## 15. Coverage Check

Every FR-01 → FR-57 has at least one acceptance criterion. AI agents implementing a feature must locate its AC-xx here and satisfy all of them before marking the task done.

---

*End of document — Acceptance Criteria v1.0*
