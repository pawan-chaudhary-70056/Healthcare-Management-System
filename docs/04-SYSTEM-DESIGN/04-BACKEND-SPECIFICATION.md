# 04 — Backend Specification

> **Document:** Express/Node backend structure, middleware, services, and coding rules for the HMS
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** Developers and AI coding agents
> **Related documents:** `01-ARCHITECTURE-AND-DATA-FLOW.md`, `01-ROLES-AND-PERMISSIONS.md`, `01-API-DESIGN-STANDARDS.md`, `02-ERROR-HANDLING-AND-VALIDATION.md`
> **Rule:** Every route declares its permission; every service enforces scope and business rules; every sensitive action is audited.

---

## 1. Project Layout

```text
backend/
├── node_modules/                         # installed npm dependencies — never manually edit
│
├── src/
│   ├── @types/                           # custom/global TypeScript declarations
│   │   └── express.d.ts                 # Express Request augmentation (user, role, permissions, session)
│   │
│   ├── config/                           # application and infrastructure configuration
│   │   ├── env.ts                        # environment loading + validation at boot — fail fast
│   │   ├── constants.ts                  # canonical status/enum constants — single source of truth
│   │   ├── database.ts                   # MongoDB/Mongoose connection configuration
│   │   ├── logger.ts                     # Pino structured JSON logging + request IDs
│   │   └── security.ts                   # Helmet, CORS allowlist, cookie/session security configuration
│   │
│   ├── errors/                           # centralized application/domain error system
│   │   ├── app-error.ts                  # base typed application error
│   │   ├── error-codes.ts                # canonical error-code catalog
│   │   ├── error-handler.ts              # converts errors into safe HTTP responses
│   │   ├── error-types.ts                # typed error categories/interfaces
│   │   └── index.ts                      # centralized error exports
│   │
│   ├── controllers/                      # HTTP request/response layer — thin controllers only
│   │   ├── auth.controller.ts            # authentication request handling
│   │   ├── patient.controller.ts         # patient request handling
│   │   ├── appointment.controller.ts     # appointment request handling
│   │   ├── clinical.controller.ts        # clinical/encounter request handling
│   │   ├── nursing.controller.ts         # nursing request handling
│   │   ├── laboratory.controller.ts      # laboratory request handling
│   │   ├── pharmacy.controller.ts        # pharmacy request handling
│   │   ├── billing.controller.ts         # billing/payment request handling
│   │   ├── inventory.controller.ts       # inventory request handling
│   │   ├── notification.controller.ts    # notification request handling
│   │   ├── report.controller.ts          # reporting request handling
│   │   ├── admin.controller.ts           # administration request handling
│   │   └── audit.controller.ts           # audit log access
│   │
│   ├── helpers/                           # reusable application-level helper functions
│   │   ├── pagination.helper.ts           # pagination calculation
│   │   ├── response.helper.ts             # standardized API response
│   │   ├── transaction.helper.ts          # MongoDB transaction wrapper
│   │   ├── permission.helper.ts           # reusable permission checks
│   │   └── ownership.helper.ts            # object ownership / IDOR protection
│   │
│   ├── middlewares/                       # cross-cutting HTTP middleware
│   │   ├── auth.middleware.ts              # requireAuth — authenticate session/user
│   │   ├── permission.middleware.ts        # requirePermission('permission.string')
│   │   ├── scope.middleware.ts             # patient/encounter/lab/pharmacy/finance scope checks
│   │   ├── ownership.middleware.ts        # assert object ownership — IDOR guard
│   │   ├── validate.middleware.ts          # request schema validation → 422 field errors
│   │   ├── rate-limit.middleware.ts       # global + stricter authentication rate limits
│   │   ├── audit.middleware.ts            # capture security-sensitive actions
│   │   ├── request-id.middleware.ts        # unique request/correlation ID
│   │   ├── error.middleware.ts             # standard error envelope — never expose stack traces
│   │   └── not-found.middleware.ts         # 404 handling
│   │
│   ├── models/                            # Mongoose models and database schemas
│   │   ├── user.model.ts                   # users
│   │   ├── role.model.ts                   # roles
│   │   ├── permission.model.ts             # permissions
│   │   ├── patient.model.ts                # patient records
│   │   ├── appointment.model.ts             # appointments
│   │   ├── encounter.model.ts              # clinical encounters
│   │   ├── nursing.model.ts                # nursing records
│   │   ├── laboratory.model.ts             # laboratory orders/results
│   │   ├── pharmacy.model.ts               # prescriptions/dispensing
│   │   ├── billing.model.ts                # invoices/payments/refunds
│   │   ├── inventory.model.ts              # inventory/stock
│   │   ├── notification.model.ts           # notifications
│   │   ├── audit-log.model.ts              # append-only audit records
│   │   └── settings.model.ts               # facility/system settings
│   │
│   ├── routes/                            # API route definitions
│   │   ├── index.ts                       # central route registration
│   │   ├── auth.routes.ts                 # /api/v1/auth/*
│   │   ├── patient.routes.ts              # /api/v1/patients/*
│   │   ├── appointment.routes.ts          # /api/v1/appointments/*
│   │   ├── clinical.routes.ts             # /api/v1/clinical/*
│   │   ├── nursing.routes.ts              # /api/v1/nursing/*
│   │   ├── laboratory.routes.ts           # /api/v1/laboratory/*
│   │   ├── pharmacy.routes.ts             # /api/v1/pharmacy/*
│   │   ├── billing.routes.ts              # /api/v1/billing/*
│   │   ├── inventory.routes.ts            # /api/v1/inventory/*
│   │   ├── notification.routes.ts         # /api/v1/notifications/*
│   │   ├── report.routes.ts               # /api/v1/reports/*
│   │   ├── admin.routes.ts                # /api/v1/admin/*
│   │   └── audit.routes.ts                # /api/v1/audit/*
│   │
│   ├── services/                          # business logic and domain rules
│   │   ├── auth.service.ts                # registration, login, sessions, password recovery
│   │   ├── patient.service.ts             # patient business rules
│   │   ├── appointment.service.ts         # scheduling + double-booking prevention
│   │   ├── clinical.service.ts            # encounters and clinical workflows
│   │   ├── nursing.service.ts             # nursing workflows
│   │   ├── laboratory.service.ts          # lab orders, specimens, results
│   │   ├── pharmacy.service.ts            # prescriptions + dispensing
│   │   ├── billing.service.ts             # invoices, payments, refunds
│   │   ├── inventory.service.ts           # stock and inventory rules
│   │   ├── notification.service.ts        # notification creation/delivery
│   │   ├── report.service.ts              # read-only reporting/aggregation
│   │   ├── admin.service.ts               # users, roles, permissions, settings
│   │   └── audit.service.ts               # append-only audit event recording
│   │
│   ├── validators/                        # request validation schemas
│   │   ├── auth.validator.ts              # login/register/password validation
│   │   ├── patient.validator.ts            # patient validation
│   │   ├── appointment.validator.ts        # appointment validation
│   │   ├── clinical.validator.ts           # clinical validation
│   │   ├── nursing.validator.ts            # nursing validation
│   │   ├── laboratory.validator.ts         # laboratory validation
│   │   ├── pharmacy.validator.ts           # pharmacy validation
│   │   ├── billing.validator.ts            # billing validation
│   │   ├── inventory.validator.ts          # inventory validation
│   │   └── admin.validator.ts              # administration validation
│   │
│   ├── integrations/                      # external system/service integrations
│   │   ├── email/                         # SMTP/email provider integration
│   │   ├── sms/                           # SMS provider integration
│   │   ├── payment/                       # payment gateway integration
│   │   └── storage/                       # file/object storage integration
│   │
│   ├── jobs/                              # asynchronous/background processing
│   │   ├── outbox/                        # transactional outbox processing
│   │   ├── notifications.job.ts           # background notification delivery
│   │   ├── reports.job.ts                 # scheduled report generation
│   │   └── cleanup.job.ts                 # expired/session/temporary-data cleanup
│   │
│   ├── utils/                             # low-level reusable utilities
│   │   ├── hash.ts                        # Argon2id password hashing
│   │   ├── session.ts                     # secure HTTP-only cookie session handling
│   │   ├── idempotency.ts                 # idempotency-key handling
│   │   ├── async-handler.ts               # async controller wrapper
│   │   ├── pagination.ts                  # pagination utilities
│   │   ├── date.ts                        # date/time utilities
│   │   └── encryption.ts                  # approved encryption helpers where required
│   │
│   ├── server.ts                          # bootstrap: env → database → HTTP server
│   └── app.ts                             # Express app + mandatory middleware order + routes
│
├── tests/                                 # automated backend testing
│   ├── unit/                              # services, helpers, validators
│   ├── integration/                       # API + database integration tests
│   ├── security/                          # IDOR, auth bypass, injection, tampering, cookies
│   └── e2e/                               # complete workflows such as appointment → billing
│
├── .env                                   # local environment variables — NEVER commit
├── .env.example                           # safe environment variable template
├── .gitignore                             # Git exclusions — MUST exclude .env
├── package.json                            # dependencies and npm scripts
├── tsconfig.json                           # TypeScript configuration
└── README.md                               # backend setup, architecture and development guide
```

