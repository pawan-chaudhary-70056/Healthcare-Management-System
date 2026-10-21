import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { setUnauthorizedRedirect } from '../api/client.js';
import { RequireAuth } from './ProtectedRoute.js';
import { MainTemplate } from '../templates/MainTemplate.js';
import { DashboardTemplate } from '../templates/DashboardTemplate.js';
import { HomePage } from '../pages/public/HomePage.js';
import { DepartmentsPage } from '../pages/public/DepartmentsPage.js';
import { EmergencyPage } from '../pages/public/EmergencyPage.js';
import { AppointmentInfoPage } from '../pages/public/AppointmentInfoPage.js';
import { LoginPage } from '../pages/auth/LoginPage.js';
import { RegisterPage } from '../pages/auth/RegisterPage.js';
import { ForgotPasswordPage } from '../pages/auth/ForgotPasswordPage.js';
import { ResetPasswordPage } from '../pages/auth/ResetPasswordPage.js';
import { DashboardPage } from '../pages/dashboard/DashboardPage.js';
import { PatientAppointmentsPage } from '../pages/appointments/PatientAppointmentsPage.js';
import { ReceptionPage } from '../pages/appointments/ReceptionPage.js';
import { DoctorSchedulePage } from '../pages/appointments/DoctorSchedulePage.js';
import { ClinicalPage } from '../pages/clinical/ClinicalPage.js';
import { LabPage } from '../pages/laboratory/LabPage.js';
import { PharmacyPage } from '../pages/pharmacy/PharmacyPage.js';
import { BillingPage } from '../pages/billing/BillingPage.js';
import { AdminPage } from '../pages/admin/AdminPage.js';

export function AppRoutes() {
  const navigate = useNavigate();

  // Auto-401 handling: the api client asks the router to go to /login (UX rule 7).
  useEffect(() => {
    setUnauthorizedRedirect((path) => navigate(path, { replace: true }));
  }, [navigate]);

  return (
    <Routes>
      {/* Public website (S-01..S-04) */}
      <Route element={<MainTemplate />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/departments" element={<DepartmentsPage />} />
        <Route path="/emergency" element={<EmergencyPage />} />
        <Route path="/appointments/info" element={<AppointmentInfoPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>

      {/* Authenticated shell — role dashboards (S-09) */}
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <DashboardTemplate />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="appointments" element={<PatientAppointmentsPage />} />
        <Route path="reception" element={<ReceptionPage />} />
        <Route path="schedule" element={<DoctorSchedulePage />} />
        <Route path="clinical" element={<ClinicalPage />} />
        <Route path="lab" element={<LabPage />} />
        <Route path="pharmacy" element={<PharmacyPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
