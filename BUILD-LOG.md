# Build Log

> Working log per `docs/09-AI-DEVELOPMENT/01-AI-AGENT-DEVELOPMENT-RULES.md §7`.
> Newest phases at the bottom. Open questions are listed per phase.

---

## Final scan — duplication removal, runtime-bug fixes, department accounts (2026-09-25)

**Status: complete — 129/129 tests green; lint/typecheck/build green (both apps); live E2E verified**

### Bugs found & fixed

1. **Browser booking was broken twice (would fail for every user)**
   - Frontend never sent the mandated `Idempotency-Key` header → every booking from the UI returned `428 IDEMPOTENCY_KEY_REQUIRED`. Fixed in both `PatientAppointmentsPage` and `ReceptionPage` via a shared `utils/booking.ts` (`newIdempotencyKey()`); retries of one attempt reuse the key so the server replays the original result.
   - Booking bodies omitted the required `departmentId` → `422 VALIDATION_ERROR`. The public doctor directory carries only the department NAME, so both pages now resolve name → id through `/public/departments` before posting. Verified live: booking succeeds with key, `428` without.
2. **164 pre-existing TypeScript errors** — every controller called `actorOf(req as unknown as ActorReq)` with a local `ActorReq` alias; the helper demanded the full Express `Request`. Added a structural `ActorRequest` type to `helpers/actor.helper.ts`; controllers now call `actorOf(req)` directly. Typecheck was already failing on main before this session.
3. **Lab custody 500 risk** — `addCustodyEntry` trusted the specimen subdoc's truthiness; Mongoose materializes an empty subdoc, so a custody call on an unrecorded specimen could throw instead of returning `404 NOT_FOUND`. Same leaf-field check as the PH-04 serializer fix now applied.

### Duplication removed

| Item | Resolution |
|---|---|
| `backend/dist/` (308 files) — stale build output from an **old module layout** (`modules/`, `core/`) that no longer matches `src/` | Deleted; `.gitignore` already excludes `dist/` (recreated cleanly by `npm run build`) |
| `createDoctorUser` duplicated `createStaffUser` **and minted a predictable** `ADMIN_PASSWORD-Temp` password | Consolidated into the single audited `createStaffUser`; doctor provisioning (`POST /admin/doctors`) now shares the EP-70 strong-password schema — no default passwords |
| `processOutbox` (platform.service) duplicated `drainQueue` (notification.service) | Single outbox processor remains in notification.service; platform test updated |
| `assertOwnForPatient` was a no-op guard (`void appt; void userId;`) | Now validates its inputs; ownership remains enforced in `getAppointmentForActor` |
| 8 controllers each declared an identical local `ActorReq` type | Removed; shared `ActorRequest` in actor.helper |
| Dead exports: `listForUser` (now test-only), `externalProvidersConfigured`, unused `resourceId()` helper, `void` import hacks in waitlist/slots/pharmacy services | Removed |

### Missing functionality added

- **Department accounts (per-department ID + password)**: new idempotent `scripts/seed-departments.ts` (`npm run seed:departments`, also composed into `npm run seed`) provisions one login per department — General Medicine, Pediatrics, Cardiology, Orthopedics (doctors, with active weekly schedules so booking works immediately), Laboratory, Pharmacy, Front Desk, Nursing, Finance — all `Dept@12345` (dev-only; change before any real deployment). README documents the full table.
- **Department management UI** on the Admin console (create department, toggle public visibility / active) — the backend endpoints existed (EP-71a) but no screen exposed them.
- Dashboard module cards now deep-link to their consoles (they previously rendered "Available in an upcoming phase" with no navigation despite all phases being built).

### Verification evidence

- `npm test` (backend) → **129/129 (19 suites)**
- backend `lint` / `typecheck` / `build` → green; frontend `lint` / `typecheck` / `build` → green
- Live E2E (real mongod replica set :27018 → backend :4000): `/health` 200; **all 10 seeded accounts login 200**; receptionist books a real slot through the fixed flow (`201`); booking without `Idempotency-Key` → `428` as contracted.

### Notes / follow-ups

