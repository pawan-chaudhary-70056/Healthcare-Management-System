# 01 — Application Overview

> **Document:** High-level overview of the Healthcare Management System (HMS)
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** Non-technical stakeholders, developers, and AI coding agents
> **Related documents:** `02-PROJECT-GLOSSARY.md`, `03-SCOPE-AND-ASSUMPTIONS.md`, `01-FUNCTIONAL-REQUIREMENTS.md`, `01-ARCHITECTURE-AND-DATA-FLOW.md`

---

## 1. What Is This Application?

The **Healthcare Management System (HMS)** is a secure, web-based platform that helps a hospital or clinic run its day-to-day operations digitally — from a patient's first visit to the website, through appointments, consultation, laboratory tests, and medicines, all the way to billing, reporting, and administration.

In plain terms:

> **One system for the whole facility — patients, doctors, nurses, lab, pharmacy, billing, and management — where every user sees only what their role allows, and every sensitive action is recorded.**

---

## 2. The Problem It Solves

| Without the HMS | With the HMS |
|---|---|
| Paper registers and spreadsheets for patients | A single, secure digital patient record |
| Phone-only appointment booking, double bookings | Online booking with automatic conflict prevention |
| Test results on paper, waiting at the lab counter | Lab orders tracked digitally; verified results released to the doctor and patient |
| Handwritten prescriptions, manual stock counts | Digital prescriptions checked by the pharmacy; live medicine inventory with expiry tracking |
| Cash boxes and loose receipts | Proper invoices, payment records, and reconciliation |
| "Who changed this?" questions with no answer | A permanent audit trail of who did what, and when |
| Everyone sees everything | Role-based access — each person sees only their own work area |

---

## 3. Who Uses the Application? (The 8 Roles)

| Role | What they mainly do in the system |
|---|---|
| **Admin** | Manages users, roles, system settings, audit logs, backups, and overall reports |
| **Receptionist** | Registers patients, books/reschedules appointments, handles check-in and the visitor queue |
| **Doctor** | Runs consultations, writes medical records and prescriptions, orders lab tests |
| **Nurse** | Records nursing care and views assigned patients |
| **Lab Technician** | Collects specimens, enters and verifies lab results |
| **Pharmacist** | Dispenses medicines against valid prescriptions and manages medicine stock |
| **Accountant** | Manages invoices, payments, refunds, and financial reports |
| **Patient** | Self-registers, books own appointments, views own bills and released results |

> Each role gets its own dashboard and sees only the modules authorized for that role. See `01-ROLES-AND-PERMISSIONS.md` for the full permission matrix.

---

## 4. The Journey of a Typical Patient

A simple narrative for non-technical readers:

1. **Discover** — The patient opens the public website and reads about departments, doctors, services, and emergency contacts. No login needed.
2. **Register** — The patient creates an account (or the receptionist registers them at the desk).
3. **Book** — The patient (or receptionist) books an appointment with a doctor. The system prevents double bookings automatically.
4. **Check in** — On visit day, reception verifies identity and checks the patient in; a queue number is issued.
5. **Consult** — The doctor sees the patient, writes the consultation notes, diagnosis, and prescription in the medical record, and may order lab tests.
6. **Laboratory** (if needed) — The lab collects the specimen, processes the test, verifies the result, and releases it to the doctor and patient.
7. **Pharmacy** (if needed) — The pharmacist validates the prescription, dispenses medicine, and stock is updated automatically.
8. **Billing** — The accountant issues an invoice covering the visit, tests, and medicines; the patient pays (fully or partially) and receives a receipt.
9. **Follow-up** — The patient receives notifications (reminders, results, bills) and can view their own records in the patient portal.
10. **Behind the scenes** — Every step above is authorized by role and recorded in the audit log. Managers see dashboards and reports.

> The exact order of lab, pharmacy, and billing steps can differ by facility policy — the system supports flexible sequences.

---

## 5. Main Modules at a Glance

