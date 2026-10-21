# 02 — Error Handling and Validation

> **Document:** Standard error envelope, error codes, validation rules, and client handling for the HMS API
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** Developers and AI coding agents
> **Related documents:** `01-API-DESIGN-STANDARDS.md`, `04-BACKEND-SPECIFICATION.md §5`, `02-UI-UX-REQUIREMENTS.md`
> **Rule:** One envelope everywhere. Specific, human-readable messages. No stack traces, no system internals, no sensitive data in errors.

---

## 1. Error Envelope

```json
{
  "error": {
    "code": "SLOT_TAKEN",
    "message": "That time slot was just taken. Please choose another slot.",
    "details": [
      { "field": "slot.start", "issue": "no longer available", "suggestions": ["10:30", "11:00"] }
    ],
    "traceId": "req-8f3a…"
  }
}
```

- `code` — machine-readable constant (from the catalog below).
- `message` — human-readable, user-safe, glossary terminology.
- `details` — optional field-level info; **never** echoes unvalidated raw input wholesale.
- `traceId` — request ID for log correlation (safe to show users).

---

## 2. HTTP Status Usage

| Status | When |
|--------|------|
| 200 / 201 | Success (201 for creations) |
| 400 | Malformed request (syntax) |
| 401 | Missing/expired/invalid authentication |
| 403 | Authenticated but not permitted (permission, scope, or object denial) |
| 404 | Not found — **also** used for found-but-forbidden, to avoid existence leaks |
| 409 | Conflict (slot race, duplicate state) |
| 422 | Validation/business-rule failure |
| 428 | Missing required `Idempotency-Key` |
| 429 | Rate limited |
| 500 | Unexpected server error (logged fully, returned minimally) |
| 503 | Maintenance/degraded mode |

---

## 3. Error Code Catalog

### 3.1 Auth & access
| Code | HTTP | Meaning |
|------|------|---------|
| `INVALID_CREDENTIALS` | 401 | Login failed (generic — no hint which part failed) |
| `SESSION_EXPIRED` | 401 | Re-authentication required |
| `MFA_REQUIRED` | 401 | Second factor needed |
| `ACCOUNT_LOCKED` | 401 | Generic lockout message (rate limit interplay per NFR-10) |
| `FORBIDDEN` | 403 | Permission/scope/object denial (audited where sensitive) |
| `RATE_LIMITED` | 429 | Too many attempts |

### 3.2 Validation & business rules
| Code | HTTP | Meaning |
|------|------|---------|
| `VALIDATION_ERROR` | 422 | Field-level failures in `details` |
| `INVALID_TRANSITION` | 422 | Status move not in the transition table |
| `POLICY_WINDOW` | 422 | Outside cancellation/booking window (configurable policy) |
| `MISSING_FIELD` | 422 | Required field absent |
| `IDEMPOTENCY_KEY_REQUIRED` | 428 | Money/booking POST without key |
| `DUPLICATE_REQUEST` | 409 | Retry detected — original result returned where applicable |

### 3.3 Appointments
| Code | HTTP | Meaning |
|------|------|---------|
| `SLOT_TAKEN` | 409 | Race lost; alternatives suggested |
| `SLOT_UNAVAILABLE` | 422 | Slot not bookable (horizon, doctor off-duty) |

### 3.4 Clinical / Lab / Pharmacy
| Code | HTTP | Meaning |
|------|------|---------|
| `ENCOUNTER_NOT_OPEN` | 422 | Writes to non-open encounter |
| `RECORD_FINALIZED` | 422 | Direct edit of finalized record (amend endpoint exists) |
| `RESULT_NOT_VERIFIED` | 422 | Release attempted pre-verification |
| `CRITICAL_ACK_REQUIRED` | 422 | Release blocked until acknowledgment flow done |
| `PRESCRIPTION_INVALID` | 422 | Cancelled/expired/incomplete prescription |
| `BATCH_EXPIRED` | 422 | Dispense blocked (AC-37) |
| `INSUFFICIENT_STOCK` | 422 | Negative stock prevention (AC-38) |
| `BATCH_QUARANTINED` | 422 | Quarantine/recall block (AC-40) |

### 3.5 Billing
| Code | HTTP | Meaning |
|------|------|---------|
| `INVOICE_ISSUED` | 422 | Silent edit of issued invoice blocked |
| `PAYMENT_EXCEEDS_BALANCE` | 422 | Overpayment without policy approval |
| `GATEWAY_ERROR` | 502 | Upstream payment failure (verify before recording) |
| `WEBHOOK_SIGNATURE_INVALID` | 400 | Unsigned/mismatched gateway callback |
| `REFUND_NOT_AUTHORIZED` | 403 | Missing `payment.refund.approve` |

---

## 4. Validation Standards

1. **Server-side always** — schema validation on every write: shape, types, lengths, enums (canonical statuses), ranges (dates, quantities), cross-field rules.
2. **Field-level details** — `details[].field` uses the request's field path; one entry per failing field.
3. **Message style** — specific and actionable ("Dose is required for each medicine"), never internal ("Sequelize…"–style internals must never appear).
4. **Canonical enums** — any status/enum mismatch returns `VALIDATION_ERROR` naming the allowed values.
5. **Sanitization** — inputs trimmed/normalized; unknown fields stripped (not error-prone passthrough).
6. **Client mirroring** — frontend applies the same rules for UX but server remains the gate; client must handle every catalog code with a designed state (no raw dumps).

---

## 5. Client Handling Rules

| Code class | Client behavior |
|-----------|-----------------|
| 401 `SESSION_EXPIRED` | Save route → login → restore |
| 403 | "You don't have access to this action" page/message; never retry loops |
| 409 `SLOT_TAKEN` | Show alternatives from `details.suggestions` |
| 422 `VALIDATION_ERROR` | Inline field errors from `details` |
| 429 | Cooldown message + retry-after respect |
| 5xx | Friendly failure + `traceId` shown for support |

---

## 6. Logging vs. Responding

- Logs (server): full context — stack, input snapshot (secrets redacted), actor, traceId.
- Response: minimal, safe, actionable.
- 500s are always defects to fix; recurring 403/409 patterns are monitored (see `03-AUDIT-LOGGING-AND-MONITORING.md §4`).

---

*End of document — Error Handling and Validation v1.0*
