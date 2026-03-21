/**
 * Queue drain helper for E2E tests.
 *
 * Since E2E has no Cloud Scheduler, this polls /internal/drain-queue
 * to move tasks from 'queued' to 'dispatched'.
 */

import type { AxiosInstance } from 'axios';

const DRAIN_INTERVAL_MS = 2000;

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
    void client.post('/internal/drain-queue').catch(() => {
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
  await client.post('/internal/drain-queue').catch(() => {
    // Ignore errors
  });
}
