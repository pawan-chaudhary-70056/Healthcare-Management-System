# 03 — Application Scope and Assumptions

> **Document:** Scope of the Healthcare Management System (HMS)
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** Non-technical stakeholders, developers, and AI coding agents
> **Related documents:** `01-APPLICATION-OVERVIEW.md`, `02-PROJECT-GLOSSARY.md`, `01-FUNCTIONAL-REQUIREMENTS.md`, `02-NON-FUNCTIONAL-REQUIREMENTS.md`

---

## 1. Purpose of This Document

This document defines **what the application will do** (in scope), **what it will not do** (out of scope), the **assumptions** the design rests on, and the **constraints** that limit how the system is built.

It answers three questions:

1. Which features are **required** for the first production-ready release?
2. Which features are **explicitly excluded**, so no one expects them and no AI agent invents them?
3. What **assumptions and constraints** must every other document and implementation phase respect?

> **Rule for AI agents:** If a feature is not listed in this document or in `01-FUNCTIONAL-REQUIREMENTS.md`, treat it as out of scope. Do not add features that are not requested. All terminology must follow `02-PROJECT-GLOSSARY.md`.

---

## 2. Product Vision (One Paragraph)

The HMS is a **web-based, role-driven healthcare management platform** for a single hospital or clinic facility. It manages the complete outpatient journey — from a public website and appointment booking, through reception check-in and queueing, clinical consultation and electronic medical records, nursing care, laboratory testing, and pharmacy dispensing — and closes the loop with billing, payments, notifications, reports, and full administrative control backed by audit trails and security controls.

---

## 3. In Scope — Required Features

### 3.1 Public-Facing Layer (no login required)

| # | Feature | Summary |
|---|---------|---------|
| S-01 | Public Home Page | Hospital introduction, departments, services, contact details |
| S-02 | Doctor & Department Directory | Browsable public directory of departments and doctors |
| S-03 | Emergency Information | Public emergency contacts and location — must work even if the app is down |
| S-04 | Appointment Information | Public guidance on how to book, visit, and prepare |

### 3.2 Authentication & Access Control

| # | Feature | Summary |
|---|---------|---------|
| S-05 | Login / Logout | Secure authentication for all users |
| S-06 | Patient Self-Registration | Public registration creating accounts with the `Patient` role only |
| S-07 | Password Recovery | Account recovery without revealing whether an email is registered |
| S-08 | MFA for Privileged Users | Multi-factor authentication required for Admin and other privileged roles |
| S-09 | Role-Based Dashboards | Every user sees only the modules their role authorizes |
| S-10 | Session Security | Session expiry, secure cookies/tokens, re-authorization on every protected API call |
| S-11 | Permission Matrix Enforcement | Server-side RBAC + object-level (per-patient) + scope (assigned department/doctor) checks |

### 3.3 Patient & Appointment Management

| # | Feature | Summary |
|---|---------|---------|
| S-12 | Patient Registration & Demographics | Full patient records managed by Reception/Admin; patients manage their own profile |
| S-13 | Appointment Booking, Rescheduling, Cancellation | With double-booking protection inside transactions and idempotent booking requests |
| S-14 | Appointment Status Lifecycle | `REQUESTED → SCHEDULED → CONFIRMED → CHECKED_IN → IN_CONSULTATION → COMPLETED`, plus `CANCELLED`, `RESCHEDULED`, `NO_SHOW` |
| S-15 | Check-in & Identity Verification | Reception verifies patient identity per approved process |
| S-16 | Queue Management | Tokens / queue positions for outpatient visits |
| S-17 | Waitlist | Patients can join a waitlist for unavailable slots |
| S-18 | Appointment Notifications | Confirmations, reminders, reschedule and cancellation updates (no sensitive diagnoses in reminders) |

### 3.4 Clinical Care

| # | Feature | Summary |
|---|---------|---------|
| S-19 | Clinical Encounters | Doctor-created consultation records linked to appointments |
| S-20 | Electronic Medical Records (EMR) | Diagnoses, notes, prescriptions, and documents with **finalization, amendment, and version history** |
| S-21 | Nursing Workflows | Nursing entries and assigned-patient views |
| S-22 | Prescriptions | Doctor-created; pharmacist-dispensed; patient-visible for own records |
| S-23 | Patient Access to Released Data | Patients see only their own **released** results and documents |

