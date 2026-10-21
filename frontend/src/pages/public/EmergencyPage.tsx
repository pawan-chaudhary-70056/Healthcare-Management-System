/** S-03 Emergency Information — static content, works even if the app/DB is down (NFR-22). */
export function EmergencyPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-red-700">Emergency Information</h1>
      <p className="mt-2 text-slate-600">
        In a life-threatening situation, call <strong>911</strong> immediately. Do not wait to book online.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-700">Emergency hotline</p>
          <p className="text-2xl font-bold text-red-700">911</p>
          <p className="mt-1 text-sm text-red-600">Available 24/7</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm font-semibold text-slate-700">Ambulance</p>
          <p className="text-2xl font-bold">+1 (555) 010-0911</p>
          <p className="mt-1 text-sm text-slate-500">Fastest response: call, don't drive yourself</p>
        </div>
      </div>

      <div className="mt-6 rounded-lg border p-4">
        <p className="font-semibold">Emergency Department location</p>
        <p className="mt-1 text-sm text-slate-600">
          City General Hospital — Entrance B, 123 Health Avenue, Springfield.
          Open 24/7. Parking available at Gate 2.
        </p>
      </div>
    </div>
  )
}
