/**
 * Tests for Rate Limit service.
 * Test-first development: Tests written before implementation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import type { UserUsage } from '../../../domain/models/userUsage.js';
import type { UserUsageRepository } from '../../../domain/ports/userUsageRepository.js';
import { createRateLimitService } from '../../../domain/services/rateLimitService.js';
import { DEFAULT_LIMITS, ESTIMATED_COST_PER_TASK } from '../../../domain/models/userUsage.js';

describe('rateLimitService', () => {
  let logger: Logger;
  let mockRepo: UserUsageRepository;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    mockRepo = {
      getOrCreate: vi.fn(),
      update: vi.fn(),
      incrementConcurrent: vi.fn(),
      decrementConcurrent: vi.fn(),
      recordTaskStart: vi.fn(),
      recordActualCost: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createUsage(overrides: Partial<UserUsage> = {}): UserUsage {
    const now = Timestamp.now();
    return {
      userId: 'test-user',
      concurrentTasks: 0,
      tasksThisHour: 0,
      hourStartedAt: now,
      costToday: 0,
      costThisMonth: 0,
      dayStartedAt: now,
      monthStartedAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  describe('checkLimits', () => {
    it('should allow task when under all limits', async () => {
      mockRepo.getOrCreate = vi.fn().mockResolvedValue(createUsage());
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      const result = await service.checkLimits('user-1', 1000);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeUndefined();
      }
    });

    it('should reject when concurrent limit reached', async () => {
      mockRepo.getOrCreate = vi.fn().mockResolvedValue(
        createUsage({ concurrentTasks: DEFAULT_LIMITS.maxConcurrentTasks })
      );
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      const result = await service.checkLimits('user-1', 1000);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('concurrent_limit');
        expect(result.error.message).toContain('concurrent');
        expect(result.error.retryAfter).toBe('when a task completes');
      }
    });

    it('should reject when hourly limit reached', async () => {
      mockRepo.getOrCreate = vi.fn().mockResolvedValue(
        createUsage({ tasksThisHour: DEFAULT_LIMITS.maxTasksPerHour })
      );
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      const result = await service.checkLimits('user-1', 1000);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('hourly_limit');
        expect(result.error.message).toContain('per hour');
        expect(result.error.retryAfter).toBe('in about 1 hour');
      }
    });

    it('should reject when daily cost limit reached', async () => {
      mockRepo.getOrCreate = vi.fn().mockResolvedValue(
        createUsage({ costToday: DEFAULT_LIMITS.dailyCostCap - ESTIMATED_COST_PER_TASK + 0.01 })
      );
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      const result = await service.checkLimits('user-1', 1000);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('daily_cost_limit');
        expect(result.error.message).toContain('$20');
        expect(result.error.retryAfter).toBe('tomorrow');
      }
    });

    it('should reject when monthly cost limit reached', async () => {
      mockRepo.getOrCreate = vi.fn().mockResolvedValue(
        createUsage({ costThisMonth: DEFAULT_LIMITS.monthlyCostCap - ESTIMATED_COST_PER_TASK + 0.01 })
      );
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      const result = await service.checkLimits('user-1', 1000);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('monthly_cost_limit');
        expect(result.error.message).toContain('$200');
        expect(result.error.retryAfter).toBe('next month');
      }
    });

    it('should reject when prompt too long', async () => {
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      const result = await service.checkLimits('user-1', DEFAULT_LIMITS.maxPromptLength + 1);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('prompt_too_long');
        expect(result.error.message).toContain('10000');
      }
      // Should not even call repository
      expect(mockRepo.getOrCreate).not.toHaveBeenCalled();
    });

    it('should allow when prompt length equals max', async () => {
      mockRepo.getOrCreate = vi.fn().mockResolvedValue(createUsage());
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      const result = await service.checkLimits('user-1', DEFAULT_LIMITS.maxPromptLength);

      expect(result.ok).toBe(true);
    });

    it('should call logger.debug with usage data', async () => {
      mockRepo.getOrCreate = vi.fn().mockResolvedValue(
        createUsage({ concurrentTasks: 2, tasksThisHour: 5, costToday: 10.5 })
      );
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      await service.checkLimits('user-1', 1000);

      expect(logger.debug).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          usage: { concurrent: 2, hourly: 5, costToday: 10.5 },
        },
        'Checking rate limits'
      );
    });

    it('should pass exactly at concurrent limit boundary', async () => {
      // Exactly at limit should still reject
      mockRepo.getOrCreate = vi.fn().mockResolvedValue(
        createUsage({ concurrentTasks: DEFAULT_LIMITS.maxConcurrentTasks })
      );
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      const result = await service.checkLimits('user-1', 1000);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('concurrent_limit');
      }
    });

    it('should allow when concurrent tasks is one below limit', async () => {
      mockRepo.getOrCreate = vi.fn().mockResolvedValue(
        createUsage({ concurrentTasks: DEFAULT_LIMITS.maxConcurrentTasks - 1 })
      );
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      const result = await service.checkLimits('user-1', 1000);

      expect(result.ok).toBe(true);
    });

    it('should allow when exactly at daily cost limit boundary minus estimated', async () => {
      // costToday + ESTIMATED_COST_PER_TASK == dailyCostCap should reject
      mockRepo.getOrCreate = vi.fn().mockResolvedValue(
        createUsage({ costToday: DEFAULT_LIMITS.dailyCostCap - ESTIMATED_COST_PER_TASK })
      );
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      const result = await service.checkLimits('user-1', 1000);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('daily_cost_limit');
      }
    });

    it('should allow when daily cost has room for one more task', async () => {
      mockRepo.getOrCreate = vi.fn().mockResolvedValue(
        createUsage({ costToday: DEFAULT_LIMITS.dailyCostCap - ESTIMATED_COST_PER_TASK - 0.01 })
      );
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      const result = await service.checkLimits('user-1', 1000);

      expect(result.ok).toBe(true);
    });
  });

  describe('recordTaskStart', () => {
    it('should increment concurrent and record start', async () => {
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      await service.recordTaskStart('user-1');

      expect(mockRepo.incrementConcurrent).toHaveBeenCalledWith('user-1');
      expect(mockRepo.recordTaskStart).toHaveBeenCalledWith('user-1', ESTIMATED_COST_PER_TASK);
    });

    it('should log info on successful record', async () => {
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      await service.recordTaskStart('user-1');

      expect(logger.info).toHaveBeenCalledWith(
        { userId: 'user-1' },
        'Recorded task start'
      );
    });
  });

  describe('recordTaskComplete', () => {
    it('should decrement concurrent without actual cost', async () => {
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      await service.recordTaskComplete('user-1');

      expect(mockRepo.decrementConcurrent).toHaveBeenCalledWith('user-1');
      expect(mockRepo.recordActualCost).not.toHaveBeenCalled();
    });

    it('should record actual cost if provided', async () => {
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      await service.recordTaskComplete('user-1', 2.50);

      expect(mockRepo.decrementConcurrent).toHaveBeenCalledWith('user-1');
      expect(mockRepo.recordActualCost).toHaveBeenCalledWith('user-1', 2.50, ESTIMATED_COST_PER_TASK);
    });

    it('should log info with actual cost', async () => {
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      await service.recordTaskComplete('user-1', 2.50);

      expect(logger.info).toHaveBeenCalledWith(
        { userId: 'user-1', actualCost: 2.50 },
        'Recorded task completion'
      );
    });

    it('should log info without actual cost', async () => {
      const service = createRateLimitService({ userUsageRepository: mockRepo, logger });

      await service.recordTaskComplete('user-1');

      expect(logger.info).toHaveBeenCalledWith(
        { userId: 'user-1', actualCost: undefined },
        'Recorded task completion'
      );
    });
  });

  describe('DEFAULT_LIMITS', () => {
    it('should have correct limit values', () => {
      expect(DEFAULT_LIMITS.maxConcurrentTasks).toBe(3);
      expect(DEFAULT_LIMITS.maxTasksPerHour).toBe(10);
      expect(DEFAULT_LIMITS.maxPromptLength).toBe(10000);
      expect(DEFAULT_LIMITS.dailyCostCap).toBe(20);
      expect(DEFAULT_LIMITS.monthlyCostCap).toBe(200);
    });
  });

  describe('ESTIMATED_COST_PER_TASK', () => {
    it('should be $1.17 as per design doc', () => {
      expect(ESTIMATED_COST_PER_TASK).toBe(1.17);
    });
  });
});
