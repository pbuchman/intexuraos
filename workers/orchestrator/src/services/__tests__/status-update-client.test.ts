import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { createHmac } from 'node:crypto';
import type { Logger } from 'pino';

import { StatusUpdateClient, type StatusUpdateClientConfig } from '../status-update-client.js';

const codeAgentUrl = 'http://code-agent.test';
const orchestratorSecret = 'orchestrator-secret-xyz';
const internalAuthToken = 'internal-auth-token';

interface LogCall {
  level: string;
  data: unknown;
}

function makeLogger(): { logger: Logger; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const logger = {
    info: (data: unknown) => {
      calls.push({ level: 'info', data });
    },
    warn: (data: unknown) => {
      calls.push({ level: 'warn', data });
    },
    error: (data: unknown) => {
      calls.push({ level: 'error', data });
    },
    debug: (data: unknown) => {
      calls.push({ level: 'debug', data });
    },
  } as unknown as Logger;
  return { logger, calls };
}

function makeClient(overrides: Partial<StatusUpdateClientConfig> = {}): {
  client: StatusUpdateClient;
  calls: LogCall[];
} {
  const { logger, calls } = makeLogger();
  const client = new StatusUpdateClient({
    codeAgentUrl,
    orchestratorSecret,
    internalAuthToken,
    logger,
    retryDelaysMs: [1, 1, 1],
    requestTimeoutMs: 15_000,
    ...overrides,
  });
  return { client, calls };
}

