/**
 * Polling and waiting helpers for E2E tests.
 *
 * Provides utilities to wait for async operations in tests.
 */

import type { AxiosInstance } from 'axios';
import type { CodeTask } from './client.js';

/**
 * Terminal task statuses that won't change.
 */
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'interrupted'] as const;

/**
 * Poll until task reaches expected status or timeout.
 *
 * @param client - Axios instance for API calls
 * @param taskId - Task ID to poll
 * @param expectedStatus - Status to wait for
 * @param timeoutMs - Maximum time to wait (default: 60000ms)
 * @param pollIntervalMs - Time between polls (default: 1000ms)
 * @returns The completed task
 * @throws Error if timeout or unexpected terminal status
 */
export async function waitForTaskStatus(
  client: AxiosInstance,
  taskId: string,
  expectedStatus: string,
  timeoutMs = 60000,
  pollIntervalMs = 1000
): Promise<CodeTask> {
  const startTime = Date.now();
  let lastStatus: string | null = null;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await client.get(`/code/tasks/${taskId}`);

      if (response.status !== 200) {
        throw new Error(`Failed to get task status: ${String(response.status)}`);
      }

      const task = response.data as CodeTask;
      lastStatus = task.status;

      if (task.status === expectedStatus) {
        return task;
      }

      // Check for unexpected terminal status
      if (TERMINAL_STATUSES.includes(task.status as (typeof TERMINAL_STATUSES)[number])) {
        throw new Error(
          `Task reached terminal status "${task.status}", expected "${expectedStatus}"`
        );
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } catch (error) {
      // If network error, retry. Otherwise throw
      if (error instanceof Error && error.message.includes('terminal status')) {
        throw error;
      }
      // Retry on transient errors
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  throw new Error(
    `Timeout waiting for task ${taskId} to reach status "${expectedStatus}". Last status: "${String(lastStatus)}"`
  );
}

/**
 * Poll until a condition is met or timeout.
 *
 * @param conditionFn - Function to check (return true when done)
 * @param timeoutMs - Maximum time to wait
 * @param pollIntervalMs - Time between checks
 * @param context - Description for error messages
 * @throws Error if timeout
 */
export async function waitForCondition(
  conditionFn: () => Promise<boolean> | boolean,
  timeoutMs = 30000,
  pollIntervalMs = 500,
  context = 'condition'
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await conditionFn()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timeout waiting for ${context}`);
}

/**
 * Sleep for a specified duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for task to be created in list endpoint.
 *
 * @param client - Axios instance for API calls
 * @param userId - User ID to filter by
 * @param timeoutMs - Maximum time to wait
 */
export async function waitForTaskInList(
  client: AxiosInstance,
  userId: string,
  timeoutMs = 10000
): Promise<CodeTask> {
  return waitForCondition(
    async () => {
      const response = await client.get('/code/tasks', { params: { userId } });
      if (response.status !== 200) return false;
      const tasks = response.data.tasks as CodeTask[];
      return tasks.length > 0;
    },
    timeoutMs,
    500,
    'task to appear in list'
  ).then(async () => {
    const response = await client.get('/code/tasks', { params: { userId } });
    const tasks = response.data.tasks as CodeTask[];
    const task = tasks[0];
    if (task === undefined) {
      throw new Error('Task list became empty unexpectedly');
    }
    return task;
  });
}
