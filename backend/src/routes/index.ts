import type { Express } from 'express';
import { requireScope } from '../middlewares/scope.middleware.js';
import { requireMfaComplete } from '../middlewares/auth.middleware.js';
import { authRouter } from './auth.routes.js';
import { adminRouter, publicRouter } from './admin.routes.js';
import { patientRouter } from './patient.routes.js';
import { appointmentRouter } from './appointment.routes.js';
import { clinicalRouter } from './clinical.routes.js';
import { labRouter } from './lab.routes.js';
import { pharmacyRouter } from './pharmacy.routes.js';
import { billingRouter, webhookRouter } from './billing.routes.js';
import { platformRouter } from './platform.routes.js';

/**
 * Central route registration — Backend Spec §2.
 * Required order: /auth first, then the MFA gate + scope tag for all other
 * `/api/v1` routes, then the module routers.
 */
export function registerRoutes(app: Express): void {
  app.use('/api/v1/auth', authRouter);

  // SEC-04 / AC-07: everything below /api/v1 (except /auth) is blocked while a
  // session has an incomplete MFA challenge (mfaPending). Auth endpoints stay
  // reachable so enrollment/verification can complete.
  app.use('/api/v1', (req, res, next) => {
    void res;
    requireMfaComplete(req, res, next);
  });

  // Scope tagging (Auth Flow §5 step 3, layer 1): resolve the actor's widest
  // window ('all' | 'assigned' | 'own') once; object-level checks re-verify in
  // services (defense in depth) and audit every denial (SEC-08, R-08/R-09).
  app.use('/api/v1', requireScope('patient'));

  app.use('/api/v1/public', publicRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/patients', patientRouter);
  app.use('/api/v1/appointments', appointmentRouter);
  app.use('/api/v1/clinical', clinicalRouter);
  app.use('/api/v1/lab', labRouter);
  app.use('/api/v1/pharmacy', pharmacyRouter);
  app.use('/api/v1/billing', billingRouter);
  // Gateway webhook: system actor, signature-verified (SEC-25) — no session.
  app.use('/api/v1/billing/webhook', webhookRouter);
  app.use('/api/v1/platform', platformRouter);
}