1. `Dept@12345` and all demo credentials are for local development only; production must rotate every password and set strong `SESSION_SECRET` / `MFA_ENCRYPTION_KEY` (env validation already enforces the latter two).
2. PH-09 staging/UAT items (load tests, a11y scan, restore drill) remain operational work outside the codebase.

---

## Full application scan — gap closure (2026-09-25)

**Status: complete — 3 spec'd endpoints were missing; added + tested; frontend lint wired**

End-to-end scan of all code, docs, and CI surfaced the following gaps, all fixed:

### 1. Missing admin endpoints (docs + catalog already specified them)

`docs/06-API-AND-ERRORS/01-API-DESIGN-STANDARDS.md` §3.9 specified **EP-70/71**
(users/roles) and **EP-74** (backups), and `AUDIT_ACTIONS` already carried
`USER_CREATE`, `USER_UPDATE`, `USER_SUSPEND`, `ROLE_ASSIGN`, `BACKUP_TRIGGER` —
but no routes existed (BUILD-TODOS PH-08 had been ticked in error). Now implemented
in the `admin` module:

| Endpoint | Permission | Behaviour |
|---|---|---|
| `GET /admin/users` | `user.manage` | Paged list, minimum-necessary projection (no password/MFA secrets) |
| `POST /admin/users` | `user.manage` | Provisions a **staff** account (patients self-register, EP-04); audited |
| `PATCH /admin/users/:id` | `user.manage` | Status/staff-profile update; suspending drops the target's sessions |
| `PUT /admin/users/:id/role` | `role.assign` | **Re-authenticates the acting admin** (SEC-11/NFR-41), audits from→to, invalidates the target's sessions (AC-56), blocks self-role change and last-admin lockout |
| `POST /admin/backups` | `backup.manage` | Returns a verifiable backup manifest (per-collection counts + SHA-256 digest), logged (AC-58) |

Frontend: endpoint registry extended and an Admin console section added for users/
roles (create, suspend/reactivate, re-auth role assign) and backups.

### 2. Frontend had no working linter

`frontend/package.json` declared `lint` but shipped no ESLint deps/config, so CI
masked the step with `|| true`. Added `eslint.config.js` (flat config: JS +
TypeScript + react-hooks + react-refresh) and the dev dependencies; the CI lint
step now runs un-masked. Lint passes with 0 warnings.

### 3. Documentation drift corrected

- API Standards: EP-72/73/76/77 paths corrected to the implemented `/platform/*`
mount; EP-75 clarified as the scoped report endpoints actually shipped.
- BUILD-TODOS: PH-04…PH-08 phase gates + the PH-09 security-suite line ticked
  (verified by the passing suites).
- README status: PH-09 broken into done (security suite) vs pending (staging/UAT).

### Verification evidence

- `npm test` (backend) → **129/129 (19 suites)** — +10 admin user/role/backup
- `npm run lint` / `typecheck` / `build` (backend) — green
- `npm run lint` / `build` (frontend) — green (lint now real)

### Notes / follow-ups

1. Backup is a verified **manifest**, not a dump — physical dump/restore stays
   operational per `03-BACKUP-AND-DISASTER-RECOVERY.md` (NFR-38 restore drill is PH-09).
2. Role change requires the acting admin's password in the request body; a
   UI-level re-auth modal is a UX refinement, not a security gap (server-enforced).
3. EP-75 is delivered as the three scoped report endpoints named above rather
   than a single `/reports/*` route; if a unified report router is wanted, it is
   a documentation change first.

---

## PH-09 — Security test suite: IDOR, NoSQL injection, XSS, CSRF (2026-09-25)

**Status: complete — 4 new suites (35 tests); 2 defects found & fixed (PH-09 still open for staging/UAT)**

### What was built (`tests/security/`)

