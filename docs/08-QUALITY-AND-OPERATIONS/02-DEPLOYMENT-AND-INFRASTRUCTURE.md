# 02 — Deployment and Infrastructure

> **Document:** Environments, topology, CI/CD, configuration, and release operations for the HMS
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** DevOps, developers, and AI coding agents
> **Related documents:** `05-FRAMEWORKS-AND-TECHNOLOGIES.md §5`, `03-BACKUP-AND-DISASTER-RECOVERY.md`, `03-AUDIT-LOGGING-AND-MONITORING.md`
> **Rule:** No secrets in code or images. Production changes only through the documented release procedure.

---

## 1. Environments

| Environment | Purpose | Data | Access |
|-------------|---------|------|--------|
| Local | Development | Seed/fake | Developers |
| CI | Automated tests | Ephemeral | Pipeline only |
| Staging | UAT + release rehearsal | De-identified only | Team + facility testers |
| Production | Live operation | Real patient data | Restricted; change-controlled |

---

## 2. Topology (Single Facility)

```text
Internet
   │ TLS (reverse proxy: nginx/traefik — HSTS, cert management)
   ▼
[Static React build]  ← served same origin (or CDN) 
   │ /api/*
   ▼
[Express app] ×(1..n instances behind proxy)
   │
   ▼
[MongoDB replica set — 3 nodes: transactions + failover]
   │
   ├── [Outbox/reminder worker] (same codebase, worker mode)
   ├── [Backup scheduler → encrypted off-site storage]
   └── [Logs/monitoring → ops dashboard + alerts]
```

- Payment gateway / email / SMS: **outbound-only** HTTPS integrations; webhooks enter only via signed endpoints (SEC-25).
- Public emergency page must remain reachable under internal degradation (NFR-22): static-served content independent of app/DB.

---

## 3. CI/CD Pipeline

```text
Push/PR → lint + typecheck (NFR-33)
       → unit + integration tests (NFR-34)
       → security tests + dependency audit (SEC-22)
       → build (frontend bundle, backend image)
       → deploy staging → smoke + E2E
       → [approval] → deploy production (tagged release)
       → post-deploy smoke checks + audit entry
```

Rules: every deploy is a tagged, reproducible build; rollbacks use the previous tag; database changes ship as versioned migrations run in the same pipeline (NFR-32).

---

## 4. Configuration & Secrets

| Item | Rule |
|------|------|
| Env vars | `NODE_ENV`, `PORT`, `MONGO_URI`, `SESSION_SECRET`, `MFA_ENCRYPTION_KEY`, gateway keys, SMTP/SMS creds, `RATE_LIMIT_*`, session timeouts, facility TZ |
| Storage | Secret store / server env files — never committed (NFR-31); repo scanned in CI |
| Rotation | Secrets rotatable without code change; DB creds least-privilege |
| Facility policies | Live in `settings` collection (admin-managed), not env — policy changes need no deploy (AC-57) |

---

## 5. Monitoring & Operations

| Area | Implementation |
|------|----------------|
| Health | `/health` (app) + DB ping; external uptime check |
| Logs | Structured JSON (pino), request IDs, PII-minimized; shipped to ops store |
| Metrics | Response times (NFR-01/02), error rates, queue depths, job lags |
| Alerts | Per `03-AUDIT-LOGGING-AND-MONITORING.md §4` |
| Maintenance | Communicated windows only; no silent restarts in operating hours (NFR-23) |

---

## 6. Release Procedure

1. Release notes compiled (features, fixes, migrations, config changes).
2. Staging rehearsal with UAT sign-off for release scope.
3. Production deploy in maintenance window (if migrations require).
4. Migrations → app rollout → smoke checks (login, book, dispense stub, payment stub).
5. Verify monitoring clean for 30 minutes; rollback on red flags.
6. Post-release audit entry + backup verification.

---

## 7. Scaling Notes (Single Facility Sizing)

- v1.0 targets 200+ concurrent users (NFR-04): one app instance typically suffices; two for failover.
- MongoDB replica set is mandatory (transactions); vertical scale first.
- Reports run against read preference `secondaryPreferred` where safe to protect operational load.

---

*End of document — Deployment and Infrastructure v1.0*
