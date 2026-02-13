import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import { sendTaskMessage, type SendTaskMessageDeps } from '../../domain/usecases/sendTaskMessage.js';

describe('sendTaskMessage use case', () => {
  let mockCodeTaskRepo: {
    findByIdForUser: ReturnType<typeof vi.fn>;
  };
  let mockTaskDispatcher: {
    sendMessageToWorker: ReturnType<typeof vi.fn>;
  };
  let mockWorkerSettingsRepo: {
    getSettings: ReturnType<typeof vi.fn>;
  };
  let mockLogLineRepo: {
    storeBatch: ReturnType<typeof vi.fn>;
  };
  let mockLogger: Logger;

  const userId = 'test-user-123';
  const taskId = 'task_msg_001';
  const message = 'Please also add unit tests';

  const makeTask = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: taskId,
    userId,
    status: 'running',
    prompt: 'Build the feature',
    sanitizedPrompt: 'Build the feature',
    systemPromptHash: 'hash123',
    workerType: 'auto',
    workerLocation: 'home-mac',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace-1',
    dedupKey: 'dedup-1',
    callbackReceived: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    webhookSecret: 'secret',
    ...overrides,
  });

  const makeWorkerSettings = (): Record<string, unknown> => ({
    workers: [
      {
        name: 'home-mac',
        url: 'https://worker.example.com',
        cfAccessClientId: 'cf-id',
        cfAccessClientSecret: 'cf-secret',
        dispatchSigningSecret: 'signing-secret',
        enabled: true,
      },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      level: 'info',
      isLevelEnabled: vi.fn(() => true),
    } as unknown as Logger;

    mockCodeTaskRepo = {
      findByIdForUser: vi.fn(),
    };

    mockTaskDispatcher = {
      sendMessageToWorker: vi.fn(),
    };

    mockWorkerSettingsRepo = {
      getSettings: vi.fn(),
    };

    mockLogLineRepo = {
      storeBatch: vi.fn().mockResolvedValue(ok(undefined)),
    };
  });

  const makeDeps = (): SendTaskMessageDeps => ({
    logger: mockLogger,
    codeTaskRepo: mockCodeTaskRepo as unknown as SendTaskMessageDeps['codeTaskRepo'],
    taskDispatcher: mockTaskDispatcher as unknown as SendTaskMessageDeps['taskDispatcher'],
    workerSettingsRepo: mockWorkerSettingsRepo as unknown as SendTaskMessageDeps['workerSettingsRepo'],
    logLineRepo: mockLogLineRepo as unknown as SendTaskMessageDeps['logLineRepo'],
  });

  it('should return task_not_found when task does not exist', async () => {
    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(
      err({ code: 'NOT_FOUND', message: 'Not found' })
    );

    const result = await sendTaskMessage(makeDeps(), { taskId, userId, message });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_not_found');
    }
  });

  it('should return task_not_running when task status is completed', async () => {
    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(makeTask({ status: 'completed' })));

    const result = await sendTaskMessage(makeDeps(), { taskId, userId, message });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_not_running');
      expect(result.error.message).toContain('completed');
    }
    expect(mockLogLineRepo.storeBatch).not.toHaveBeenCalled();
  });

  it('should return worker_not_configured when no workers available', async () => {
    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(makeTask()));
    mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [] }));

    const result = await sendTaskMessage(makeDeps(), { taskId, userId, message });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('worker_not_configured');
    }
  });

  it('should forward message to worker for running task', async () => {
    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(makeTask()));
    mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok(makeWorkerSettings()));
    mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok(undefined));

    const result = await sendTaskMessage(makeDeps(), { taskId, userId, message });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe('interrupted');
    }

    expect(mockTaskDispatcher.sendMessageToWorker).toHaveBeenCalledWith(
      taskId,
      message,
      expect.objectContaining({
        url: 'https://worker.example.com',
        dispatchSigningSecret: 'signing-secret',
      })
    );
  });

  it('should write user message to log_lines', async () => {
    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(makeTask()));
    mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok(makeWorkerSettings()));
    mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok(undefined));

    await sendTaskMessage(makeDeps(), { taskId, userId, message });

    expect(mockLogLineRepo.storeBatch).toHaveBeenCalledWith(
      taskId,
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('[USER MESSAGE]'),
        }),
      ])
    );
  });

  it('should return message_failed when worker rejects message', async () => {
    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(makeTask()));
    mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok(makeWorkerSettings()));
    mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(err('Worker returned HTTP 409'));

    const result = await sendTaskMessage(makeDeps(), { taskId, userId, message });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('message_failed');
    }
  });

  it('should forward message for dispatched task', async () => {
    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(makeTask({ status: 'dispatched' })));
    mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok(makeWorkerSettings()));
    mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok(undefined));

    const result = await sendTaskMessage(makeDeps(), { taskId, userId, message });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe('interrupted');
    }
  });

  it('should fall back to first worker when location does not match', async () => {
    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(
      ok(makeTask({ workerLocation: 'unknown-location' }))
    );
    mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok(makeWorkerSettings()));
    mockTaskDispatcher.sendMessageToWorker.mockResolvedValue(ok(undefined));

    const result = await sendTaskMessage(makeDeps(), { taskId, userId, message });

    expect(result.ok).toBe(true);
    expect(mockTaskDispatcher.sendMessageToWorker).toHaveBeenCalledWith(
      taskId,
      message,
      expect.objectContaining({
        url: 'https://worker.example.com',
      })
    );
  });

  it('should return task_not_running for failed task status', async () => {
    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(makeTask({ status: 'failed' })));

    const result = await sendTaskMessage(makeDeps(), { taskId, userId, message });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_not_running');
      expect(result.error.message).toContain('failed');
    }
  });
});
