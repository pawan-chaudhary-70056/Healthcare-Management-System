# HMS — Healthcare Management System

MERN modular monolith implementing the HMS specification in `docs/`.

## Layout

```
backend/    Node.js 20+ / Express / TypeScript / Mongoose (MongoDB 7 replica set)
frontend/   React 18 + Vite + TypeScript + Tailwind (SPA)
```

## Quick Start (local development)

### 1. Prerequisites
- Node.js 20+ LTS
- MongoDB 7+ running as a **replica set** (required for transactions).

### 2. Start MongoDB replica set

If your local mongod is standalone, run a user-space replica-set instance:

```bash
mkdir -p ~/hms-mongo-data
mongod --dbpath ~/hms-mongo-data --port 27018 --bind_ip 127.0.0.1 \
       --replSet rs0 --fork --logpath ~/hms-mongo-data/mongod.log
mongosh --quiet --port 27018 --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27018'}]})"
```

(Or configure `replication.replSetName` in `/etc/mongod.conf` and restart the service.)

### 3. Backend

```bash
cd backend
cp .env.example .env          # review values; do NOT commit .env
npm install
npm run seed                  # roles, admin, departments + per-department accounts
npm run dev                   # http://localhost:4000  (GET /health)
```

### 4. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev                   # http://localhost:5173
```

### 5. Default accounts (change these passwords immediately)

Bootstrap administrator (from `ADMIN_EMAIL` / `ADMIN_PASSWORD`):

| Email | Password | Role |
|---|---|---|
| `admin@hms.local` | `Admin@12345` | admin |

One account per department (`npm run seed:departments`, included in `npm run seed`):

| Department | Account (ID) | Password | Role |
|---|---|---|---|
| General Medicine | `general@hms.local` | `Dept@12345` | doctor |
| Pediatrics | `peds@hms.local` | `Dept@12345` | doctor |
| Cardiology | `cardio@hms.local` | `Dept@12345` | doctor |
| Orthopedics | `ortho@hms.local` | `Dept@12345` | doctor |
| Laboratory | `lab@hms.local` | `Dept@12345` | lab_tech |
| Pharmacy | `pharmacy@hms.local` | `Dept@12345` | pharmacist |
| Front Desk | `frontdesk@hms.local` | `Dept@12345` | receptionist |
| Nursing | `nursing@hms.local` | `Dept@12345` | nurse |
| Finance (Billing) | `finance@hms.local` | `Dept@12345` | accountant |

Optional demo persona set (`npm run seed:demo`): one user per role with
representative names and a linked demo patient — useful for role walkthroughs.
All local seeding is idempotent and safe to re-run.

## Scripts

| Location | Command | Purpose |
|---|---|---|
| backend | `npm run dev` | Watch-mode server |
| backend | `npm run build` | Typecheck + compile to `dist/` |
| backend | `npm run seed` | Load permission catalog, roles, admin, departments |
| backend | `npm test` | Vitest unit + integration |
| frontend | `npm run dev` | Vite dev server |
| frontend | `npm run build` | Production build |

## Documentation

All requirements, workflows, and security rules live in `docs/` — start with
`README.md`, then `docs/09-AI-DEVELOPMENT/02-PHASED-IMPLEMENTATION-PLAN.md`.
The canonical build checklist is `docs/09-AI-DEVELOPMENT/04-BUILD-TODOS.md`.

## Status

- [x] PH-01 — Foundation (see BUILD LOG below)
- [x] PH-02 — Authentication & RBAC core
- [x] PH-03 — Patients & Appointments
- [x] PH-04 — Clinical & Nursing
- [x] PH-05 — Laboratory
- [x] PH-06 — Pharmacy
- [x] PH-07 — Billing
- [x] PH-08 — Platform features
- [ ] PH-09 — Hardening & release (requires staging + facility UAT)
  - [x] Security test suite (IDOR sweep, NoSQL injection, XSS, CSRF, session flags) — `backend/tests/security/`
  - [ ] Load tests, accessibility scan, restore drill, monitoring, staging UAT, deployment
