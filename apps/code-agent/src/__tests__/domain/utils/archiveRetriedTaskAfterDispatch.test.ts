import { describe, expect, it, vi } from 'vitest';
import { err, ok, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import { archiveRetriedTaskAfterDispatch } from '../../../domain/utils/archiveRetriedTaskAfterDispatch.js';

describe('archiveRetriedTaskAfterDispatch', () => {
  function createLogger(): Logger {
    return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
  }

  it('does nothing when retriedFrom is undefined', async () => {
    const logger = createLogger();
    const codeTaskRepo = {
      update: vi.fn(),
    } as unknown as CodeTaskRepository;

    await archiveRetriedTaskAfterDispatch({
      logger,
      codeTaskRepo,
      retryTaskId: 'task_retry',
      warningMessage: 'Failed to archive retried task',
    });

    expect(codeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('archives the original task when retriedFrom is present', async () => {
    const logger = createLogger();
    const codeTaskRepo = {
      update: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as CodeTaskRepository;

    await archiveRetriedTaskAfterDispatch({
      logger,
      codeTaskRepo,
      retriedFrom: 'task_original',
      retryTaskId: 'task_retry',
      warningMessage: 'Failed to archive retried task',
    });

    expect(codeTaskRepo.update).toHaveBeenCalledWith('task_original', {
      status: 'archived',
    });
  });

  it('logs a warning and continues when archiving fails', async () => {
    const logger = createLogger();
    const codeTaskRepo = {
      update: vi.fn().mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'archive failed' })
      ),
    } as unknown as CodeTaskRepository;

    await archiveRetriedTaskAfterDispatch({
      logger,
      codeTaskRepo,
      retriedFrom: 'task_original',
      retryTaskId: 'task_retry',
      warningMessage: 'Failed to archive retried task',
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        originalTaskId: 'task_original',
        retryTaskId: 'task_retry',
      }),
      'Failed to archive retried task'
    );
  });
});
