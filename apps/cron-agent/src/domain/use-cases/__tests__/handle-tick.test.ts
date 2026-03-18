import { describe, it, expect } from 'vitest';
import { handleTick } from '../handle-tick.js';
import { ok } from '@intexuraos/common-core';
import type { CronSchedule } from '../../types.js';

function createTestLogger(): never {
  return {
    info: () => { /* noop */ },
    warn: () => { /* noop */ },
    error: () => { /* noop */ },
    debug: () => { /* noop */ },
    child: () => createTestLogger(),
  } as never;
}

function createTestSchedule(overrides: Partial<CronSchedule> = {}): CronSchedule {
  return {
    id: 'schedule-1',
    userId: 'user-1',
    name: 'Test Schedule',
    description: 'Every minute',
    cronExpression: '* * * * *',
    timezone: 'UTC',
    action: { services: ['code-agent'], instruction: 'do something' },
    status: 'active',
    lastExecutedAt: null,
    nextExecutionAt: new Date(Date.now() - 60000).toISOString(),
    executionCount: 0,
    failureCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('handleTick', () => {
  it('returns zeros when no schedules are due', async () => {
    const result = await handleTick({
      logger: createTestLogger(),
      scheduleRepo: {
        create: async () => ok({} as CronSchedule),
        findById: async () => ok(null),
        findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
        findDueSchedules: async () => ok([]),
        update: async () => ok({} as CronSchedule),
      },
      executionRepo: {
        create: async () => ok({} as never),
        findById: async () => ok(null),
        findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findRunningByScheduleId: async () => ok(null),
        update: async () => ok({} as never),
      },
      executeDeps: {
        logger: createTestLogger(),
        executionRepo: {} as never,
        scheduleRepo: {} as never,
        actionDeps: {} as never,
      },
    });
    expect(result).toEqual({ executed: 0, skipped: 0, errors: 0 });
  });

  it('skips schedules that are already running', async () => {
    const schedule = createTestSchedule();

    const result = await handleTick({
      logger: createTestLogger(),
      scheduleRepo: {
        create: async () => ok({} as CronSchedule),
        findById: async () => ok(schedule),
        findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
        findDueSchedules: async () => ok([schedule]),
        update: async () => ok(schedule),
      },
      executionRepo: {
        create: async () => ok({} as never),
        findById: async () => ok(null),
        findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findRunningByScheduleId: async () => ok({ id: 'exec-1' } as never),
        update: async () => ok({} as never),
      },
      executeDeps: {
        logger: createTestLogger(),
        executionRepo: {} as never,
        scheduleRepo: {} as never,
        actionDeps: {} as never,
      },
    });
    expect(result.skipped).toBe(1);
    expect(result.executed).toBe(0);
  });

  it('executes due schedules successfully', async () => {
    const schedule = createTestSchedule();

    const result = await handleTick({
      logger: createTestLogger(),
      scheduleRepo: {
        create: async () => ok({} as CronSchedule),
        findById: async () => ok(schedule),
        findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
        findDueSchedules: async () => ok([schedule]),
        update: async () => ok(schedule),
      },
      executionRepo: {
        create: async () => ok({} as never),
        findById: async () => ok(null),
        findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findRunningByScheduleId: async () => ok(null),
        update: async () => ok({} as never),
      },
      executeDeps: {
        logger: createTestLogger(),
        executionRepo: {
          create: async () => ok({
            id: 'exec-1',
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            userId: schedule.userId,
            status: 'running' as const,
            trigger: 'scheduled' as const,
            startedAt: new Date().toISOString(),
            completedAt: null,
            durationMs: null,
            toolCalls: [],
            agentResponse: null,
            tokenUsage: null,
            error: null,
            createdAt: new Date().toISOString(),
          }),
          findById: async () => ok(null),
          findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
          findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
          findRunningByScheduleId: async () => ok(null),
          update: async () => ok({} as never),
        },
        scheduleRepo: {
          create: async () => ok(schedule),
          findById: async () => ok(schedule),
          findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
          findDueSchedules: async () => ok([]),
          update: async () => ok(schedule),
        },
        actionDeps: {
          logger: createTestLogger(),
          toolRegistry: {
            getToolsForService: async () => [],
            getToolsForServices: async () => [{
              name: 'test-tool',
              description: 'Test',
              parameters: { type: 'object', properties: {} },
              run: async (): Promise<string> => '{}',
            }],
            listServiceTools: async () => [{ key: 'code-agent', name: 'Code Agent', tools: [] }],
            refreshAll: async (): Promise<void> => { /* noop */ },
          },
          toolCallingClient: {
            run: async () => ok({
              content: 'Done',
              toolCallsMade: 0,
              iterationCount: 1,
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
            }),
          },
        },
      },
    });
    expect(result.executed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('counts errors when executeSchedule fails', async () => {
    const schedule = createTestSchedule();

    const result = await handleTick({
      logger: createTestLogger(),
      scheduleRepo: {
        create: async () => ok({} as CronSchedule),
        findById: async () => ok(schedule),
        findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
        findDueSchedules: async () => ok([schedule]),
        update: async () => ok(schedule),
      },
      executionRepo: {
        create: async () => ok({} as never),
        findById: async () => ok(null),
        findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findRunningByScheduleId: async () => ok(null),
        update: async () => ok({} as never),
      },
      executeDeps: {
        logger: createTestLogger(),
        executionRepo: {
          create: async () => ({
            ok: false as const,
            error: { code: 'INTERNAL_ERROR' as const, message: 'DB error' },
          }),
          findById: async () => ok(null),
          findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
          findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
          findRunningByScheduleId: async () => ok(null),
          update: async () => ok({} as never),
        },
        scheduleRepo: {
          create: async () => ok(schedule),
          findById: async () => ok(schedule),
          findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
          findDueSchedules: async () => ok([]),
          update: async () => ok(schedule),
        },
        actionDeps: {} as never,
      },
    });
    expect(result.errors).toBe(1);
    expect(result.executed).toBe(0);
  });

  it('handles findDueSchedules failure', async () => {
    const result = await handleTick({
      logger: createTestLogger(),
      scheduleRepo: {
        create: async () => ok({} as CronSchedule),
        findById: async () => ok(null),
        findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
        findDueSchedules: async () => ({
          ok: false as const,
          error: { code: 'INTERNAL_ERROR' as const, message: 'DB error' },
        }),
        update: async () => ok({} as CronSchedule),
      },
      executionRepo: {
        create: async () => ok({} as never),
        findById: async () => ok(null),
        findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findRunningByScheduleId: async () => ok(null),
        update: async () => ok({} as never),
      },
      executeDeps: {
        logger: createTestLogger(),
        executionRepo: {} as never,
        scheduleRepo: {} as never,
        actionDeps: {} as never,
      },
    });
    expect(result.errors).toBe(1);
  });
});
