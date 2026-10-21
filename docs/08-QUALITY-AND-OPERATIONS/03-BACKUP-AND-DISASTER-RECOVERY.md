# 03 — Backup and Disaster Recovery

> **Document:** Backup regime, restore drills, and disaster recovery plan for the HMS
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** DevOps, Admin, and AI coding agents
> **Related documents:** `02-DEPLOYMENT-AND-INFRASTRUCTURE.md`, `02-NON-FUNCTIONAL-REQUIREMENTS.md` (NFR-20/21/38), `01-SECURITY-REQUIREMENTS.md` (SEC-28)
> **Rule:** A backup that has never been restored is not a backup. Drills are mandatory.

---

## 1. Objectives

| Target | Value (default, configurable) |
|--------|-------------------------------|
| RPO — max data loss | ≤ 24 h daily baseline; point-in-time oplog tailing where hosting allows |
| RTO — max restore time | ≤ 4 h |
| Backup success | Automated, verified, alerted on failure (NFR-37/38) |

---

## 2. Backup Scope & Schedule

| Item | Schedule | Retention | Notes |
|------|----------|-----------|-------|
| MongoDB dump | Daily (off-peak) | 30 daily, 12 monthly | All app collections incl. audit log |
| Oplog/incremental (if available) | Continuous | 48 h | Enables point-in-time restore |
| Configuration/secrets store | On change + monthly | Last 12 versions | Excludes secret values where possible; encrypted otherwise |
| Frontend/backend artifacts | Per release | All released tags | Reproducible deploys |
| Facility settings export | Weekly | 12 weeks | JSON export of policies |

---

## 3. Protection Requirements

1. **Encrypted** at rest and in transit to storage (SEC-28).
2. **Off-site/immutable** storage: separate credential domain from production (compromised prod cannot delete backups).
3. **Access-restricted**: `backup.manage` (PERM-68) only; every backup trigger/restore attempt audited (FR-54).
4. **Integrity**: checksums recorded; verification step after each backup.

---

## 4. Restore Drills (Mandatory)

| Drill | Frequency | Steps |
|-------|-----------|-------|
| Restore to staging | **Monthly** | Restore latest dump → run app → verify: login, patient record, appointment, invoice, audit entries intact |
| Point-in-time test | Quarterly | Restore to a chosen timestamp; confirm data matches ledger of test transactions |
| Full DR rehearsal | Quarterly (NFR-38) | Simulate site loss: rebuild infra from docs + restore → measure RTO against 4 h target |

Each drill: recorded result (who, when, duration, issues) — kept as an ops record. A failed drill is an incident with a fix plan.

---

## 5. Disaster Scenarios & Responses

| Scenario | Response |
|----------|----------|
| App server failure | Restart/redeploy from last tag (RTO minutes); no data impact |
| DB node failure | Replica failover (automatic); replace node; verify health |
| Full DB loss / corruption | Restore latest dump + oplog tail to last good moment; app maintenance page during restore |
| Bad release | Rollback tag; migrations forward-compatible policy required |
| Ransomware/compromise | Isolate, revoke credentials, restore from immutable backups, incident process + audit review |
| Accidental data deletion (logical) | Point-in-time restore of affected collection; reconcile against audit log |

During any outage: reception continues on paper fallback (facility policy); emergency info page stays public (NFR-22, A-10).

---

## 6. Roles & Responsibilities

| Role | Duty |
|------|------|
| Admin (PERM-68) | Trigger/verify backups; monitor alerts; lead drills |
| DevOps | Maintain pipeline, storage, and restore automation |
| Facility | Approve RPO/RTO values and fallback procedures (A-07) |

---

*End of document — Backup and Disaster Recovery v1.0*