| # | Module | Purpose |
|---|--------|---------|
| 1 | Public Website | Hospital introduction, departments, doctors, emergency info |
| 2 | Authentication & Access | Login, registration, MFA, sessions, role-based access |
| 3 | Patient Management | Patient records, demographics, consent and privacy controls |
| 4 | Appointments & Queue | Booking, rescheduling, cancellation, check-in, waitlist, tokens |
| 5 | Clinical Care (EMR) | Consultations, diagnoses, medical records, prescriptions |
| 6 | Nursing | Nursing entries and assigned-patient care records |
| 7 | Laboratory | Lab orders, specimen tracking, result entry, verification, release |
| 8 | Pharmacy | Dispensing, medicine inventory, batches, expiry, stock control |
| 9 | Billing & Payments | Invoices, payments, refunds, reconciliation |
| 10 | Inventory & Assets | Hospital (non-pharmacy) equipment and inventory tracking |
| 11 | Notifications | Confirmations, reminders, alerts — in-app, email, SMS |
| 12 | Reports & Dashboards | Role-scoped operational, clinical, and financial reporting |
| 13 | Administration | User/role management, settings, backups, recovery |
| 14 | Security & Audit | Audit trails, break-glass emergency access, monitoring |

---

## 6. What Makes It "Professional and Secure"?

Six principles are built into every module (explained fully in `01-SECURITY-REQUIREMENTS.md`):

1. **Never trust the frontend** — All security checks happen on the server, on every request.
2. **Role + scope access** — A user's role *and* their assignment (their patients, their department) decide what they can see.
3. **Records are finalized, not silently edited** — Clinical and financial records keep version history; changes are audited amendments.
4. **No duplicates, ever** — Booking and payment operations are safe to retry without creating duplicates.
5. **Segregation of duties** — Clinical, pharmacy, and financial powers stay separate; admin does not automatically see clinical data.
6. **Everything sensitive is logged** — Access and changes to sensitive data are permanently recorded; emergency "break-glass" access is tightly controlled and reviewed.

---

## 7. Technology Foundation (For Developers and AI Agents)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React | Single-page application, responsive web (desktop/tablet/mobile) |
| Backend | Node.js + Express | Modular monolith — one deployable service, organized by module |
| Database | MongoDB | Single primary datastore |
| Architecture | Modular monolith | Modules communicate through well-defined internal boundaries |
| Security baseline | HTTPS everywhere, Argon2id password hashing, MFA for privileged roles, secure session handling |

> **Why a modular monolith?** For a single-facility v1.0, it is simpler to build, test, deploy, and secure than microservices, while clean module boundaries keep future extraction possible.

---

## 8. Key Rules That Govern the Whole System

These are binding for every document and every implementation phase:

1. **Scope discipline** — If a feature is not in `03-SCOPE-AND-ASSUMPTIONS.md` or `01-FUNCTIONAL-REQUIREMENTS.md`, it must not be built.
2. **Server-side authorization** — Roles, user IDs, and payment results sent by the frontend are never trusted.
3. **Universal secure pipeline** — Every protected API call passes: HTTPS + validation → authentication → authorization → business rules → database transaction → audit → minimal response.
4. **Consistent terminology** — All documents use the definitions in `02-PROJECT-GLOSSARY.md`.
5. **Traceability** — Requirements, workflows, and tests reference each other by ID (S-xx, X-xx, A-xx, C-xx).

---

## 9. Document Map (Where to Find What)

| I want to know… | Read |
|---|---|
| What the system does and does not include | `03-SCOPE-AND-ASSUMPTIONS.md` |
| What words like "encounter" or "finalization" mean | `02-PROJECT-GLOSSARY.md` |
| Detailed feature requirements | `01-FUNCTIONAL-REQUIREMENTS.md` |
| Speed, safety, availability targets | `02-NON-FUNCTIONAL-REQUIREMENTS.md` |
| Who can do what | `01-ROLES-AND-PERMISSIONS.md` |
| How each workflow runs step by step | `03-APPLICATION-FLOWS/` folder |
| How the system is designed internally | `04-SYSTEM-DESIGN/` folder |
| Security and privacy rules | `05-SECURITY-AND-PRIVACY/` folder |
| How to build it phase by phase | `09-AI-DEVELOPMENT/` folder |

---

*End of document — Application Overview v1.0*
