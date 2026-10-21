# 03 — Audit Logging and Monitoring

> **Document:** What the HMS logs, how logs are structured and protected, and how the system is monitored
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** Developers and AI coding agents
> **Related documents:** `01-SECURITY-REQUIREMENTS.md` (SEC-27), `02-PRIVACY-AND-DATA-PROTECTION.md`, `04-EMERGENCY-BREAK-GLASS-ACCESS.md`
> **Rule:** If it touches sensitive data or security state, it is logged. Logs are append-only and never contain secrets.

---

## 1. Audited Events (Mandatory List)

| Category | Events |
|----------|--------|
| Authentication | Login success/failure, logout, MFA enroll/verify/fail, password change/reset, account lock/unlock |
| Authorization | Access denied (403) on sensitive resources, IDOR-pattern denials, permission/role changes |
| Patient data | Record creation/update, record **views** of clinical data (per policy), consent changes |
| Appointments | Every status transition (T-01…T-12) with actor + reason |
| Clinical | Encounter create/finalize, EMR amendments (with reason), prescription create/cancel |
| Laboratory | Specimen events, result entry, verification, critical alert + acknowledgment, release, amendment |
| Pharmacy | Validation, dispense, stock movement/adjustment, quarantine, recall |
| Billing | Invoice issue, payment confirm, refund, discount, adjustment, reconciliation run |
| Admin | User create/suspend, role assignment, settings changes, backup trigger/verify |
| Break-glass | Every emergency access event (reason, scope, duration) and its review |

FR-54 defines the same list from the requirements side; AC-59 is the test.

---

## 2. Audit Entry Structure

```json
{
  "at": "<UTC ISO timestamp>",
  "actorId": "<userId>",
  "actorRole": "doctor",
  "action": "lab.result.release",
  "module": "laboratory",
  "resourceType": "lab_result",
  "resourceId": "<id>",
  "patientId": "<id>",
  "outcome": "SUCCESS",
  "ip": "…",
  "userAgent": "…",
  "details": { "reason": "…" }
}
```

Rules: `details` never contains passwords/tokens/secrets or full clinical content — references only. `outcome ∈ {SUCCESS, DENIED, FAILED}`. Structure mirrors `02-DATABASE-DESIGN.md §3.11`.

---

## 3. Log Protection

| Control | Rule |
|---------|------|
| Append-only | No update/delete paths in the application; DB permissions restrict writes (SEC-27) |
| Completeness | Audit write is part of the operation flow (outbox fallback if needed) — business success without audit is a defect |
| Access | Admin: all (PERM-63); Doctor: own events (PERM-64); Accountant: financial events (PERM-65); no one else |
| Retention | ≥ 1 year default (NFR-36); facility policy may extend (A-09) |
| Export | Admin-only export for oversight; export itself is audited |

---

## 4. Monitoring & Alerting

| Signal | Alert condition (defaults) | Route |
|--------|---------------------------|-------|
| Service health | Health check failing > 1 min | Ops/admin |
| Database | Connection loss, replication lag, disk thresholds | Ops/admin |
| Auth anomalies | Failed-login spike, lockout surge | Admin |
| Authorization anomalies | IDOR-pattern denials, scope-denial spike | Admin |
| Critical lab results | Unacknowledged beyond escalation window | Clinical oversight |
| Payment anomalies | Gateway mismatches, repeated idempotency conflicts | Finance + admin |
| Break-glass | Any use — immediate notification to oversight (PERM-67) | Admin |
| Outbox/notifications | Delivery backlog beyond threshold | Ops |
| Backup jobs | Failure or missing success within window | Ops |

Alerts include time, signal, context IDs; delivery via configured channel (email/ops tool) (NFR-37).

---

## 5. Review Cadences

| Review | Frequency | Reviewer |
|--------|-----------|----------|
| Break-glass events | Within 72 h (NFR-40) | Admin/oversight |
| Auth anomalies | Weekly | Admin |
| Access denials / IDOR attempts | Weekly | Admin |
| Financial reconciliation exceptions | Each cycle | Accountant |
| Backup/restore verification | Quarterly drill (NFR-38) | Ops/admin |
| Audit retention compliance | Quarterly | Admin |

---

*End of document — Audit Logging and Monitoring v1.0*
