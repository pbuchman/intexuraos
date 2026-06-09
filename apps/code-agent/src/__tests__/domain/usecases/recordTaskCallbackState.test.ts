import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { resetServices, setServices, type ServiceContainer } from '../../../services.js';
import { recordTaskCallbackSuccess } from '../../../domain/usecases/recordTaskCallbackState.js';

describe('recordTaskCallbackSuccess', () => {
  afterEach(() => {
    resetServices();
    vi.clearAllMocks();
  });

  it('logs and skips when the task no longer exists', async () => {
    const logger = { warn: vi.fn() };
    const update = vi.fn();
    setServices({
      codeTaskCallbackBaseUrl: 'https://callback.test',
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(err({ code: 'NOT_FOUND', message: 'Task not found' })),
        update,
      },
    } as unknown as ServiceContainer);

    await recordTaskCallbackSuccess('task_missing', 'logs', logger);

    expect(update).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_missing', endpoint: 'logs' }),
      'Callback success state skipped because task was not found'
    );
  });

  it('logs when callback state persistence fails', async () => {
    const logger = { warn: vi.fn() };
    setServices({
      codeTaskCallbackBaseUrl: 'https://callback.test',
      codeTaskRepo: {
        findById: vi.fn().mockResolvedValue(ok({
          id: 'task_123',
          callbackState: {
            webhookUrl: 'https://callback.test/internal/webhooks/task-complete',
            callbackBaseUrl: 'https://callback.test',
            owner: 'custom',
            configuredAt: new Date('2026-06-09T14:00:00.000Z'),
          },
        })),
        update: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'write failed' })),
      },
    } as unknown as ServiceContainer);

    await recordTaskCallbackSuccess('task_123', 'task_complete', logger);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_123', endpoint: 'task_complete' }),
      'Failed to record callback success state'
    );
  });
});
