/**
 * Tests for startAskAgent use case.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { ok, err, type Logger } from '@intexuraos/common-core';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createFirestoreCodeTaskRepository } from '../../../infra/firestore/firestoreCodeTaskRepository.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import type { WorkerSettingsRepository } from '../../../domain/ports/workerSettingsRepository.js';
import type { TaskEnqueueService } from '../../../domain/services/taskEnqueueService.js';
import type { WhatsAppNotifier } from '../../../domain/services/whatsappNotifier.js';
import { createWorkerSettingsRepository } from '../../../infra/firestore/workerSettingsRepository.js';
import { startAskAgent } from '../../../domain/usecases/startAskAgent.js';

// Required env vars
process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';
process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] = 'test-orchestrator-secret';

describe('startAskAgent', () => {
  let logger: Logger;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let codeTaskRepo: CodeTaskRepository;
  let workerSettingsRepo: WorkerSettingsRepository;
  let taskEnqueueService: TaskEnqueueService;
  let whatsappNotifier: WhatsAppNotifier;

  beforeEach(async () => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    workerSettingsRepo = createWorkerSettingsRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    taskEnqueueService = {
      enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 1 })),
    };
    whatsappNotifier = {
      notifyTaskDispatchBlocked: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as WhatsAppNotifier;

    // Seed a worker for the test user
    await workerSettingsRepo.addWorker('test-user-id', {
      name: 'test-worker',
      url: 'http://test',
      cfAccessClientId: '',
      cfAccessClientSecret: '',
      dispatchSigningSecret: 'test-secret',
    });
  });

  afterEach(() => {
    resetFirestore();
    vi.clearAllMocks();
  });

  it('submits task successfully on happy path', async () => {
    const result = await startAskAgent(
      { logger, codeTaskRepo, workerSettingsRepo, taskEnqueueService, whatsappNotifier },
      { userId: 'test-user-id', prompt: 'What is the architecture of this codebase?' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('submitted');
    expect(result.value.codeTaskId).toMatch(/^task_/);

    // Verify enqueue was called
    expect(taskEnqueueService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: result.value.codeTaskId,
        userId: 'test-user-id',
      }),
    );
  });

  it('returns a failed task id when no workers are set up', async () => {
    const blockerLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    // Use a user with no workers
    const result = await startAskAgent(
      { logger: blockerLogger, codeTaskRepo, workerSettingsRepo, taskEnqueueService, whatsappNotifier },
      { userId: 'user-with-no-workers', prompt: 'Ask something' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('failed');
    const taskResult = await codeTaskRepo.findLatestAskAgentTask('user-with-no-workers');
    expect(taskResult.ok).toBe(true);
    if (!taskResult.ok) return;
    expect(taskResult.value).not.toBeNull();
    if (taskResult.value === null) return;
    const task = taskResult.value;
    expect(task).toEqual(expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({
        code: 'dispatch_blocked_no_enabled_workers',
      }),
      dispatchStatus: expect.objectContaining({
        state: 'terminal',
        reason: 'no_enabled_workers',
        nextAction: 'retry_after_fix',
      }),
    }));
    expect(whatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith(
      'user-with-no-workers',
      expect.objectContaining({
        reason: 'no_enabled_workers',
        exampleTaskId: task.id,
      }),
    );
    expect(blockerLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-with-no-workers',
        taskId: task.id,
        workerType: task.workerType,
        reason: 'no_enabled_workers',
        _skipSentry: true,
      }),
      'User has no workers configured for ask-agent',
    );
  });

  it('returns internal_error when no-worker ask-agent task failure cannot be persisted', async () => {
    vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'write failed' }),
    );

    const result = await startAskAgent(
      { logger, codeTaskRepo, workerSettingsRepo, taskEnqueueService, whatsappNotifier },
      { userId: 'user-with-no-workers', prompt: 'Ask something' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'internal_error',
      message: 'Failed to persist dispatch failure status',
    });
    expect(whatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
  });

  it('returns a failed task id when queue is at capacity', async () => {
    vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(
      err({ code: 'queue_full', message: 'Queue is full (50/50)' }),
    );

    const result = await startAskAgent(
      { logger, codeTaskRepo, workerSettingsRepo, taskEnqueueService, whatsappNotifier },
      { userId: 'test-user-id', prompt: 'Ask something' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('failed');
    expect(result.value.codeTaskId).toMatch(/^task_/);
  });

  it('returns duplicate_prompt when similar prompt was recently submitted', async () => {
    // Submit first task
    await startAskAgent(
      { logger, codeTaskRepo, workerSettingsRepo, taskEnqueueService, whatsappNotifier },
      { userId: 'test-user-id', prompt: 'Exact same prompt' },
    );

    // Submit second task with same prompt
    const result = await startAskAgent(
      { logger, codeTaskRepo, workerSettingsRepo, taskEnqueueService, whatsappNotifier },
      { userId: 'test-user-id', prompt: 'Exact same prompt' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('duplicate_prompt');
  });

  it('returns internal_error when enqueue fails with non-queue_full error', async () => {
    vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(
      err({ code: 'internal_error', message: 'Firestore write failed' }),
    );

    const result = await startAskAgent(
      { logger, codeTaskRepo, workerSettingsRepo, taskEnqueueService, whatsappNotifier },
      { userId: 'test-user-id', prompt: 'Ask something new' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('internal_error');
  });

  it('returns a failed task id when worker settings fetch fails after task creation', async () => {
    // Create a mock workerSettingsRepo that fails
    const failingWorkerSettingsRepo: WorkerSettingsRepository = {
      ...workerSettingsRepo,
      getSettings: vi.fn().mockResolvedValue(err({ code: 'internal_error', message: 'Firestore error' })),
    };

    const result = await startAskAgent(
      { logger, codeTaskRepo, workerSettingsRepo: failingWorkerSettingsRepo, taskEnqueueService, whatsappNotifier },
      { userId: 'test-user-id', prompt: 'Ask something else' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('failed');
    expect(result.value.codeTaskId).toMatch(/^task_/);

    const taskResult = await codeTaskRepo.findById(result.value.codeTaskId);
    expect(taskResult.ok).toBe(true);
    if (!taskResult.ok) return;
    expect(taskResult.value.status).toBe('failed');
    expect(taskResult.value.error).toEqual(expect.objectContaining({
      code: 'dispatch_blocked_dispatch_failed',
    }));
    expect(taskResult.value.dispatchStatus).toEqual(expect.objectContaining({
      state: 'terminal',
      reason: 'dispatch_failed',
      nextAction: 'retry_after_fix',
    }));
    expect(whatsappNotifier.notifyTaskDispatchBlocked).toHaveBeenCalledWith(
      'test-user-id',
      expect.objectContaining({
        reason: 'dispatch_failed',
        exampleTaskId: result.value.codeTaskId,
      }),
    );
  });

  it('returns internal_error when settings-fetch failure status cannot be persisted', async () => {
    const failingWorkerSettingsRepo: WorkerSettingsRepository = {
      ...workerSettingsRepo,
      getSettings: vi.fn().mockResolvedValue(err({ code: 'internal_error', message: 'Firestore error' })),
    };
    vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'write failed' }),
    );

    const result = await startAskAgent(
      { logger, codeTaskRepo, workerSettingsRepo: failingWorkerSettingsRepo, taskEnqueueService, whatsappNotifier },
      { userId: 'test-user-id', prompt: 'Ask something with failing persistence' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'internal_error',
      message: 'Failed to persist dispatch failure status',
    });
    expect(whatsappNotifier.notifyTaskDispatchBlocked).not.toHaveBeenCalled();
  });
});
