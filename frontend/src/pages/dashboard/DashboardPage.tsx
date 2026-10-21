import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';

interface ModuleCard {
  label: string;
  description: string;
  to: string; // route inside the dashboard shell
  anyPermission: string[]; // visible only when the user holds at least one (UX hiding)
}

/** Dashboard modules per role — permission-driven, server is the gate (S-09, AC-54). */
const MODULES: ModuleCard[] = [
  {
    label: 'Patients',
    description: 'Register, search, and manage patient records.',
    to: '/dashboard/reception',
    anyPermission: ['patient.create', 'patient.read.assigned', 'patient.read.all', 'patient.read.own'],
  },
  {
    label: 'Appointments',
    description: 'Book, check in, and manage the visit queue.',
    to: '/dashboard/appointments',
    anyPermission: [
      'appointment.create.any',
      'appointment.create.own',
      'appointment.read.own-schedule',
      'appointment.read.assigned',
      'appointment.queue.manage',
    ],
  },
  {
    label: 'Clinical Care',
    description: 'Encounters, medical records, and prescriptions.',
    to: '/dashboard/clinical',
    anyPermission: ['encounter.create', 'emr.read.assigned', 'emr.read.released.own', 'nursing.entry.create'],
  },
  {
    label: 'Laboratory',
    description: 'Orders, specimens, results, and verification.',
    to: '/dashboard/lab',
    anyPermission: [
      'lab.order.create',
      'lab.specimen.record',
      'lab.result.enter',
      'lab.result.read.assigned',
      'lab.result.read.released.own',
    ],
  },
  {
    label: 'Pharmacy',
    description: 'Dispensing and medicine inventory.',
    to: '/dashboard/pharmacy',
    anyPermission: [
      'prescription.validate',
      'prescription.dispense',
      'pharmacy.inventory.manage',
      'prescription.read.own',
    ],
  },
  {
    label: 'Billing',
    description: 'Invoices, payments, refunds, and reconciliation.',
    to: '/dashboard/billing',
    anyPermission: [
      'invoice.create',
      'invoice.read.any',
      'invoice.read.own',
      'payment.record',
      'payment.refund.approve',
    ],
  },
  {
    label: 'Administration',
    description: 'Users, roles, settings, audit, and backups.',
    to: '/dashboard/admin',
    anyPermission: ['user.manage', 'settings.manage', 'audit.read.all', 'backup.manage', 'breakglass.review'],
  },
];

export function DashboardPage() {
  const { user } = useAuth();

  const visible = MODULES.filter((m) => m.anyPermission.some((p) => user?.permissions.includes(p)));

  return (
    <div>
      <h1 className="text-2xl font-bold">Welcome{user?.email ? `, ${user.email}` : ''}</h1>
      <p className="mt-1 text-sm text-slate-600">
        Your workspace shows only the modules your role authorizes.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((m) => (
          <Link
            key={m.label}
            to={m.to}
            className="rounded-lg border bg-white p-4 transition hover:border-primary-500 hover:shadow-sm"
          >
            <p className="font-semibold text-primary-700">{m.label}</p>
            <p className="mt-1 text-sm text-slate-600">{m.description}</p>
            <p className="mt-3 text-xs font-medium text-primary-600">Open module →</p>
          </Link>
        ))}
      </div>

      {visible.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">No modules are enabled for your account yet.</p>
      )}

      <div className="mt-8 rounded-lg border bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Session</p>
        <p className="mt-1 text-xs text-slate-500">
          Signed in as <span className="font-medium text-slate-700">{user?.email}</span> · role{' '}
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs uppercase">{user?.role}</span> ·
          secure HTTP-only cookie session
        </p>
      </div>
    </div>
  );
}
