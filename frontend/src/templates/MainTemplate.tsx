import { Link, Outlet } from 'react-router-dom';

/** Public shell — global footer carries emergency contact on every page. */
export function MainTemplate() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-800">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-bold text-primary-700">
            City General Hospital
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/departments" className="hover:text-primary-600">
              Departments
            </Link>
            <Link to="/appointments/info" className="hover:text-primary-600">
              Appointments
            </Link>
            <Link to="/emergency" className="font-semibold text-red-600 hover:text-red-700">
              Emergency
            </Link>
            <Link
              to="/login"
              className="rounded-md bg-primary-600 px-3 py-1.5 font-medium text-white hover:bg-primary-700"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-red-600">Emergency: 911 · 24/7</p>
            <p>123 Health Avenue, Springfield · +1 (555) 010-0199</p>
          </div>
          <p>© {new Date().getFullYear()} City General Hospital · Your data is protected</p>
        </div>
      </footer>
    </div>
  );
}