### 3.5 Laboratory

| # | Feature | Summary |
|---|---------|---------|
| S-24 | Lab Order Management | Doctor-ordered tests linked to patient + encounter |
| S-25 | Specimen Tracking | Collection time, collector, specimen type, status, chain-of-custody |
| S-26 | Result Entry & Verification | Restricted to authorized personnel; results require review before release |
| S-27 | Critical Result Alerts | Notify responsible clinician via approved process with recorded acknowledgment |
| S-28 | Result Amendments | Preserve the original result; auditable corrections only |

### 3.6 Pharmacy & Inventory

| # | Feature | Summary |
|---|---------|---------|
| S-29 | Dispensing Workflow | Validate prescription, verify patient, dispense with records |
| S-30 | Medicine Inventory | Batches, expiry dates, stock movements, FEFO rotation |
| S-31 | Stock Transactions | Controlled transactions preventing negative stock and duplicate deductions |
| S-32 | Quarantine & Recall | Support quarantine of stock and recall workflows |
| S-33 | Stock Adjustments | Require authorization; fully audited |

### 3.7 Billing & Finance

| # | Feature | Summary |
|---|---------|---------|
| S-34 | Invoicing | Draft → issued → finalized invoice lifecycle |
| S-35 | Payments & Partial Payments | Idempotency keys; outstanding balances tracked accurately |
| S-36 | Refunds & Discounts | Require authorization; never processed on client-side "success" claims alone |
| S-37 | Reconciliation | Match gateway payments, cash collections, and billing records |

### 3.8 Cross-Cutting Platform Features

| # | Feature | Summary |
|---|---------|---------|
| S-38 | Notifications | In-app and email/SMS notifications (provider pluggable) |
| S-39 | Reports & Dashboards | Role-scoped operational, clinical-scope, and financial reports |
| S-40 | Hospital Asset & Inventory Management | Non-pharmacy assets and inventory tracking |
| S-41 | Audit Trails | Immutable, protected logs of access and sensitive actions |
| S-42 | Emergency Break-Glass Access | Time-limited, reasoned, fully audited access for genuine emergencies |
| S-43 | Administration | User and role management, backup, recovery, and system settings |
| S-44 | Consent & Privacy Controls | Patient data-sharing permissions and minimum-necessary access |

---

## 4. Out of Scope — Explicit Exclusions

The following are **not** part of this application. Building them is prohibited unless scope is formally revised.

| # | Exclusion | Reason |
|---|-----------|--------|
| X-01 | Telemedicine / video consultations | Separate product with distinct regulatory needs |
| X-02 | Insurance claim processing / TPA integration | Depends on regional payer systems; future phase |
| X-03 | Inpatient (ward/bed/OT) management, discharge summaries | System targets outpatient-first scope for v1.0 |
| X-04 | HL7 / FHIR integration with external hospital systems | Requires external agreements; future phase |
| X-05 | AI-based diagnosis or treatment recommendation | Clinical decision support is out of scope; software must not prescribe |
| X-06 | Mobile native apps | Responsive web only |
| X-07 | Multi-facility / multi-branch support | Single-facility deployment for v1.0 |
| X-08 | Booking without an account for non-registered users | Booking requires an authenticated patient account (or staff booking) |
| X-09 | E-prescribing to external pharmacies | Internal pharmacy only |
| X-10 | Payroll / HR management | Out of clinical/financial core scope |
| X-11 | Real-time clinical device integration (monitors, machines) | Future consideration |
| X-12 | Patient portal messaging/chat with doctors | Notifications only in v1.0 |

---

## 5. Assumptions

These are statements the design **assumes to be true**. If any assumption fails, the affected documents and implementation must be reviewed.

