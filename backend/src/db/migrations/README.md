# core/db/migrations — versioned, repeatable (NFR-32)

Migration scripts for any collection/index change. Rules:

- One file per migration: `NNN-description.ts`, executed in filename order.
- Each migration is **idempotent** (safe to re-run) and records itself in a
  `_migrations` collection.
- Index/model changes are declared in the owning module's `model.ts` *and*
  mirrored here so existing deployments converge.

Status: no migrations required yet — all indexes are declared inline in
Mongoose schemas and every deployment starts from an empty database or the
seeded baseline (`npm run seed`). The first migration will be added when a
deployed database needs a data transformation (expected: PH-06 inventory or
PH-07 billing index changes).
