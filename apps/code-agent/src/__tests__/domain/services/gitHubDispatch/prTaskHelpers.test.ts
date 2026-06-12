import { describe, expect, it, vi } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import {
  destroyPreservedContainer,
  isStaleTaskError,
  resolveLoginForTaskCreation,
  resolveWorkerCredentials,
  reusePreservedContainer,
} from '../../../../domain/services/gitHubDispatch/prTaskHelpers.js';
import type { WorkerSettingsRepository } from '../../../../domain/ports/workerSettingsRepository.js';

vi.mock('../../../../domain/usecases/sendTaskMessage.js', () => ({
  sendTaskMessage: vi.fn(),
}));

import { sendTaskMessage } from '../../../../domain/usecases/sendTaskMessage.js';
const mockedSendTaskMessage = vi.mocked(sendTaskMessage);

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeWorkerSettingsRepo(overrides: Partial<WorkerSettingsRepository> = {}): WorkerSettingsRepository {
  return {
    getSettings: vi.fn().mockResolvedValue(ok(null)),
    saveSettings: vi.fn(),
    ...overrides,
  } as unknown as WorkerSettingsRepository;
}

describe('prTaskHelpers / resolveLoginForTaskCreation', () => {
  const allowedBots = new Set(['claude[bot]', 'chatgpt-codex-connector[bot]']);

  it('returns sender unchanged for human users', () => {
    expect(resolveLoginForTaskCreation('alice', 'alice/fork', allowedBots)).toBe('alice');
  });

  it('remaps bot sender to repo owner for personal forks', () => {
    expect(resolveLoginForTaskCreation('claude[bot]', 'alice/intexuraos', allowedBots)).toBe('alice');
  });

  it('does NOT remap bot sender for intexuraos org repos', () => {
    expect(resolveLoginForTaskCreation('claude[bot]', 'intexuraos/code-agent', allowedBots)).toBe('claude[bot]');
  });

  it('returns sender unchanged when repository has no owner slash', () => {
    expect(resolveLoginForTaskCreation('claude[bot]', 'no-owner-repo', allowedBots)).toBe('claude[bot]');
  });

  it('returns sender unchanged when repository starts with slash', () => {
    expect(resolveLoginForTaskCreation('claude[bot]', '/repo', allowedBots)).toBe('claude[bot]');
  });
});

describe('prTaskHelpers / isStaleTaskError', () => {
  it('returns true for task_not_found error code', () => {
    expect(isStaleTaskError({ success: false, dispatched: false, errorCode: 'task_not_found' })).toBe(true);
  });

  it('returns true for session_expired error code', () => {
    expect(isStaleTaskError({ success: false, dispatched: false, errorCode: 'session_expired' })).toBe(true);
  });

  it('returns true for worker_error with "Task not found" message', () => {
    expect(
      isStaleTaskError({
        success: false,
        dispatched: false,
        errorCode: 'worker_error',
        error: 'Worker responded: Task not found',
      }),
    ).toBe(true);
  });

  it('returns true for worker_error with "HTTP 404" message', () => {
    expect(
      isStaleTaskError({
        success: false,
        dispatched: false,
        errorCode: 'worker_error',
        error: 'HTTP 404 from worker',
      }),
    ).toBe(true);
  });

  it('returns false for worker_error with unrelated message', () => {
    expect(
      isStaleTaskError({
        success: false,
        dispatched: false,
        errorCode: 'worker_error',
        error: 'Worker timeout',
      }),
    ).toBe(false);
  });

  it('returns false for worker_error without an error message', () => {
    expect(isStaleTaskError({ success: false, dispatched: false, errorCode: 'worker_error' })).toBe(false);
  });

  it('returns false for successful results', () => {
    expect(isStaleTaskError({ success: true, dispatched: true })).toBe(false);
  });
});

