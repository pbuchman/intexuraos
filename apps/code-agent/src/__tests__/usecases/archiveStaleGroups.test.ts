import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import { createArchiveStaleGroupsUseCase } from '../../domain/usecases/archiveStaleGroups.js';
import type { ArchiveStaleGroupsDeps } from '../../domain/usecases/archiveStaleGroups.js';
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
const NOW = new Date('2026-03-30T12:00:00Z');

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

describe('archiveStaleGroups', () => {
  let deps: ArchiveStaleGroupsDeps;
  let useCase: ReturnType<typeof createArchiveStaleGroupsUseCase>;
  let listAllNonArchivedGlobalMock: MockedFunction<
    ArchiveStaleGroupsDeps['codeTaskRepository']['listAllNonArchivedGlobal']
  >;
  let updateMock: MockedFunction<ArchiveStaleGroupsDeps['codeTaskRepository']['update']>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    listAllNonArchivedGlobalMock = vi.fn() as MockedFunction<
      ArchiveStaleGroupsDeps['codeTaskRepository']['listAllNonArchivedGlobal']
    >;
    updateMock = vi.fn() as MockedFunction<
      ArchiveStaleGroupsDeps['codeTaskRepository']['update']
    >;

    deps = {
      codeTaskRepository: {
        listAllNonArchivedGlobal: listAllNonArchivedGlobalMock,
        update: updateMock,
      } as unknown as ArchiveStaleGroupsDeps['codeTaskRepository'],
      logger: createFakeLogger() as unknown as ArchiveStaleGroupsDeps['logger'],
    };
    useCase = createArchiveStaleGroupsUseCase(deps);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('archives group where all tasks have updatedAt > 7 days ago', async () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-100', updatedAt: daysAgo(10) }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-100', updatedAt: daysAgo(10) }),
    ];
    listAllNonArchivedGlobalMock.mockResolvedValue(ok(tasks));
    updateMock.mockResolvedValue(ok(tasks[0] as CodeTask));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledWith('task-1', { status: 'archived' });
    expect(updateMock).toHaveBeenCalledWith('task-2', { status: 'archived' });
  });

  it('retains group where maxUpdatedAt is within 7 days', async () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-200', updatedAt: daysAgo(3) }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-200', updatedAt: daysAgo(3) }),
    ];
    listAllNonArchivedGlobalMock.mockResolvedValue(ok(tasks));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('skips group with active task (status=running) even if updatedAt is old', async () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-300', status: 'running', updatedAt: daysAgo(14) }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-300', status: 'failed', updatedAt: daysAgo(14) }),
    ];
    listAllNonArchivedGlobalMock.mockResolvedValue(ok(tasks));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.groupsSkippedActive).toBe(1);
    }
  });

  it('groups tasks by linearIssueId — stale group archived, fresh group retained', async () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-400', updatedAt: daysAgo(10) }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-400', updatedAt: daysAgo(10) }),
      makeTask({ id: 'task-3', linearIssueId: 'INT-500', updatedAt: daysAgo(2) }),
      makeTask({ id: 'task-4', linearIssueId: 'INT-500', updatedAt: daysAgo(2) }),
    ];
    listAllNonArchivedGlobalMock.mockResolvedValue(ok(tasks));
    updateMock.mockResolvedValue(ok(tasks[0] as CodeTask));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledWith('task-1', { status: 'archived' });
    expect(updateMock).toHaveBeenCalledWith('task-2', { status: 'archived' });
    expect(updateMock).not.toHaveBeenCalledWith('task-3', expect.anything());
    expect(updateMock).not.toHaveBeenCalledWith('task-4', expect.anything());
    if (result.ok) {
      expect(result.value.groupsArchived).toBe(1);
      expect(result.value.groupsRetained).toBe(1);
    }
  });

  it('standalone tasks (no linearIssueId) grouped by task.id, archived when stale', async () => {
    const task = makeTask({ id: 'standalone-1', updatedAt: daysAgo(10) });
    // no linearIssueId
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([task]));
    updateMock.mockResolvedValue(ok(task));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith('standalone-1', { status: 'archived' });
  });

  it('handles update failure — logs error, continues, reports tasksFailed: 1', async () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-600', updatedAt: daysAgo(10) }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-600', updatedAt: daysAgo(10) }),
    ];
    listAllNonArchivedGlobalMock.mockResolvedValue(ok(tasks));
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

  it('returns zero counts when no non-archived tasks exist', async () => {
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([]));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalTasksFetched).toBe(0);
      expect(result.value.totalGroupsEvaluated).toBe(0);
      expect(result.value.groupsArchived).toBe(0);
      expect(result.value.groupsRetained).toBe(0);
      expect(result.value.groupsSkippedActive).toBe(0);
      expect(result.value.tasksArchived).toBe(0);
      expect(result.value.tasksFailed).toBe(0);
      expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns error when listAllNonArchivedGlobal fails', async () => {
    listAllNonArchivedGlobalMock.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR' as const, message: 'Query failed' })
    );

    const result = await useCase();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Query failed');
    }
  });

  it('custom staleDays parameter respected — tasks 5 days old archived with staleDays: 3', async () => {
    const task = makeTask({ id: 'task-1', linearIssueId: 'INT-700', updatedAt: daysAgo(5) });
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([task]));
    updateMock.mockResolvedValue(ok(task));

    // With staleDays: 3, 5-day-old task should be archived
    const result = await useCase({ staleDays: 3 });

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith('task-1', { status: 'archived' });
  });

  it('custom staleDays parameter respected — tasks 5 days old retained with default (7)', async () => {
    const task = makeTask({ id: 'task-1', linearIssueId: 'INT-800', updatedAt: daysAgo(5) });
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([task]));

    // With default staleDays: 7, 5-day-old task should be retained
    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('handles update throwing an exception — catches, logs error, reports tasksFailed', async () => {
    const task = makeTask({ id: 'task-1', linearIssueId: 'INT-601', updatedAt: daysAgo(10) });
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([task]));
    updateMock.mockRejectedValue(new Error('Unexpected Firestore crash'));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tasksFailed).toBe(1);
      expect(result.value.tasksArchived).toBe(0);
    }
  });

  it('mixed group: one task stale, one task fresh → group retained', async () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-900', updatedAt: daysAgo(10) }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-900', updatedAt: daysAgo(2) }),
    ];
    listAllNonArchivedGlobalMock.mockResolvedValue(ok(tasks));

    const result = await useCase();

    expect(result.ok).toBe(true);
    // maxUpdatedAt is 2 days ago (fresh) → group retained
    expect(updateMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.groupsRetained).toBe(1);
    }
  });
});
