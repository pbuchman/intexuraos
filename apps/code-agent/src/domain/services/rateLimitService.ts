/**
 * Service for checking rate limits before accepting new tasks.
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import type { UserUsageRepository } from '../ports/userUsageRepository.js';
import { DEFAULT_LIMITS, ESTIMATED_COST_PER_TASK } from '../models/userUsage.js';

export interface RateLimitError {
  code: 'concurrent_limit' | 'hourly_limit' | 'daily_cost_limit' | 'monthly_cost_limit' | 'prompt_too_long' | 'service_unavailable';
  message: string;
  retryAfter?: string;
}

export interface RateLimitServiceDeps {
  userUsageRepository: UserUsageRepository;
  logger: Logger;
}

export interface RateLimitService {
  /** Check all rate limits before accepting a task */
  checkLimits(userId: string, promptLength: number): Promise<Result<void, RateLimitError>>;

  /** Record task start (increment counters) */
  recordTaskStart(userId: string): Promise<void>;

  /** Record task completion (decrement concurrent, update cost) */
  recordTaskComplete(userId: string, actualCost?: number): Promise<void>;
}

export function createRateLimitService(deps: RateLimitServiceDeps): RateLimitService {
  const { userUsageRepository, logger } = deps;
  const limits = DEFAULT_LIMITS;

  return {
    async checkLimits(userId: string, promptLength: number): Promise<Result<void, RateLimitError>> {
      // Check prompt length first (no DB needed)
      if (promptLength > limits.maxPromptLength) {
        return err({
          code: 'prompt_too_long',
          message: `Prompt exceeds maximum length of ${String(limits.maxPromptLength)} characters`,
        });
      }

      let usage;
      try {
        usage = await userUsageRepository.getOrCreate(userId);
      } catch (error) {
        const errorMessage = getErrorMessage(error, 'Unknown error');
        logger.error({ userId, error: errorMessage }, 'Failed to fetch user usage for rate limiting');
        return err({
          code: 'service_unavailable',
          message: 'Unable to verify rate limits. Please try again.',
        });
      }

      logger.debug(
        { userId, usage: { concurrent: usage.concurrentTasks, hourly: usage.tasksThisHour, costToday: usage.costToday } },
        'Checking rate limits'
      );

      // Check concurrent limit
      if (usage.concurrentTasks >= limits.maxConcurrentTasks) {
        return err({
          code: 'concurrent_limit',
          message: `Maximum ${String(limits.maxConcurrentTasks)} concurrent tasks allowed`,
          retryAfter: 'when a task completes',
        });
      }

      // Check hourly limit
      if (usage.tasksThisHour >= limits.maxTasksPerHour) {
        return err({
          code: 'hourly_limit',
          message: `Maximum ${String(limits.maxTasksPerHour)} tasks per hour allowed`,
          retryAfter: 'in about 1 hour',
        });
      }

      // Check daily cost
      if (usage.costToday + ESTIMATED_COST_PER_TASK >= limits.dailyCostCap) {
        return err({
          code: 'daily_cost_limit',
          message: `Daily cost limit of $${String(limits.dailyCostCap)} reached ($${usage.costToday.toFixed(2)} spent today)`,
          retryAfter: 'tomorrow',
        });
      }

      // Check monthly cost
      if (usage.costThisMonth + ESTIMATED_COST_PER_TASK >= limits.monthlyCostCap) {
        return err({
          code: 'monthly_cost_limit',
          message: `Monthly cost limit of $${String(limits.monthlyCostCap)} reached ($${usage.costThisMonth.toFixed(2)} spent this month)`,
          retryAfter: 'next month',
        });
      }

      return ok(undefined);
    },

    async recordTaskStart(userId: string): Promise<void> {
      await userUsageRepository.incrementConcurrent(userId);
      await userUsageRepository.recordTaskStart(userId, ESTIMATED_COST_PER_TASK);
      logger.info({ userId }, 'Recorded task start');
    },

    async recordTaskComplete(userId: string, actualCost?: number): Promise<void> {
      await userUsageRepository.decrementConcurrent(userId);
      if (actualCost !== undefined) {
        await userUsageRepository.recordActualCost(userId, actualCost, ESTIMATED_COST_PER_TASK);
      }
      logger.info({ userId, actualCost }, 'Recorded task completion');
    },
  };
}
