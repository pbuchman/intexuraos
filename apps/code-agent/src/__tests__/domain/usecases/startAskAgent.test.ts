/**
 * Tests for startAskAgent use case.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { ok, err, type Logger } from '@intexuraos/common-core';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createFirestoreCodeTaskRepository } from '../../../infra/repositories/firestoreCodeTaskRepository.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import type { RateLimitService } from '../../../domain/services/rateLimitService.js';
import type { WorkerSettingsRepository } from '../../../domain/ports/workerSettingsRepository.js';
import type { TaskEnqueueService } from '../../../domain/services/taskEnqueueService.js';
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
  let rateLimitService: RateLimitService;
  let workerSettingsRepo: WorkerSettingsRepository;
  let taskEnqueueService: TaskEnqueueService;

  beforeEach(async () => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    rateLimitService = {
      checkLimits: vi.fn().mockResolvedValue(ok(undefined)),
      recordTaskStart: vi.fn().mockResolvedValue(undefined),
      recordTaskComplete: vi.fn().mockResolvedValue(undefined),
    };

    workerSettingsRepo = createWorkerSettingsRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    taskEnqueueService = {
      enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 1 })),
    };

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
      { logger, codeTaskRepo, rateLimitService, workerSettingsRepo, taskEnqueueService },
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

    // Verify rate limit start was recorded
    expect(rateLimitService.recordTaskStart).toHaveBeenCalledWith('test-user-id');
  });

  it('returns rate_limited when rate limit is exceeded', async () => {
    vi.mocked(rateLimitService.checkLimits).mockResolvedValueOnce(
      err({ code: 'concurrent_limit', message: 'Maximum 2 concurrent tasks allowed' }),
    );

    const result = await startAskAgent(
      { logger, codeTaskRepo, rateLimitService, workerSettingsRepo, taskEnqueueService },
      { userId: 'test-user-id', prompt: 'Ask something' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('rate_limited');
  });

  it('returns service_unavailable when rate limit service is down', async () => {
    vi.mocked(rateLimitService.checkLimits).mockResolvedValueOnce(
      err({ code: 'service_unavailable', message: 'Unable to verify rate limits' }),
    );

    const result = await startAskAgent(
      { logger, codeTaskRepo, rateLimitService, workerSettingsRepo, taskEnqueueService },
      { userId: 'test-user-id', prompt: 'Ask something' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('service_unavailable');
  });

  it('returns worker_not_configured when no workers are set up', async () => {
    // Use a user with no workers
    const result = await startAskAgent(
      { logger, codeTaskRepo, rateLimitService, workerSettingsRepo, taskEnqueueService },
      { userId: 'user-with-no-workers', prompt: 'Ask something' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('worker_not_configured');
  });

  it('returns queue_full when queue is at capacity', async () => {
    vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(
      err({ code: 'queue_full', message: 'Queue is full (50/50)' }),
    );

    const result = await startAskAgent(
      { logger, codeTaskRepo, rateLimitService, workerSettingsRepo, taskEnqueueService },
      { userId: 'test-user-id', prompt: 'Ask something' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('queue_full');
  });

  it('returns duplicate_prompt when similar prompt was recently submitted', async () => {
    // Submit first task
    await startAskAgent(
      { logger, codeTaskRepo, rateLimitService, workerSettingsRepo, taskEnqueueService },
      { userId: 'test-user-id', prompt: 'Exact same prompt' },
    );

    // Submit second task with same prompt
    const result = await startAskAgent(
      { logger, codeTaskRepo, rateLimitService, workerSettingsRepo, taskEnqueueService },
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
      { logger, codeTaskRepo, rateLimitService, workerSettingsRepo, taskEnqueueService },
      { userId: 'test-user-id', prompt: 'Ask something new' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('internal_error');
  });

  it('returns internal_error when worker settings fetch fails', async () => {
    // Create a mock workerSettingsRepo that fails
    const failingWorkerSettingsRepo: WorkerSettingsRepository = {
      ...workerSettingsRepo,
      getSettings: vi.fn().mockResolvedValue(err({ code: 'internal_error', message: 'Firestore error' })),
    };

    const result = await startAskAgent(
      { logger, codeTaskRepo, rateLimitService, workerSettingsRepo: failingWorkerSettingsRepo, taskEnqueueService },
      { userId: 'test-user-id', prompt: 'Ask something else' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('internal_error');
    expect(result.error.message).toBe('Failed to fetch worker settings');
  });
});
