# 02 — Project Glossary

> **Document:** Standard terminology for the Healthcare Management System (HMS)
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** Non-technical stakeholders, developers, and AI coding agents
> **Related documents:** `01-APPLICATION-OVERVIEW.md`, `03-SCOPE-AND-ASSUMPTIONS.md`, `01-ROLES-AND-PERMISSIONS.md`

---

## 1. Purpose of This Document

This glossary defines the **exact meaning of every important term** used across all HMS documents and in the application itself.

> **Rule for everyone (and every AI agent):**
> These terms must be used **consistently** in all documents, database designs, API names, UI labels, and code. Never invent a synonym for a term defined here (e.g., do not alternate between "patient record" and "client file"). If a new term is needed, add it to this glossary first.

**How to read the permission levels used below:**

| Level | Meaning |
|---|---|
| **Manage** | Can perform all permitted operations within their assigned scope |
| **Authorized** | Approved access, bounded by organizational policy and audit |
| **Limited** | Restricted subset of operations, as defined per feature |
| **Assigned** | Access only to records within the user's assignment (their patients, department, or encounter) |
| **Own** | Access only to the user's own records |
| **No** | No access to this feature |

---

## 2. People & Roles

| Term | Definition |
|---|---|
| **User** | Any person with an account in the system (staff or patient) |
| **Admin** | System administrator; manages users, roles, settings, audit logs, and backups. Does **not** get automatic access to clinical content |
| **Receptionist** | Front-desk staff; registers patients, books appointments, manages check-in and queue |
| **Doctor** | Licensed clinician; conducts consultations, writes EMR entries, creates prescriptions and lab orders for patients **within their assigned scope** |
| **Nurse** | Nursing staff; records nursing entries and views assigned patients |
| **Lab Technician** | Laboratory staff; processes specimens, enters and verifies lab results |
| **Pharmacist** | Pharmacy staff; validates and dispenses prescriptions, manages medicine inventory |
| **Accountant** | Finance staff; manages invoices, payments, refunds, and financial reports |
| **Patient** | The person receiving care; owns their account and can view their own released data |
| **Prescriber** | Any role authorized to create prescriptions (in v1.0: Doctor) |
| **Privileged User** | Any user with administrative or elevated privileges (required to use MFA) |

---

## 3. Patient & Identity

| Term | Definition |
|---|---|
| **Patient Registration** | Creating a patient record in the system (by staff or self-registration by the patient) |
| **Demographics** | Non-clinical patient details: name, date of birth, gender, contact information, address |
| **Identity Verification** | The facility's approved process for confirming a person is who they claim to be (at registration and check-in) |
| **Consent** | The patient's recorded permission for specific data-sharing actions |
| **Patient Assignment** | The link that gives a doctor or nurse authorized access to a specific patient (e.g., the doctor of the current encounter) |
| **Scope** | The boundary of a user's access: their patients, department, or role responsibilities |

---

## 4. Appointments & Queue

| Term | Definition |
|---|---|
| **Appointment** | A scheduled meeting between a patient and a doctor (or service) at a specific time |
| **Appointment Status** | The lifecycle state of an appointment: `REQUESTED → SCHEDULED → CONFIRMED → CHECKED_IN → IN_CONSULTATION → COMPLETED`, with `CANCELLED`, `RESCHEDULED`, `NO_SHOW` |
| **Booking** | The act of creating an appointment |
| **Rescheduling** | Moving an appointment to a different time/doctor; leaves an audit trail |
| **Check-in** | Reception confirming the patient has arrived; identity is verified at this point |
| **Queue / Token** | The ordered position of checked-in patients waiting for service |
| **Waitlist** | A list of patients waiting for an open slot when none is available |
| **No-Show** | A patient who was confirmed/checked-in expectations but did not attend; handled by configurable rules |
| **Double-Booking Protection** | A transaction-safe check that a slot is still free at the moment of booking |
| **Idempotency** | Design property: repeating the same request (e.g., a retry) does not create a duplicate record |

---