| Suite | Coverage |
|---|---|
| `idor-sweep.test.ts` (13) | Cross-patient and cross-clinician object access end-to-end: foreign actor presents a valid session **and** the route permission, but the record belongs to someone else. Patients: read / summary / update / nursing entries. Clinicians: another doctor's encounter + lab order. Cross-patient lab order. Scoped lists (`lab/orders`, `billing/invoices`, `clinical/prescriptions`) proven not to leak foreign rows; foreign invoice fetch → 404. Denials assert `403` + `security.access_denied` (module-scoped). Positive controls included so the sweep cannot pass vacuously. |
| `nosql-injection.test.ts` (12) | Bodies: `$gt` / `$ne` / `$where` operator objects on login, register, forgot-password → `422 VALIDATION_ERROR`, no session/cookie minted (auth-bypass class). Query strings: bracket-notation operators (`?q[$ne]=`, `?patientId[$ne]=`, `?doctorId[$ne]=`) across 5 list endpoints → no 5xx; regex metacharacters in search escaped. |
| `xss.test.ts` (5) | Script/img payloads stored **verbatim as inert data** (round-trip unchanged); every response that carries them is `application/json` + `X-Content-Type-Options: nosniff` (never `text/html`); helmet CSP `script-src 'self'` present; validation errors and unknown routes do not reflect the payload into markup. |
| `csrf.test.ts` (5) | Session cookie HttpOnly + SameSite=Lax; form-encoded and `text/plain` POSTs cannot forge a patient write **even with the victim's cookie attached** (writes are JSON-only); positive control passes; unauthenticated mutation → 401 and no record. |

### Bugs found & fixed by the new suites

1. **Query-operator deserialization (SEC-17/19)** — Express' default `extended`
   query parser turned `?q[$ne]=` into a Mongo operator object; services then
   called `.replace(...)` or `new Types.ObjectId({...})` → **500** on
   `/patients`, `/lab/orders`, `/billing/invoices`, `/appointments`,
   `/clinical/nursing-entries`. Fixed at the boundary with
   `app.set('query parser', 'simple')` (app.ts) — bracket notation stays a
   literal key, so operators never reach Mongoose. No consumer relied on nested
   query objects.
2. **Malformed id → 500** — `new Types.ObjectId('not-an-objectid')` in list
   filters threw a CastError → 500. Fixed with `core/utils/object-id.ts`
   (`asObjectId`), returning a `422 VALIDATION_ERROR` for invalid ids; applied
   to the appointments, waitlist, platform (audit viewer), billing, clinical,
   and lab list filters.

Also removed an unused `env` import in `scripts/seed-demo.ts` (lint drift).

### Verification evidence

- `npm test` → **119/119 (18 suites)** — was 84; +13 IDOR +12 injection +5 XSS +5 CSRF
- `npm run lint` / `npm run typecheck` / `npm run build` — all green

### Notes / follow-ups

1. IDOR sweep currently covers patients/clinical/lab/billing; pharmacy dispense
   and platform break-glass objects are permission-gated (no `*.own` read path)
   — cross-role object checks there remain for a later pass if the scope model changes.
2. Remaining client-side assertion: React encodes on render by design, but an
   automated component-level XSS encoding test is still ⏳.
3. Still open in PH-09: load tests, a11y scan, restore drill, monitoring,
   staging UAT, deployment.
4. The login suite covers the brute-force limiter only live (`verify-live.mjs`);
   the limiter is intentionally disabled under `NODE_ENV=test`.

---

## PH-09 prep — Dispense concurrency suite + live end-to-end verification (2026-09-24)

**Status: complete (PH-09 remains open — staging/UAT items untouched)**

### Dispense concurrency suite (`tests/integration/dispense-concurrency.test.ts`)

Four invariants proven under parallel load on a real replica set, per-test drug
isolation so FEFO cannot leak stock across tests:

| Invariant | Proof |
|---|---|
| I1 | 4 parallel dispenses of the SAME prescription → exactly one 200; losers get `422 PRESCRIPTION_INVALID`; batch = 100 − 6; `dispensedQty` == ordered; exactly one dispense record |
| I2 | 2 prescriptions race vs exactly-enough stock → persisted qty == 16 − committed deductions, never negative |
| I3 | 6-way race vs 20-unit batch → ≤2 commits; every rejection a business guard (no 500s); ledger exact |
| I4 | Zero-stock drain race → ≤1 drain wins; movement-ledger deltas + received == persisted quantity (no lost/ghost writes) |