describe('prTaskHelpers / resolveWorkerCredentials', () => {
  it('returns undefined when getSettings fails', async () => {
    const repo = makeWorkerSettingsRepo({
      getSettings: vi.fn().mockResolvedValue(err({ code: 'fail' as never, message: 'boom' })),
    });
    expect(await resolveWorkerCredentials(repo, 'user-1', 'home')).toBeUndefined();
  });

  it('returns undefined when settings are null', async () => {
    const repo = makeWorkerSettingsRepo({
      getSettings: vi.fn().mockResolvedValue(ok(null)),
    });
    expect(await resolveWorkerCredentials(repo, 'user-1', 'home')).toBeUndefined();
  });

  it('returns undefined when no matching worker is configured', async () => {
    const repo = makeWorkerSettingsRepo({
      getSettings: vi.fn().mockResolvedValue(
        ok({
          workers: [
            {
              name: 'office',
              enabled: true,
              url: 'http://office',
              cfAccessClientId: 'id',
              cfAccessClientSecret: 'secret',
            },
          ],
        } as never),
      ),
    });
    expect(await resolveWorkerCredentials(repo, 'user-1', 'home')).toBeUndefined();
  });

  it('returns undefined when matching worker is disabled', async () => {
    const repo = makeWorkerSettingsRepo({
      getSettings: vi.fn().mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home',
              enabled: false,
              url: 'http://home',
              cfAccessClientId: 'id',
              cfAccessClientSecret: 'secret',
            },
          ],
        } as never),
      ),
    });
    expect(await resolveWorkerCredentials(repo, 'user-1', 'home')).toBeUndefined();
  });

  it('returns credentials for enabled matching worker', async () => {
    const repo = makeWorkerSettingsRepo({
      getSettings: vi.fn().mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home',
              enabled: true,
              url: 'http://home',
              cfAccessClientId: 'id',
              cfAccessClientSecret: 'secret',
            },
          ],
        } as never),
      ),
    });
    expect(await resolveWorkerCredentials(repo, 'user-1', 'home')).toEqual({
      url: 'http://home',
      cfAccessClientId: 'id',
      cfAccessClientSecret: 'secret',
    });
  });
});

describe('prTaskHelpers / destroyPreservedContainer', () => {
  it('calls cancelOnWorker with resolved credentials', async () => {
    const cancelOnWorker = vi.fn().mockResolvedValue(undefined);
    const workerSettingsRepo = makeWorkerSettingsRepo({
      getSettings: vi.fn().mockResolvedValue(
        ok({
          workers: [
            {
              name: 'home',
              enabled: true,
              url: 'http://home',
              cfAccessClientId: 'id',
              cfAccessClientSecret: 'secret',
            },
          ],
        } as never),
      ),
    });
    const deps = {
      workerSettingsRepo,
      taskDispatcher: { cancelOnWorker } as never,
    };

    await destroyPreservedContainer(
      deps,
      { id: 'task-1', userId: 'user-1', workerLocation: 'home' },
      mockLogger,
    );

    expect(cancelOnWorker).toHaveBeenCalledWith('task-1', 'home', {
      url: 'http://home',
      cfAccessClientId: 'id',
      cfAccessClientSecret: 'secret',
    });
  });

  it('logs warn when cancelOnWorker throws (best-effort)', async () => {
    const cancelOnWorker = vi.fn().mockRejectedValue(new Error('net down'));
    const deps = {
      workerSettingsRepo: makeWorkerSettingsRepo(),
      taskDispatcher: { cancelOnWorker } as never,
    };
    const warn = vi.fn();
    const logger: Logger = { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() };

    await destroyPreservedContainer(
      deps,
      { id: 'task-1', userId: 'user-1', workerLocation: 'home' },
      logger,
    );

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' }),
      'Failed to destroy preserved container (best-effort)',
    );
  });
});

describe('prTaskHelpers / reusePreservedContainer', () => {
  function makeReuseDeps(): {
    codeTaskRepo: never;
    logLineRepo: never;
    taskDispatcher: never;
    workerSettingsRepo: never;
    statusMirrorService: never;
    whatsappNotifier: never;
  } {
    return {
      codeTaskRepo: {} as never,
      logLineRepo: {} as never,
      taskDispatcher: {} as never,
      workerSettingsRepo: {} as never,
      statusMirrorService: {} as never,
      whatsappNotifier: {} as never,
    };
  }

  it('returns success when sendTaskMessage succeeds', async () => {
    mockedSendTaskMessage.mockResolvedValue(ok({ action: 'queued' } as never));
    const result = await reusePreservedContainer(
      makeReuseDeps(),
      { id: 'task-1', userId: 'user-1' },
      'hello',
      mockLogger,
    );
    expect(result).toEqual({ success: true, dispatched: true });
  });

  it('returns null when sendTaskMessage fails', async () => {
    mockedSendTaskMessage.mockResolvedValue(err({ code: 'worker_error', message: 'nope' } as never));
    const result = await reusePreservedContainer(
      makeReuseDeps(),
      { id: 'task-1', userId: 'user-1' },
      'hello',
      mockLogger,
    );
    expect(result).toBeNull();
  });

  it('returns null when sendTaskMessage throws', async () => {
    mockedSendTaskMessage.mockRejectedValue(new Error('boom'));
    const warn = vi.fn();
    const logger: Logger = { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() };
    const result = await reusePreservedContainer(
      makeReuseDeps(),
      { id: 'task-1', userId: 'user-1' },
      'hello',
      logger,
    );
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
