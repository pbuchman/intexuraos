/**
 * Thin route-level tests for `webhookRoutes` — asserts the parse → validate
 * → delegate → respond pattern works end-to-end without exercising the full
 * use-case domain logic.
 *
 * Deep integration coverage (actual DB writes, Linear enforcement, etc.)
 * remains in `webhooks.test.ts`. This file satisfies the INT-1431 DoD
 * requirement for a dedicated `webhookRoutes.test.ts` verifying:
 *   - POST /internal/webhooks/task-complete with valid body → use case called, 200
 *   - Invalid signature → 401 (without invoking the use case)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fastify, { type FastifyInstance } from 'fastify';
import { intexuraFastifyPlugin } from '@intexuraos/common-http';
import { ok } from '@intexuraos/common-core';

import { webhookRoutes } from '../../routes/webhookRoutes.js';
import { resetServices, setServices, type ServiceContainer } from '../../services.js';
import { createMockLogger } from '../helpers/mockLogger.js';

// Mock the use cases so route-level tests only verify delegation, not the
// 1,700-line handleTaskCompletion body.
vi.mock('../../domain/usecases/handleTaskCompletion.js', () => ({
  handleTaskCompletion: vi.fn(),
}));
vi.mock('../../domain/usecases/recordTaskEvent.js', () => ({
  storeLogChunks: vi.fn(),
  recordTurnMetrics: vi.fn(),
}));

import * as handleTaskCompletionModule from '../../domain/usecases/handleTaskCompletion.js';
import * as recordTaskEventModule from '../../domain/usecases/recordTaskEvent.js';

const WEBHOOK_SECRET = 'test-webhook-secret';
const INTERNAL_AUTH_TOKEN = 'test-internal-token';
const EXISTING_CALLBACK_STATE = {
  webhookUrl: 'https://intexuraos.cloud/api/code/internal/webhooks/task-complete',
  callbackBaseUrl: 'https://intexuraos.cloud/api/code',
  owner: 'prod' as const,
  configuredAt: new Date('2026-06-09T14:00:00.000Z'),
};

interface MockCodeTaskRepo {
  findById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({ logger: false });
  await app.register(intexuraFastifyPlugin);
  await app.register(webhookRoutes);
  await app.ready();
  return app;
}

function signPayload(payload: object, secret: string, timestamp: number): string {
  const message = `${String(timestamp)}.${JSON.stringify(payload)}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

describe('webhookRoutes — POST /internal/webhooks/task-complete', () => {
  let app: FastifyInstance;
  let mockCodeTaskRepo: MockCodeTaskRepo;

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
    mockCodeTaskRepo = {
      findById: vi.fn().mockResolvedValue(ok({
        webhookSecret: WEBHOOK_SECRET,
        callbackState: EXISTING_CALLBACK_STATE,
      })),
      update: vi.fn().mockResolvedValue(ok({})),
    };
    setServices({
      codeTaskRepo: mockCodeTaskRepo as never,
      logger: createMockLogger() as never,
    } as unknown as ServiceContainer);
    app = await buildApp();
  });

  afterEach(async () => {
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    resetServices();
    vi.clearAllMocks();
    await app.close();
  });

  it('delegates to handleTaskCompletion and returns 200 for a valid body + valid signature', async () => {
    vi.mocked(handleTaskCompletionModule.handleTaskCompletion).mockResolvedValue({ kind: 'received' });

    const payload = { taskId: 't-1', status: 'completed' as const };
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(payload, WEBHOOK_SECRET, timestamp);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': INTERNAL_AUTH_TOKEN,
        'x-request-timestamp': String(timestamp),
        'x-request-signature': signature,
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
    // Use case MUST be invoked once with the parsed body.
    expect(handleTaskCompletionModule.handleTaskCompletion).toHaveBeenCalledTimes(1);
    const call = vi.mocked(handleTaskCompletionModule.handleTaskCompletion).mock.calls[0];
    expect(call?.[1].body).toMatchObject({ taskId: 't-1', status: 'completed' });
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({
        callbackState: expect.objectContaining({
          callbackBaseUrl: 'https://intexuraos.cloud/api/code',
          lastSuccessEndpoint: 'task_complete',
          lastSuccessAt: expect.any(Date),
        }),
      })
    );
  });

  it('accepts a valid task signature without environment-scoped internal auth', async () => {
    vi.mocked(handleTaskCompletionModule.handleTaskCompletion).mockResolvedValue({ kind: 'received' });

    const payload = { taskId: 't-cross-env', status: 'completed' as const };
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(payload, WEBHOOK_SECRET, timestamp);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-request-timestamp': String(timestamp),
        'x-request-signature': signature,
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(handleTaskCompletionModule.handleTaskCompletion).toHaveBeenCalledTimes(1);
  });

  it('returns 401 WITHOUT calling the use case when the signature is invalid', async () => {
    const payload = { taskId: 't-1', status: 'completed' as const };
    const timestamp = Math.floor(Date.now() / 1000);
    // Deliberately wrong signature (signed with a different secret)
    const badSignature = signPayload(payload, 'not-the-real-secret', timestamp);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': INTERNAL_AUTH_TOKEN,
        'x-request-timestamp': String(timestamp),
        'x-request-signature': badSignature,
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
    expect(handleTaskCompletionModule.handleTaskCompletion).not.toHaveBeenCalled();
  });

  it('returns 401 WITHOUT calling the use case when the signature headers are missing', async () => {
    const payload = { taskId: 't-1', status: 'completed' as const };

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: { 'content-type': 'application/json' },
      payload,
    });

    expect(response.statusCode).toBe(401);
    expect(handleTaskCompletionModule.handleTaskCompletion).not.toHaveBeenCalled();
  });

  it('returns the use-case failure code when handleTaskCompletion returns a fail outcome', async () => {
    vi.mocked(handleTaskCompletionModule.handleTaskCompletion).mockResolvedValue({
      kind: 'fail', code: 'NOT_FOUND', message: 'Task not found',
    });

    const payload = { taskId: 't-missing', status: 'completed' as const };
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(payload, WEBHOOK_SECRET, timestamp);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': INTERNAL_AUTH_TOKEN,
        'x-request-timestamp': String(timestamp),
        'x-request-signature': signature,
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(404);
    expect(handleTaskCompletionModule.handleTaskCompletion).toHaveBeenCalledTimes(1);
  });
});

describe('webhookRoutes — POST /internal/logs', () => {
  let app: FastifyInstance;
  let mockCodeTaskRepo: MockCodeTaskRepo;

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
    mockCodeTaskRepo = {
      findById: vi.fn().mockResolvedValue(ok({
        webhookSecret: WEBHOOK_SECRET,
        callbackState: EXISTING_CALLBACK_STATE,
      })),
      update: vi.fn().mockResolvedValue(ok({})),
    };
    setServices({
      codeTaskRepo: mockCodeTaskRepo as never,
      logger: createMockLogger() as never,
    } as unknown as ServiceContainer);
    app = await buildApp();
  });

  afterEach(async () => {
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    resetServices();
    vi.clearAllMocks();
    await app.close();
  });

  it('delegates to storeLogChunks and returns 200 with acknowledged sequences', async () => {
    vi.mocked(recordTaskEventModule.storeLogChunks).mockResolvedValue({
      kind: 'received', acknowledgedSequences: [1, 2], count: 2,
    });

    const payload = {
      taskId: 't-logs',
      chunks: [
        { sequence: 1, content: 'hello', timestamp: new Date().toISOString() },
        { sequence: 2, content: 'world', timestamp: new Date().toISOString() },
      ],
    };
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(payload, WEBHOOK_SECRET, timestamp);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': INTERNAL_AUTH_TOKEN,
        'x-request-timestamp': String(timestamp),
        'x-request-signature': signature,
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true, acknowledgedSequences: [1, 2], count: 2 });
    expect(recordTaskEventModule.storeLogChunks).toHaveBeenCalledTimes(1);
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
      't-logs',
      expect.objectContaining({
        callbackState: expect.objectContaining({
          lastSuccessEndpoint: 'logs',
          lastSuccessAt: expect.any(Date),
        }),
      })
    );
  });

  it('accepts log chunks signed with the task secret without internal auth', async () => {
    vi.mocked(recordTaskEventModule.storeLogChunks).mockResolvedValue({
      kind: 'received', acknowledgedSequences: [10], count: 1,
    });

    const payload = {
      taskId: 't-logs',
      chunks: [
        { sequence: 10, content: 'cross-env log', timestamp: new Date().toISOString() },
      ],
    };
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(payload, WEBHOOK_SECRET, timestamp);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-request-timestamp': String(timestamp),
        'x-request-signature': signature,
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true, acknowledgedSequences: [10], count: 1 });
    expect(recordTaskEventModule.storeLogChunks).toHaveBeenCalledTimes(1);
  });
});

describe('webhookRoutes — POST /internal/turn-metrics', () => {
  let app: FastifyInstance;
  let mockCodeTaskRepo: MockCodeTaskRepo;

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
    process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] = 'orchestrator-secret-not-used-for-task-metrics';
    mockCodeTaskRepo = {
      findById: vi.fn().mockResolvedValue(ok({
        webhookSecret: WEBHOOK_SECRET,
        callbackState: EXISTING_CALLBACK_STATE,
      })),
      update: vi.fn().mockResolvedValue(ok({})),
    };
    setServices({
      codeTaskRepo: mockCodeTaskRepo as never,
      logger: createMockLogger() as never,
    } as unknown as ServiceContainer);
    app = await buildApp();
  });

  afterEach(async () => {
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_ORCHESTRATOR_SECRET'];
    resetServices();
    vi.clearAllMocks();
    await app.close();
  });

  it('accepts turn metrics signed with the task secret without internal auth', async () => {
    vi.mocked(recordTaskEventModule.recordTurnMetrics).mockResolvedValue({ kind: 'received' });

    const payload = {
      taskId: 't-metrics',
      attempt: 1,
      timestamp: '2026-06-09T14:47:40.000Z',
      cpuTimeSeconds: 10,
      cpuCores: 4,
      peakMemoryMB: 512,
      wallTimeSeconds: 120,
      apiWaitSeconds: 40,
      toolExecSeconds: 50,
      backgroundWaitSeconds: 10,
      overheadSeconds: 20,
      totalInputTokens: 1000,
      totalOutputTokens: 200,
      totalCacheReadTokens: 300,
      totalCacheCreationTokens: 400,
      apiCallCount: 3,
      cpuUtilizationPercent: 2.08,
      idlePercent: 41.67,
    };
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(payload, WEBHOOK_SECRET, timestamp);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/turn-metrics',
      headers: {
        'x-request-timestamp': String(timestamp),
        'x-request-signature': signature,
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
    expect(recordTaskEventModule.recordTurnMetrics).toHaveBeenCalledTimes(1);
    expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
      't-metrics',
      expect.objectContaining({
        callbackState: expect.objectContaining({
          lastSuccessEndpoint: 'turn_metrics',
          lastSuccessAt: expect.any(Date),
        }),
      })
    );
  });
});