Mechanism under test: guarded `quantity >= qty` in-tx update + transaction
re-read — the same pattern as booking's partial unique index.

### Live end-to-end verification (`scripts/verify-live.mjs`, **55/55**)

Drove the REAL stack (mongod replica set :27018 → backend :4000 → vite proxy
:5173) over raw HTTP with cookie sessions:

- Login + `/auth/me` for all 8 roles
- 27 role→dashboard endpoint contract checks (200 own / 403 foreign)
- Full clinical journey **through the Vite proxy, as the browser does**:
  public directory → slots (authenticated) → patient self-books → reception
  confirm → check-in + token → encounter → EMR → prescription → finalize →
  COMPLETED → pharmacy receive + FEFO dispense → invoice → issue → payment → PAID

### Bugs found & fixed by the live run (unit tests missed both)

1. **Receptionist booking flow broken in the browser** — `GET /patients`
   (the ReceptionPage search) returned 403: the route didn't grant
   `patient.create`, which receptionists hold. Booking lookup now granted
   (R-06); minimum-necessary projection unchanged.
2. **Demo environment gaps** (seed, not code): demo doctor lacked
   `staffProfile.department` (directory/booking resolution) and the nurse
   wasn't in the demo patient's care team (nursing scope check). `seed-demo.ts`
   is idempotent and backfills both.

Also: the strict /auth rate limiter correctly 429s repeated smoke runs —
restart the backend to reset (SEC-03 working as designed; the smoke script
surfaces this clearly).

### Verification evidence

- `npm test` → **84/84 (14 suites)** incl. the new concurrency suite
- lint + typecheck (backend & frontend) green; builds green
- Live smoke **55 passed, 0 failed** against the running stack

### Notes / follow-ups

1. The vite proxy forwards `/api/*` only; `/health` stays direct-to-backend —
   the smoke's proxy probe asserts reachability, not the health payload.
2. Slots are authenticated (200-anon → 401); the browser's public info pages
   use the directory, not the slots API — no change needed.
3. IDOR sweep security suite (per earlier request) still pending — next task.

---

## PH-04…PH-08 — Clinical, Lab, Pharmacy, Billing, Platform (2026-09-24)

**Status: complete — phase gates passed**

### What was built

| Phase | Detail |
|---|---|
| PH-04 Clinical | `encounters` (EP-30) as the only door into documentation — created from CHECKED_IN appointments, appointment auto-moves IN_CONSULTATION (T-05) in-tx; EMR draft → finalize → amend with immutable version history (EP-31…34, C-04, AC-23/24); release-to-patient gate (AC-27); prescriptions (EP-35/36) with per-item dispensedQty + validity expiry; nursing entries scoped to care team (PERM-24, R-02, AC-25 — denials audited) |
| PH-05 Laboratory | Orders auto-create billing charges (EP-40, AC-34); specimen recording + chain-of-custody append (EP-41, AC-29); result entry (PERM-32) ≠ verification (PERM-33) enforced server-side — same person cannot verify (AC-30/31); critical detection from per-test thresholds → alert → mandatory ack before release → escalation sweep (EP-46, AC-32); release status-gated on VERIFIED (AC-31); amendments version + clear verification for re-verification (EP-45, AC-33); patients see RELEASED + releasedToPatient only (NFR-17, AC-30) |
| PH-06 Pharmacy | Validation gauntlet inside the dispense tx (EP-50/51, AC-35): status/validity/duplicate/stock checks must all pass; FEFO batch pick (earliest expiry first, expired + quarantined blocked — AC-37/40); guarded `quantity >= qty` update makes negative stock impossible under concurrency (AC-38); dispense record + prescription status (PARTIALLY/FULLY_DISPENSED) + billing charge in ONE transaction (AC-36); inventory receipts/adjustments (reason mandatory, audited) / quarantine / recall (EP-52…54, AC-41); expiry sweep + daily prescription EXPIRED sweep (EP-55, AC-42) |
| PH-07 Billing | Charge consolidation → DRAFT → ISSUED (immutable, SEC-26, AC-43/44); payments idempotent via scoped idempotency keys — replay returns the ORIGINAL payment record (SEC-23, AC-45/47); exact outstanding computation + PARTIALLY_PAID/PAID transitions per Glossary §13.2 (AC-46); overpay rejected `PAYMENT_EXCEEDS_BALANCE`; refunds gated by PERM-54 + audited (AC-48); discounts with mandatory reason; reconciliation totals (EP-67, AC-49); gateway webhook signature-verified — unsigned → `400 WEBHOOK_SIGNATURE_INVALID` + audited DENIED (SEC-25); integer minor units everywhere, server-computed totals (C-02) |
| PH-08 Platform | Outbox processor with channel adapters gated on provider env (A-04, AC-52/53); in-app notification list; settings/policy engine hot-applies facility overrides through `setPolicyOverrides` (EP-72, A-07, AC-57); audit viewer with role-filtered access — admin all / doctor own events (EP-73); break-glass: mandatory ≥10-char reason, 60-min window, immediate admin alerts, revoke, expiry sweep, review flow (EP-76/77, AC-60/61) |

