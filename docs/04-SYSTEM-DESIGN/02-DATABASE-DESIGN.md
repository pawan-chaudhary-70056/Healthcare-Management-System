# 02 — Database Design

> **Document:** MongoDB data model for the HMS: collections, relationships, indexes, and transaction rules
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** Developers and AI coding agents
> **Related documents:** `01-ARCHITECTURE-AND-DATA-FLOW.md`, `02-PROJECT-GLOSSARY.md §13` (canonical statuses), `01-ROLES-AND-PERMISSIONS.md`
> **Rule:** Field names below are the contract. Status enums use glossary values exactly.

---

## 1. Conventions

- MongoDB replica set (required for multi-document transactions).
- Collection names: lowercase plural (`patients`, `appointments`).
- All documents: `_id` (ObjectId), `createdAt`, `updatedAt`.
- Money: integer minor units + currency code (never floats).
- Statuses: canonical strings from the glossary.
- Soft references by `_id`; enforce integrity in services (no cross-module direct writes).

---

## 2. Collections Overview

| Collection | Module | Purpose |
|-----------|--------|---------|
| `users` | auth | All accounts (staff + patients), role, status |
| `roles` / `permissions` | auth | Role → permission catalog mapping (seeded from `01-ROLES-AND-PERMISSIONS.md §4`) |
| `sessions` | auth | Active sessions (if server-side) |
| `departments` | admin (reference) | Public directory + booking filter: name, description, active flag |
| `doctor_schedules` | appointments | Doctor availability template: doctor, department, weekday, start/end time, slot length, active flag |
| `schedule_exceptions` | appointments | Date-specific overrides: doctor, date, closed or custom hours (leave, holiday) |
| `patients` | patients | Demographics, identity reference, consent flags |
| `consents` | patients | Consent records with timestamps |
| `appointments` | appointments | Bookings, status lifecycle, slot refs |
| `waitlist` | appointments | Waitlist entries |
| `queue_tokens` | appointments | Check-in tokens and order |
| `encounters` | clinical | Visit-level clinical container |
| `emr_entries` | clinical | Clinical notes/diagnoses; versions array |
| `prescriptions` | clinical | Prescription header + items + status |
| `nursing_entries` | nursing | Nurse care notes |
| `lab_orders` | laboratory | Test orders + status |
| `specimens` | laboratory | Specimen + custody trail |
| `lab_results` | laboratory | Values; versions for amendments |
| `medicines` | pharmacy | Catalog (name, form, strength) |
| `batches` | pharmacy | Stock by batch/expiry |
| `stock_movements` | pharmacy | Every inventory delta |
| `dispenses` | pharmacy | Dispensing records |
| `invoices` | billing | Header + itemized lines + status |
| `payments` | billing | Payments with idempotency keys |
| `refunds` | billing | Refund records |
| `adjustments` | billing | Credit notes/discounts |
| `assets` | inventory | Equipment register |
| `general_stock` / `general_stock_movements` | inventory | Non-medicine inventory |
| `notifications` | notifications | Queue + delivery state |
| `idempotency_keys` | cross | Booking/payment dedupe |
| `outbox` | cross | Event delivery for notifications/integrations |
| `audit_log` | audit | Append-only trail |
| `settings` | admin | Facility policies/config |

---

## 3. Key Collections & Fields

### 3.1 `users`
```text
_id, email(unique), passwordHash(Argon2id), role: 'admin'|'receptionist'|'doctor'|
'nurse'|'lab_tech'|'pharmacist'|'accountant'|'patient',
status: ACTIVE|SUSPENDED|LOCKED|PENDING_MFA_SETUP,
mfa: { enabled, secretEncrypted }, failedLogins, lockedUntil,
staffProfile: { department, specialties[] }?,   // staff only
createdAt, updatedAt
```

### 3.2 `departments` / `doctor_schedules` / `schedule_exceptions`
```text
departments:        _id, name(unique), description, publicVisible, active,
                    orderIndex (directory display order)
doctor_schedules:   _id, doctorId, departmentId, weekday: 0–6,
                    startTime, endTime (facility-local, A-01), slotLengthMinutes,
                    validFrom?, validTo?, active
schedule_exceptions:_id, doctorId, date, type: CLOSED|CUSTOM,
                    customSlots? (start/end list)
```

