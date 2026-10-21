# 05 — Frameworks and Technologies

> **Document:** Approved technology stack and library choices for the HMS
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** Developers and AI coding agents
> **Related documents:** `01-ARCHITECTURE-AND-DATA-FLOW.md`, `03-FRONTEND-SPECIFICATION.md`, `04-BACKEND-SPECIFICATION.md`
> **Rule:** Use the approved stack. Adding a new dependency requires justification in the implementation notes — do not add libraries for convenience alone.

---

## 1. Core Stack (MERN)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 18+ (SPA) | Vite-based build; TypeScript recommended |
| Routing | React Router | Protected routes + permission guards |
| Backend | Node.js 20+ LTS | Express 4/5 |
| Database | MongoDB 7+ | **Replica set** (transactions required) |
| Driver | Official MongoDB Node driver or Mongoose | Choose one; Mongoose acceptable for schema discipline |

---

## 2. Library Choices by Concern

| Concern | Approved choice (or equivalent) | Why |
|---------|-------------------------------|-----|
| Password hashing | `argon2` (Argon2id) | Requirement C-07 |
| Session/cookies | `express-session` + connect-mongo, or signed HTTP-only JWT cookies | Session model rules; never localStorage tokens |
| Validation | `zod` (or `joi`/`express-validator`) | One schema system, mirrored to client |
| Security headers | `helmet` | Standard hardening |
| CORS | `cors` with explicit allowlist | No wildcard in production |
| Rate limiting | `express-rate-limit` (+ store for multi-instance) | NFR-10 |
| HTTP client (frontend) | `axios` or `fetch` wrapper | Auto-401 handling |
| Server data cache (frontend) | TanStack Query | Cache/invalidate patterns |
| Forms (frontend) | React Hook Form (+ zod resolver) | Mirror server validation |
| Charts/reports | Recharts (or similar) | Dashboards |
| PDF generation (invoices/lab reports) | Server-side lib (e.g., pdfkit/puppeteer) | Authorized download endpoints only |
| Notifications | Pluggable adapters: SMTP (`nodemailer`), SMS provider SDK | A-04; providers configurable |
| Payments | Facility-selected gateway SDK (A-03) | Webhook signature verification mandatory |
| Logging | `pino` (+ pino-http) | Structured JSON logs |
| Process management | PM2 / systemd / container runtime | Per deployment doc |
| Testing | `vitest`/`jest` + `supertest` (+ `mongodb-memory-server`) | NFR-34 |
| Lint/format | `eslint` + `prettier` | NFR-33 |

---

## 3. Version & Upgrade Policy

1. Pin major versions in `package.json`; lockfiles committed.
2. Use LTS/runtime versions; avoid experimental features.
3. Dependency updates: monthly review; security updates applied promptly (audit in CI).
4. `npm audit` (or equivalent) must pass without high/critical findings before release.

---

## 4. Prohibited / Avoid

| Avoid | Reason |
|-------|--------|
| Client-stored credentials/tokens in `localStorage` | Session security model (§4 of auth flow doc) |
| Floats for money | Rounding defects; use integer minor units |
| Direct DB access from frontend | Architecture boundary |
| Unvalidated `eval`/dynamic code execution | Security |
| Wildcard CORS in production | Attack surface |
| Client-side authorization libraries as the security gate | Server is the only gate (C-02) |
| Hard-coded policy values (cancellation windows, timeouts) | Must be configurable (A-07) |

---

## 5. Environment Matrix

| Environment | Purpose | Data |
|-------------|---------|------|
| Local | Development | Seed/fake data only |
| Test/CI | Automated tests | In-memory/ephemeral DB |
| Staging | Pre-production rehearsal, UAT | De-identified data |
| Production | Live facility operation | Real patient data (full controls) |

Details: `02-DEPLOYMENT-AND-INFRASTRUCTURE.md`.

---

*End of document — Frameworks and Technologies v1.0*
