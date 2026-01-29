import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { ok } from '@intexuraos/common-core';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import type { ProcessHeartbeatDeps } from '../../domain/usecases/processHeartbeat.js';
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

describe('processHeartbeat', () => {
  let deps: ProcessHeartbeatDeps;
  let useCase: ReturnType<typeof createProcessHeartbeatUseCase>;
  let findByIdMock: MockedFunction<(taskId: string) => Promise<unknown>>;
  let updateMock: MockedFunction<(taskId: string, input: unknown) => Promise<unknown>>;

  beforeEach(() => {
    findByIdMock = vi.fn() as unknown as MockedFunction<(taskId: string) => Promise<unknown>>;
    updateMock = vi.fn() as unknown as MockedFunction<(taskId: string, input: unknown) => Promise<unknown>>;

    deps = {
      codeTaskRepository: {
        create: vi.fn(),
        findById: findByIdMock,
        findByIdForUser: vi.fn(),
        list: vi.fn(),
        hasActiveTaskForLinearIssue: vi.fn(),
        findZombieTasks: vi.fn(),
        update: updateMock,
      } as unknown as ProcessHeartbeatDeps['codeTaskRepository'],
      logger: createFakeLogger() as unknown as ProcessHeartbeatDeps['logger'],
    };
    useCase = createProcessHeartbeatUseCase(deps);
  });

  it('should update updatedAt for running tasks', async () => {
    const task = createFakeCodeTask({ id: 'task-1', status: 'running' });
    findByIdMock.mockResolvedValue(ok(task));
    updateMock.mockResolvedValue(ok({ ...task, updatedAt: Timestamp.now() }));

    const result = await useCase(['task-1']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.processed).toBe(1);
      expect(result.value.notFound).toHaveLength(0);
    }
    expect(updateMock).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        updatedAt: expect.any(Date),
        lastHeartbeat: expect.any(Date),
      })
    );
  });

  it('should skip non-running tasks', async () => {
    const task = createFakeCodeTask({ id: 'task-1', status: 'completed' });
    findByIdMock.mockResolvedValue(ok(task));

    const result = await useCase(['task-1']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.processed).toBe(0);
    }
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('should update dispatched tasks since they may be actively running', async () => {
    const task = createFakeCodeTask({ id: 'task-1', status: 'dispatched' });
    findByIdMock.mockResolvedValue(ok(task));
    updateMock.mockResolvedValue(ok(task));

    const result = await useCase(['task-1']);

    // Dispatched tasks should still get heartbeat updates
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.processed).toBe(1);
    }
    expect(updateMock).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        updatedAt: expect.any(Date),
        lastHeartbeat: expect.any(Date),
      })
    );
  });

  it('should report not found tasks', async () => {
    findByIdMock.mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Task not found' },
    });

    const result = await useCase(['unknown-task']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.notFound).toContain('unknown-task');
      expect(result.value.processed).toBe(0);
    }
  });

  it('should process multiple tasks', async () => {
    const task1 = createFakeCodeTask({ id: 'task-1', status: 'running' });
    const task2 = createFakeCodeTask({ id: 'task-2', status: 'running' });
    findByIdMock
      .mockResolvedValueOnce(ok(task1))
      .mockResolvedValueOnce(ok(task2));
    updateMock.mockResolvedValue(ok({}));

    const result = await useCase(['task-1', 'task-2']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.processed).toBe(2);
    }
    expect(updateMock).toHaveBeenCalledTimes(2);
  });

  it('should continue processing after individual task error', async () => {
    const task1 = createFakeCodeTask({ id: 'task-1', status: 'running' });

    findByIdMock
      .mockResolvedValueOnce(ok(task1))
      .mockRejectedValueOnce(new Error('Database error'));
    // Mock update to succeed for task-1 (will be called before task-2's findById)
    updateMock.mockResolvedValue(ok(task1));

    const result = await useCase(['task-1', 'task-2']);

    // Should not throw - processHeartbeat doesn't throw on individual errors
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.processed).toBe(1); // Only task-1 succeeded
    }
  });

  it('should handle empty taskIds array', async () => {
    const result = await useCase([]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.processed).toBe(0);
      expect(result.value.notFound).toHaveLength(0);
    }
  });

  it('should handle update failure and continue processing', async () => {
    const task1 = createFakeCodeTask({ id: 'task-1', status: 'running' });
    const task2 = createFakeCodeTask({ id: 'task-2', status: 'running' });
    findByIdMock
      .mockResolvedValueOnce(ok(task1))
      .mockResolvedValueOnce(ok(task2));
    updateMock
      .mockResolvedValueOnce({ ok: false, error: { code: 'UPDATE_ERROR', message: 'Update failed' } })
      .mockResolvedValueOnce(ok({}));

    const result = await useCase(['task-1', 'task-2']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.processed).toBe(1);
    }
    expect(deps.logger.error).toHaveBeenCalledWith(
      { taskId: 'task-1', error: 'Update failed' },
      'Failed to update task heartbeat'
    );
  });
});
