# 03 — Frontend Specification

> **Document:** React frontend structure, routing, state, and UI rules for the HMS
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** Developers and AI coding agents
> **Related documents:** `01-PAGE-AND-NAVIGATION-STRUCTURE.md`, `02-UI-UX-REQUIREMENTS.md`, `01-ARCHITECTURE-AND-DATA-FLOW.md`
> **Rule:** The frontend is a convenience layer. It never decides authorization — it only reflects server decisions and hides what the user cannot use.

---

## 1. Stack & Structure

```text
frontend/
├── node_modules/                     # installed npm dependencies — never manually edit
├── src/
│   ├── @types/                       # global and custom TypeScript type declarations
│   │   └── global.d.ts              # ambient/global type declarations
│   │
│   ├── api/                          # all backend/API communication
│   │   ├── client.ts                 # Axios/fetch client configuration
│   │   ├── endpoints.ts              # centralized API endpoint paths (/api/v1/...)
│   │   ├── auth.api.ts               # authentication API requests
│   │   ├── patients.api.ts           # patient API requests
│   │   ├── appointments.api.ts       # appointment API requests
│   │   ├── clinical.api.ts           # clinical/encounter API requests
│   │   ├── nursing.api.ts             # nursing API requests
│   │   ├── laboratory.api.ts         # laboratory API requests
│   │   ├── pharmacy.api.ts           # pharmacy API requests
│   │   ├── billing.api.ts            # billing/payment API requests
│   │   ├── inventory.api.ts          # inventory API requests
│   │   ├── notifications.api.ts      # notification API requests
│   │   ├── reports.api.ts            # reporting API requests
│   │   └── admin.api.ts              # administration API requests
│   │
│   ├── assets/                       # static frontend assets
│   │   ├── images/                   # logos, illustrations, medical images
│   │   ├── icons/                    # application icons
│   │   └── fonts/                    # local/custom fonts
│   │
│   ├── components/                   # reusable UI components only — no module business logic
│   │   ├── ui/                       # Button, Input, Select, Badge, Card, etc.
│   │   ├── forms/                    # reusable form components
│   │   ├── tables/                   # reusable tables, pagination, filters
│   │   ├── modals/                   # confirmation and reason-capture modals
│   │   ├── navigation/               # Navbar, Sidebar, Breadcrumbs
│   │   └── common/                   # Loading, Error, Empty, PageHeader, etc.
│   │
│   ├── hooks/                        # reusable React hooks
│   │   ├── useAuth.ts                # authentication state/access
│   │   ├── usePermission.ts          # permission checks
│   │   ├── useDebounce.ts            # debounced values/search
│   │   └── usePagination.ts          # reusable pagination state
│   │
│   ├── pages/                        # route-level application pages
│   │   ├── public/                   # publicly accessible pages
│   │   │   ├── Home.tsx              # first page users see
│   │   │   ├── About.tsx
│   │   │   └── Contact.tsx
│   │   │
│   │   ├── auth/                     # authentication pages
│   │   │   ├── Login.tsx
│   │   │   ├── Register.tsx
│   │   │   ├── ForgotPassword.tsx
│   │   │   ├── ResetPassword.tsx
│   │   │   └── VerifyAccount.tsx
│   │   │
│   │   ├── dashboard/                # role-based dashboards
│   │   │   ├── PatientDashboard.tsx
│   │   │   ├── DoctorDashboard.tsx
│   │   │   ├── NurseDashboard.tsx
│   │   │   ├── ReceptionDashboard.tsx
│   │   │   ├── LaboratoryDashboard.tsx
│   │   │   ├── PharmacyDashboard.tsx
│   │   │   ├── BillingDashboard.tsx
│   │   │   ├── ManagerDashboard.tsx
│   │   │   └── AdminDashboard.tsx
│   │   │
│   │   ├── patients/                 # patient management pages
│   │   │   ├── PatientList.tsx
│   │   │   ├── PatientDetails.tsx
│   │   │   ├── PatientCreate.tsx
│   │   │   └── PatientEdit.tsx
│   │   │
│   │   ├── appointments/             # appointment management pages
│   │   │   ├── AppointmentList.tsx
│   │   │   ├── AppointmentCreate.tsx
│   │   │   ├── AppointmentDetails.tsx
│   │   │   └── AppointmentCalendar.tsx
│   │   │
│   │   ├── clinical/                 # clinical encounter pages
│   │   │   ├── EncounterList.tsx
│   │   │   ├── EncounterDetails.tsx
│   │   │   └── Consultation.tsx
│   │   │
│   │   ├── nursing/                  # nursing workflow pages
│   │   │   ├── NursingDashboard.tsx
│   │   │   ├── PatientVitals.tsx
│   │   │   └── NursingNotes.tsx
│   │   │
│   │   ├── laboratory/               # laboratory workflow pages
│   │   │   ├── LabOrders.tsx
│   │   │   ├── Specimens.tsx
│   │   │   └── LabResults.tsx
│   │   │
│   │   ├── pharmacy/                 # pharmacy workflow pages
│   │   │   ├── Prescriptions.tsx
│   │   │   ├── Dispensing.tsx
│   │   │   └── PharmacyInventory.tsx
│   │   │
│   │   ├── billing/                  # billing/payment pages
│   │   │   ├── Invoices.tsx
│   │   │   ├── Payments.tsx
│   │   │   ├── Refunds.tsx
│   │   │   └── Receipts.tsx
│   │   │
│   │   ├── inventory/                # inventory management pages
│   │   │   ├── InventoryList.tsx
│   │   │   ├── StockMovements.tsx
│   │   │   └── Suppliers.tsx
│   │   │
│   │   ├── notifications/            # notification pages
│   │   │   └── Notifications.tsx
│   │   │
│   │   ├── reports/                  # reports and analytics pages
│   │   │   ├── Reports.tsx
│   │   │   └── AuditLogs.tsx
│   │   │
│   │   └── admin/                    # administration pages
│   │       ├── Users.tsx
│   │       ├── Roles.tsx
│   │       ├── Permissions.tsx
│   │       └── SystemSettings.tsx
│   │
│   ├── routes/                       # routing and route protection
│   │   ├── AppRoutes.tsx             # complete application route tree
│   │   ├── ProtectedRoute.tsx        # authentication guard
│   │   ├── PermissionRoute.tsx        # permission-based guard
│   │   └── routeConfig.ts            # centralized route definitions
│   │
│   ├── templates/                    # reusable page/layout templates
│   │   ├── MainTemplate.tsx          # main public application template
│   │   ├── AuthTemplate.tsx          # Login/Register template
│   │   ├── DashboardTemplate.tsx     # authenticated dashboard template
│   │   ├── ListTemplate.tsx          # reusable list/table page
│   │   └── DetailTemplate.tsx        # reusable detail page
│   │
│   ├── themes/                       # application visual system
│   │   ├── theme.ts                  # centralized theme configuration
│   │   ├── colors.ts                 # design color tokens
│   │   ├── typography.ts             # typography tokens
│   │   └── index.css                 # global styles / Tailwind entry
│   │
│   ├── utils/                        # small reusable utility functions
│   │   ├── formatDate.ts              # date/time formatting
│   │   ├── formatCurrency.ts          # money formatting
│   │   ├── formatStatus.ts            # status labels
│   │   ├── constants.ts               # frontend constants
│   │   └── helpers.ts                 # generic helpers
│   │
│   ├── validators/                   # client-side validation schemas
│   │   ├── auth.schema.ts             # login/register validation
│   │   ├── patient.schema.ts          # patient validation
│   │   ├── appointment.schema.ts      # appointment validation
│   │   ├── clinical.schema.ts         # clinical form validation
│   │   ├── laboratory.schema.ts       # laboratory validation
│   │   ├── pharmacy.schema.ts         # pharmacy validation
│   │   └── billing.schema.ts          # billing validation
│   │
│   ├── app.tsx                       # root application component
│   └── main.tsx                      # React application entry point
│
├── .env                              # local environment variables — NEVER commit
├── .gitignore                        # Git exclusions; MUST exclude .env
├── index.html                        # Vite HTML entry point
├── package.json                      # dependencies and npm scripts
├── tailwind.config.ts                # Tailwind CSS configuration
├── tsconfig.json                     # TypeScript configuration
├── vite.config.ts                    # Vite configuration
└── README.md                         # frontend setup and development guide
```