**Mapping from layer-based layouts** (if migrating a template with root-level `controllers/`, `models/`, `routes/`, `services/`):

| Layer-based location | Spec-compliant location |
|---|---|
| `controllers/<x>.controller.ts` | `modules/<module>/controller.ts` |
| `services/<x>.service.ts` | `modules/<module>/service.ts` |
| `models/<x>.model.ts` | `modules/<module>/model.ts` |
| `routes/<x>.routes.ts` | `modules/<module>/routes.ts` |
| `validators/<x>.validator.ts` | `modules/<x module>/validators.ts` |
| `helpers/` | `core/utils/` |
| `middlewares/` | `core/middleware/` |

**Domain naming rule:** use HMS glossary terms only — `appointments` (not bookings), `encounters`, `invoices`. Generic template names like `room`/`booking` must not survive into models or routes.

Each module folder contains: `routes.ts` (declarative permissions), `controller.ts` (thin handlers), `service.ts` (business rules + scope checks), `repo.ts` (data access), `validators.ts` (schemas), `model.ts` (Mongoose schema). Cross-module access happens only through the owning module's service interface — never a direct collection write (NFR-29).

---

## 2. Middleware Chain (Order Is Mandatory)

```text
helmet → cors(allowlist) → body parser(limited size) → request id
  → rate limiter(global; stricter on /auth)
  → requireAuth (session → user + permissions loaded from DB)
  → requirePermission('perm.string')      // per route
  → requireScope('patient'|'encounter'|'lab'|'pharmacy'|'finance')  // per route
  → validate(schema)                       // per route
  → route handler (controller: parse → call service → respond)
  → error handler (standard envelope; logs details, returns minimal info)
```