Slot generation rule: `GET /appointments/slots` computes offerable slots = doctor_schedules template for that weekday − existing non-cancelled appointments − schedule_exceptions for that date − booking-horizon policy. Slots are generated on read; **no slots collection is stored**.

### 3.3 `patients`
```text
_id, userId?, mrn(unique, facility MRN), firstName, lastName, dob, gender,
contacts: { phone, email, address },
identityRef: { type, value },   // per facility policy
consentFlags: { shareWithLab, shareWithPharmacy, ... },
assignedDoctorIds: [ObjectId]? // context-dependent assignments
```

### 3.4 `appointments`
```text
_id, patientId, doctorId, departmentId, slot: { start(UTC), end },
serviceType, reasonForVisit(private),
status: REQUESTED|SCHEDULED|CONFIRMED|CHECKED_IN|IN_CONSULTATION|COMPLETED|
        CANCELLED|RESCHEDULED|NO_SHOW,
idempotencyKey?, bookedBy: { userId, role },
statusHistory: [ { from, to, by, at, reason? } ],
appointmentNo(unique per facility/day? per policy)
```

### 3.5 `encounters`
```text
_id, appointmentId(unique), patientId, doctorId,
startedAt, completedAt?, status: OPEN|FINALIZED,
finalizedAt?, finalizationNote?
```

### 3.6 `emr_entries`
```text
_id, encounterId, patientId, type: 'note'|'diagnosis'|'document'|'plan',
content, authorId,
status: DRAFT|FINALIZED|AMENDED,
versions: [ { v, content, by, at, reason? } ],   // original preserved
finalizedAt?
```

### 3.7 `prescriptions`
```text
_id, encounterId, patientId, prescriberId,
items: [ { medicineId, dose, frequency, duration, quantityDispensed } ],
status: ACTIVE|PARTIALLY_DISPENSED|FULLY_DISPENSED|CANCELLED|EXPIRED,
validUntil, cancelReason?
```

### 3.8 `lab_orders` / `specimens` / `lab_results`
```text
lab_orders:  _id, encounterId, patientId, doctorId, tests: [ { code, name } ],
             status: ORDERED|SPECIMEN_COLLECTED|IN_PROCESS|RESULT_ENTERED|VERIFIED|
                     RELEASED|AMENDED|CANCELLED,
             chargeId
specimens:   _id, labOrderId, specimenId(unique), type, collectedAt, collectedBy,
             custody: [ { heldBy, at, action } ], status
lab_results: _id, labOrderId, patientId, testCode,
             values: [ { name, value, unit, flag: NORMAL|LOW|HIGH|CRITICAL } ],
             status, verifiedBy, verifiedAt, releasedAt?,
             versions: [ { v, values, by, at, reason? } ],
             critical: { isCritical, notifiedUserId?, acknowledgedAt? }
```

### 3.9 `batches` / `stock_movements` / `dispenses`
```text
batches:          _id, medicineId, batchNo, expiryDate, quantityOnHand, status:
                  AVAILABLE|QUARANTINED|RECALLED|EXPIRED
stock_movements:  _id, batchId, type: RECEIPT|DISPENSE|ADJUSTMENT|QUARANTINE|
                  RECALL|EXPIRY, qtyDelta, reason?, byUserId, at
dispenses:        _id, prescriptionId, patientId, encounterId?, items: [
                  { medicineId, batchId, qty } ], dispensedBy, at, chargeId
```