## 5. Clinical Care & Medical Records

| Term | Definition |
|---|---|
| **Encounter** | A single visit of a patient, linking the appointment to all clinical activity for that visit |
| **Clinical Encounter** | The doctor's consultation record created within an encounter |
| **EMR (Electronic Medical Record)** | The digital medical record: diagnoses, notes, prescriptions, documents, and history |
| **Finalization** | The act of marking a clinical or financial record complete; after finalization, changes happen only via audited amendments |
| **Amendment** | A controlled, audited change to a finalized record; the original is preserved with version history |
| **Version History** | The preserved sequence of a record's previous states |
| **Nursing Entry** | A care note recorded by a nurse for an assigned patient |
| **Prescription** | A doctor-created instruction for medicines, later validated and dispensed by the pharmacy |
| **Dispensing** | The pharmacist's act of giving medicine against a valid prescription, recorded with batch details |
| **Released Data** | Patient-facing clinical data that has been approved for the patient to see; **unverified results are never released** |

---

## 6. Laboratory

| Term | Definition |
|---|---|
| **Lab Order** | A doctor's request for laboratory test(s), linked to a patient and encounter |
| **Specimen** | The physical sample collected from the patient (blood, urine, etc.) |
| **Specimen Identifier** | The unique code tracking a specimen through the lab process |
| **Chain of Custody** | The recorded trail of who handled a specimen, when, and where |
| **Result Entry** | Inputting test values into the system (authorized personnel only) |
| **Result Verification** | Review and approval of a result by authorized personnel before release |
| **Critical Result** | A dangerously abnormal result that triggers urgent clinician notification with recorded acknowledgment |
| **Result Release** | Making a verified result visible to the doctor and (per policy) the patient |
| **Result Amendment** | A corrected lab result; the original is always preserved |

---

## 7. Pharmacy & Inventory

| Term | Definition |
|---|---|
| **Pharmacy Inventory** | The stock of medicines, tracked by medicine, batch, and expiry |
| **Batch / Lot Number** | The identifier of a specific production batch of a medicine |
| **Expiry Date** | The date after which a medicine must not be dispensed |
| **FEFO (First-Expiry, First-Out)** | Stock rotation rule: dispense the batch expiring soonest first |
| **Stock Movement** | Any change to inventory: receipt, dispense, adjustment, quarantine, recall |
| **Stock Adjustment** | A controlled inventory change requiring authorization; always audited |
| **Quarantine** | Holding stock aside so it cannot be dispensed (e.g., suspected quality issue) |
| **Recall** | Withdrawing a batch from dispensing, typically due to a safety notice |
| **Negative Stock Prevention** | System rule: inventory can never go below zero |

---

## 8. Billing & Finance

| Term | Definition |
|---|---|
| **Invoice** | A formal bill issued to a patient for services, tests, and medicines |
| **Draft Invoice** | An editable invoice not yet issued; invisible to the patient |
| **Issued Invoice** | A finalized bill sent to the patient; changes require authorized amendment |
| **Finalized Financial Record** | An issued invoice/payment record that can no longer be silently edited |
| **Payment** | Money received against an invoice (full or partial) |
| **Partial Payment** | A payment covering only part of the invoice total; balance remains tracked |
| **Outstanding Balance** | The remaining amount owed on an invoice |
| **Refund** | Returning money to a patient; requires authorization and audit |
| **Discount** | A price reduction; requires authorization per policy |
| **Idempotency Key** | A unique request marker ensuring a payment (or booking) is processed at most once |
| **Reconciliation** | Matching recorded payments against gateway reports, cash collections, and bank deposits |
| **Gateway** | The external payment service used to process online payments |

---

## 9. Hospital Assets & General Inventory

| Term | Definition |
|---|---|
| **Asset** | Hospital equipment or property tracked in the system (non-pharmacy) |
| **Asset Register** | The catalog of all tracked assets with status and location |
| **General Inventory** | Non-medicine supplies (consumables, stationery, equipment parts) |

---

## 10. Notifications & Reports

