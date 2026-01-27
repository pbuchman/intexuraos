import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { ok } from '@intexuraos/common-core';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import type { DetectZombieTasksDeps } from '../../domain/usecases/detectZombieTasks.js';
import type { CodeTask } from '../../domain/models/codeTask.js';

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
  let updateMock: MockedFunction<(taskId: string, input: unknown) => Promise<unknown>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));

    findZombieTasksMock = vi.fn() as unknown as MockedFunction<(staleThreshold: Date) => Promise<ReturnType<typeof ok>>>;
    updateMock = vi.fn() as unknown as MockedFunction<(taskId: string, input: unknown) => Promise<unknown>>;

    deps = {
      codeTaskRepository: {
        // Add stub implementations for all required methods
        create: vi.fn(),
        findById: vi.fn(),
        findByIdForUser: vi.fn(),
        list: vi.fn(),
        hasActiveTaskForLinearIssue: vi.fn(),
        findZombieTasks: findZombieTasksMock,
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
    findZombieTasksMock.mockResolvedValue(ok([zombieTask]));
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
      })
    );
  });

  it('should use 30 minute stale threshold by default', async () => {
    findZombieTasksMock.mockResolvedValue(ok([]));

    await useCase();

    expect(findZombieTasksMock).toHaveBeenCalledWith(expect.any(Date));

    const calls = findZombieTasksMock.mock.calls;
    const thresholdDate = calls[0]?.[0] as Date | undefined;
    const expectedThreshold = new Date('2025-01-01T11:30:00Z'); // 30 minutes before current time
    expect(thresholdDate?.getTime()).toBe(expectedThreshold.getTime());
  });

  it('should return empty result when no zombies found', async () => {
    findZombieTasksMock.mockResolvedValue(ok([]));

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

    findZombieTasksMock.mockResolvedValue(ok([zombie1, zombie2]));
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

  afterEach(() => {
    vi.useRealTimers();
  });
});