### 3.10 `invoices` / `payments` / `refunds` / `adjustments`
```text
invoices:   _id, patientId, encounterId?, lines: [ { type: SERVICE|LAB|MEDICINE,
            refId, description, qty, unitPriceMinor, totalMinor } ],
            totalMinor, currency, paidMinor, status: DRAFT|ISSUED|PARTIALLY_PAID|
            PAID|REFUNDED|CANCELLED, issuedAt, statusHistory[]
payments:   _id, invoiceId, patientId, amountMinor, method: GATEWAY|CASH|POS,
            gatewayRef?, idempotencyKey(unique), status: PENDING|CONFIRMED|
            FAILED, confirmedBy?, confirmedAt
refunds:    _id, paymentId, invoiceId, amountMinor, reason, approvedBy, at
adjustments:_id, invoiceId, type: DISCOUNT|CREDIT, amountMinor, reason, approvedBy, at
```

### 3.11 `audit_log` (append-only)
```text
_id, at, actorId, actorRole, action, module, resourceType, resourceId,
patientId?, outcome: SUCCESS|DENIED|FAILED, ip, userAgent, details(no secrets)
```

---

## 4. Relationships (Logical)

```text
users 1─1 patients (patient accounts)
departments 1─* doctor_schedules *─1 users(doctor)
doctor_schedules 1─* appointments (slots generated on read; exceptions subtract)
patients 1─* appointments *─1 users(doctor)
appointments 1─1 encounters 1─* emr_entries
encounters 1─* prescriptions, lab_orders
lab_orders 1─1 specimens 1─* lab_results
prescriptions 1─* dispenses *─1 batches *─1 medicines
encounters/prescriptions/lab-orders → charges → invoices 1─* payments
                                         ├─* refunds
                                         └─* adjustments
patients 1─* consents, audit references (patientId index)
```

---

## 5. Indexes (Minimum Set)

| Collection | Index |
|------------|-------|
| users | `{ email: 1 }` unique |
| departments | `{ name: 1 }` unique; `{ active: 1, orderIndex: 1 }` |
| doctor_schedules | `{ doctorId: 1, weekday: 1 }`; `{ departmentId: 1, active: 1 }` |
| schedule_exceptions | `{ doctorId: 1, date: 1 }` unique |
| patients | `{ mrn: 1 }` unique; `{ phone: 1 }`; `{ lastName, firstName }` |
| appointments | `{ doctorId, "slot.start": 1 }`; `{ patientId, "slot.start": -1 }`; `{ status: 1 }`; `{ idempotencyKey: 1 }` sparse unique |
| encounters | `{ appointmentId: 1 }` unique; `{ patientId: 1 }` |
| prescriptions | `{ patientId: 1, status: 1 }` |
| lab_orders | `{ status: 1 }`; `{ patientId: 1 }` |
| lab_results | `{ labOrderId: 1 }`; `{ patientId: 1, status: 1 }` |
| batches | `{ medicineId: 1, expiryDate: 1 }`; partial index `status: AVAILABLE` |
| invoices | `{ patientId: 1, createdAt: -1 }`; `{ status: 1 }` |
| payments | `{ idempotencyKey: 1 }` unique; `{ invoiceId: 1 }` |
| audit_log | `{ at: -1 }`; `{ actorId: 1, at: -1 }`; `{ patientId: 1, at: -1 }` |
| outbox | `{ processed: 1, createdAt: 1 }` |

---

## 6. Transaction Rules (When Transactions Are Mandatory)

| Operation | Transaction scope |
|-----------|-------------------|
| Booking (T-02/T-07) | slot re-check + appointment insert + idempotency record |
| Check-in | appointment status + queue token insert |
| Encounter finalize | encounter status + appointment T-06 |
| Dispense | batch deductions + dispense record + prescription status + charge creation |
| Payment confirm | payment insert/update + invoice balance + status |
| Refund | refund record + invoice status |
| Result release | result status + notification outbox |
| Stock adjustment | movement + batch quantity |

Writes that span modules (e.g., charge creation) occur inside the owning transaction via service calls; notifications always go through the outbox, never inside the critical transaction.

---

## 7. Data Protection Notes

- `passwordHash`, `mfa.secretEncrypted` — never returned by any API; excluded from projections.
- Audit `details` must not contain passwords, tokens, or secrets.
- Field-level encryption optional per facility policy for identity refs (A-09).
- Retention: per facility policy (NFR-18); audit default ≥ 1 year (NFR-36).

---

*End of document — Database Design v1.0*
