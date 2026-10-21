# 02 — UI/UX Requirements

> **Document:** Design principles, visual standards, interaction patterns, and accessibility rules for the HMS
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** Designers, developers, and AI coding agents
> **Related documents:** `01-PAGE-AND-NAVIGATION-STRUCTURE.md`, `02-ERROR-HANDLING-AND-VALIDATION.md` (message style), `02-NON-FUNCTIONAL-REQUIREMENTS.md §6`
> **Rule:** Clarity over decoration. Speed for staff, safety for money and medicine, dignity for patients.

---

## 1. Design Principles

1. **Role-focused screens** — each user sees their work, not the whole hospital.
2. **Minimum-necessary display** — no clinical data where it isn't needed (privacy by screen design).
3. **Fewest steps for frequent actions** — booking, check-in, dispense, payment within ≤ 5 steps (NFR-25).
4. **Statuses are always visible** — canonical status badges on every record (glossary §13).
5. **Safe defaults** — destructive actions require confirmation + reason; nothing deletes silently.
6. **Readable under pressure** — staff work fast, sometimes stressed; high contrast, large tap targets, clear hierarchy.

---

## 2. Visual Standards

| Element | Standard |
|---------|----------|
| Status badges | Consistent colors: green=completed/paid/verified, blue=in-progress, amber=action needed, red=critical/cancelled, gray=terminal-neutral |
| Money | Right-aligned, currency-formatted, negative amounts in red with minus sign |
| Dates | Facility-local format; relative labels ("in 2 hours") on operational screens |
| Tables | Sticky header, zebra rows, sortable on indexed columns, pagination always |
| Forms | Labels above fields; required marks; inline validation on blur; submit disabled while pending |
| Empty states | Explain + offer action ("No appointments today. Book one.") |
| Loading | Skeletons for lists; button spinners for actions |
| Density | Comfortable for clinical data; compact mode toggle for queue/lab screens |

---

## 3. Interaction Patterns

| Pattern | Rule |
|---------|------|
| Confirmations | Required for: cancellation, reschedule (beyond policy), refund, stock adjustment, quarantine, break-glass — with reason field where policy demands |
| Reason capture | Free-text + optional structured codes; stored and shown in history |
| Search | Debounced, minimum 2 chars, patient search requires identity disambiguation (DOB/MRN confirmation) |
| Optimistic UI | Only for read-refresh; never for money, stock, or clinical writes — await server truth |
| Notifications | In-app bell for events; toast only for action feedback (success/error of the user's own action) |
| Errors | Per `02-ERROR-HANDLING-AND-VALIDATION.md §5` — inline for validation, banners for access, retry for 5xx |
| Time-sensitive lists | Auto-refresh queues and dashboards (interval or SSE), with manual refresh fallback |
| Multi-step flows | Slot picker, dispense, and break-glass use step indicators with review step before commit |

---

## 4. Patient Portal Specifics

1. Plain language everywhere — no medical jargon without explanation.
2. Results display: released results with reference ranges; abnormal flagged per policy; **never** display unverified items.
3. Bills: itemized lines, payment history, outstanding balance prominent; pay button per invoice.
4. Booking: calendar/slot UI with honest availability; waitlist offered when full.
5. Privacy notice at registration: readable summary + full text link; consent toggles with clear descriptions (AC-13).

---

## 5. Accessibility (WCAG 2.1 AA-oriented — NFR-27)

| Area | Requirement |
|------|-------------|
| Keyboard | All flows operable by keyboard; visible focus; logical tab order |
| Labels | Every input labeled; errors linked via `aria-describedby` |
| Contrast | ≥ 4.5:1 text; status color never the sole carrier of meaning (icon/text too) |
| Semantics | Landmarks, headings hierarchy, real buttons/links |
| Forms | Error summary on submit; `aria-live` for async validation |
| Motion | Respect reduced-motion preference |
| Zoom | Usable at 200% zoom / 360 px width (NFR-24) |

---

## 6. Content Rules

1. Terminology exactly as `02-PROJECT-GLOSSARY.md` — no synonyms for statuses/modules.
2. Tone: professional, calm, non-blaming errors ("That slot was just taken", not "You failed").
3. No internal jargon in user-facing text (no collection names, codes, stack traces).
4. Bilingual readiness: strings externalized (i18n-ready) even if v1.0 ships one language.
5. Emergency info wording approved by the facility; always visible on public pages.

---

## 7. Responsive Behavior

| Breakpoint | Behavior |
|-----------|----------|
| ≥ 1280 px | Full sidebar + multi-column dashboards |
| 768–1279 px | Collapsible sidebar; stacked columns |
| ≤ 767 px | Bottom/tab navigation or hamburger; single column; touch targets ≥ 44 px; queue and check-in usable one-handed |

Check-in staff and pharmacists may use tablets — critical flows must be fully tablet-usable.

---

*End of document — UI/UX Requirements v1.0*