**Mapping from layer-based layouts** (if migrating a template with `pages/`, `services/`, `store/`):

| Layer-based location | Spec-compliant location |
|---|---|
| `pages/<domain>/` | `features/<module>/pages/` |
| `services/<x>.service.ts` | `features/<module>/api/` |
| `store/auth.store.ts` | `lib/auth-context.tsx` (memory-only; nothing persisted) |
| `templates/PageTemplate.tsx` | `components/common/` |
| `themes/` | `styles/` |

- React SPA (Vite or equivalent), TypeScript recommended (NFR-33).
- Routing: protected routes resolve via server-validated session bootstrap (`GET /auth/me` returns profile + permissions).
- API client: single axios/fetch wrapper; auto-401 handling → redirect to login; standard error envelope parsing.
- Server state via TanStack Query; forms via React Hook Form + zod resolver mirroring `validators/`.
- i18n-ready: user-facing strings externalized even for a single language (UI/UX §6).
- Session rule: HTTP-only cookie auth; no tokens, roles, or secrets in localStorage/sessionStorage (Auth flow §4, §8).

---

## 2. Role-Gated UI Pattern

```text
1. After login, call /auth/me → { user, permissions: PERM-xx[] , scope }
2. Store in AuthContext (memory; no tokens/secrets in localStorage)
3. Guards:
   <RequirePermission perm="invoice.create">…</RequirePermission>
   <RequireAnyPermission perms={["appointment.create.any","appointment.create.own"]}>…</RequireAnyPermission>
4. Route guards mirror menu visibility: if a route is hidden by permission,
   direct URL entry is still rejected by the SERVER (client guard is UX only).
```

