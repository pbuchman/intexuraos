import { describe, it, expect } from 'vitest';
import { createScheduleManager } from '../manage-schedule.js';
import { ok, type Result } from '@intexuraos/common-core';
import type { CronSchedule, ListSchedulesResponse } from '../../types.js';
import type { ScheduleRepository, ScheduleRepositoryError } from '../../ports/schedule-repository.js';

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
  name: 'Test',
  scheduleSummary: 'Every minute',
  cronExpression: '* * * * *',
  timezone: 'UTC',
  action: { services: ['code-agent'], instruction: 'do something', preferredTools: [] },
  status: 'active',
  lastExecutedAt: null,
  nextExecutionAt: new Date().toISOString(),
  executionCount: 0,
  failureCount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function createFakeScheduleRepo(): ScheduleRepository {
  return {
    create: async (): Promise<Result<CronSchedule, ScheduleRepositoryError>> => ok(testSchedule),
    findById: async (id: string): Promise<Result<CronSchedule | null, ScheduleRepositoryError>> =>
      ok(id === testSchedule.id ? testSchedule : null),
    findByUserId: async (): Promise<Result<ListSchedulesResponse, ScheduleRepositoryError>> =>
      ok({ schedules: [testSchedule], nextCursor: null, count: 1 }),
    findDueSchedules: async (): Promise<Result<CronSchedule[], ScheduleRepositoryError>> => ok([]),
    update: async (_id: string, updates: Partial<CronSchedule>): Promise<Result<CronSchedule, ScheduleRepositoryError>> =>
      ok({ ...testSchedule, ...updates }),
    incrementCounters: async (): Promise<Result<void, ScheduleRepositoryError>> => ok(undefined),
  };
}

function createFakeParseDeps(): never {
  return {
    logger: createTestLogger(),
    geminiClient: {
      research: async () =>
        ok({
          content: '',
          sources: [],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
        }),
      generate: async () =>
        ok({
          content:
            '{"cronExpression": "*/5 * * * *", "humanSummary": "Every 5 minutes"}',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
        }),
    },
  } as never;
}

