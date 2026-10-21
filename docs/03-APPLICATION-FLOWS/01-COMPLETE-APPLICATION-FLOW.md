# 01 — Complete Application Flow

> **Document:** End-to-end application entry, navigation, and exit flow for the HMS
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** All audiences
> **Related documents:** `03-SCOPE-AND-ASSUMPTIONS.md`, `02-AUTHENTICATION-AND-AUTHORIZATION-FLOW.md`, `01-PAGE-AND-NAVIGATION-STRUCTURE.md`
> **Rule:** The application opens on a **public Home Page** — never directly on a login screen.

---

## 1. High-Level Flow

```text
START
  │
  ▼
Open Application
  │
  ▼
Public Home Page (no login required)
  ├── Hospital introduction, departments, services, contacts
  ├── Doctor & Department Directory (browsable)
  ├── Emergency Information (always reachable)
  └── Appointment information
  │
  ▼
Explore Healthcare Services (visitor browses)
  │
  ▼
Action requires authentication?
  ├── Yes → Authentication Gateway
  │            ├── Login
  │            ├── Patient self-registration
  │            ├── Password reset
  │            └── MFA (privileged users)
  │                  │
  │                  ▼
  └── No → continue browsing
             │
             ▼
Role-Based Dashboard (loaded from server permissions)
  ├── Admin Dashboard
  ├── Reception Dashboard
  ├── Doctor Dashboard
  ├── Nurse Dashboard
  ├── Lab Technician Dashboard
  ├── Pharmacist Dashboard
  ├── Accountant Dashboard
  └── Patient Portal
             │
             ▼
Access Authorized Modules (only those the role permits)
  │
  ▼
Logout (session invalidated, audit written)
  │
  ▼
END (return to Public Home Page)
```

---

## 2. What Each Audience Sees First

| User | Lands on | Can reach |
|------|----------|-----------|
| Visitor | Public Home Page | Directory, emergency info, register, login |
| Patient | Patient Portal dashboard | Own appointments, bills, released results, profile |
| Receptionist | Reception Dashboard | Registration, appointments, check-in, queue, billing view |
| Doctor | Doctor Dashboard | Own schedule, encounters, EMR, prescriptions, lab orders |
| Nurse | Nurse Dashboard | Assigned patients, nursing entries |
| Lab Technician | Lab Dashboard | Lab queue, specimens, results, verification |
| Pharmacist | Pharmacy Dashboard | Validation queue, dispensing, inventory |
| Accountant | Finance Dashboard | Invoices, payments, refunds, reports |
| Admin | Admin Dashboard | Users, roles, settings, audit review, backups, break-glass review |

---

## 3. Navigation Principles

1. **Public first** — exploring the hospital never requires an account.
2. **Auth only when needed** — login is requested at the moment an action requires identity.
3. **Dashboard is role-shaped** — the dashboard is generated from server-loaded permissions; users never see modules they cannot use.
4. **Emergency info always public** — reachable from every public page footer.
5. **Session awareness** — expired sessions redirect to login with a neutral message, then return the user to the page they attempted.
6. **Logout is explicit and audited** — header control on every authenticated page.

---

## 4. Flow Rules for AI Agents

- Implement routes/pages so that **deep links to protected pages** always pass through the authorization pipeline (`02-AUTHENTICATION-AND-AUTHORIZATION-FLOW.md §5`) — never client-side hiding alone.
- After login, redirect users to their **role dashboard**, not a generic home.
- After logout, redirect to the public Home Page.
- A user's dashboard must be built from the **server permission set** (PERM-xx), not from a hard-coded role-to-page map in the frontend bundle alone. The frontend map may exist for UX but the server remains the gate.

---

*End of document — Complete Application Flow v1.0*