### Frontend

- New feature pages: Clinical (encounters/EMR/prescriptions), Lab (order pipeline + patient released view), Pharmacy (queue/FEFO dispense/inventory), Billing (invoices/payments/reconciliation), Admin (policy/audit/break-glass)
- Permission-driven sidebar sections; endpoints registry extended for EP-30…77

### Verification evidence

- `npm test` → **80/80 (13 suites)** — PH-04: 7, PH-05: 7, PH-06: 8, PH-07: 9, PH-08: 6 + all 43 prior
- lint + typecheck + backend build + frontend build all green

### Bugs found & fixed during PH-04…08 verification

1. **Lab serializer 500** — Mongoose materializes an empty `specimen` subdocument, so truthiness check passed while `collectedAt` was undefined → `toISOString()` threw. Fixed by checking the leaf field.
2. **Re-verification path** — `verifyResults` only accepted RESULT_ENTERED; amended orders (AMENDED) could never be re-verified/re-released (AC-33 dead end). Fixed.
3. **Webhook audit actor** — `actorId: 'gateway'` violated the ObjectId schema cast; moved identity context into `details`.
4. **Notification union too narrow** — PH-05+ events rejected by the PH-03 payload type; extended to a cross-module `NotificationEvent` union with an index-signature payload.

### Notes / follow-ups

1. PH-09 (hardening & release: IDOR sweep, load tests, a11y, restore drill, UAT) remains open — requires staging environment and facility sign-off.
2. Dispense pricing uses the drug catalog `unitPriceMinor` (seam documented in code); a purchase-order/procurement subledger is out of scope (X-xx).
3. Gateway signature is a deterministic sandbox digest behind `gatewaySignature()` — the production HMAC adapter swaps in at that seam (A-04).

---

## PH-03 — Patients & Appointments (2026-09-24)

**Status: complete — phase gate passed**

### What was built

| Area | Detail |
|---|---|
| Spec layout | Backend Spec §1 structure completed: `errors/index.ts` barrel, `scope.middleware.ts` (role→scope tagging, layer 1), `request-id.middleware.ts` extracted, `core/policies/policy.loader.ts` (A-07 seam; `settings` collection overrides land PH-08/EP-72), `jobs/` runner (notifications drain + reminders), `core/db/migrations/` + `tests/security/` + `tests/api/` placeholders, `integrations/` note (PH-07/08 adapters) |
| Policy loader | Booking horizon / cancellation window / no-show grace / waitlist offer / reminder lead now resolve through `getPolicy()` (never hard-coded; A-07); env `REMINDER_LEAD_HOURS`, `NOTIFICATION_DRAIN_SECONDS`, `REMINDER_SWEEP_MINUTES` added |
| Reminders | `sendDueReminders()` — one reminder per appointment (de-dup via partial unique index scoped to `appointment.reminder`), privacy-trimmed payload (NFR-16/AC-20); background runner started/stopped with server |
| Concurrency | `ensureIndexes()` at boot + in test harness: unique partial `uniq_active_slot` guaranteed before first write |
| Cancel | T-09 now releases the slot (`activeSlot=false`) in-tx — cancelled appointments no longer occupy capacity at the uniqueness layer |
| No-show | T-11 grace-period policy enforced (before grace → `422 POLICY_WINDOW`); test simulates past slot |
| Confirm | REQUESTED → SCHEDULED (T-02) auto-stepped inside confirm (slot was already allocated/verified at booking) so the single Confirm action matches the UI while every write still passes the transition table |
| Lists | EP-22 list endpoints serialize + preserve populated doctor/department display fields (frontend contract) |