function createFakeToolRegistry(): {
  getToolsForService: () => Promise<never[]>;
  getToolsForServices: () => Promise<never[]>;
  listServiceTools: () => Promise<{
    key: string;
    name: string;
    tools: { name: string; description: string; parameters: Record<string, unknown> }[];
  }[]>;
  refreshAll: () => Promise<void>;
} {
  return {
    getToolsForService: async (): Promise<never[]> => [],
    getToolsForServices: async (): Promise<never[]> => [],
    listServiceTools: async (): Promise<{
      key: string;
      name: string;
      tools: { name: string; description: string; parameters: Record<string, unknown> }[];
    }[]> => [
      {
        key: 'code-agent',
        name: 'Code Agent',
        tools: [
          {
            name: 'code_agent__runCode',
            description: 'Run code',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
    ],
    refreshAll: async (): Promise<void> => { /* noop */ },
  };
}

describe('createScheduleManager', () => {
  it('creates a schedule successfully', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.create('user-1', {
      name: 'Test',
      schedule: 'Every minute',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      timezone: 'UTC',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects creation when user has reached schedule limit', async () => {
    const fullSchedules = Array.from({ length: 50 }, (_, i) =>
      ({ ...testSchedule, id: `schedule-${String(i)}` }),
    );
    const fullRepo: ScheduleRepository = {
      ...createFakeScheduleRepo(),
      findByUserId: async (): Promise<Result<ListSchedulesResponse, ScheduleRepositoryError>> =>
        ok({ schedules: fullSchedules, nextCursor: null, count: 50 }),
    };

    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: fullRepo,
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.create('user-1', {
      name: 'One too many',
      schedule: 'Every hour',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      timezone: 'UTC',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
    expect(result.error.message).toContain('Maximum');
  });

  it('rejects unknown service keys', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: {
        getToolsForService: async (): Promise<never[]> => [],
        getToolsForServices: async (): Promise<never[]> => [],
        listServiceTools: async (): Promise<never[]> => [],
        refreshAll: async (): Promise<void> => { /* noop */ },
      },
      executeDeps: {} as never,
    });

    const result = await manager.create('user-1', {
      name: 'Test',
      schedule: 'Every minute',
      action: { services: ['unknown-service'], instruction: 'test', preferredTools: [] },
      timezone: 'UTC',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('persists preferred tools on create', async () => {
    const repo: ScheduleRepository = {
      ...createFakeScheduleRepo(),
      create: async (
        userId: string,
        input,
      ): Promise<Result<CronSchedule, ScheduleRepositoryError>> =>
        ok({
          ...testSchedule,
          userId,
          action: input.action,
        }),
    };

    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: repo,
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.create('user-1', {
      name: 'Test',
      schedule: 'Every minute',
      action: {
        services: ['code-agent'],
        instruction: 'test',
        preferredTools: ['code_agent__runCode'],
      },
      timezone: 'UTC',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action.preferredTools).toEqual(['code_agent__runCode']);
  });

  it('rejects preferred tools that are not available on selected services', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.create('user-1', {
      name: 'Test',
      schedule: 'Every minute',
      action: {
        services: ['code-agent'],
        instruction: 'test',
        preferredTools: ['code_agent__missingTool'],
      },
      timezone: 'UTC',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
    expect(result.error.message).toContain('Unknown preferred tool');
  });

  it('gets schedule by id with ownership check', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.getById('user-1', 'schedule-1');
    expect(result.ok).toBe(true);
  });

  it('returns NOT_FOUND for wrong user', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.getById('other-user', 'schedule-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('lists schedules for user', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.list('user-1', { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schedules.length).toBe(1);
  });

  it('soft-deletes a schedule', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.delete('user-1', 'schedule-1');
    expect(result.ok).toBe(true);
  });

  it('returns NOT_FOUND when deleting non-existent schedule', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.delete('user-1', 'nonexistent');
    expect(result.ok).toBe(false);
  });

  it('updates schedule name', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.update('user-1', 'schedule-1', { name: 'New Name' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('New Name');
  });

  it('returns NOT_FOUND when updating non-existent schedule', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.update('user-1', 'nonexistent', { name: 'New Name' });
    expect(result.ok).toBe(false);
  });

  it('returns NOT_FOUND when updating schedule owned by different user', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.update('other-user', 'schedule-1', { name: 'Hijack' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('returns NOT_FOUND when deleting schedule owned by different user', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.delete('other-user', 'schedule-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('returns PARSE_FAILED when schedule parsing fails during create', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: {
        logger: createTestLogger(),
        geminiClient: {
          research: async () => ({
            ok: true as const,
            value: { content: '', sources: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } },
          }),
          generate: async () => ({
            ok: true as const,
            value: {
              content: '{"error": "Cannot parse this"}',
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
            },
          }),
        },
      } as never,
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.create('user-1', {
      name: 'Test',
      schedule: 'invalid schedule description',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      timezone: 'UTC',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PARSE_FAILED');
  });

  it('returns INTERNAL_ERROR when scheduleRepo.create fails', async () => {
    const failingRepo: ScheduleRepository = {
      ...createFakeScheduleRepo(),
      create: async (): Promise<Result<CronSchedule, ScheduleRepositoryError>> => ({
        ok: false as const,
        error: { code: 'INTERNAL_ERROR' as const, message: 'DB write failed' },
      }),
    };

    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: failingRepo,
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.create('user-1', {
      name: 'Test',
      schedule: 'every minute',
      action: { services: ['code-agent'], instruction: 'test', preferredTools: [] },
      timezone: 'UTC',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns INTERNAL_ERROR when scheduleRepo.findById fails in getById', async () => {
    const failingRepo: ScheduleRepository = {
      ...createFakeScheduleRepo(),
      findById: async (): Promise<Result<CronSchedule | null, ScheduleRepositoryError>> => ({
        ok: false as const,
        error: { code: 'INTERNAL_ERROR' as const, message: 'DB read failed' },
      }),
    };

    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: failingRepo,
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.getById('user-1', 'schedule-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns NOT_FOUND when schedule is null in getById', async () => {
    const emptyRepo: ScheduleRepository = {
      ...createFakeScheduleRepo(),
      findById: async (): Promise<Result<CronSchedule | null, ScheduleRepositoryError>> => ok(null),
    };

    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: emptyRepo,
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.getById('user-1', 'nonexistent');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('returns INTERNAL_ERROR when list fails', async () => {
    const failingRepo: ScheduleRepository = {
      ...createFakeScheduleRepo(),
      findByUserId: async (): Promise<Result<ListSchedulesResponse, ScheduleRepositoryError>> => ({
        ok: false as const,
        error: { code: 'INTERNAL_ERROR' as const, message: 'DB read failed' },
      }),
    };

    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: failingRepo,
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.list('user-1', { limit: 50 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns INTERNAL_ERROR when update findById fails', async () => {
    const failingRepo: ScheduleRepository = {
      ...createFakeScheduleRepo(),
      findById: async (): Promise<Result<CronSchedule | null, ScheduleRepositoryError>> => ({
        ok: false as const,
        error: { code: 'INTERNAL_ERROR' as const, message: 'DB read failed' },
      }),
    };

    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: failingRepo,
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.update('user-1', 'schedule-1', { name: 'New Name' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('updates schedule and re-parses cron', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.update('user-1', 'schedule-1', {
      schedule: 'every 5 minutes',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scheduleSummary).toBe('Every 5 minutes');
    expect(result.value.cronExpression).toBe('*/5 * * * *');
  });

  it('returns PARSE_FAILED when schedule update parse fails', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: {
        logger: createTestLogger(),
        geminiClient: {
          research: async () => ({
            ok: true as const,
            value: { content: '', sources: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } },
          }),
          generate: async () => ({
            ok: true as const,
            value: {
              content: '{"error": "Cannot parse"}',
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
            },
          }),
        },
      } as never,
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.update('user-1', 'schedule-1', {
      schedule: 'bad description',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PARSE_FAILED');
  });

  it('updates action and validates service keys', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.update('user-1', 'schedule-1', {
      action: {
        services: ['code-agent'],
        instruction: 'updated instruction',
        preferredTools: [],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action.instruction).toBe('updated instruction');
  });

  it('rejects preferred tools that belong to an unselected service during update', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: {
        getToolsForService: async (): Promise<never[]> => [],
        getToolsForServices: async (): Promise<never[]> => [],
        listServiceTools: async () => [
          {
            key: 'code-agent',
            name: 'Code Agent',
            tools: [
              {
                name: 'code_agent__runCode',
                description: 'Run code',
                parameters: { type: 'object', properties: {} },
              },
            ],
          },
          {
            key: 'notes-agent',
            name: 'Notes Agent',
            tools: [
              {
                name: 'notes_agent__syncNotes',
                description: 'Sync notes',
                parameters: { type: 'object', properties: {} },
              },
            ],
          },
        ],
        refreshAll: async (): Promise<void> => { /* noop */ },
      },
      executeDeps: {} as never,
    });

    const result = await manager.update('user-1', 'schedule-1', {
      action: {
        services: ['code-agent'],
        instruction: 'updated instruction',
        preferredTools: ['notes_agent__syncNotes'],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
    expect(result.error.message).toContain('selected services');
  });

  it('returns VALIDATION_ERROR when updating action with unknown service', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: {
        getToolsForService: async (): Promise<never[]> => [],
        getToolsForServices: async (): Promise<never[]> => [],
        listServiceTools: async (): Promise<never[]> => [],
        refreshAll: async (): Promise<void> => { /* noop */ },
      },
      executeDeps: {} as never,
    });

    const result = await manager.update('user-1', 'schedule-1', {
      action: { services: ['unknown-service'], instruction: 'test', preferredTools: [] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('handles status change to paused', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.update('user-1', 'schedule-1', { status: 'paused' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('paused');
    expect(result.value.nextExecutionAt).toBeNull();
  });

  it('handles status change to active with next execution computed', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.update('user-1', 'schedule-1', { status: 'active' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('active');
    // nextExecutionAt should be computed from the cron expression
    expect(result.value.nextExecutionAt).toBeDefined();
  });

  it('returns INTERNAL_ERROR when scheduleRepo.update fails', async () => {
    const failingRepo: ScheduleRepository = {
      ...createFakeScheduleRepo(),
      update: async (): Promise<Result<CronSchedule, ScheduleRepositoryError>> => ({
        ok: false as const,
        error: { code: 'INTERNAL_ERROR' as const, message: 'DB write failed' },
      }),
    };

    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: failingRepo,
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.update('user-1', 'schedule-1', { name: 'Will Fail' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('updates timezone', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.update('user-1', 'schedule-1', {
      timezone: 'America/New_York',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.timezone).toBe('America/New_York');
  });

  it('returns INTERNAL_ERROR when delete findById fails', async () => {
    const failingRepo: ScheduleRepository = {
      ...createFakeScheduleRepo(),
      findById: async (): Promise<Result<CronSchedule | null, ScheduleRepositoryError>> => ({
        ok: false as const,
        error: { code: 'INTERNAL_ERROR' as const, message: 'DB read failed' },
      }),
    };

    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: failingRepo,
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.delete('user-1', 'schedule-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns INTERNAL_ERROR when delete update fails', async () => {
    const failingRepo: ScheduleRepository = {
      ...createFakeScheduleRepo(),
      update: async (): Promise<Result<CronSchedule, ScheduleRepositoryError>> => ({
        ok: false as const,
        error: { code: 'INTERNAL_ERROR' as const, message: 'DB update failed' },
      }),
    };

    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: failingRepo,
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.delete('user-1', 'schedule-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns INTERNAL_ERROR when trigger findById fails', async () => {
    const failingRepo: ScheduleRepository = {
      ...createFakeScheduleRepo(),
      findById: async (): Promise<Result<CronSchedule | null, ScheduleRepositoryError>> => ({
        ok: false as const,
        error: { code: 'INTERNAL_ERROR' as const, message: 'DB read failed' },
      }),
    };

    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: failingRepo,
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.trigger('user-1', 'schedule-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns NOT_FOUND when triggering nonexistent schedule', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.trigger('user-1', 'nonexistent');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('returns NOT_FOUND when triggering schedule owned by different user', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {} as never,
    });

    const result = await manager.trigger('other-user', 'schedule-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('triggers a schedule successfully', async () => {
    const testExec = {
      id: 'exec-1',
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
      status: 'running' as const,
      trigger: 'manual' as const,
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationMs: null,
      toolCalls: [],
      agentResponse: null,
      tokenUsage: null,
      error: null,
      createdAt: new Date().toISOString(),
    };

    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {
        logger: createTestLogger(),
        executionRepo: {
          create: async () => ok(testExec),
          findById: async () => ok(null),
          findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
          findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
          findRunningByScheduleId: async () => ok(null),
          update: async () => ok(testExec),
        },
        scheduleRepo: createFakeScheduleRepo(),
        actionDeps: {
          logger: createTestLogger(),
          toolRegistry: {
            getToolsForService: async (): Promise<never[]> => [],
            getToolsForServices: async (): Promise<{ name: string; description: string; parameters: { type: string; properties: Record<string, never> }; run: () => Promise<string> }[]> => [{
              name: 'test-tool',
              description: 'Test',
              parameters: { type: 'object', properties: {} },
              run: async (): Promise<string> => '{}',
            }],
            listServiceTools: async (): Promise<{ key: string; name: string; tools: never[] }[]> => [{ key: 'code-agent', name: 'Code Agent', tools: [] }],
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

    const result = await manager.trigger('user-1', 'schedule-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.trigger).toBe('manual');
  });

  it('returns CONFLICT when schedule is already running', async () => {
    const runningExec = {
      id: 'exec-running',
      scheduleId: 'schedule-1',
      scheduleName: 'Test',
      userId: 'user-1',
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
    };

    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
      executeDeps: {
        logger: createTestLogger(),
        executionRepo: {
          create: async () => ok(runningExec),
          findById: async () => ok(runningExec),
          findByUserId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
          findByScheduleId: async () => ok({ executions: [], nextCursor: null, count: 0 }),
          findRunningByScheduleId: async () => ok(runningExec),
          update: async () => ok(runningExec),
        },
        scheduleRepo: createFakeScheduleRepo(),
        actionDeps: {} as never,
      },
    });

    const result = await manager.trigger('user-1', 'schedule-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT');
    expect(result.error.message).toContain('already running');
  });

  it('returns INTERNAL_ERROR when trigger executeSchedule fails', async () => {
    const manager = createScheduleManager({
      logger: createTestLogger(),
      scheduleRepo: createFakeScheduleRepo(),
      parseDeps: createFakeParseDeps(),
      toolRegistry: createFakeToolRegistry(),
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
        scheduleRepo: createFakeScheduleRepo(),
        actionDeps: {} as never,
      },
    });

    const result = await manager.trigger('user-1', 'schedule-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });
});
