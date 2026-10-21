# 04 — Emergency Break-Glass Access

> **Document:** Controlled emergency access to restricted patient information
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** All audiences
> **Related documents:** `01-ROLES-AND-PERMISSIONS.md` (PERM-66/67), `03-AUDIT-LOGGING-AND-MONITORING.md`, `01-SECURITY-REQUIREMENTS.md`
> **Rule:** Break-glass is **not** an RBAC bypass. It is a narrow, reason-bound, time-limited, fully audited doorway for genuine emergencies.

---

## 1. Purpose

In a genuine emergency, an authorized clinician may need records they cannot normally access (e.g., an unconscious patient's allergies or ongoing medications). Break-glass permits exactly that — minimally, briefly, and under review.

---

## 2. Eligibility & Scope

| Aspect | Rule |
|--------|------|
| Who | Only staff on the facility's approved break-glass list (typically Doctors; Nurses where policy allows) holding `PERM-66` |
| What | A **defined data scope** only — e.g., allergies, active medications, critical history — not unlimited record access |
| When | Genuine emergency where normal authorization cannot be satisfied in time |
| Duration | Time-limited session of access (default: 60 minutes, configurable) |
| Not allowed | Routine convenience, curiosity, admin tasks, or bypassing normal workflows when normal access is available |

---

## 3. Workflow

```text
Emergency situation → clinician opens Break-Glass request
  │
  ▼
Identity + permission check (must be authenticated; PERM-66 held)
  │
  ▼
Mandatory form:
  ├── patient identifier (search by MRN/name per policy)
  ├── REASON (free text, required — AC-61 rejects empty)
  └── confirmation of emergency context
  │
  ▼
Grant time-limited access token scoped to the defined data subset
  │
  ▼
Clinician views ONLY the emergency scope
  │
  ▼
Access window ends (or early revoke by admin)
  │
  ▼
Automatic notifications: oversight (PERM-67) alerted immediately
  │
  ▼
OVERSIGHT REVIEW within 72 h (NFR-40):
  ├── reason plausible & access proportionate? → close
  └── concern raised → escalate per facility policy (HR/clinical governance)
```

---

## 4. Constraints & Controls

1. **Reason is mandatory** at request time — not afterwards (AC-61).
2. **Time-limited**: access expires automatically; re-request requires a new reason.
3. **Fully audited**: request, grant, every record viewed, expiry, and review (FR-54, AC-60).
4. **Immediate notification** to oversight staff on every use.
5. **Review queue**: unreviewed events escalate (see `03-AUDIT-LOGGING-AND-MONITORING.md §4`).
6. **No data modification**: break-glass grants read access to the defined scope only — never write.
7. **Separate from role rights**: revocable independently of the user's role (suspension of break-glass privilege is instant and audited).
8. **Policy-configurable**: eligible list, scope, duration, notification, and review window come from Admin settings (A-07).

---

## 5. Abuse Prevention & Response

| Signal | Response |
|--------|----------|
| Repeated use by one user | Flag in review; interview per policy |
| Use without plausible reason | Escalation; possible privilege suspension |
| Access outside emergency scope | Technical block + audit; incident process |
| Patterns (same patient repeatedly, off-hours anomalies) | Automated anomaly alert to oversight |

Repeated unjustified use leads to privilege removal and, per facility policy, disciplinary referral. The system provides the evidence trail; governance decisions belong to the facility.

---

## 6. Relationship to Other Controls

- Normal scope rules (R-01…R-09) remain the default; break-glass is the only exception (R-10).
- Break-glass events are a top-priority category in audit and monitoring.
- Privacy rule: even in emergencies, data viewed is the minimum necessary for the clinical situation.

---

*End of document — Emergency Break-Glass Access v1.0*
