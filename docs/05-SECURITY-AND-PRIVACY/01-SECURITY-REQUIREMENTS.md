# 01 — Security Requirements

> **Document:** Mandatory security requirements and the universal secure request pipeline for the HMS
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** Developers and AI coding agents
> **Related documents:** `02-AUTHENTICATION-AND-AUTHORIZATION-FLOW.md`, `02-PRIVACY-AND-DATA-PROTECTION.md`, `03-AUDIT-LOGGING-AND-MONITORING.md`
> **Rule:** These controls are release blockers. A feature that cannot meet them is not shipped.

---

## 1. Universal Secure Request Pipeline

Every protected API operation — patient registration, appointments, EMR, lab, pharmacy, billing, admin — passes this pipeline in order. Skipping any step is a defect.

```text
1. FRONTEND REQUEST      React app / approved client only
2. TRANSPORT + INPUT     HTTPS/TLS only; size limits; header hardening
3. AUTHENTICATION        Valid session/token; user + permissions loaded server-side
4. AUTHORIZATION         RBAC (PERM-xx) + object-level + scope checks
5. BUSINESS RULES        Ownership, workflow status, policy constraints
6. DATABASE TRANSACTION  Consistent, controlled write (where multi-doc)
7. AUDIT + RESPONSE      Record event; return minimum-necessary data
```

---

## 2. Security Requirements Catalog

### 2.1 Identity & Authentication

| ID | Requirement |
|----|-------------|
| SEC-01 | Passwords hashed with Argon2id; constant-time verification; no reversible storage (C-07). |
| SEC-02 | Generic authentication errors; no account enumeration on login or recovery (FR-06). |
| SEC-03 | Rate limiting on login/reset/sensitive endpoints; temporary lockout after repeated failures (NFR-10). |
| SEC-04 | MFA required for privileged users before dashboard access (FR-07). |
| SEC-05 | Self-registration grants only the `Patient` role; staff roles are admin-assigned (FR-05). |
| SEC-06 | Sessions: HTTP-only, Secure, SameSite cookies; idle + absolute expiry; server-side invalidation on logout/password/role change (NFR-11). |

### 2.2 Authorization

| ID | Requirement |
|----|-------------|
| SEC-07 | Authorization derived solely from server-loaded permissions — never from client-supplied role/user fields (C-02). |
| SEC-08 | Object-level checks on every record access: changing/guessing IDs must not reveal another patient's data (R-09, NFR-09). |
| SEC-09 | Scope rules (R-01…R-10) applied on top of permissions; enforced in middleware **and** services. |
| SEC-10 | Admin access does not grant clinical-note content; only demographics/admin surfaces (R-06) — exceptions only via break-glass. |
| SEC-11 | Permission/role/policy changes require re-authentication and are audited (NFR-41). |

### 2.3 Data Protection

| ID | Requirement |
|----|-------------|
| SEC-12 | TLS for all transport; HTTP redirected/rejected; HSTS enabled (NFR-07). |
| SEC-13 | Encryption at rest for databases/backups (NFR-14); secrets only via environment/secret store, never in code (NFR-31). |
| SEC-14 | Minimum-necessary responses: field projections per role (C-09, NFR-15). |
| SEC-15 | File attachments/reports served through authorized endpoints with access checks — no public static URLs for patient data. |
| SEC-16 | Uploads: type/size validation, malware scanning where feasible, sanitized storage names. |

### 2.4 Application Hardening

| ID | Requirement |
|----|-------------|
| SEC-17 | Input validation on every write (schema-level); canonical enums only. |
| SEC-18 | Output encoding; XSS-safe rendering; CSP headers. |
| SEC-19 | Parameterized queries / ORM usage — no string-built queries (NoSQL injection prevention). |
| SEC-20 | CSRF protection for cookie-based sessions (SameSite + token where needed). |
| SEC-21 | Security headers: CSP, X-Content-Type-Options, X-Frame-Options/DENY, Referrer-Policy. |
| SEC-22 | Dependency scanning in CI; no high/critical vulnerabilities at release. |

### 2.5 Financial & Operational Integrity

| ID | Requirement |
|----|-------------|
| SEC-23 | Idempotency keys for payments and bookings; duplicates impossible (C-06). |
| SEC-24 | Payment success only from verified gateway confirmation or authorized manual recording (FR-41). |
| SEC-25 | Webhook signature verification for gateways; reject unsigned/mismatched callbacks. |
| SEC-26 | Issued invoices immutable except audited amendments/credit notes (C-04). |
| SEC-27 | Audit log append-only; tamper attempts blocked and alerted (NFR-12). |
| SEC-28 | Backups encrypted and access-restricted; restore drills per ops doc (NFR-38). |

---

## 3. Threat Model Highlights (What We Defend Against)

| Threat | Control |
|--------|---------|
| IDOR (record ID guessing) | SEC-08 object-level checks; automated IDOR tests |
| Privilege escalation via client tampering | SEC-05, SEC-07 |
| Credential stuffing | SEC-01, SEC-03 |
| Account discovery | SEC-02 |
| Session theft | SEC-06, SEC-20, SEC-21 |
| SQL/NoSQL injection | SEC-17, SEC-19 |
| XSS | SEC-18, SEC-21 |
| Payment fraud/duplicate charges | SEC-23, SEC-24, SEC-25 |
| Insider snooping | SEC-09, SEC-10, audit + break-glass oversight |
| Log tampering | SEC-27 |
| Data loss | SEC-28 + DR doc |

---

## 4. Security Testing Gate (Before Release)

1. All SEC-xx controls implemented and code-reviewed.
2. Automated security test suite passes (authz negative cases, IDOR, rate limits, idempotency).
3. Dependency audit clean of high/critical findings.
4. Penetration test or structured self-assessment completed and criticals fixed.
5. Security checklist (Section 2) signed off in `03-DEFINITION-OF-DONE.md`.

---

*End of document — Security Requirements v1.0*
