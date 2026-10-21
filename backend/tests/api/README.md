# tests/api — endpoint-contract tests

Contract tests per `docs/06-API-AND-ERRORS/01-API-DESIGN-STANDARDS.md`:
envelope shape (`data`/`error`, `meta.pagination`), status codes, 428
idempotency-key rule, and EP-xx request/response contracts.

Currently the endpoint contract assertions live inside
`tests/integration/*.test.ts` (they share the seeded replica-set harness).
This directory holds extracted contract-only suites from PH-07 onward, when
billing endpoints add cases that do not need the clinical harness.
