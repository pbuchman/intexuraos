import { createHmac } from 'node:crypto';
import { request as createHttpRequest } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import type { GitHubTokenService } from '../github/token-service.js';
import { registerRoutes } from '../routes.js';
import type { TaskDispatcher } from '../services/task-dispatcher.js';

const orchestratorSecret = 'admission-test-secret';

function signedRequest(payload: object): { headers: Record<string, string>; body: string } {
  const timestamp = String(Date.now());
  const nonce = `nonce-${Math.random().toString(36).slice(2)}`;
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', orchestratorSecret)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest('hex');
  return {
    headers: {
      'content-type': 'application/json',
      'x-dispatch-timestamp': timestamp,
      'x-dispatch-signature': signature,
      'x-dispatch-nonce': nonce,
    },
    body,
  };
}

function taskPayload(): object {
  return {
    taskId: 'task_00000000-0000-0000-0000-000000000001',
    workerType: 'auto',
    prompt: 'test',
    webhookUrl: 'https://example.com/hook',
    webhookSecret: 'secret',
  };
}

function createDispatcher(): TaskDispatcher {
  return {
    submitTask: vi.fn(async () => ({ ok: true, value: undefined })),
    cancelTask: vi.fn(async () => ({ ok: true, value: undefined })),
    sendMessage: vi.fn(async () => ({ ok: true, value: { action: 'queued' } })),
    getTask: vi.fn(async () => ({ taskId: 'readable' })),
    getRunningCount: vi.fn(() => 0),
    getCapacity: vi.fn(() => 5),
    getDrainOwnershipSnapshot: vi.fn(async () => ({
      workerContainers: 0,
      pendingTerminalCallbacks: 0,
      terminalCallbackActivityTotal: 0,
    })),
    getLogForwarderDrainSnapshot: vi.fn(() => ({
      counterEpochId: '00112233445566778899aabbccddeeff',
      processStartedAt: '2026-09-01T00:00:00.000Z',
      activeForwarders: 0,
      bufferedBytes: 0,
      partialLineBytes: 0,
      queuedChunks: 0,
      inFlightBatches: 0,
      inFlightChunks: 0,
      activeFlushOperations: 0,
      openUploadRequests: 0,
      detachedUploadRetryPromises: 0,
      droppedChunksTotal: 0,
      forwarderActivityTotal: 0,
      lastActivityAt: null,
    })),
  } as unknown as TaskDispatcher;
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

const tokenService = {
  getExpiresAt: vi.fn(() => null),
  refreshToken: vi.fn(async () => ({ ok: true, value: 'token' })),
} as unknown as GitHubTokenService;

describe('task admission freeze lifecycle', () => {
  const apps: FastifyInstance[] = [];

  async function build(
    dispatcher: TaskDispatcher,
    readAdmissionFreeze: () => boolean,
    configureApp?: (app: FastifyInstance) => void
  ): Promise<FastifyInstance> {
    const app = Fastify();
    apps.push(app);
    configureApp?.(app);
    registerRoutes(
      app,
      dispatcher,
      tokenService,
      { orchestratorSecret },
      logger,
      undefined,
      undefined,
      undefined,
      {},
      readAdmissionFreeze
    );
    await app.ready();
    return app;
  }

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()));
    vi.clearAllMocks();
  });

  it('fails closed for every task mutation while preserving reads', async () => {
    const dispatcher = createDispatcher();
    const app = await build(dispatcher, () => true);

    const create = signedRequest(taskPayload());
    const message = signedRequest({ message: 'hello' });
    const responses = await Promise.all([
      app.inject({ method: 'POST', url: '/tasks', ...create }),
      app.inject({ method: 'DELETE', url: '/tasks/readable' }),
      app.inject({ method: 'POST', url: '/tasks/readable/message', ...message }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([503, 503, 503]);
    expect(dispatcher.submitTask).not.toHaveBeenCalled();
    expect(dispatcher.cancelTask).not.toHaveBeenCalled();
    expect(dispatcher.sendMessage).not.toHaveBeenCalled();

    const read = await app.inject({ method: 'GET', url: '/tasks/readable' });
    expect(read.statusCode).toBe(200);
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toMatchObject({
      admissionFrozen: true,
      pendingAdmissions: 0,
      admissionActivityTotal: 3,
    });
  });

  it('keeps a request that crossed the freeze boundary visible until its response completes', async () => {
    const dispatcher = createDispatcher();
    let frozen = false;
    let releaseSubmission: ((value: { ok: true; value: undefined }) => void) | undefined;
    vi.mocked(dispatcher.submitTask).mockImplementationOnce(
      async () =>
        await new Promise((resolve) => {
          releaseSubmission = resolve;
        })
    );
    const app = await build(dispatcher, () => frozen);

    const accepted = app.inject({ method: 'POST', url: '/tasks', ...signedRequest(taskPayload()) });
    await vi.waitFor(() => expect(dispatcher.submitTask).toHaveBeenCalledTimes(1));

    frozen = true;
    const drainingHealth = await app.inject({ method: 'GET', url: '/health' });
    expect(drainingHealth.json()).toMatchObject({
      admissionFrozen: true,
      pendingAdmissions: 1,
      admissionActivityTotal: 1,
    });

    releaseSubmission?.({ ok: true, value: undefined });
    expect((await accepted).statusCode).toBe(202);

    const drainedHealth = await app.inject({ method: 'GET', url: '/health' });
    expect(drainedHealth.json()).toMatchObject({
      admissionFrozen: true,
      pendingAdmissions: 0,
      admissionActivityTotal: 1,
    });

    const rejected = await app.inject({
      method: 'POST',
      url: '/tasks',
      ...signedRequest({ ...taskPayload(), taskId: 'task_00000000-0000-0000-0000-000000000002' }),
    });
    expect(rejected.statusCode).toBe(503);
    expect(dispatcher.submitTask).toHaveBeenCalledTimes(1);
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({
      admissionFrozen: true,
      pendingAdmissions: 0,
      admissionActivityTotal: 2,
    });
  });

  it('denies mutations when the marker reader throws', async () => {
    const dispatcher = createDispatcher();
    const app = await build(dispatcher, () => {
      throw new Error('unreadable marker');
    });
    const request = signedRequest(taskPayload());

    const response = await app.inject({ method: 'POST', url: '/tasks', ...request });

    expect(response.statusCode).toBe(503);
    expect(dispatcher.submitTask).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({
      admissionFrozen: true,
      pendingAdmissions: 0,
      admissionActivityTotal: 1,
    });
  });

  it('decrements an admitted mutation exactly once when its handler throws', async () => {
    const dispatcher = createDispatcher();
    vi.mocked(dispatcher.submitTask).mockRejectedValueOnce(new Error('dispatcher failed'));
    const app = await build(dispatcher, () => false);

    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      ...signedRequest(taskPayload()),
    });

    expect(response.statusCode).toBe(500);
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({
      pendingAdmissions: 0,
      admissionActivityTotal: 1,
    });
  });

  it('settles a mutation whose transport aborted during a delayed preHandler', async () => {
    const dispatcher = createDispatcher();
    let releasePreHandler: (() => void) | undefined;
    let markPreHandlerEntered: (() => void) | undefined;
    const preHandlerEntered = new Promise<void>((resolve) => {
      markPreHandlerEntered = resolve;
    });
    const preHandlerGate = new Promise<void>((resolve) => {
      releasePreHandler = resolve;
    });
    const app = await build(
      dispatcher,
      () => false,
      (instance) => {
        instance.addHook('preHandler', async (request) => {
          if (request.url === '/tasks') {
            markPreHandlerEntered?.();
            await preHandlerGate;
          }
        });
      }
    );
    const address = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
    const signed = signedRequest(taskPayload());
    const client = createHttpRequest({
      hostname: address.hostname,
      port: address.port,
      path: '/tasks',
      method: 'POST',
      headers: {
        ...signed.headers,
        'content-length': String(Buffer.byteLength(signed.body)),
      },
    });
    client.on('error', () => undefined);
    client.end(signed.body);
    await preHandlerEntered;

    const closed = new Promise<void>((resolve) => client.once('close', resolve));
    client.destroy();
    await closed;
    releasePreHandler?.();

    await vi.waitFor(() => expect(dispatcher.submitTask).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => {
      expect((await app.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({
        pendingAdmissions: 0,
        admissionActivityTotal: 1,
      });
    });
  });

  it('keeps an aborted transport pending until its admitted handler also settles', async () => {
    const dispatcher = createDispatcher();
    let releaseSubmission: ((value: { ok: true; value: undefined }) => void) | undefined;
    vi.mocked(dispatcher.submitTask).mockImplementationOnce(
      async () =>
        await new Promise((resolve) => {
          releaseSubmission = resolve;
        })
    );
    let frozen = false;
    const app = await build(dispatcher, () => frozen);
    const address = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
    const signed = signedRequest(taskPayload());
    const client = createHttpRequest({
      hostname: address.hostname,
      port: address.port,
      path: '/tasks',
      method: 'POST',
      headers: {
        ...signed.headers,
        'content-length': String(Buffer.byteLength(signed.body)),
      },
    });
    client.on('error', () => undefined);
    client.end(signed.body);
    await vi.waitFor(() => expect(dispatcher.submitTask).toHaveBeenCalledTimes(1));

    frozen = true;
    const closed = new Promise<void>((resolve) => client.once('close', resolve));
    client.destroy();
    await closed;
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({
      admissionFrozen: true,
      pendingAdmissions: 1,
      admissionActivityTotal: 1,
    });

    releaseSubmission?.({ ok: true, value: undefined });
    await vi.waitFor(async () => {
      expect((await app.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({
        pendingAdmissions: 0,
        admissionActivityTotal: 1,
      });
    });
  });
});
