# 02 — Privacy and Data Protection

> **Document:** Privacy principles, consent handling, data minimization, and patient visibility rules for the HMS
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** All audiences
> **Related documents:** `01-SECURITY-REQUIREMENTS.md`, `03-AUDIT-LOGGING-AND-MONITORING.md`, `04-EMERGENCY-BREAK-GLASS-ACCESS.md`, `03-SCOPE-AND-ASSUMPTIONS.md` (A-09)
> **Rule:** Minimum necessary, always. The system exposes the least data required for the task — and records who saw what.

---

## 1. Data Categories & Sensitivity

| Category | Examples | Sensitivity | Visibility default |
|----------|----------|-------------|--------------------|
| Identity/demographics | Name, DOB, contacts, MRN | High | Role-gated; patients see own |
| Clinical | Diagnoses, notes, EMR | **Very high** | Assigned scope only; patient sees released only |
| Laboratory | Orders, results | **Very high** | Verified/released only to patient |
| Prescriptions/pharmacy | Medicines, dispensing | High | Care team + own record |
| Financial | Invoices, payments | High | Patient own bills; finance roles |
| Operational | Queue, schedules | Medium | Role-gated, de-identified where possible |
| Security/audit | Logs, break-glass | High | Admin; scoped views for Doctor/Accountant |

---

## 2. Minimum-Necessary Principle

1. API responses return only fields required by the requesting role and screen (SEC-14, NFR-15) — projections, not "hide in UI".
2. Screens display the least data needed for safe work (e.g., pharmacy sees medicine/patient-match context, not full clinical notes).
3. Notifications and external messages never contain diagnoses or clinical details (NFR-16).
4. Reports aggregate/de-identify where individual detail is unnecessary.
5. Lists (queues, schedules) show operational data, not clinical reason-for-visit.

---

## 3. Consent Management

| Aspect | Rule |
|--------|------|
| Capture | Privacy notice shown at registration (AC-13); consent flags stored with timestamp and version of the notice |
| Types | Treatment-data sharing (lab/pharmacy), patient-portal release of results, optional communications |
| Change | Patients may view/change consent flags (PERM-07); changes audited |
| Effect | Consent flags gate optional data sharing (e.g., auto-release of results to portal) — never emergency care delivery |
| Withdrawal | Withdrawal applies prospectively; historical processing remains auditable |

---

## 4. Patient Visibility Rights

| Data | Patient can see | Patient cannot see |
|------|-----------------|--------------------|
| Demographics | Own; edit non-identity fields | Others' records |
| Appointments | Own | Others' |
| Clinical records | Released summaries per policy | Full raw notes unless released; anyone else's |
| Lab results | **Released only** (never unverified) | Unverified; others' |
| Prescriptions | Own | Others' |
| Bills/payments | Own | Others' |
| Audit | — | Who accessed their record **may** be shown per facility policy (configurable) |

---

## 5. Data Lifecycle

| Stage | Rule |
|-------|------|
| Collection | Only purposeful fields; validated at entry |
| Storage | Encrypted at rest (NFR-14); access role-gated and audited |
| Usage | Business purpose only; no analytics on clinical content without policy approval |
| Sharing | External sharing only via consent or legal requirement; logged |
| Retention | Per facility policy and applicable law (A-09, NFR-18); configurable per data class |
| Disposal | Secure deletion/anonymization per policy; audit records retained per rules |

---

## 6. External Communications Rules

1. Reminders: date/time/department only (AC-20).
2. "Results ready" notices: no values, no diagnoses — portal login required.
3. Billing notices: amounts/invoice reference only; no clinical line items in external messages.
4. Email/SMS consent honored for optional communications; operational notices (appointment lifecycle) may proceed per policy.

---

## 7. Privacy Violations (Defects)

Any of these is a release blocker:
- Clinical data in an external message.
- Unverified result visible to a patient.
- API returning more fields than the role's projection.
- Missing audit entry for a patient-record access.
- Break-glass without reason/review (see `04-EMERGENCY-BREAK-GLASS-ACCESS.md`).

---

*End of document — Privacy and Data Protection v1.0*
