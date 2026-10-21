import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getPolicy } from '../config/policy.loader.js';
import { drainQueue, sendDueReminders } from '../services/notification.service.js';

/**
 * Background job runner (Backend Spec §6). Idempotent, resumable, logged.
 * In-process interval scheduler — no broker dependency for the monolith;
 * PH-09 ops may move these to workers without changing job bodies.
 *
 * Jobs here:
 *  - notification queue drain (outbox-style delivery, never in the critical tx)
 *  - appointment reminders per policy lead time (Build TODOs PH-03, AC-20)
 */

interface JobHandle {
  name: string;
  timer: NodeJS.Timeout;
}

const handles: JobHandle[] = [];
let running = false;

export function startBackgroundJobs(): void {
  if (running) return;
  running = true;

  const drainMs = env.NOTIFICATION_DRAIN_SECONDS * 1000;
  handles.push({
    name: 'notifications.drain',
    timer: setInterval(() => {
      void (async () => {
        try {
          await drainQueue();
        } catch (err) {
          logger.error({ err }, 'Job notifications.drain failed');
        }
      })();
    }, drainMs),
  });

  const reminderMs = env.REMINDER_SWEEP_MINUTES * 60_000;
  handles.push({
    name: 'appointments.reminders',
    timer: setInterval(() => {
      void (async () => {
        try {
          const sent = await sendDueReminders();
          if (sent > 0) logger.debug({ sent }, 'Reminders enqueued');
        } catch (err) {
          logger.error({ err }, 'Job appointments.reminders failed');
        }
      })();
    }, reminderMs),
  });

  logger.info(
    { jobs: handles.map((h) => h.name), reminderLeadHours: getPolicy().REMINDER_LEAD_HOURS },
    'Background jobs started'
  );
}

export function stopBackgroundJobs(): void {
  for (const h of handles) clearInterval(h.timer);
  handles.length = 0;
  running = false;
}
