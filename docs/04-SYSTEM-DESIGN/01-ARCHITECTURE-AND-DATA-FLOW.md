# 01 — Architecture and Data Flow

> **Document:** System architecture for the HMS: layers, modules, request pipeline, and cross-cutting concerns
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** Developers and AI coding agents
> **Related documents:** `02-DATABASE-DESIGN.md`, `03-FRONTEND-SPECIFICATION.md`, `04-BACKEND-SPECIFICATION.md`, `01-SECURITY-REQUIREMENTS.md`
> **Rule:** Modular monolith. Strict module boundaries. Security pipeline on every request.

---

## 1. Architectural Style

**Modular monolith (MERN):** one deployable backend service (Node.js/Express) and one frontend application (React), organized internally into strictly separated modules.

Why: single-facility scope (A-01), simpler deployment/testing/security than microservices for v1.0, with module boundaries clean enough to extract later if needed.

---

## 2. High-Level View

```text
┌──────────────────────────────────────────────────────────┐
│                      BROWSER (React SPA)                 │
│  Public site │ Role dashboards │ Module UIs (role-gated) │
└───────────────────────────┬──────────────────────────────┘
                            │ HTTPS (JSON REST)
┌───────────────────────────▼──────────────────────────────┐
│                    EXPRESS API (Node.js)                 │
│                                                          │
│  Middleware chain:                                       │
│    helmet/cors → rate limiter → authN → authZ (PERM)     │
│    → scope/object checks → validation → handler          │
│                                                          │
│  Modules (each: routes → service → repository):          │
│    auth │ patients │ appointments │ clinical │ nursing   │
│    laboratory │ pharmacy │ billing │ inventory           │
│    notifications │ reports │ admin │ audit               │
│                                                          │
│  Cross-cutting: audit logger, policy config, outbox      │
└───────────────────────────┬──────────────────────────────┘
                            │ MongoDB driver (transactions)
┌───────────────────────────▼──────────────────────────────┐
│              MONGODB (replica set for transactions)      │
│  app data │ audit collection (append-only) │ indexes     │
└──────────────────────────────────────────────────────────┘
        │                         │                  │
   Payment gateway          Email/SMS providers   Backups/monitoring
```

---

## 3. Module Boundaries

| Module | Owns (collections) | Never does |
|--------|--------------------|------------|
| auth | users, sessions, mfa | Write patient/clinical data |
| patients | patients, consents | Write appointments/encounters |
| appointments | appointments, waitlist, queue | Write EMR content |
| clinical | encounters, emr-entries, prescriptions, lab-orders (creation) | Deduct stock; record payments |
| nursing | nursing-entries | Prescribe/dispense |
| laboratory | lab-orders (workflow), specimens, results | Create prescriptions |
| pharmacy | inventory, batches, stock-movements, dispenses | Create/edit prescriptions |
| billing | invoices, payments, refunds, adjustments | Modify clinical content |
| inventory | assets, general-stock | Touch medicine stock (pharmacy's domain) |
| notifications | notification-queue | Make business decisions |
| reports | read-only aggregation | Write business data |
| admin | settings, role-assignments | Bypass audit |
| audit | audit-log (append-only) | Allow updates/deletes |

**Boundary rules:** modules communicate via service interfaces (in-process) — never direct writes to another module's collections (NFR-29). Cross-module side effects (e.g., billing charge on dispense) go through the owning module's service or the outbox/event mechanism.

---

## 4. Universal Request Pipeline (Mandatory)

```text
HTTPS request
  → 1. transport/security middleware (helmet, size limits, CORS)
  → 2. rate limiter (login/sensitive endpoints stricter)
  → 3. AUTHENTICATION (session → user; permissions loaded server-side)
  → 4. AUTHORIZATION (PERM-xx required permission)
  → 5. SCOPE + OBJECT-LEVEL CHECK (assignment & record ownership)
  → 6. VALIDATION (schema: shape, types, lengths, enums)
  → 7. BUSINESS RULES (status transitions, policy windows, config)
  → 8. TRANSACTION (Mongo session/transaction where multi-doc)
  → 9. AUDIT (sensitive actions/events)
  → 10. RESPONSE (minimum-necessary fields, standard error envelope)
```

Steps 3–7 are identical to `02-AUTHENTICATION-AND-AUTHORIZATION-FLOW.md §5`; this document adds the transport, transaction, and response layers.

---

## 5. Data Flow Examples

### 5.1 Booking an appointment
1. React sends `POST /appointments` with slot, patient, idempotency key (validated at step 6).
2. Pipeline steps 3–5 confirm patient/reception rights and scope.
3. Service opens a Mongo transaction: re-check slot availability, insert appointment, write idempotency record (steps 7–8).
4. Outbox row queued for confirmation notification + audit entry (step 9).
5. Response returns the appointment (minimum fields — step 10).

### 5.2 Dispensing a prescription
1. Pharmacist submits dispense request (prescription ID, quantities).
2. Pipeline verifies `prescription.dispense` + pharmacy scope.
3. Transaction: lock/check stock per batch (FEFO, no negative), insert dispense record, update prescription status, insert billing charge via billing service.
4. Audit + notifications queued; response returns dispense confirmation.

### 5.3 Releasing a lab result
1. Lab staff requests release (result ID).
2. Pipeline: `lab.result.release` + result's order belongs to requester's scope.
3. Business rules: status must be `VERIFIED`; critical acknowledgment rules satisfied.
4. Transaction: status → `RELEASED`; visibility flags set; clinician notification queued.
5. Audit entry; minimal response.

---

## 6. Cross-Cutting Concerns

| Concern | Approach |
|---------|----------|
| Audit logging | Single audit module; all others call it; append-only collection; never in the same transaction as user-visible success (log must not block, but must be reliable — outbox fallback) |
| Configuration | Environment variables + settings collection (facility policies, A-07); no hard-coded policy values |
| Idempotency | Idempotency-key collection for bookings and payments |
| Events/outbox | Transactional outbox for notifications and cross-module reactions |
| Error handling | Standard envelope per `06-API-AND-ERRORS/02-ERROR-HANDLING-AND-VALIDATION.md` |
| Time | Facility local time zone (A-01); store UTC, render local |

---

## 7. Deployment Topology (Summary)

Single server or small cluster: React static build behind the same origin (or CDN), Express behind reverse proxy (TLS termination), MongoDB replica set (transactions + oplog for backups), provider integrations outbound-only. Details: `02-DEPLOYMENT-AND-INFRASTRUCTURE.md`.

---

*End of document — Architecture and Data Flow v1.0*