| # | Assumption | Impact if false |
|---|-----------|-----------------|
| A-01 | Single facility with one operating time zone | Scheduling logic must change for multi-time-zone support |
| A-02 | MERN stack (MongoDB, Express, React, Node.js) as a modular monolith | Architecture document and phases would need rework |
| A-03 | A payment gateway is available and agreed upon before billing goes live | Billing workflow needs a manual/offline payment mode |
| A-04 | Email/SMS provider accounts are available for notifications | Notifications degrade to in-app only |
| A-05 | Roles are fixed at deployment: Admin, Receptionist, Doctor, Nurse, Lab Technician, Pharmacist, Accountant, Patient | Permission matrix must be extended |
| A-06 | Doctors see only their assigned patients; nurses see assigned patients; patients see only their own data | Scope-based authorization is central and must be re-verified |
| A-07 | The facility defines its own operational policies (cancellation windows, no-show rules, queue priority, break-glass approvers) | System defaults must be configurable, not hard-coded |
| A-08 | Data entered by staff is accurate; the system records *who did what*, not clinical correctness | Training and governance required outside the software |
| A-09 | Legal/regulatory review (privacy law, medical record retention) is performed by the facility before production | Compliance gaps are the facility's responsibility |
| A-10 | The system does not replace emergency care; emergency workflows work even when the software is unavailable | Public emergency info must remain accessible without login |

---

## 6. Constraints

| # | Constraint | Notes |
|---|-----------|-------|
| C-01 | Security-first architecture | Every sensitive operation passes the universal secure pipeline (auth → authorization → validation → business rules → transaction → audit) |
| C-02 | Server-side authorization only | Roles, user IDs, and payment results from the client are never trusted |
| C-03 | Immutable audit trails | Audit logs must be append-only and protected from modification |
| C-04 | Clinical & financial record finalization | Once finalized, records change only via audited amendments with version history |
| C-05 | Segregation of duties | Clinical, pharmacy, and financial permissions stay separate; admin access does not grant clinical data access |
| C-06 | Idempotent money and booking operations | Payments and appointment bookings must be safe to retry without duplication |
| C-07 | Passwords hashed with Argon2id or equivalent | No plaintext or reversible storage |
| C-08 | Encryption in transit (HTTPS) and appropriate protection at rest | Applies to all patient data |
| C-09 | Minimum necessary data exposure | API responses return only what the role and page require |
| C-10 | Responsive web UI | Desktop, tablet, and mobile browsers; no native mobile apps |

---

## 7. Scope Boundaries by Role (Summary View)

| Role | Can do | Cannot do |
|------|--------|-----------|
| Admin | Manage users/roles, view audit logs, system settings, all reports | Alter clinical content of finalized records |
| Receptionist | Register patients, book/reschedule appointments, check-in, queue, limited billing view | View clinical notes or lab results |
| Doctor | Own-schedule appointments, create encounters, EMR, prescriptions, lab orders | Access patients outside their assigned scope |
| Nurse | Assigned-patient nursing records, assigned views | Prescribe, dispense, or bill |
| Lab Technician | Process/verify lab results in lab scope | Release results without verification; view unrelated patients |
| Pharmacist | Dispense valid prescriptions, manage pharmacy inventory | Create or modify prescriptions |
| Accountant | Manage invoices, payments, refunds, financial reports | View clinical content |
| Patient | Self-register, book own appointments, view own bills and released results | Access anyone else's data; view unverified results |

---

## 8. Future Considerations (Backlog — Not in v1.0)

Acknowledged but **not** built now. Listed so architects leave sensible extension points.

1. Telemedicine module
2. Insurance/TPA integration
3. Inpatient and ward management
4. HL7/FHIR interoperability
5. Mobile applications
6. Multi-branch support
7. AI-assisted (non-diagnostic) administrative features
8. Patient portal messaging

---

## 9. Acceptance of Scope

- [ ] Stakeholders reviewed and agreed the in-scope feature list (Section 3)
- [ ] Stakeholders confirmed exclusions (Section 4) and understood they will not appear in the product
- [ ] Assumptions (Section 5) validated with the facility
- [ ] Constraints (Section 6) accepted by the development team
- [ ] Regulatory/compliance review ownership assigned (A-09)

---

*End of document — Scope and Assumptions v1.0*
