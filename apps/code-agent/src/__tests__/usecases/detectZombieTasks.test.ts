import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { ok } from '@intexuraos/common-core';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import type { DetectZombieTasksDeps } from '../../domain/usecases/detectZombieTasks.js';
import type { CodeTask } from '../../domain/models/codeTask.js';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';

function createFakeCodeTask(overrides: Partial<CodeTask> = {}): CodeTask {
  const now = Timestamp.now();
  return {
    id: 'task-1',
    traceId: 'trace-1',
    userId: 'user-1',
    prompt: 'Test prompt',
    sanitizedPrompt: 'Test prompt',
    systemPromptHash: 'hash',
    workerType: 'auto',
    workerLocation: 'mac',
    repository: 'test/repo',
    baseBranch: 'main',
    status: 'running',
    dedupKey: 'key',
    callbackReceived: false,
    createdAt: now,
    updatedAt: now,
    lastHeartbeat: Timestamp.fromDate(new Date('2025-01-01T10:00:00.000Z')),
    dispatchToken: 'dispatch-token-1',
    ...overrides,
  };
}

function createFakeLogger(): Record<string, MockedFunction<() => void>> {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('detectZombieTasks', () => {
  let deps: DetectZombieTasksDeps;
  let useCase: ReturnType<typeof createDetectZombieTasksUseCase>;
  let findZombieTasksMock: MockedFunction<(staleThreshold: Date) => Promise<ReturnType<typeof ok>>>;
  let findByIdMock: ReturnType<typeof vi.fn>;
  let runInTransactionMock: ReturnType<typeof vi.fn>;
  let updateMock: MockedFunction<(taskId: string, input: unknown) => Promise<unknown>>;

  function arrangeZombieTasks(tasks: CodeTask[]): void {
    findZombieTasksMock.mockResolvedValue(ok(tasks));
    findByIdMock.mockImplementation(async (taskId: string) => {
      const task = tasks.find((candidate) => candidate.id === taskId);
      return task === undefined
        ? { ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } }
        : ok(task);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));

    findZombieTasksMock = vi.fn() as unknown as MockedFunction<(staleThreshold: Date) => Promise<ReturnType<typeof ok>>>;
    findByIdMock = vi.fn();
    runInTransactionMock = vi.fn().mockImplementation(
      async (operation: (transaction: unknown) => Promise<unknown>) => await operation({}),
    );
    updateMock = vi.fn() as unknown as MockedFunction<(taskId: string, input: unknown) => Promise<unknown>>;

    deps = {
      codeTaskRepository: {
        // Add stub implementations for all required methods
        create: vi.fn(),
        findById: findByIdMock,
        findByIdForUser: vi.fn(),
        list: vi.fn(),
        hasActiveTaskForLinearIssue: vi.fn(),
        hasDispatchedOrRunningForPR: vi.fn(),
        findZombieTasks: findZombieTasksMock,
        runInTransaction: runInTransactionMock,
        update: updateMock,
      } as unknown as DetectZombieTasksDeps['codeTaskRepository'],
      logger: createFakeLogger() as unknown as DetectZombieTasksDeps['logger'],
    };
    useCase = createDetectZombieTasksUseCase(deps);
  });

  it('should find and interrupt zombie tasks', async () => {
    const zombieTask = createFakeCodeTask({
      id: 'zombie-task',
      status: 'running',
    });
    arrangeZombieTasks([zombieTask]);
    updateMock.mockResolvedValue(ok({ ...zombieTask, status: 'interrupted' as const }));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.detected).toBe(1);
      expect(result.value.interrupted).toBe(1);
      expect(result.value.errors).toHaveLength(0);
    }
    expect(updateMock).toHaveBeenCalledWith(
      'zombie-task',
      expect.objectContaining({
        status: 'interrupted',
      }),
      { transaction: expect.anything() },
    );
  });

  it('should use 30 minute stale threshold by default', async () => {
    arrangeZombieTasks([]);

    await useCase();

    expect(findZombieTasksMock).toHaveBeenCalledWith(expect.any(Date));

    const calls = findZombieTasksMock.mock.calls;
    const thresholdDate = calls[0]?.[0] as Date | undefined;
    const expectedThreshold = new Date('2025-01-01T11:30:00Z'); // 30 minutes before current time
    expect(thresholdDate?.getTime()).toBe(expectedThreshold.getTime());
  });

  it('should return empty result when no zombies found', async () => {
    arrangeZombieTasks([]);

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.detected).toBe(0);
      expect(result.value.interrupted).toBe(0);
    }
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('should continue processing after individual task error', async () => {
    const zombie1 = createFakeCodeTask({ id: 'zombie-1', status: 'running' });
    const zombie2 = createFakeCodeTask({ id: 'zombie-2', status: 'dispatched' });

    arrangeZombieTasks([zombie1, zombie2]);
    updateMock
      .mockResolvedValueOnce(ok({ ...zombie1, status: 'interrupted' as const }))
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'FIRESTORE_ERROR', message: 'Update failed' },
      });

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.detected).toBe(2);
      expect(result.value.interrupted).toBe(1);
      expect(result.value.errors).toHaveLength(1);
      expect(result.value.errors[0]).toBe('zombie-2');
    }
  });

  it('should handle repository error gracefully', async () => {
    const errorResult: ReturnType<typeof ok> = {
      ok: false,
      error: { code: 'FIRESTORE_ERROR', message: 'Query failed' },
    } as unknown as ReturnType<typeof ok>;

    findZombieTasksMock.mockResolvedValue(errorResult);

    const result = await useCase();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The use case wraps RepositoryError in an Error object
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('Query failed');
    }
  });

  it('does not interrupt when heartbeat changes after the zombie query', async () => {
    const queriedTask = createFakeCodeTask({ id: 'heartbeat-race' });
    arrangeZombieTasks([queriedTask]);
    findByIdMock.mockResolvedValue(ok({
      ...queriedTask,
      lastHeartbeat: Timestamp.fromDate(new Date('2025-01-01T10:30:00.000Z')),
    }));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ detected: 1, interrupted: 0, errors: [] });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('does not interrupt when status changes after the zombie query', async () => {
    const queriedTask = createFakeCodeTask({ id: 'status-race' });
    arrangeZombieTasks([queriedTask]);
    findByIdMock.mockResolvedValue(ok({ ...queriedTask, status: 'completed' as const }));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.interrupted).toBe(0);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('does not interrupt when dispatch token changes after the zombie query', async () => {
    const queriedTask = createFakeCodeTask({ id: 'token-race' });
    arrangeZombieTasks([queriedTask]);
    findByIdMock.mockResolvedValue(ok({ ...queriedTask, dispatchToken: 'new-owner-token' }));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.interrupted).toBe(0);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('skips a task deleted after the zombie query', async () => {
    const queriedTask = createFakeCodeTask({ id: 'deleted-race' });
    arrangeZombieTasks([queriedTask]);
    findByIdMock.mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Task not found' },
    });

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ detected: 1, interrupted: 0, errors: [] });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('reports a transactional re-read failure without terminalizing the task', async () => {
    const queriedTask = createFakeCodeTask({ id: 'read-failure' });
    arrangeZombieTasks([queriedTask]);
    findByIdMock.mockResolvedValue({
      ok: false,
      error: { code: 'FIRESTORE_ERROR', message: 'read failed' },
    });

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ detected: 1, interrupted: 0, errors: ['read-failure'] });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('fails safely when atomic repository transactions are unavailable', async () => {
    const queriedTask = createFakeCodeTask({ id: 'no-transaction' });
    arrangeZombieTasks([queriedTask]);
    delete (deps.codeTaskRepository as Partial<CodeTaskRepository>).runInTransaction;
    useCase = createDetectZombieTasksUseCase(deps);

    const result = await useCase();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('Atomic zombie task interruption is unavailable');
    expect(updateMock).not.toHaveBeenCalled();
  });

  describe('PR task lock cleanup', () => {
    it('returns locksToCleanup for zombie PR task', async () => {
      const zombieTask = createFakeCodeTask({
        id: 'zombie-pr-task',
        status: 'running',
        repository: 'org/repo',
        prNumber: 42,
      });
      arrangeZombieTasks([zombieTask]);
      updateMock.mockResolvedValue(ok({ ...zombieTask, status: 'interrupted' as const }));

      const result = await useCase();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.interrupted).toBe(1);
        expect(result.value.locksToCleanup).toEqual([
          { repository: 'org/repo', prNumber: 42 },
        ]);
      }
    });

    it('returns empty locksToCleanup for zombie non-PR task', async () => {
      const zombieTask = createFakeCodeTask({
        id: 'zombie-non-pr-task',
        status: 'running',
      });
      arrangeZombieTasks([zombieTask]);
      updateMock.mockResolvedValue(ok({ ...zombieTask, status: 'interrupted' as const }));

      const result = await useCase();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.interrupted).toBe(1);
        expect(result.value.locksToCleanup).toEqual([]);
      }
    });

    it('returns empty locksToCleanup for zombie follow-up task (has parentTaskId)', async () => {
      const zombieTask = createFakeCodeTask({
        id: 'zombie-followup-task',
        status: 'running',
        repository: 'org/repo',
        prNumber: 42,
        parentTaskId: 'parent-task-123',
      });
      arrangeZombieTasks([zombieTask]);
      updateMock.mockResolvedValue(ok({ ...zombieTask, status: 'interrupted' as const }));

      const result = await useCase();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.interrupted).toBe(1);
        expect(result.value.locksToCleanup).toEqual([]);
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
