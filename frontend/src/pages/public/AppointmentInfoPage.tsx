/** S-04 Appointment Information — public guidance */
export function AppointmentInfoPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Appointments</h1>
      <p className="mt-2 text-slate-600">How booking works at City General Hospital.</p>

      <ol className="mt-6 space-y-4">
        {[
          ['Create an account', 'Register online in about two minutes, or register at the front desk.'],
          ['Choose a department and doctor', 'Pick the specialty you need and an available time slot.'],
          ['Receive confirmation', 'You will get a confirmation right away and a reminder before your visit.'],
          ['Check in on arrival', 'Verify your identity at the front desk and receive your queue number.'],
        ].map(([title, body], i) => (
          <li key={title} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-600 text-sm font-bold text-white">
              {i + 1}
            </span>
            <div>
              <p className="font-semibold">{title}</p>
              <p className="text-sm text-slate-600">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
        <p className="font-semibold text-slate-700">Good to know</p>
        <ul className="mt-1 list-disc pl-5">
          <li>Bring a photo ID and any previous medical records to your first visit.</li>
          <li>Arrive 15 minutes early for check-in.</li>
          <li>Appointments can be rescheduled or cancelled online up to the facility's policy window.</li>
        </ul>
      </div>
    </div>
  );
}
