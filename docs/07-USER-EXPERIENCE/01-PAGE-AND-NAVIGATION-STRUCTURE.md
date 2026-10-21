# 01 — Page and Navigation Structure

> **Document:** Complete page inventory, routes, access levels, and navigation map for the HMS
> **Version:** 1.0
> **Status:** Draft for review
> **Audience:** All audiences
> **Related documents:** `02-UI-UX-REQUIREMENTS.md`, `01-COMPLETE-APPLICATION-FLOW.md`, `01-ROLES-AND-PERMISSIONS.md`
> **Rule:** Every page lists its access level. Pages not listed here must not be created without updating this document.

---

## 1. Public Pages (no login)

| Page | Route | Contents |
|------|-------|----------|
| Home | `/` | Hero, services overview, departments, contact, emergency banner |
| Departments & Doctors | `/departments`, `/doctors` | Directory cards (name, specialty, availability) |
| Emergency Info | `/emergency` | Emergency numbers, location, 24/7 note |
| Appointment Info | `/appointments/info` | How booking works, visiting hours |
| Login | `/login` | Credentials + MFA step |
| Register | `/register` | Patient self-registration + privacy notice |
| Forgot / Reset Password | `/forgot-password`, `/reset-password` | Neutral recovery flow |

**Global footer (all public pages):** emergency phone, address, privacy notice link.

---

## 2. Authenticated Shell

After login, all roles share a shell: top bar (facility name, notifications bell, user menu with logout) + sidebar with **only the sections the user's permissions allow**. Each role lands on its dashboard at `/dashboard`.

---

## 3. Role Dashboards & Module Pages

### 3.1 Patient Portal (role: Patient)
| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/dashboard` | Next appointment, outstanding bills, recent released results |
| Book Appointment | `/appointments/book` | Department → doctor → slot picker |
| My Appointments | `/appointments` | List, reschedule/cancel within policy |
| My Results | `/results` | Released lab results only |
| My Prescriptions | `/prescriptions` | Own prescriptions |
| My Bills | `/billing` | Invoices, pay online, receipts |
| My Profile | `/profile` | Demographics edit, consent settings |

### 3.2 Reception (role: Receptionist)
| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/dashboard` | Today's appointments, arrivals, queue snapshot |
| Register Patient | `/patients/new` | Full registration |
| Patients Search | `/patients` | Search, open patient card |
| Appointments | `/appointments` | Day/week view, book for walk-ins |
| Check-in & Queue | `/checkin`, `/queue` | Identity verify, token issue, queue board |
| Waitlist | `/waitlist` | Manage waitlist offers |
| Payments Desk | `/billing/desk` | Record cash/POS payments, receipts |

### 3.3 Doctor
| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/dashboard` | Own schedule, waiting patients, critical alerts |
| My Schedule | `/schedule` | Day/week appointments |
| Encounter | `/encounters/:id` | Consultation editor (EMR) |
| Patient Chart | `/patients/:id/chart` | Assigned patient's EMR, history |
| Prescribe | part of encounter | Prescription form |
| Lab Orders | `/lab-orders` | Own orders, results to review |
| Break-Glass | `/breakglass` | Emergency access request (if eligible) |

### 3.4 Nurse
| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/dashboard` | Assigned patients, tasks |
| Assigned Patients | `/nursing/patients` | Patient list (assigned scope) |
| Nursing Entry | `/nursing/patients/:id/entry` | Care notes |
| Patient View | `/patients/:id/chart` | Read-relevant clinical context |

### 3.5 Lab Technician
| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/dashboard` | Order queue, pending verifications, criticals |
| Lab Queue | `/lab/orders` | Orders by status |
| Specimen Recording | `/lab/orders/:id/specimen` | Collection details |
| Result Entry | `/lab/orders/:id/results` | Values entry |
| Verification | `/lab/results/verify` | Review & verify |
| Release | `/lab/results/release` | Release to doctor/patient |

### 3.6 Pharmacist
| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/dashboard` | Validation queue, low-stock, expiring batches |
| Dispense | `/pharmacy/dispense/:prescriptionId` | Validation + FEFO picking |
| Inventory | `/pharmacy/inventory` | Batches, expiry view |
| Stock Movements | `/pharmacy/movements` | Receipts, adjustments log |
| Quarantine/Recall | `/pharmacy/quarantine` | Blocked stock management |

### 3.7 Accountant
| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/dashboard` | Today's collections, outstanding, issues |
| Invoices | `/billing/invoices` | Draft/issued lists, create invoice |
| Invoice Detail | `/billing/invoices/:id` | Lines, issue, payments, adjustments |
| Payments | `/billing/payments` | Records, gateway status |
| Refunds & Discounts | `/billing/refunds` | Approval workflows |
| Reconciliation | `/billing/reconciliation` | Gateway vs cash vs invoices |

### 3.8 Admin
| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/dashboard` | System snapshot: users, activity, alerts |
| Users & Roles | `/admin/users` | CRUD, role assignment |
| Departments & Schedules | `/admin/departments`, `/admin/schedules` | Department catalog; doctor weekly templates + date exceptions (FR-57) |
| Settings | `/admin/settings` | Facility policies (windows, timeouts, queues) |
| Audit Viewer | `/admin/audit` | Search/filter audit trail |
| Break-Glass Review | `/admin/breakglass` | Review queue (72 h) |
| Backups | `/admin/backups` | Trigger/verify, history |
| Reports | `/reports` | Cross-module reports |

---

## 4. Navigation Rules

1. Sidebar sections derive from **server permissions** (`/auth/me`), not hard-coded role checks.
2. Deep links to unauthorized pages → "no access" screen (403 UI), never a crash.
3. Every list page: search + filters + pagination consistent with API standards.
4. Breadcrumbs on detail pages; back returns to the list preserving filters.
5. Notification bell: unread count → panel linking to relevant pages.
6. Logout: explicit in user menu; ends session server-side.

---

*End of document — Page and Navigation Structure v1.0*