### Verification evidence

- `npm test` → **43/43** (8 suites) incl. parallel-booking race: exactly one 201, loser `409 SLOT_TAKEN`, zero orphan docs
- lint + typecheck + backend build + frontend build all green

### Bugs found & fixed during PH-03 verification

1. **`activeSlot` missing from the Mongoose schema** — Mongoose stripped the undeclared field on save, so the partial unique index matched nothing: true double-booking was possible under concurrency (AC-15 silently violated; sequential tests masked it via the read re-check).
2. Sparse vs partial compound index: the first reminder de-dup index used `sparse`, which still indexed non-reminder docs sharing `userId+event` → E11000 surfaced as `409 DUPLICATE_REQUEST` on every second booking by the same patient. Replaced with a `partialFilterExpression` scoped to reminder events.
3. Cancel path never released the slot (see above).
4. `patients.test.ts` referenced an undeclared `adminAgent` (suite failed at file level); fixed + added an admin-projection test.

### Notes / follow-ups

1. Outbox stack (full) + email/SMS adapters remain PH-08 (A-04); reminders are in_app-only until then (AC-52 path already honored).
2. T-10 (approved-exception cancel of CHECKED_IN) is in the table but has no endpoint — deferred with PH-04 admin flows per plan wording.
3. Per-facility policy overrides via `settings` collection land with EP-72 (PH-08); `policy.loader.setPolicyOverrides()` is the seam.

---

## PH-02 — Authentication & RBAC Core (2026-09-22)

**Status: complete — phase gate passed**

### What was built

| Area | Detail |
|---|---|
| EP-05/06 | `forgot-password` (neutral response, both paths audited) + `reset-password` (single-use SHA-256-hashed token, 30 min TTL, strong-password validation, invalidates ALL user sessions via store cleanup) |
| EP-07 | MFA enroll/verify: RFC 6238 TOTP (Node crypto only, no new deps), ±1 step drift, constant-time compare, secret encrypted at rest (AES-256-GCM), secret shown once during enrollment, `mfaPending` session gate blocks ALL `/api/v1` except `/auth/mfa/*` and `/auth/logout` until complete (SEC-04, AC-07) |
| Sessions | Idle timeout via `lastActivityAt` stamp (default 30 min, `SESSION_IDLE_MINUTES`) + 12 h absolute via store TTL; enforced in `requireAuth` (SEC-06, NFR-11, AC-08) |
| MFA policy | `MFA_REQUIRED_ROLES` env (default `admin`); non-privileged roles unaffected — verified by tests |
| Privacy | Public directory projection fixed: no emails/personal contacts; availability summary (weekdays from active schedules) instead (AC-62, EP-09) |
| Ownership | `ownership.middleware.ts` object-level decision helper for PH-03+ record checks (SEC-08, R-09) |
| Frontend | MFA setup/verify step in login flow (secret shown once, code entry), forgot/reset pages, routes wired |
| Tests | 22 total: TOTP unit vectors + drift; forced-MFA gate (enroll→verify→unblock, wrong code keeps gate); recovery neutrality (known vs unknown identical); forged role/permission fields ignored (AC-09); idle expiry simulation |

### Verification evidence

- `npm test` → 22/22 (5 suites); lint + typecheck green; frontend build green
- Live smoke: registration → patient role only; forgot-password identical for known/unknown; admin login → `MFA_REQUIRED` on admin APIs; enroll → verify with computed TOTP → 200 on admin APIs; fresh login → `enrolled:true` (code-only step)
- `audit_log` records mfa_enroll, mfa_verify, mfa_verify_failed, password_reset_requested, register

