/**
 * Background jobs — Backend Spec §1 `jobs/` (also §6: idempotent, resumable,
 * logged; run as system actors with audited scope, never bypassing
 * authorization for user-initiated data).
 */
export { startBackgroundJobs, stopBackgroundJobs } from './notifications.job.js';
