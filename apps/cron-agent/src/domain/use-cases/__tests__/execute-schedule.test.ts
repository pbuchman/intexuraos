import { describe, it, expect } from 'vitest';
import { executeSchedule } from '../execute-schedule.js';
import type { ExecuteScheduleDeps } from '../execute-schedule.js';
import type { CronSchedule, CronExecution } from '../../types.js';
import { ok, err } from '@intexuraos/common-core';

function createTestLogger(): never {
  return {
    info: () => { /* noop */ },
    warn: () => { /* noop */ },
    error: () => { /* noop */ },
    debug: () => { /* noop */ },
    child: () => createTestLogger(),
  } as never;
}

const testSchedule: CronSchedule = {
  id: 'schedule-1',
  userId: 'user-1',
  name: 'Test Schedule',
  description: 'Every minute',
  cronExpression: '* * * * *',
  timezone: 'UTC',
  action: { services: ['code-agent'], instruction: 'do something' },
  status: 'active',
  lastExecutedAt: null,
  nextExecutionAt: new Date().toISOString(),
  executionCount: 5,
  failureCount: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const testExecution: CronExecution = {
  id: 'exec-1',
  scheduleId: 'schedule-1',
  scheduleName: 'Test Schedule',
  userId: 'user-1',
  status: 'running',
  trigger: 'scheduled',
  startedAt: new Date().toISOString(),
  completedAt: null,
  durationMs: null,
  toolCalls: [],
  agentResponse: null,
  tokenUsage: null,
  error: null,
  createdAt: new Date().toISOString(),
};

function createSuccessActionDeps(): ExecuteScheduleDeps['actionDeps'] {
  return {
    logger: createTestLogger(),
    toolRegistry: {
      getToolsForService: async () => [],
      getToolsForServices: async () => [{
        name: 'test-tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
        run: async () => '{"ok": true}',
      }],
      listServiceTools: async () => [
        { key: 'code-agent', name: 'Code Agent', tools: [{ name: 'test-tool', description: 'A test tool' }] },
      ],
      refreshAll: async (): Promise<void> => { /* noop */ },
    },
    toolCallingClient: {
      run: async () =>
        ok({
          content: 'Task completed',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
        }),
    },
  };
}

function createFailingActionDeps(): ExecuteScheduleDeps['actionDeps'] {
  return {
    logger: createTestLogger(),
    toolRegistry: {
      getToolsForService: async () => [],
      getToolsForServices: async () => [{
        name: 'test-tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
        run: async () => '{"ok": true}',
      }],
      listServiceTools: async () => [
        { key: 'code-agent', name: 'Code Agent', tools: [{ name: 'test-tool', description: 'A test tool' }] },
      ],
      refreshAll: async (): Promise<void> => { /* noop */ },
    },
    toolCallingClient: {
      run: async () => err({ code: 'API_ERROR' as const, message: 'LLM failed' }),
    },
  };
}

function createThrowingActionDeps(): ExecuteScheduleDeps['actionDeps'] {
  return {
    logger: createTestLogger(),
    toolRegistry: {
      getToolsForService: async () => [],
      getToolsForServices: async () => [{
        name: 'test-tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
        run: async () => '{"ok": true}',
      }],
      listServiceTools: async () => [
        { key: 'code-agent', name: 'Code Agent', tools: [{ name: 'test-tool', description: 'A test tool' }] },
      ],
      refreshAll: async (): Promise<void> => { /* noop */ },
    },
    toolCallingClient: {
      run: async (): Promise<never> => {
        throw new Error('Unexpected failure');
      },
    },
  };
}

describe('executeSchedule', () => {
  it('returns INTERNAL_ERROR when execution creation fails', async () => {
    const deps: ExecuteScheduleDeps = {
      logger: createTestLogger(),
      executionRepo: {
        create: async () => ({ ok: false as const, error: { code: 'INTERNAL_ERROR' as const, message: 'DB error' } }),
        findById: async () => ok(null),
        findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findRunningByScheduleId: async () => ok(null),
        update: async () => ok(testExecution),
      },
      scheduleRepo: {
        create: async () => ok(testSchedule),
        findById: async () => ok(testSchedule),
        findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
        findDueSchedules: async () => ok([]),
        update: async () => ok(testSchedule),
        incrementCounters: async () => ok(undefined),
      },
      actionDeps: createSuccessActionDeps(),
    };

    const result = await executeSchedule(deps, testSchedule, 'scheduled');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('executes successfully and returns updated execution', async () => {
    const updatedExecution: CronExecution = {
      ...testExecution,
      status: 'success',
      completedAt: new Date().toISOString(),
      durationMs: 100,
      agentResponse: 'Task completed',
      tokenUsage: { inputTokens: 100, outputTokens: 50, totalCost: 0.001 },
    };

    const deps: ExecuteScheduleDeps = {
      logger: createTestLogger(),
      executionRepo: {
        create: async () => ok(testExecution),
        findById: async () => ok(updatedExecution),
        findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findRunningByScheduleId: async () => ok(null),
        update: async () => ok(updatedExecution),
      },
      scheduleRepo: {
        create: async () => ok(testSchedule),
        findById: async () => ok(testSchedule),
        findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
        findDueSchedules: async () => ok([]),
        update: async () => ok(testSchedule),
        incrementCounters: async () => ok(undefined),
      },
      actionDeps: createSuccessActionDeps(),
    };

    const result = await executeSchedule(deps, testSchedule, 'scheduled');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('success');
  });

  it('returns fallback execution when update fails after success', async () => {
    const deps: ExecuteScheduleDeps = {
      logger: createTestLogger(),
      executionRepo: {
        create: async () => ok(testExecution),
        findById: async () => ok(null),
        findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findRunningByScheduleId: async () => ok(null),
        update: async () => err({ code: 'INTERNAL_ERROR' as const, message: 'update failed' }),
      },
      scheduleRepo: {
        create: async () => ok(testSchedule),
        findById: async () => ok(testSchedule),
        findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
        findDueSchedules: async () => ok([]),
        update: async () => ok(testSchedule),
        incrementCounters: async () => ok(undefined),
      },
      actionDeps: createSuccessActionDeps(),
    };

    const result = await executeSchedule(deps, testSchedule, 'manual');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('success');
    expect(result.value.agentResponse).toBe('Task completed');
  });

  it('handles action failure and records it', async () => {
    const failedExecution: CronExecution = {
      ...testExecution,
      status: 'failure',
      completedAt: new Date().toISOString(),
      durationMs: 50,
      error: 'LLM failed',
    };

    const deps: ExecuteScheduleDeps = {
      logger: createTestLogger(),
      executionRepo: {
        create: async () => ok(testExecution),
        findById: async () => ok(failedExecution),
        findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findRunningByScheduleId: async () => ok(null),
        update: async () => ok(failedExecution),
      },
      scheduleRepo: {
        create: async () => ok(testSchedule),
        findById: async () => ok(testSchedule),
        findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
        findDueSchedules: async () => ok([]),
        update: async () => ok(testSchedule),
        incrementCounters: async () => ok(undefined),
      },
      actionDeps: createFailingActionDeps(),
    };

    const result = await executeSchedule(deps, testSchedule, 'scheduled');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('failure');
  });

  it('returns fallback execution when update fails after action failure', async () => {
    const deps: ExecuteScheduleDeps = {
      logger: createTestLogger(),
      executionRepo: {
        create: async () => ok(testExecution),
        findById: async () => ok(null),
        findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findRunningByScheduleId: async () => ok(null),
        update: async () => err({ code: 'INTERNAL_ERROR' as const, message: 'update failed' }),
      },
      scheduleRepo: {
        create: async () => ok(testSchedule),
        findById: async () => ok(testSchedule),
        findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
        findDueSchedules: async () => ok([]),
        update: async () => ok(testSchedule),
        incrementCounters: async () => ok(undefined),
      },
      actionDeps: createFailingActionDeps(),
    };

    const result = await executeSchedule(deps, testSchedule, 'scheduled');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('failure');
    expect(result.value.error).toBe('LLM failed');
  });

  it('handles thrown exception during action execution', async () => {
    const deps: ExecuteScheduleDeps = {
      logger: createTestLogger(),
      executionRepo: {
        create: async () => ok(testExecution),
        findById: async () => ok(null),
        findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findRunningByScheduleId: async () => ok(null),
        update: async () => ok(testExecution),
      },
      scheduleRepo: {
        create: async () => ok(testSchedule),
        findById: async () => ok(testSchedule),
        findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
        findDueSchedules: async () => ok([]),
        update: async () => ok(testSchedule),
        incrementCounters: async () => ok(undefined),
      },
      actionDeps: createThrowingActionDeps(),
    };

    const result = await executeSchedule(deps, testSchedule, 'scheduled');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXECUTION_FAILED');
    expect(result.error.message).toContain('Unexpected failure');
  });

  it('logs warning when schedule counter update fails after success', async () => {
    const warnCalls: unknown[] = [];
    const warnLogger = {
      info: () => { /* noop */ },
      warn: (...args: unknown[]) => { warnCalls.push(args); },
      error: () => { /* noop */ },
      debug: () => { /* noop */ },
      child: () => warnLogger,
    } as never;

    const updatedExecution: CronExecution = {
      ...testExecution,
      status: 'success',
      completedAt: new Date().toISOString(),
      durationMs: 100,
    };

    const deps: ExecuteScheduleDeps = {
      logger: warnLogger,
      executionRepo: {
        create: async () => ok(testExecution),
        findById: async () => ok(updatedExecution),
        findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findRunningByScheduleId: async () => ok(null),
        update: async () => ok(updatedExecution),
      },
      scheduleRepo: {
        create: async () => ok(testSchedule),
        findById: async () => ok(testSchedule),
        findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
        findDueSchedules: async () => ok([]),
        update: async () => ok(testSchedule),
        incrementCounters: async () => err({ code: 'INTERNAL_ERROR' as const, message: 'Firestore write failed' }),
      },
      actionDeps: createSuccessActionDeps(),
    };

    const result = await executeSchedule(deps, testSchedule, 'scheduled');
    expect(result.ok).toBe(true);
    expect(warnCalls.length).toBe(1);
  });

  it('logs warning when schedule counter update fails after action failure', async () => {
    const warnCalls: unknown[] = [];
    const warnLogger = {
      info: () => { /* noop */ },
      warn: (...args: unknown[]) => { warnCalls.push(args); },
      error: () => { /* noop */ },
      debug: () => { /* noop */ },
      child: () => warnLogger,
    } as never;

    const failedExecution: CronExecution = {
      ...testExecution,
      status: 'failure',
      completedAt: new Date().toISOString(),
      durationMs: 50,
      error: 'LLM failed',
    };

    const deps: ExecuteScheduleDeps = {
      logger: warnLogger,
      executionRepo: {
        create: async () => ok(testExecution),
        findById: async () => ok(failedExecution),
        findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findRunningByScheduleId: async () => ok(null),
        update: async () => ok(failedExecution),
      },
      scheduleRepo: {
        create: async () => ok(testSchedule),
        findById: async () => ok(testSchedule),
        findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
        findDueSchedules: async () => ok([]),
        update: async () => ok(testSchedule),
        incrementCounters: async () => err({ code: 'INTERNAL_ERROR' as const, message: 'Firestore write failed' }),
      },
      actionDeps: createFailingActionDeps(),
    };

    const result = await executeSchedule(deps, testSchedule, 'scheduled');
    expect(result.ok).toBe(true);
    expect(warnCalls.length).toBe(1);
  });

  it('logs warning when schedule counter update fails after thrown exception', async () => {
    const warnCalls: unknown[] = [];
    const warnLogger = {
      info: () => { /* noop */ },
      warn: (...args: unknown[]) => { warnCalls.push(args); },
      error: () => { /* noop */ },
      debug: () => { /* noop */ },
      child: () => warnLogger,
    } as never;

    const deps: ExecuteScheduleDeps = {
      logger: warnLogger,
      executionRepo: {
        create: async () => ok(testExecution),
        findById: async () => ok(null),
        findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findRunningByScheduleId: async () => ok(null),
        update: async () => ok(testExecution),
      },
      scheduleRepo: {
        create: async () => ok(testSchedule),
        findById: async () => ok(testSchedule),
        findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
        findDueSchedules: async () => ok([]),
        update: async () => ok(testSchedule),
        incrementCounters: async () => err({ code: 'INTERNAL_ERROR' as const, message: 'Firestore write failed' }),
      },
      actionDeps: createThrowingActionDeps(),
    };

    const result = await executeSchedule(deps, testSchedule, 'scheduled');
    expect(result.ok).toBe(false);
    expect(warnCalls.length).toBe(1);
  });

  it('computes next execution with invalid cron expression gracefully', async () => {
    const scheduleWithBadCron: CronSchedule = {
      ...testSchedule,
      cronExpression: 'invalid-cron',
    };

    const updatedExecution: CronExecution = {
      ...testExecution,
      status: 'success',
      completedAt: new Date().toISOString(),
      durationMs: 100,
    };

    const incrementCalls: { counters: { executionCount?: boolean; failureCount?: boolean }; metadata: { lastExecutedAt: string; nextExecutionAt: string | null } }[] = [];
    const deps: ExecuteScheduleDeps = {
      logger: createTestLogger(),
      executionRepo: {
        create: async () => ok(testExecution),
        findById: async () => ok(updatedExecution),
        findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
        findRunningByScheduleId: async () => ok(null),
        update: async () => ok(updatedExecution),
      },
      scheduleRepo: {
        create: async () => ok(scheduleWithBadCron),
        findById: async () => ok(scheduleWithBadCron),
        findByUserId: async () => ok({ schedules: [], nextCursor: null, count: 0 }),
        findDueSchedules: async () => ok([]),
        update: async () => ok(scheduleWithBadCron),
        incrementCounters: async (_id: string, counters: { executionCount?: boolean; failureCount?: boolean }, metadata: { lastExecutedAt: string; nextExecutionAt: string | null }) => {
          incrementCalls.push({ counters, metadata });
          return ok(undefined);
        },
      },
      actionDeps: createSuccessActionDeps(),
    };

    const result = await executeSchedule(deps, scheduleWithBadCron, 'manual');
    expect(result.ok).toBe(true);
    // The schedule update should have nextExecutionAt as null for invalid cron
    expect(incrementCalls.length).toBeGreaterThan(0);
    expect(incrementCalls[0]?.metadata.nextExecutionAt).toBeNull();
  });
});
