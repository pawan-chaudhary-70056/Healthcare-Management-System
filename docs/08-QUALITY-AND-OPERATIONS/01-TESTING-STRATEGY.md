# 01 — Testing Strategy

> **Document:** How the HMS is tested before release and during development
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** QA, developers, and AI coding agents
> **Related documents:** `03-ACCEPTANCE-CRITERIA.md` (source of test cases), `02-NON-FUNCTIONAL-REQUIREMENTS.md` (targets), `03-DEFINITION-OF-DONE.md`
> **Rule:** Acceptance criteria (AC-xx) are the tests. A feature without passing AC tests is not done.

---

## 1. Test Levels

| Level | Scope | Tooling (or equivalent) | Gate |
|-------|-------|------------------------|------|
| Unit | Services, business rules, transition tables, money math | vitest/jest | ≥ 80% coverage of business rules (NFR-34) |
| Integration | Endpoints with DB (in-memory Mongo): happy path + authz negatives | supertest + mongodb-memory-server | Every EP-xx has positive + negative tests |
| Concurrency | Parallel bookings, parallel payments | Scripted parallel requests | 0 duplicates (NFR-05, AC-15, AC-45) |
| Security | IDOR, privilege escalation, rate limits, injection, session | Dedicated suite + dependency audit | All SEC-xx pass |
| Frontend | Component tests; critical-path E2E | Testing Library; Playwright | Booking→bill E2E green |
| UAT | Facility staff rehearsal on staging | Manual scripts from workflows | Sign-off |
| NFR | Load, restore drills, accessibility | k6/autocannon; restore script; a11y scanner | Targets in NFR doc met |

---

## 2. Mandatory Test Cases by Module

### 2.1 Auth & Access
- Correct/wrong credentials → 200 / generic 401 (AC-04)
- Recovery with registered/unregistered email → identical response (AC-06)
- Self-registration cannot select staff roles (AC-05)
- Forged role header/body ignored (AC-09)
- Forged/guessed patient ID → 403 + audit (AC-12)
- Idle timeout forces re-auth (AC-08)
- Privileged login without MFA blocked (AC-07)

### 2.2 Appointments
- Concurrent bookings same slot → exactly one success (AC-15)
- Same idempotency key retry → no duplicate (AC-16)
- Full lifecycle per T-01…T-12 incl. invalid transitions → 422
- Check-in issues token; queue order correct (AC-17)
- Reminder content has no clinical detail (AC-20)
- Doctor sees own schedule only (AC-21)

### 2.3 Clinical
- Encounter requires CHECKED_IN appointment (AC-22)
- Finalized record edit → 422; amend flow works with version history (AC-23/24)
- Patient sees only released data (AC-27)

### 2.4 Laboratory
- Unverified result invisible to patient (AC-30)
- Verify → release order enforced (AC-31)
- Critical alert + acknowledgment recorded (AC-32)
- Amendment preserves original (AC-33)
- Order auto-creates charge (AC-34)

### 2.5 Pharmacy
- Expired batch blocked (AC-37)
- Stock never negative (AC-38)
- FEFO suggestion correct (AC-39)
- Quarantined/recalled batch blocked (AC-40)
- Unauthorized adjustment rejected; authorized audited (AC-41)
- Dispense creates charge (AC-42)

### 2.6 Billing
- Issue → silent edit blocked (AC-44)
- Idempotent payment (AC-45)
- Partial payment balance exact (AC-46)
- Client "success" claim without gateway proof ignored (AC-47)
- Unauthorized refund rejected; authorized recorded (AC-48)
- Reconciliation lists discrepancies (AC-49)

### 2.7 Admin & Audit
- Role change audited + forces re-auth (AC-56)
- Policy change enforced without deploy (AC-57)
- Audit entries immutable via app (AC-59)
- Break-glass: reason required, time-limited, reviewed (AC-60/61)

---

## 3. Security Test Suite (Minimum)

| Test | Expectation |
|------|-------------|
| IDOR sweep over record endpoints with foreign IDs | 403 + audit entry |
| Role tampering (cookies/body) | Ignored; server permissions win |
| Brute-force login | Rate limited/locked (NFR-10) |
| NoSQL injection payloads | Rejected by validation (SEC-17/19) |
| XSS payloads in text fields | Stored safe, rendered encoded |
| Session cookie flags | HTTP-only, Secure, SameSite verified |
| Webhook without signature | Rejected (SEC-25) |
| Money replay (same key) | Single record (SEC-23) |
| Unverified result access as patient | 403/404 (SEC-08 + privacy) |

---

## 4. Environments & Data

| Environment | Data rule |
|-------------|-----------|
| Unit/CI | Ephemeral in-memory DB; seed fixtures |
| Staging | De-identified data only — never production copies with real patients (NFR-14/18) |
| Production | No testing against production; read-only smoke checks after deploy |

---

## 5. Release Test Gate

1. All CI suites green (unit, integration, security, E2E).
2. All applicable AC-xx verified for shipped features.
3. Concurrency suite: zero duplicate bookings/payments.
4. Dependency audit: no high/critical.
5. NFR spot-checks: response times, accessibility scan.
6. UAT sign-off recorded for release scope.

Failures block release — no partial credit (see `03-DEFINITION-OF-DONE.md`).

---

*End of document — Testing Strategy v1.0*