describe('StatusUpdateClient', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('signs with orchestratorSecret and returns ok on 200', async () => {
    const completedAt = new Date('2026-04-17T10:00:00.000Z');

    nock(codeAgentUrl)
      .patch('/internal/code-tasks/task_1/status')
      .matchHeader('content-type', 'application/json')
      .matchHeader('x-internal-auth', internalAuthToken)
      .matchHeader('x-request-signature', /^[a-f0-9]{64}$/)
      .matchHeader('x-request-timestamp', /^\d+$/)
      .reply(200, { success: true });

    const { client } = makeClient();
    const result = await client.commit({
      taskId: 'task_1',
      status: 'completed',
      completedAt,
    });

    expect(result).toEqual({ ok: true });
    expect(nock.isDone()).toBe(true);
  });

  it('uses the task webhook base for terminal status callbacks when provided', async () => {
    const taskCallbackOrigin = 'https://intexuraos.cloud';

    nock(taskCallbackOrigin)
      .patch('/internal/code-tasks/task_prod/status')
      .reply(200, { success: true });

    const { client } = makeClient();
    const result = await client.commit({
      taskId: 'task_prod',
      status: 'failed',
      completedAt: new Date('2026-04-17T10:00:00.000Z'),
      webhookUrl: 'https://intexuraos.cloud/internal/webhooks/task-complete',
    });

    expect(result).toEqual({ ok: true });
    expect(nock.isDone()).toBe(true);
  });

  it('computes signature over the exact rawBody bytes sent', async () => {
    let capturedBody: string | undefined;
    let capturedTimestamp: string | undefined;
    let capturedSignature: string | undefined;

    nock(codeAgentUrl)
      .patch('/internal/code-tasks/task_sig/status', (body) => {
        capturedBody = JSON.stringify(body);
        return true;
      })
      .reply(function () {
        capturedTimestamp = this.req.headers['x-request-timestamp'] as string | undefined;
        capturedSignature = this.req.headers['x-request-signature'] as string | undefined;
        return [200, { success: true }];
      });

    const { client } = makeClient();
    const completedAt = new Date('2026-04-17T10:00:00.000Z');
    const result = await client.commit({
      taskId: 'task_sig',
      status: 'completed',
      completedAt,
      result: { prUrl: 'https://github.com/x/y/pull/1', branch: 'task_foo', summary: 'Done' },
    });

    expect(result).toEqual({ ok: true });
    expect(capturedBody).toBeDefined();
    expect(capturedTimestamp).toMatch(/^\d+$/);
    expect(capturedSignature).toMatch(/^[a-f0-9]{64}$/);

    const expected = createHmac('sha256', orchestratorSecret)
      .update(`${String(capturedTimestamp)}.${String(capturedBody)}`)
      .digest('hex');

    expect(capturedSignature).toBe(expected);
    expect(nock.isDone()).toBe(true);
  });

  it('returns ok on eventual 200 after 5xx retries', async () => {
    nock(codeAgentUrl).patch('/internal/code-tasks/task_retry/status').reply(500, 'boom');
    nock(codeAgentUrl)
      .patch('/internal/code-tasks/task_retry/status')
      .reply(200, { success: true });

    const { client, calls } = makeClient({ retryDelaysMs: [1, 1] });
    const result = await client.commit({
      taskId: 'task_retry',
      status: 'completed',
      completedAt: new Date('2026-04-17T10:00:00.000Z'),
    });

    expect(result).toEqual({ ok: true });
    expect(nock.isDone()).toBe(true);
    // Exactly one warn for the failed attempt, and an info for the eventual recovery
    expect(calls.filter((c) => c.level === 'warn')).toHaveLength(1);
    expect(calls.filter((c) => c.level === 'info')).toHaveLength(1);
  });

  it('does not retry on 4xx and returns err with type "4xx"', async () => {
    nock(codeAgentUrl).patch('/internal/code-tasks/task_404/status').reply(404, 'not found');

    const { client, calls } = makeClient({ retryDelaysMs: [1, 1, 1] });
    const result = await client.commit({
      taskId: 'task_404',
      status: 'completed',
      completedAt: new Date('2026-04-17T10:00:00.000Z'),
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.type).toBe('4xx');
      if (result.error.type === '4xx') {
        expect(result.error.status).toBe(404);
      }
    }
    expect(nock.isDone()).toBe(true);
    // Only one attempt → one warn, no retries
    expect(calls.filter((c) => c.level === 'warn')).toHaveLength(1);
  });

  it('returns err after exhausting retries on persistent 5xx', async () => {
    nock(codeAgentUrl).patch('/internal/code-tasks/task_503/status').reply(503, 'unavailable');
    nock(codeAgentUrl).patch('/internal/code-tasks/task_503/status').reply(503, 'unavailable');
    nock(codeAgentUrl).patch('/internal/code-tasks/task_503/status').reply(503, 'unavailable');

    const { client, calls } = makeClient({ retryDelaysMs: [1, 1] });
    const result = await client.commit({
      taskId: 'task_503',
      status: 'failed',
      completedAt: new Date('2026-04-17T10:00:00.000Z'),
      error: { code: 'UPSTREAM', message: 'bad things' },
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.type).toBe('5xx');
      if (result.error.type === '5xx') {
        expect(result.error.status).toBe(503);
      }
    }
    expect(nock.isDone()).toBe(true);
    // Three attempts → three warns
    expect(calls.filter((c) => c.level === 'warn')).toHaveLength(3);
    // On retry exhaustion we escalate to a single error log so operators see
    // the terminal failure even if the caller forgets to log.
    const errors = calls.filter((c) => c.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.data).toMatchObject({
      taskId: 'task_503',
      attempts: 3,
      errorType: '5xx',
    });
  });

  it('returns timeout error when request exceeds requestTimeoutMs', async () => {
    nock(codeAgentUrl)
      .patch('/internal/code-tasks/task_slow/status')
      .delay(50)
      .reply(200, { success: true });

    const { client, calls } = makeClient({
      retryDelaysMs: [],
      requestTimeoutMs: 10,
    });
    const result = await client.commit({
      taskId: 'task_slow',
      status: 'completed',
      completedAt: new Date('2026-04-17T10:00:00.000Z'),
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.type).toBe('timeout');
    }
    // Retry-exhaustion error log must also fire on timeout.
    const errors = calls.filter((c) => c.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.data).toMatchObject({
      taskId: 'task_slow',
      attempts: 1,
      errorType: 'timeout',
    });
    // nock may or may not consider the interceptor "done" depending on when the abort
    // fires relative to the response. Clear it so afterEach doesn't complain.
    nock.cleanAll();
  });

  it('serializes completedAt to ISO string', async () => {
    let capturedBody: unknown;

    nock(codeAgentUrl)
      .patch('/internal/code-tasks/task_iso/status', (body) => {
        capturedBody = body;
        return true;
      })
      .reply(200, { success: true });

    const { client } = makeClient();
    await client.commit({
      taskId: 'task_iso',
      status: 'completed',
      completedAt: new Date('2026-04-17T10:11:12.345Z'),
    });

    expect(capturedBody).toMatchObject({
      taskId: 'task_iso',
      status: 'completed',
      completedAt: '2026-04-17T10:11:12.345Z',
    });
    expect(nock.isDone()).toBe(true);
  });

  it('omits error/result from body when not provided', async () => {
    let capturedBody: Record<string, unknown> | undefined;

    nock(codeAgentUrl)
      .patch('/internal/code-tasks/task_min/status', (body) => {
        capturedBody = body as Record<string, unknown>;
        return true;
      })
      .reply(200, { success: true });

    const { client } = makeClient();
    await client.commit({
      taskId: 'task_min',
      status: 'completed',
      completedAt: new Date('2026-04-17T10:00:00.000Z'),
    });

    expect(capturedBody).toBeDefined();
    expect(Object.keys(capturedBody ?? {}).sort()).toEqual(
      ['completedAt', 'status', 'taskId'].sort()
    );
    expect('error' in (capturedBody ?? {})).toBe(false);
    expect('result' in (capturedBody ?? {})).toBe(false);
    expect(nock.isDone()).toBe(true);
  });

  it('uses default retry delays and timeout when not supplied', async () => {
    nock(codeAgentUrl)
      .patch('/internal/code-tasks/task_defaults/status')
      .reply(200, { success: true });

    const { logger } = makeLogger();
    const client = new StatusUpdateClient({
      codeAgentUrl,
      orchestratorSecret,
      internalAuthToken,
      logger,
      // No retryDelaysMs, no requestTimeoutMs → exercise default-fallback branches.
    });

    const result = await client.commit({
      taskId: 'task_defaults',
      status: 'completed',
      completedAt: new Date('2026-04-17T10:00:00.000Z'),
    });

    expect(result).toEqual({ ok: true });
    expect(nock.isDone()).toBe(true);
  });

  it('falls back to HTTP status string when 5xx body is empty', async () => {
    nock(codeAgentUrl).patch('/internal/code-tasks/task_empty/status').reply(500, '');
    nock(codeAgentUrl).patch('/internal/code-tasks/task_empty/status').reply(500, '');

    const { client, calls } = makeClient({ retryDelaysMs: [1] });
    const result = await client.commit({
      taskId: 'task_empty',
      status: 'failed',
      completedAt: new Date('2026-04-17T10:00:00.000Z'),
      error: { code: 'X', message: 'y' },
    });

    expect(result.ok).toBe(false);
    if (result.ok === false && result.error.type === '5xx') {
      expect(result.error.message).toBe('HTTP 500');
    }
    expect(nock.isDone()).toBe(true);
    const warns = calls.filter((c) => c.level === 'warn');
    expect(warns).toHaveLength(2);
  });

  it('handles non-Error thrown values from fetch as network errors', async () => {
    // Simulate an unusual throw (e.g. a plain string) that is NOT an Error instance.
    // This exercises the `String(err)` fallback in the network-error branch.
    const fetchFn: typeof fetch = () => {
      throw 'exploded';
    };

    const { logger, calls } = makeLogger();
    const client = new StatusUpdateClient({
      codeAgentUrl,
      orchestratorSecret,
      internalAuthToken,
      logger,
      retryDelaysMs: [],
      requestTimeoutMs: 1000,
      fetchFn,
    });

    const result = await client.commit({
      taskId: 'task_nonerror',
      status: 'completed',
      completedAt: new Date('2026-04-17T10:00:00.000Z'),
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.type).toBe('network');
      if (result.error.type === 'network') {
        expect(result.error.message).toBe('exploded');
      }
    }
    // Retry-exhaustion error log must also fire on network-class errors.
    const errors = calls.filter((c) => c.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.data).toMatchObject({
      taskId: 'task_nonerror',
      attempts: 1,
      errorType: 'network',
      errorMessage: 'exploded',
    });
  });

  it('retries on network error and eventually succeeds', async () => {
    nock(codeAgentUrl)
      .patch('/internal/code-tasks/task_net/status')
      .replyWithError({ code: 'ECONNRESET', message: 'socket hang up' });
    nock(codeAgentUrl).patch('/internal/code-tasks/task_net/status').reply(200, { success: true });

    const { client, calls } = makeClient({ retryDelaysMs: [1] });
    const result = await client.commit({
      taskId: 'task_net',
      status: 'completed',
      completedAt: new Date('2026-04-17T10:00:00.000Z'),
    });

    expect(result).toEqual({ ok: true });
    expect(nock.isDone()).toBe(true);
    expect(calls.filter((c) => c.level === 'warn')).toHaveLength(1);
    expect(calls.filter((c) => c.level === 'info')).toHaveLength(1);
  });
});

// Silence unused warnings; vi is kept in case future tests need mocks
void vi;
