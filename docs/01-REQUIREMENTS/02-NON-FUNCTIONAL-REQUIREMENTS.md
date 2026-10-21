# 02 — Non-Functional Requirements

> **Document:** Non-functional requirements (quality attributes) for the HMS
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** Developers and AI coding agents
> **Related documents:** `01-FUNCTIONAL-REQUIREMENTS.md`, `01-SECURITY-REQUIREMENTS.md`, `02-DEPLOYMENT-AND-INFRASTRUCTURE.md`
> **Rule:** NFRs are testable targets, not aspirations. Each NFR includes how it is verified.

---

## 1. How to Read This Document

- Requirements are numbered `NFR-xx` and grouped by quality attribute.
- Each requirement states a **measurable target** and a **verification method**.
- `MUST` = release blocker · `SHOULD` = strongly expected · `MAY` = optional.
- Defaults below apply unless the facility overrides them via configuration (A-07).

---

## 2. Performance

| ID | Requirement | Target | Verification |
|----|-------------|--------|--------------|
| NFR-01 | API response time for standard reads (lists, dashboards) | ≤ 500 ms at p95 under normal load | Load test |
| NFR-02 | API response time for writes (booking, invoicing, dispensing) | ≤ 1,000 ms at p95 | Load test |
| NFR-03 | Public page first contentful paint | ≤ 2.5 s on 3G-class connection | Frontend audit |
| NFR-04 | Concurrent users supported without degradation | 200+ concurrent sessions (sized for a single facility) | Load test |
| NFR-05 | Double-booking protection must hold under concurrent booking attempts on the same slot | 0 duplicate bookings in concurrent test | Concurrency test |

## 3. Security

| ID | Requirement | Target | Verification |
|----|-------------|--------|--------------|
| NFR-06 | Passwords hashed with Argon2id (or approved equivalent); no reversible storage | 100% of accounts | Code review + DB audit |
| NFR-07 | All transport encrypted via HTTPS/TLS; plain HTTP rejected | 100% of endpoints | Config audit |
| NFR-08 | Authorization re-checked server-side on every protected request; zero client-trusted role/user IDs | 0 violations | Penetration test |
| NFR-09 | Object-level access: changing a record ID in a request must never grant access to another patient's data | 0 unauthorized reads | Automated IDOR test suite |
| NFR-10 | Rate limiting on login, password reset, and sensitive endpoints | Configurable; default: 5 failed logins → temporary lock | Security test |
| NFR-11 | Session idle timeout and absolute lifetime enforced | Default: 30 min idle / 12 h absolute | Test |
| NFR-12 | Audit logs are append-only; modification or deletion attempts blocked and alerted | 0 successful tampering | Security test |
| NFR-13 | Payment and booking operations are idempotent | Retries produce no duplicates | Integration test |

## 4. Privacy & Data Protection

| ID | Requirement | Target | Verification |
|----|-------------|--------|--------------|
| NFR-14 | Patient data encrypted at rest (database/disk level) | 100% of stores | Infrastructure audit |
| NFR-15 | API responses return minimum-necessary fields per role | 0 over-exposed fields | API contract tests |
| NFR-16 | Reminders and external notifications contain no diagnoses or clinical details | 100% compliant | Content review |
| NFR-17 | Unverified lab results are never exposed to patients | 0 violations | Access test |
| NFR-18 | Data retention and deletion follow facility policy and applicable law | Configurable retention | Policy review |

## 5. Availability & Reliability

| ID | Requirement | Target | Verification |
|----|-------------|--------|--------------|
| NFR-19 | System availability during facility operating hours | ≥ 99.5% monthly | Monitoring |
| NFR-20 | Recovery Point Objective (RPO) — maximum data loss after failure | ≤ 24 h (daily backups; more frequent if configured) | Restore drill |
| NFR-21 | Recovery Time Objective (RTO) — maximum restoration time | ≤ 4 h | Restore drill |
| NFR-22 | Public emergency information page remains reachable during internal system degradation | Served independently of auth/database-heavy paths | Failover test |
| NFR-23 | Scheduled maintenance windows communicated in advance; no silent restarts during operating hours | 100% compliance | Operations review |

## 6. Usability & Accessibility

| ID | Requirement | Target | Verification |
|----|-------------|--------|--------------|
| NFR-24 | Responsive UI on desktop, tablet, and mobile browsers | All primary flows usable at 360 px width | UI test |
| NFR-25 | Critical flows (booking, check-in, dispensing, payment) completable in ≤ 5 steps from the role dashboard | Walkthrough audit | UX review |
| NFR-26 | Form validation messages are specific, human-readable, and never expose system internals | 100% of forms | Review |
| NFR-27 | Accessibility baseline: keyboard navigation, labels, contrast, and semantic HTML (WCAG 2.1 AA-oriented) | Pass automated audit | Accessibility scan |
| NFR-28 | Interface language is plain and consistent with the glossary terminology | 100% usage | Review |

## 7. Maintainability & Architecture

| ID | Requirement | Target | Verification |
|----|-------------|--------|--------------|
| NFR-29 | Modular monolith with strict module boundaries; no cross-module database writes | 0 violations | Code review |
| NFR-30 | All business rules server-side; frontend contains no authorization logic | 0 violations | Code review |
| NFR-31 | Configuration via environment variables; no secrets in code or repository | 0 secrets committed | Repo scan |
| NFR-32 | Database schema changes are versioned and repeatable (migrations) | 100% of changes | CI check |
| NFR-33 | Code passes linting and type checks with zero errors before merge | 0 errors | CI check |
| NFR-34 | Every module has unit tests for business rules; critical paths have integration tests | ≥ 80% coverage of business rules | CI check |

## 8. Auditability & Operations

| ID | Requirement | Target | Verification |
|----|-------------|--------|--------------|
| NFR-35 | Audit events recorded for all actions listed in FR-54, including actor, action, resource, timestamp, and outcome | 100% coverage | Audit test suite |
| NFR-36 | Logs and monitoring available to Admin; audit logs retained per policy (default ≥ 1 year) | Retention met | Operations review |
| NFR-37 | Health check endpoint and alerting for service and database failures | Alerts fire in test | Failover test |
| NFR-38 | Backups automated, tested by restore drills, and stored securely | Quarterly drill pass | DR drill |

## 9. Compliance & Governance

| ID | Requirement | Target | Verification |
|----|-------------|--------|--------------|
| NFR-39 | The system supports the facility's regulatory obligations (privacy law, medical record retention); specifics are configured per A-09 | Policy matrix completed | Legal review |
| NFR-40 | Break-glass access events are reviewed by oversight staff within a defined period (default 72 h) | 100% reviewed | Admin report |
| NFR-41 | Role changes, permission changes, and policy changes require re-authentication and are audited | 100% compliance | Audit review |

---

## 10. Verification Summary

| NFR group | Verified by |
|-----------|-------------|
| Performance (01–05) | Load and concurrency tests |
| Security (06–13) | Penetration tests, code review, security test suite |
| Privacy (14–18) | Contract tests, content review, infrastructure audit |
| Availability (19–23) | Monitoring, failover and restore drills |
| Usability (24–28) | UX review, accessibility scan |
| Maintainability (29–34) | CI checks, code review |
| Audit & Ops (35–38) | Audit tests, operations review, DR drills |
| Compliance (39–41) | Legal/policy review, admin reports |

---

*End of document — Non-Functional Requirements v1.0*
