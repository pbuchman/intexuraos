/**
 * User usage model for rate limiting and cost tracking.
 *
 * Design doc: docs/designs/INT-156-code-action-type.md (lines 2625-2689)
 */

import type { Timestamp } from '@google-cloud/firestore';

export interface UserUsage {
  userId: string;

  /** Number of tasks currently in 'dispatched' or 'running' status */
  concurrentTasks: number;

  /** Number of tasks created in the current hour */
  tasksThisHour: number;

  /** When the current hour window started */
  hourStartedAt: Timestamp;

  /** Estimated cost accumulated today (in dollars) */
  costToday: number;

  /** Estimated cost accumulated this month (in dollars) */
  costThisMonth: number;

  /** When the current day window started (UTC midnight) */
  dayStartedAt: Timestamp;

  /** When the current month window started (1st of month UTC) */
  monthStartedAt: Timestamp;

  updatedAt: Timestamp;
}

export const DEFAULT_LIMITS = {
  maxConcurrentTasks: 3,
  maxTasksPerHour: 10,
  maxPromptLength: 10000,
  dailyCostCap: 20, // $20
  monthlyCostCap: 200, // $200
} as const;

export const ESTIMATED_COST_PER_TASK = 1.17; // $1.17 (see design doc line 2255)
