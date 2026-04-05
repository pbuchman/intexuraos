import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import { createAutoArchiveMergedTasksUseCase } from '../../domain/usecases/autoArchiveMergedTasks.js';
import type { AutoArchiveMergedTasksDeps } from '../../domain/usecases/autoArchiveMergedTasks.js';
import type { CodeTask } from '../../domain/models/codeTask.js';

function createFakeLogger(): Record<string, MockedFunction<() => void>> {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// Fixed "now" for all tests
const NOW = new Date('2026-04-04T12:00:00Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function makeTask(overrides: Omit<Partial<CodeTask>, 'updatedAt' | 'createdAt'> & { id: string; updatedAt: Date }): CodeTask {
  return {
    userId: 'user-1',
    prompt: 'test prompt',
    sanitizedPrompt: 'test prompt',
    systemPromptHash: 'hash',
    workerType: 'sonnet',
    workerLocation: 'test',
    repository: 'test/repo',
    baseBranch: 'main',
    traceId: 'trace-1',
    status: 'implemented',
    dedupKey: `dedup-${overrides.id}`,
    callbackReceived: false,
    createdAt: Timestamp.fromDate(overrides.updatedAt),
    ...overrides,
    updatedAt: Timestamp.fromDate(overrides.updatedAt),
  } as CodeTask;
}

describe('autoArchiveMergedTasks', () => {
  let deps: AutoArchiveMergedTasksDeps;
  let useCase: ReturnType<typeof createAutoArchiveMergedTasksUseCase>;
  let findAllNonArchivedMock: MockedFunction<AutoArchiveMergedTasksDeps['codeTaskRepository']['findAllNonArchived']>;
  let updateMock: MockedFunction<AutoArchiveMergedTasksDeps['codeTaskRepository']['update']>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    findAllNonArchivedMock = vi.fn() as MockedFunction<AutoArchiveMergedTasksDeps['codeTaskRepository']['findAllNonArchived']>;
    updateMock = vi.fn() as MockedFunction<AutoArchiveMergedTasksDeps['codeTaskRepository']['update']>;

    deps = {
      codeTaskRepository: {
        findAllNonArchived: findAllNonArchivedMock,
        update: updateMock,
      } as unknown as AutoArchiveMergedTasksDeps['codeTaskRepository'],
      logger: createFakeLogger() as unknown as AutoArchiveMergedTasksDeps['logger'],
    };
    useCase = createAutoArchiveMergedTasksUseCase(deps);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('archives tasks with prMergedAt older than 7 days', async () => {
    const task = makeTask({
      id: 'task-1',
      linearIssueId: 'INT-100',
      updatedAt: daysAgo(10),
      prMergedAt: Timestamp.fromDate(daysAgo(10)),
    });
    findAllNonArchivedMock.mockResolvedValue(ok([task]));
    updateMock.mockResolvedValue(ok(task));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith('task-1', { status: 'archived' });
  });

  it('does NOT archive tasks with prMergedAt within 7 days', async () => {
    const task = makeTask({
      id: 'task-1',
      linearIssueId: 'INT-200',
      updatedAt: daysAgo(3),
      prMergedAt: Timestamp.fromDate(daysAgo(3)),
    });
    findAllNonArchivedMock.mockResolvedValue(ok([task]));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('groups by linearIssueId and archives both tasks when both have expired prMergedAt', async () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        linearIssueId: 'INT-300',
        updatedAt: daysAgo(10),
        prMergedAt: Timestamp.fromDate(daysAgo(10)),
      }),
      makeTask({
        id: 'task-2',
        linearIssueId: 'INT-300',
        updatedAt: daysAgo(10),
        prMergedAt: Timestamp.fromDate(daysAgo(10)),
      }),
    ];
    findAllNonArchivedMock.mockResolvedValue(ok(tasks));
    updateMock.mockResolvedValue(ok(tasks[0] as CodeTask));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledWith('task-1', { status: 'archived' });
    expect(updateMock).toHaveBeenCalledWith('task-2', { status: 'archived' });
  });

  it('skips groups with active tasks (running) even if prMergedAt is expired', async () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        linearIssueId: 'INT-400',
        status: 'running',
        updatedAt: daysAgo(10),
        prMergedAt: Timestamp.fromDate(daysAgo(10)),
      }),
      makeTask({
        id: 'task-2',
        linearIssueId: 'INT-400',
        status: 'implemented',
        updatedAt: daysAgo(10),
        prMergedAt: Timestamp.fromDate(daysAgo(10)),
      }),
    ];
    findAllNonArchivedMock.mockResolvedValue(ok(tasks));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.groupsSkippedActive).toBe(1);
    }
  });

  it('skips groups with active tasks (dispatched) even if prMergedAt is expired', async () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        linearIssueId: 'INT-401',
        status: 'dispatched',
        updatedAt: daysAgo(10),
        prMergedAt: Timestamp.fromDate(daysAgo(10)),
      }),
    ];
    findAllNonArchivedMock.mockResolvedValue(ok(tasks));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.groupsSkippedActive).toBe(1);
    }
  });

  it('skips groups with active tasks (queued) even if prMergedAt is expired', async () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        linearIssueId: 'INT-402',
        status: 'queued',
        updatedAt: daysAgo(10),
        prMergedAt: Timestamp.fromDate(daysAgo(10)),
      }),
    ];
    findAllNonArchivedMock.mockResolvedValue(ok(tasks));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.groupsSkippedActive).toBe(1);
    }
  });

  it('returns error when findAllNonArchived fails', async () => {
    findAllNonArchivedMock.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR' as const, message: 'Query failed' })
    );

    const result = await useCase();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Query failed');
    }
  });

  it('returns correct statistics after archiving', async () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        linearIssueId: 'INT-500',
        updatedAt: daysAgo(10),
        prMergedAt: Timestamp.fromDate(daysAgo(10)),
      }),
      makeTask({
        id: 'task-2',
        linearIssueId: 'INT-500',
        updatedAt: daysAgo(10),
        prMergedAt: Timestamp.fromDate(daysAgo(10)),
      }),
      makeTask({
        id: 'task-3',
        linearIssueId: 'INT-501',
        updatedAt: daysAgo(3),
        prMergedAt: Timestamp.fromDate(daysAgo(3)),
      }),
    ];
    findAllNonArchivedMock.mockResolvedValue(ok(tasks));
    updateMock.mockResolvedValue(ok(tasks[0] as CodeTask));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalTasksFetched).toBe(3);
      expect(result.value.totalGroupsEvaluated).toBe(2);
      expect(result.value.groupsArchived).toBe(1);
      expect(result.value.groupsSkippedActive).toBe(0);
      expect(result.value.tasksArchived).toBe(2);
      expect(result.value.tasksFailed).toBe(0);
      expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('respects custom mergeDays parameter — tasks 5 days old archived with mergeDays: 3', async () => {
    const task = makeTask({
      id: 'task-1',
      linearIssueId: 'INT-600',
      updatedAt: daysAgo(5),
      prMergedAt: Timestamp.fromDate(daysAgo(5)),
    });
    findAllNonArchivedMock.mockResolvedValue(ok([task]));
    updateMock.mockResolvedValue(ok(task));

    const result = await useCase({ mergeDays: 3 });

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith('task-1', { status: 'archived' });
  });

  it('respects custom mergeDays parameter — tasks 5 days old not archived with default (7)', async () => {
    const task = makeTask({
      id: 'task-1',
      linearIssueId: 'INT-601',
      updatedAt: daysAgo(5),
      prMergedAt: Timestamp.fromDate(daysAgo(5)),
    });
    findAllNonArchivedMock.mockResolvedValue(ok([task]));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('returns zero counts when no non-archived tasks exist', async () => {
    findAllNonArchivedMock.mockResolvedValue(ok([]));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalTasksFetched).toBe(0);
      expect(result.value.totalGroupsEvaluated).toBe(0);
      expect(result.value.groupsArchived).toBe(0);
      expect(result.value.groupsSkippedActive).toBe(0);
      expect(result.value.tasksArchived).toBe(0);
      expect(result.value.tasksFailed).toBe(0);
      expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('tasks without prMergedAt are not archived', async () => {
    const task = makeTask({
      id: 'task-1',
      linearIssueId: 'INT-700',
      updatedAt: daysAgo(10),
      // no prMergedAt
    });
    findAllNonArchivedMock.mockResolvedValue(ok([task]));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.tasksArchived).toBe(0);
    }
  });

  it('handles update failure — logs error, continues, reports tasksFailed: 1', async () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        linearIssueId: 'INT-800',
        updatedAt: daysAgo(10),
        prMergedAt: Timestamp.fromDate(daysAgo(10)),
      }),
      makeTask({
        id: 'task-2',
        linearIssueId: 'INT-800',
        updatedAt: daysAgo(10),
        prMergedAt: Timestamp.fromDate(daysAgo(10)),
      }),
    ];
    findAllNonArchivedMock.mockResolvedValue(ok(tasks));
    updateMock
      .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR' as const, message: 'Write failed' }))
      .mockResolvedValueOnce(ok(tasks[1] as CodeTask));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tasksFailed).toBe(1);
      expect(result.value.tasksArchived).toBe(1);
    }
  });

  it('handles update throwing an exception — catches, logs error, reports tasksFailed', async () => {
    const task = makeTask({
      id: 'task-1',
      linearIssueId: 'INT-801',
      updatedAt: daysAgo(10),
      prMergedAt: Timestamp.fromDate(daysAgo(10)),
    });
    findAllNonArchivedMock.mockResolvedValue(ok([task]));
    updateMock.mockRejectedValue(new Error('Unexpected Firestore crash'));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tasksFailed).toBe(1);
      expect(result.value.tasksArchived).toBe(0);
      // groupsArchived should be 0 when all tasks in group fail
      expect(result.value.groupsArchived).toBe(0);
    }
  });

  it('does not count group as archived when all tasks in group fail to update', async () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        linearIssueId: 'INT-802',
        updatedAt: daysAgo(10),
        prMergedAt: Timestamp.fromDate(daysAgo(10)),
      }),
      makeTask({
        id: 'task-2',
        linearIssueId: 'INT-802',
        updatedAt: daysAgo(10),
        prMergedAt: Timestamp.fromDate(daysAgo(10)),
      }),
    ];
    findAllNonArchivedMock.mockResolvedValue(ok(tasks));
    updateMock.mockResolvedValue(err({ code: 'FIRESTORE_ERROR' as const, message: 'Write failed' }));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tasksFailed).toBe(2);
      expect(result.value.tasksArchived).toBe(0);
      expect(result.value.groupsArchived).toBe(0);
    }
  });

  it('mixed group: task with expired prMergedAt archived, task without prMergedAt skipped', async () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        linearIssueId: 'INT-900',
        updatedAt: daysAgo(10),
        prMergedAt: Timestamp.fromDate(daysAgo(10)),
      }),
      makeTask({
        id: 'task-2',
        linearIssueId: 'INT-900',
        updatedAt: daysAgo(10),
        // no prMergedAt — should not be archived
      }),
    ];
    findAllNonArchivedMock.mockResolvedValue(ok(tasks));
    updateMock.mockResolvedValue(ok(tasks[0] as CodeTask));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith('task-1', { status: 'archived' });
    expect(updateMock).not.toHaveBeenCalledWith('task-2', expect.anything());
    if (result.ok) {
      expect(result.value.tasksArchived).toBe(1);
      expect(result.value.groupsArchived).toBe(1);
    }
  });

  it('standalone tasks (no linearIssueId) grouped by task.id and archived when prMergedAt expired', async () => {
    const task = makeTask({
      id: 'standalone-1',
      updatedAt: daysAgo(10),
      prMergedAt: Timestamp.fromDate(daysAgo(10)),
      // no linearIssueId
    });
    findAllNonArchivedMock.mockResolvedValue(ok([task]));
    updateMock.mockResolvedValue(ok(task));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith('standalone-1', { status: 'archived' });
  });
});