The handler is the **last** place security lives: permission/scope/object checks (steps in `02-AUTHENTICATION-AND-AUTHORIZATION-FLOW.md §5–6`) run before any business code executes.

---

## 3. Service Layer Rules

1. **Transactions:** any multi-document write (see `02-DATABASE-DESIGN.md §6`) runs inside a Mongo transaction via the shared `withTransaction` helper.
2. **Scope enforcement:** services re-verify assignment/ownership even if middleware passed — defense in depth (e.g., appointment service confirms the doctor owns the schedule).
3. **Status transitions:** only via a shared transition table implementation (appointment T-01…T-12; invoice/lab/prescription equivalents) — ad-hoc status writes are forbidden.
4. **Idempotency:** booking and payment services consume `idempotency_keys` atomically with the primary write.
5. **Money:** integer minor units; server-side totals recomputed from lines, never trusted from client.
6. **Audit:** services emit audit events through the audit module — never write `audit_log` directly.
7. **Outbox:** cross-module notifications/events are inserted in the same transaction as the business write; a background processor delivers.

---

## 4. Example Route Declaration (Canonical Style)

```js
// modules/appointments/routes.js
router.post('/',
  requireAuth,
  requirePermission(['appointment.create.any', 'appointment.create.own']),
  requireScope('patient'),
  validate(createAppointmentSchema),
  controller.create
);

router.post('/:id/checkin',
  requireAuth,
  requirePermission('appointment.checkin'),
  validate(idParamSchema),
  controller.checkIn
);
```

Controllers stay thin; all logic lives in services so rules are testable (NFR-34).

---

## 5. Validation Standards

- Schema validation on every write endpoint (shape, types, lengths, enums = canonical statuses).
- Validation errors return `422` with field-level details per the standard envelope (`02-ERROR-HANDLING-AND-VALIDATION.md`).
- Canonical status strings are constants in `config/constants.js` — never inlined magic strings.

---

## 6. Background Jobs

| Job | Purpose | Cadence |
|-----|---------|---------|
| Outbox processor | Deliver notifications/events | Continuous (short interval) |
| Reminder scheduler | Send appointment reminders per policy | Every few minutes |
| Waitlist processor | Offer freed slots | On slot release + periodic |
| Expiry sweep | Quarantine expired batches | Daily |
| Prescription expiry | Mark `EXPIRED` past `validUntil` | Daily |
| Reconciliation helper | Aggregate gateway/cash records for review | Daily/weekly |
| Backup trigger/verify | Per ops schedule | Per `03-BACKUP-AND-DISASTER-RECOVERY.md` |
| Break-glass review alert | Flag unreviewed emergency access (72 h default) | Daily |

Jobs are idempotent, resumable, and logged; they never bypass authorization for user-initiated data — they run as system actors with audited scope.

---

## 7. Coding Standards

- No secrets in code; configuration via env (guidance in `02-DEPLOYMENT-AND-INFRASTRUCTURE.md` §4).
- Errors: thrown as typed domain errors → mapped by the central error handler; handlers never return stack traces.
- Logging: structured (JSON) with request ID; PII minimized; no passwords/tokens ever logged.
- Migrations: versioned scripts for any collection/index change (NFR-32).
- Tests: unit tests for service rules; integration tests for endpoints incl. negative authorization cases (NFR-34).

---

*End of document — Backend Specification v1.0*
