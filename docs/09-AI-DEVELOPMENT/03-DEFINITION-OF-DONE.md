# 03 — Definition of Done

> **Document:** What "done" means for every task, feature, phase, and the release
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** AI coding agents, developers, QA
> **Related documents:** `01-AI-AGENT-DEVELOPMENT-RULES.md`, `02-PHASED-IMPLEMENTATION-PLAN.md`, `03-ACCEPTANCE-CRITERIA.md`, `01-TESTING-STRATEGY.md`
> **Rule:** Done is binary. Any unchecked box means **not done** — no partial credit.

---

## 1. Task-Level Definition of Done (every change set)

- [ ] Traced to requirement IDs (S-xx → FR-xx → AC-xx) and endpoint ID (EP-xx) where applicable
- [ ] Implements exactly the documented behavior — no invented extras
- [ ] Permission + scope declared on routes; object-level checks included
- [ ] Server-side validation with canonical enums; standard error envelope codes used
- [ ] Transactions applied where mandated (`02-DATABASE-DESIGN.md §6`)
- [ ] Audit events written for FR-54-listed actions touched by this task
- [ ] Minimum-necessary projections verified (no over-exposed fields)
- [ ] Unit + integration tests written, including negative authorization cases
- [ ] Lint, typecheck, and tests all green (NFR-33/34)
- [ ] No secrets committed; no hard-coded policy values
- [ ] Docs updated if behavior/terms changed (via proposed change, no drift)

---

## 2. Feature-Level Definition of Done (per FR-xx)

- [ ] All linked AC-xx criteria pass as automated or scripted tests
- [ ] Workflow matches the corresponding document in `03-APPLICATION-FLOWS/` (statuses, actors, side effects)
- [ ] Cross-module reactions from `08-CROSS-MODULE-INTEGRATION-FLOW.md §2` implemented and audited
- [ ] Frontend screens follow `07-USER-EXPERIENCE/` (status badges, confirmations, reason fields, privacy-safe display)
- [ ] Performance spot-check within NFR targets for the involved endpoints
- [ ] Security review against applicable SEC-xx controls completed
- [ ] Build log updated (what shipped, tests added, open questions)

---

## 3. Phase-Level Definition of Done (per PH-xx)

- [ ] All feature-level DoD satisfied for the phase's scope
- [ ] Phase exit criteria in `02-PHASED-IMPLEMENTATION-PLAN.md` verified
- [ ] Regression suites (all previous phases) still green
- [ ] Documentation sync check: no contradictions between code and docs
- [ ] Phase summary written: AC coverage %, security checklist status, known gaps/questions

---

## 4. Release-Level Definition of Done

- [ ] Every shipped feature's AC-xx verified on staging
- [ ] Security suite fully passing (IDOR sweep, tampering, injection, session, webhook, idempotency)
- [ ] Dependency audit: zero high/critical findings (SEC-22)
- [ ] Load/concurrency tests meet NFR-01…NFR-05 (zero duplicate bookings/payments)
- [ ] Accessibility scan passes (NFR-27)
- [ ] Restore drill completed successfully (NFR-38) — backup proven restorable
- [ ] Monitoring + alerts verified live (NFR-37)
- [ ] UAT sign-off recorded by facility representatives
- [ ] Production deployment per `02-DEPLOYMENT-AND-INFRASTRUCTURE.md §6` with smoke checks green
- [ ] Post-deploy audit entry + backup verification completed
- [ ] Final security checklist (SEC-01…SEC-28) signed off

---

## 5. "Not Done" Signals (automatic)

Any of these marks the work **not done**, regardless of other progress:

1. A known AC failing or skipped.
2. A security control disabled/bypassed "temporarily".
3. Missing audit entry for a sensitive action.
4. Hard-coded policy value.
5. Unverified lab result reachable by a patient.
6. Duplicate booking/payment possible under concurrency.
7. Client-trusted role/ID/payment result anywhere in the flow.
8. Documentation contradiction left unresolved.

---

*End of document — Definition of Done v1.0*