| Term | Definition |
|---|---|
| **Notification** | A system-generated message (in-app, email, or SMS) about appointments, results, bills, etc. |
| **Reminder** | A notification sent before an appointment; must not contain sensitive clinical details |
| **Dashboard** | A role-scoped summary screen of key metrics |
| **Operational Report** | Reports on appointments, queues, and workload |
| **Financial Report** | Reports on billing, payments, and reconciliation (accountant/admin scope) |

---

## 11. Security & Privacy

| Term | Definition |
|---|---|
| **RBAC (Role-Based Access Control)** | Access decisions based on the user's role, enforced server-side |
| **Object-Level Authorization** | Checking that the user may access *this specific record* (prevents ID-guessing attacks) |
| **Scope-Based Authorization** | Checking assignment, department, or encounter boundaries beyond the role itself |
| **Authentication** | Proving who the user is (login, MFA) |
| **MFA (Multi-Factor Authentication)** | A second proof of identity, required for privileged users |
| **Session** | The authenticated period after login; expires automatically and is re-verified on every request |
| **Argon2id** | The approved password-hashing algorithm |
| **Audit Log / Audit Trail** | A protected, append-only record of who did what, when, and to what data |
| **Break-Glass Access** | Controlled emergency access to restricted records: requires a stated reason, is time-limited, and is fully audited and reviewed |
| **Minimum Necessary** | Privacy principle: expose only the data required for the task at hand |
| **Encryption in Transit** | Protecting data moving between browser and server (HTTPS/TLS) |
| **Encryption at Rest** | Protecting stored data (database/disk-level protection) |
| **Segregation of Duties (SoD)** | Keeping clinical, pharmacy, and financial powers in separate roles so no single user controls everything |
| **Backup** | A protected copy of data enabling recovery after failure |
| **Disaster Recovery (DR)** | The planned process of restoring service and data after a serious incident |

---

## 12. System & Technical Terms

| Term | Definition |
|---|---|
| **MERN** | The technology stack: MongoDB, Express, React, Node.js |
| **Modular Monolith** | One deployable application organized into strictly separated internal modules |
| **API (Application Programming Interface)** | The rules by which the frontend talks to the backend |
| **Endpoint** | A specific API address for one operation (e.g., create appointment) |
| **Request Validation** | Server-side checking that incoming data is complete, well-formed, and allowed |
| **Business Rules** | Facility-specific policies enforced by the system (cancellation windows, refund approval, queue priority) |
| **State Transition** | A permitted move of a record from one status to another (e.g., SCHEDULED → CONFIRMED) |
| **Transaction** | A database operation where all changes succeed together or none apply |
| **Rate Limiting** | Restricting how often a user/IP can attempt sensitive operations (e.g., login) |
| **Permission Catalog** | The fine-grained list of individual permissions (e.g., `lab.result.verify`) mapped to roles |

---

## 13. Status Vocabularies (Canonical Values)

These exact values must be used consistently in the database, API, and UI.

### 13.1 Appointment Status
`REQUESTED` · `SCHEDULED` · `CONFIRMED` · `CHECKED_IN` · `IN_CONSULTATION` · `COMPLETED` · `CANCELLED` · `RESCHEDULED` · `NO_SHOW`

### 13.2 Invoice Status
`DRAFT` · `ISSUED` · `PARTIALLY_PAID` · `PAID` · `REFUNDED` · `CANCELLED`

### 13.3 Lab Order Status
`ORDERED` · `SPECIMEN_COLLECTED` · `IN_PROCESS` · `RESULT_ENTERED` · `VERIFIED` · `RELEASED` · `AMENDED` · `CANCELLED`

### 13.4 Prescription Status
`ACTIVE` · `PARTIALLY_DISPENSED` · `FULLY_DISPENSED` · `CANCELLED` · `EXPIRED`

### 13.5 User Account Status
`ACTIVE` · `SUSPENDED` · `LOCKED` · `PENDING_MFA_SETUP`

---

*End of document — Project Glossary v1.0*