### Notes / follow-ups

1. Reset-token delivery: dev logs the token server-side (non-production only); SMTP adapter arrives with the notifications stack in PH-08 (A-04).
2. `ghost@x.y`-style syntactically invalid emails are rejected by format validation before the neutral path — a negligible enumeration surface; revisit if pen-test flags it.
3. MFA secret encryption key currently env-based (`MFA_ENCRYPTION_KEY`); KMS integration is an ops concern for PH-09.

---

## PH-01 — Foundation (2026-09-22)

**Status: complete — phase gate passed**

### What was built

| Area | Detail |
|---|---|
| Monorepo | `backend/` (Express + TS + Mongoose, ESM) + `frontend/` (React 18 + Vite + TS + Tailwind), per Backend Spec §1 / Frontend Spec §1 |
| Config | `env.ts` (zod-validated, fail-fast), `constants.ts` (canonical statuses Glossary §13 + full permission catalog PERM-01…68 + error codes), `logger.ts` (pino + redaction), `database.ts` (replica-set connection), `security.ts` (helmet, CORS allowlist, HTTP-only SameSite cookie sessions, 12 h store TTL) |
| Core | error envelope + catalog-driven `AppError`, validate middleware (zod → 422 field details), rate limiters (global + strict /auth), `withTransaction` helper, response/pagination/async-handler utils, Argon2id hash utils incl. dummy-verify (anti-enumeration timing) |
| Modules | `audit` (append-only model + single-writer service, secret sanitizing), `auth` (User/Role models, requireAuth loading permissions from DB, login/logout/me/register with generic failures + audit), `admin` (departments, doctor_schedules, schedule_exceptions, doctor users — full CRUD, permission-declared routes, audited) + public directory EP-08/09 |
| Seeds | roles ← catalog (`permissionsForRole`), bootstrap admin from env, 6 sample departments; idempotent |
| Frontend | public site (Home/Departments/Emergency/Appointment Info), login + patient registration (memory-only AuthContext), dashboard shell with permission-driven sidebar, axios client with auto-401 redirect, Vite proxy to :4000 |
| CI | GitHub Actions: backend lint/typecheck/tests(build)/audit + frontend typecheck/build/audit |
| Tests | 7 integration tests (health envelope, auth flows incl. anti-enumeration parity, 401/403 paths) |

### Verification evidence

- `npm run lint` / `npm run typecheck` / `npm test` → all green (7/7)
- `npm run build` → `dist/server.js`
- Seed verified in DB: 8 roles with catalog-derived permission counts (admin 15, patient 10, …)
- Live smoke: `/health` OK; EP-08 public directory; login → permissions; admin list paginated; no-session → 401 `SESSION_EXPIRED`; wrong password → generic 401 `INVALID_CREDENTIALS`
- `audit_log` shows `auth.login` SUCCESS + `auth.login_failed` FAILED entries
- Mongo transactions verified on the replica set (session commit path)
- `npm audit` → 0 high/critical (2 moderate dev-only vitest advisories; tracked below)

### Deviations & notes

- **MongoDB replica set:** system mongod was standalone and sudo required; running user-space `mongod --replSet rs0` on port 27018 (`MONGO_URI` default in `.env.example` and README instructions). No security rules bypassed.
- **vitest 3:** pinned to avoid the moderate `@vitest/mocker` advisories in 4.x; upgrade to vitest 5 planned in PH-09 hardening.
- **Session model note:** connect-mongo TTL gives 12 h absolute; the 30 min idle timeout (NFR-11) needs touch-based enforcement and is planned early in PH-02.
- **EP-04 register:** creates the patient *account*; the linked `patients` record + consents arrive in PH-03 per plan.

### Open questions (none blocking PH-02)

1. Appointment numbers (`appointmentNo` policy: per-facility/day) — needs a decision before PH-03 booking work.
2. MFA secret encryption key management (KMS vs env-derived) — needed before privileged-role MFA enrollment in PH-02.

---

*End of build log entry — PH-01*
