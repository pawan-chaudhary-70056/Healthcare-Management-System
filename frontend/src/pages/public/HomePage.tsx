import { Link } from 'react-router-dom';

/** S-01 Public Home Page */
export function HomePage() {
  return (
    <div className="space-y-10">
      <section className="rounded-xl bg-gradient-to-r from-primary-700 to-primary-500 px-6 py-12 text-white">
        <h1 className="text-3xl font-bold sm:text-4xl">Care you can trust, close to home</h1>
        <p className="mt-3 max-w-2xl text-primary-50">
          Book appointments online, consult with experienced doctors, and get lab results and prescriptions —
          all in one secure system.
        </p>
        <div className="mt-6 flex gap-3">
          <Link
            to="/register"
            className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-50"
          >
            Create account
          </Link>
          <Link
            to="/appointments/info"
            className="rounded-md border border-white/60 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
          >
            How booking works
          </Link>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold">Our services</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Appointments', 'Book, reschedule, or cancel online with instant confirmation.'],
            ['Laboratory', 'Digital test orders with verified, trackable results.'],
            ['Pharmacy', 'Prescriptions dispensed safely with batch tracking.'],
            ['Billing', 'Clear invoices with online and desk payment options.'],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-lg border p-4">
              <p className="font-semibold text-primary-700">{title}</p>
              <p className="mt-1 text-sm text-slate-600">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border-l-4 border-red-500 bg-red-50 p-4">
        <p className="font-semibold text-red-700">Medical emergency?</p>
        <p className="text-sm text-red-600">
          Call 911 immediately or go to <Link to="/emergency" className="underline">emergency information</Link>.
        </p>
      </section>
    </div>
  );
}
