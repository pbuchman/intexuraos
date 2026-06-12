/**
 * Queue drain helper for E2E tests.
 *
 * Since E2E has no Cloud Scheduler, this polls /internal/drain-queue
 * to move tasks from 'queued' to 'dispatched'.
 */

import type { AxiosInstance, AxiosRequestConfig } from 'axios';

const DRAIN_INTERVAL_MS = 2000;

// authenticateInternalScheduler hard-rejects when Authorization: Bearer is
// present but isn't a valid Google OIDC token. The shared E2E client carries
// `Bearer test-token` for user routes; internal-scheduler endpoints must
// receive the request without it so the helper falls through to the
// `x-internal-auth` shared-secret path.
const DRAIN_REQUEST: AxiosRequestConfig = {
  headers: { Authorization: '' },
};

let drainTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start a background drain poller that mimics Cloud Scheduler.
 *
 * Calls POST /internal/drain-queue every 2 seconds so queued tasks
 * get dispatched to the mock-claude worker.
 */
export function startDrainPoller(client: AxiosInstance): void {
  if (drainTimer !== null) return;

  drainTimer = setInterval(() => {
    void client.post('/internal/drain-queue', undefined, DRAIN_REQUEST).catch(() => {
      // Ignore errors — drain may fail if no tasks are queued
    });
  }, DRAIN_INTERVAL_MS);
}

/**
 * Stop the background drain poller.
 */
export function stopDrainPoller(): void {
  if (drainTimer !== null) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
}

/**
 * Trigger a single drain cycle.
 *
 * Use this for tests that need immediate drain after submit.
 */
export async function triggerDrain(client: AxiosInstance): Promise<void> {
  await client.post('/internal/drain-queue', undefined, DRAIN_REQUEST).catch(() => {
    // Ignore errors
  });
}
