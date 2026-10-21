# 01 — AI Agent Development Rules

> **Document:** Binding rules for any AI coding agent building the HMS
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** AI coding agents (and their human supervisors)
> **Related documents:** All documents in this package; especially `02-PHASED-IMPLEMENTATION-PLAN.md`, `03-DEFINITION-OF-DONE.md`
> **Rule:** These rules override any general training habits. When in doubt: stop, cite the conflict, ask.

---

## 1. Prime Directives

1. **The documentation is the single source of truth.** Implement what is specified — no more, no less.
2. **Never invent requirements.** If a needed detail is missing, list the gap and request clarification instead of guessing.
3. **Never weaken security to ship a feature.** If a feature conflicts with SEC-xx/R-xx/C-xx, the feature changes — not the security rule.
4. **Scope guard:** anything marked X-xx in `03-SCOPE-AND-ASSUMPTIONS.md` must not be built. Anything not marked S-xx/FR-xx is out of scope until documented.

---

## 2. Reading & Setup Discipline

1. Read all documents in README order **before** writing code.
2. Load the permission catalog (`01-ROLES-AND-PERMISSIONS.md §4`) as the seed data for RBAC — do not invent permission strings.
3. Use canonical status strings from `02-PROJECT-GLOSSARY.md §13` as code constants — no synonyms, no variants.
4. Follow the module boundaries in `01-ARCHITECTURE-AND-DATA-FLOW.md §3` — no cross-module collection writes.
5. Trace every task to its IDs (S-xx → FR-xx → AC-xx → EP-xx) before implementing.

---

## 3. Implementation Rules

| Area | Rule |
|------|------|
| Authorization | Every route declares permission + scope; server-side only; object-level checks on record reads/writes |
| Money & bookings | Idempotency keys mandatory; integer minor units; server-computed totals; transactions per `02-DATABASE-DESIGN.md §6` |
| Statuses | Changes only via documented transition endpoints/tables; invalid moves → `422 INVALID_TRANSITION` |
| Audit | Every FR-54-listed action writes an audit entry; business success without audit is a defect |
| Validation | Schema validation on every write; canonical enums; errors per the standard envelope |
| Privacy | Minimum-necessary projections per role; no clinical content in notifications; unverified results never patient-visible |
| Frontend | UX hiding only; server is the gate; no tokens in localStorage; i18n-ready strings |
| Migrations | Versioned, repeatable, forward-compatible; no manual prod data edits |
| Tests | Write the AC-xx tests with the feature (same task), including negative authorization cases |
| Secrets | Environment variables only; never commit; never log |

---

## 4. Workflow Rules

1. Work phase by phase per `02-PHASED-IMPLEMENTATION-PLAN.md`; do not skip ahead (dependencies are real).
2. Within a phase, implement feature-by-feature: schema → service + rules → endpoints + middleware → frontend → tests → docs update.
3. Run lint, typecheck, and the relevant test suites after each feature; all green before proceeding (NFR-33/34).
4. Update the documentation when reality requires it — via a proposed change, not silent drift. Code and docs must never contradict.
5. Keep changes small and reviewable; one feature per change set.

---

## 5. Prohibited Actions

1. Adding features, libraries, endpoints, or pages not in the docs without an approved documentation change.
2. Hard-coding policy values (cancellation windows, timeouts, queues) — they are admin settings (A-07).
3. Storing credentials/tokens in localStorage or code.
4. Client-trusted roles/IDs/payment results.
5. Silent edits to finalized records; deletions of appointments/payments/results.
6. Direct collection writes across module boundaries.
7. Weakening, skipping, or "temporarily disabling" auth, authz, audit, or validation to make something work.
8. Using production data in staging/tests.

---

## 6. When Something Is Ambiguous or Broken

1. **Conflicting documents** → stop; report both references (file + section); propose a resolution; wait for approval.
2. **Missing detail** → check the glossary and related workflows; if truly absent, write the question with your recommended default; implement only after approval (or implement the default behind a clearly-marked TODO when the supervisor has approved that mode).
3. **Failing AC after reasonable attempts** → report the failing criterion, the attempted approach, and hypotheses — do not fake a pass.
4. **Security bug found mid-build** → fix or quarantine immediately; never leave known-vulnerable code in the mainline.

---

## 7. Communication & Reporting

- Maintain a short build log: phase, task, files touched, tests added, open questions.
- Flag documentation drift the moment it appears.
- Summarize each completed phase with: AC coverage, security checklist status, and known gaps.

---

*End of document — AI Agent Development Rules v1.0*
