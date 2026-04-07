import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { createCleanupTaskLogsUseCase } from '../../domain/usecases/cleanupTaskLogs.js';
import type { CleanupTaskLogsDeps } from '../../domain/usecases/cleanupTaskLogs.js';

function createFakeLogger(): Record<string, MockedFunction<() => void>> {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('cleanupTaskLogs', () => {
  let deps: CleanupTaskLogsDeps;
  let useCase: ReturnType<typeof createCleanupTaskLogsUseCase>;
  let findArchivableTasksMock: MockedFunction<CleanupTaskLogsDeps['codeTaskRepository']['findArchivableTasks']>;
  let archiveTaskLogsMock: MockedFunction<CleanupTaskLogsDeps['codeTaskRepository']['archiveTaskLogs']>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));

    findArchivableTasksMock = vi.fn() as MockedFunction<CleanupTaskLogsDeps['codeTaskRepository']['findArchivableTasks']>;
    archiveTaskLogsMock = vi.fn() as MockedFunction<CleanupTaskLogsDeps['codeTaskRepository']['archiveTaskLogs']>;

    deps = {
      codeTaskRepository: {
        create: vi.fn(),
        findById: vi.fn(),
        findByIdForUser: vi.fn(),
        update: vi.fn(),
        list: vi.fn(),
        hasActiveTaskForLinearIssue: vi.fn(),
        hasDispatchedOrRunningForPR: vi.fn(),
        findZombieTasks: vi.fn(),
        countByUserToday: vi.fn(),
        findArchivableTasks: findArchivableTasksMock,
        archiveTaskLogs: archiveTaskLogsMock,
      } as unknown as CleanupTaskLogsDeps['codeTaskRepository'],
      logger: createFakeLogger() as unknown as CleanupTaskLogsDeps['logger'],
    };
    useCase = createCleanupTaskLogsUseCase(deps);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should use default values when no input provided', async () => {
    findArchivableTasksMock.mockResolvedValue(ok([]));

    await useCase();

    expect(findArchivableTasksMock).toHaveBeenCalledWith(expect.any(Date), 100);

    const calls = findArchivableTasksMock.mock.calls;
    const cutoffDate = calls[0]?.[0] as Date | undefined;
    const expectedCutoff = new Date('2024-10-03T12:00:00Z');
    expect(cutoffDate?.getTime()).toBe(expectedCutoff.getTime());
  });

  it('should process tasks until none remain', async () => {
    findArchivableTasksMock
      .mockResolvedValueOnce(ok([{ taskId: 'task-1' }, { taskId: 'task-2' }]))
      .mockResolvedValueOnce(ok([]));

    archiveTaskLogsMock.mockResolvedValue(ok({ logCount: 10, archivedAt: new Date() }));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tasksProcessed).toBe(2);
      expect(result.value.logsDeleted).toBe(20);
    }
    expect(archiveTaskLogsMock).toHaveBeenCalledTimes(2);
  });

  it('should continue after individual task failure', async () => {
    findArchivableTasksMock
      .mockResolvedValueOnce(ok([{ taskId: 'task-1' }, { taskId: 'task-2' }]))
      .mockResolvedValueOnce(ok([]));

    archiveTaskLogsMock
      .mockResolvedValueOnce(err({ code: 'NOT_FOUND' as const, message: 'Task not found' }))
      .mockResolvedValueOnce(ok({ logCount: 5, archivedAt: new Date() }));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tasksProcessed).toBe(1);
      expect(result.value.tasksFailed).toBe(1);
      expect(result.value.logsDeleted).toBe(5);
    }
  });

  it('should return error when findArchivableTasks fails', async () => {
    findArchivableTasksMock.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR' as const, message: 'Query failed' })
    );

    const result = await useCase();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Query failed');
    }
  });

  it('should handle thrown exceptions in task processing', async () => {
    findArchivableTasksMock
      .mockResolvedValueOnce(ok([{ taskId: 'task-1' }]))
      .mockResolvedValueOnce(ok([]));

    archiveTaskLogsMock.mockRejectedValue(new Error('Unexpected error'));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tasksFailed).toBe(1);
      expect(result.value.tasksProcessed).toBe(0);
    }
  });

  it('should respect custom retentionDays', async () => {
    findArchivableTasksMock.mockResolvedValue(ok([]));

    await useCase({ retentionDays: 30 });

    const calls = findArchivableTasksMock.mock.calls;
    const cutoffDate = calls[0]?.[0] as Date | undefined;
    const expectedCutoff = new Date('2024-12-02T12:00:00Z');
    expect(cutoffDate?.getTime()).toBe(expectedCutoff.getTime());
  });

  it('should pass batchSize to archiveTaskLogs', async () => {
    findArchivableTasksMock
      .mockResolvedValueOnce(ok([{ taskId: 'task-1' }]))
      .mockResolvedValueOnce(ok([]));

    archiveTaskLogsMock.mockResolvedValue(ok({ logCount: 10, archivedAt: new Date() }));

    await useCase({ batchSize: 250 });

    expect(archiveTaskLogsMock).toHaveBeenCalledWith('task-1', 250);
  });

  it('should stop when fewer tasks than tasksPerRun returned', async () => {
    findArchivableTasksMock.mockResolvedValueOnce(ok([{ taskId: 'task-1' }]));

    archiveTaskLogsMock.mockResolvedValue(ok({ logCount: 10, archivedAt: new Date() }));

    const result = await useCase({ tasksPerRun: 100 });

    expect(result.ok).toBe(true);
    expect(findArchivableTasksMock).toHaveBeenCalledTimes(1);
  });

  it('should continue paginating when tasks returned equals tasksPerRun', async () => {
    const tasksPerRun = 2;

    findArchivableTasksMock
      .mockResolvedValueOnce(ok([{ taskId: 'task-1' }, { taskId: 'task-2' }]))
      .mockResolvedValueOnce(ok([{ taskId: 'task-3' }]));

    archiveTaskLogsMock.mockResolvedValue(ok({ logCount: 5, archivedAt: new Date() }));

    const result = await useCase({ tasksPerRun });

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.tasksProcessed).toBe(3);
      expect(result.value.logsDeleted).toBe(15);
    }
    expect(findArchivableTasksMock).toHaveBeenCalledTimes(2);
    expect(archiveTaskLogsMock).toHaveBeenCalledTimes(3);
  });

  it('should return zero counts when no tasks to process', async () => {
    findArchivableTasksMock.mockResolvedValue(ok([]));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tasksProcessed).toBe(0);
      expect(result.value.tasksFailed).toBe(0);
      expect(result.value.logsDeleted).toBe(0);
      expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