Dashboard composition: each role's dashboard renders widgets for the permissions the user actually holds — Reception sees queue widgets; Doctor sees schedule/encounters; Accountant sees billing summary; Patient sees own appointments/bills/results.

---

## 3. State Management

| Concern | Approach |
|---------|----------|
| Session/profile | AuthContext (memory) |
| Server data | Query cache library (e.g., TanStack Query): lists, detail, dashboards |
| Forms | Form library (e.g., React Hook Form) + server-side-mirrored validation messages |
| Notifications | Polling or SSE/websocket for in-app notifications (configurable) |
| Optimistic updates | Allowed only for non-critical UI; money/clinical actions always refetch from server |

---

## 4. Key Screens (by module; details in `01-PAGE-AND-NAVIGATION-STRUCTURE.md`)

| Module | Screens |
|--------|---------|
| public | Home, Directory, Emergency Info, Register, Login, Forgot password |
| appointments | Book slot picker, My/Today's appointments, Reschedule dialog, Check-in screen, Queue board, Waitlist |
| clinical | Patient worklist, Encounter editor, EMR viewer (version history), Prescription form |
| nursing | Assigned patients, Nursing entry form |
| lab | Order queue, Specimen recording, Result entry, Verification screen, Release, Critical alert inbox |
| pharmacy | Validation queue, Dispense screen (FEFO batch suggestion), Inventory (batches/expiries), Adjustments, Quarantine/Recall |
| billing | Invoice draft editor, Issue, Payment collection, Refunds/Discounts, Reconciliation view |
| inventory | Assets register, General stock |
| notifications | Bell/menu with unread state |
| reports | Role-scoped dashboards + report views |
| admin | Users & roles, Settings (policies), Audit viewer, Backups, Break-glass review |

---

## 5. UX Rules (Binding)

1. Status badges use canonical status strings with human labels (glossary §13).
2. Destructive or sensitive actions require confirmation + reason fields where policy demands (cancellation, refund, break-glass).
3. Money fields: currency-formatted, integer-backed; never rounded client-side.
4. Forms mirror server validation: same field rules, specific messages (NFR-26); never expose stack traces.
5. Minimum-necessary display: screens show only fields the role needs; no patient banner data on pharmacy/lab screens beyond what's required for safe work.
6. Accessibility: WCAG 2.1 AA-oriented (NFR-27) — labels, focus management, contrast, keyboard paths for queue/check-in screens.
7. Session expiry: on 401, save attempted route, redirect to login, restore after re-auth.
8. Loading/empty/error states for every data view — no blank screens.

---

## 6. Security Rules for the Client

- No secrets, tokens in `localStorage`; HTTP-only cookies via server (NFR-31, session model).
- No authorization logic in the client beyond UX hiding — server is the gate (C-02).
- Client bundles must not contain role-permission maps that could contradict the server catalog; fetch permissions at runtime.
- Sanitize/encode all rendered content; avoid dangerous HTML insertion (XSS).
- File downloads (lab reports, invoices) go through authorized endpoints — never static public URLs.

---

*End of document — Frontend Specification v1.0*
