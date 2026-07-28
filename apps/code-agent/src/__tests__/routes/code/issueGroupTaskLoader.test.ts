import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { err, ok, type Logger } from '@intexuraos/common-core';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import { loadExactTasksForUser } from '../../../routes/code/issueGroupTaskLoader.js';

const timestamp = Timestamp.fromDate(new Date('2026-07-28T06:00:00.000Z'));

function task(id: string): CodeTask {
  return {
    id,
    userId: 'user-123',
    status: 'failed',
    agentType: 'execution',
    createdAt: timestamp,
    statusChangedAt: timestamp,
    completedAt: timestamp,
    updatedAt: timestamp,
  } as CodeTask;
}

function logger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('loadExactTasksForUser', () => {
  it('deduplicates a whole-page id set, prefers one bulk call, restores order, and logs missing ids', async () => {
    const findByIdsForUser = vi.fn().mockResolvedValue(ok([task('task_c'), task('task_a')]));
    const findByIdForUser = vi.fn();
    const codeTaskRepo = {
      findByIdsForUser,
      findByIdForUser,
    } as unknown as CodeTaskRepository;
    const testLogger = logger();

    const result = await loadExactTasksForUser({
      codeTaskRepo,
      userId: 'user-123',
      taskIds: ['task_a', 'task_b', 'task_a', 'task_c'],
      logger: testLogger,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findByIdsForUser).toHaveBeenCalledOnce();
    expect(findByIdsForUser).toHaveBeenCalledWith(
      ['task_a', 'task_b', 'task_c'],
      'user-123',
    );
    expect(findByIdForUser).not.toHaveBeenCalled();
    expect(result.value.map((value) => value.id)).toEqual(['task_a', 'task_c']);
    expect(testLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        missingTaskCount: 1,
        [SKIP_SENTRY_KEY]: true,
      }),
      'Exact issue-group task references could not be hydrated',
    );
    const warningPayload = vi.mocked(testLogger.warn).mock.calls[0]?.[0];
    expect(warningPayload).not.toHaveProperty('missingTaskIds');
    expect(testLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedTaskCount: 3,
        hydratedTaskCount: 2,
        missingTaskCount: 1,
        durationMs: expect.any(Number),
        [SKIP_SENTRY_KEY]: true,
      }),
      'Completed exact issue-group task hydration',
    );
    const infoPayload = vi.mocked(testLogger.info).mock.calls[0]?.[0];
    expect(infoPayload).not.toHaveProperty('taskIds');
  });

  it('returns a bulk infrastructure failure unchanged', async () => {
    const findByIdsForUser = vi.fn().mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR' as const, message: 'down' }),
    );
    const codeTaskRepo = { findByIdsForUser } as unknown as CodeTaskRepository;

    const result = await loadExactTasksForUser({
      codeTaskRepo,
      userId: 'user-123',
      taskIds: ['task_a', 'task_broken'],
      logger: logger(),
    });

    expect(result).toEqual(err({ code: 'FIRESTORE_ERROR', message: 'down' }));
  });
});
