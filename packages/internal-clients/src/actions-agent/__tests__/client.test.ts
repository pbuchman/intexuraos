import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionsAgentServiceClient } from '../client.js';
import type { ActionsAgentServiceConfig } from '../types.js';

const BASE_URL = 'http://actions-agent.test';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => logger,
} as unknown as ActionsAgentServiceConfig['logger'];

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createActionsAgentServiceClient', () => {
  it('creates actions through the internal endpoint', async () => {
    const action = {
      id: 'action-1',
      userId: 'user-1',
      commandId: 'command-1',
      type: 'todo',
      confidence: 0.9,
      title: 'Follow up',
      status: 'pending',
      payload: {},
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
    };
    const scope = nock(BASE_URL)
      .post('/internal/actions', {
        userId: 'user-1',
        commandId: 'command-1',
        type: 'todo',
        title: 'Follow up',
        confidence: 0.9,
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, { success: true, data: action });

    const client = createActionsAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createAction<typeof action>({
      userId: 'user-1',
      commandId: 'command-1',
      type: 'todo',
      title: 'Follow up',
      confidence: 0.9,
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({ ok: true, value: action });
  });

  it('returns null when getAction sees a 404', async () => {
    const scope = nock(BASE_URL)
      .get('/internal/actions/action-missing')
      .matchHeader('x-internal-auth', 'secret')
      .reply(404);

    const client = createActionsAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getAction('action-missing');

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({ ok: true, value: null });
  });

  it('updates resource status through the status endpoint and forwards trace ids', async () => {
    const scope = nock(BASE_URL)
      .patch('/internal/actions/action-123/status', {
        resource_status: 'completed',
        resource_result: {
          prUrl: 'https://github.com/intexuraos/intexuraos/pull/123',
        },
      })
      .matchHeader('x-internal-auth', 'secret')
      .matchHeader('x-trace-id', 'trace-123')
      .reply(200, { success: true, data: undefined });

    const client = createActionsAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.updateResourceStatus(
      'action-123',
      'completed',
      { prUrl: 'https://github.com/intexuraos/intexuraos/pull/123' },
      { traceId: 'trace-123' }
    );

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('updates resource status without optional trace or resource result fields', async () => {
    const scope = nock(BASE_URL)
      .patch('/internal/actions/action-plain/status', {
        resource_status: 'failed',
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, { success: true, data: undefined });

    const client = createActionsAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.updateResourceStatus('action-plain', 'failed');

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('maps timed out resource-status calls to NETWORK_ERROR', async () => {
    nock(BASE_URL).patch('/internal/actions/action-timeout/status').delay(50).reply(200, {
      success: true,
      data: undefined,
    });

    const client = createActionsAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
      defaultTimeoutMs: 1,
    });
    const result = await client.updateResourceStatus('action-timeout', 'completed');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Request exceeded 1ms',
      },
    });
  });

  it('returns API_ERROR when the resource-status endpoint rejects the request', async () => {
    nock(BASE_URL)
      .patch('/internal/actions/action-err/status')
      .reply(500, {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'nope' },
      });

    const client = createActionsAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.updateResourceStatus('action-err', 'completed');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'API_ERROR',
        message: 'HTTP 500',
      },
    });
  });

  it('returns an error when createAction gets success=false', async () => {
    nock(BASE_URL).post('/internal/actions').reply(200, { success: false });

    const client = createActionsAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createAction({
      userId: 'user-1',
      commandId: 'command-1',
      type: 'todo',
      title: 'Follow up',
      confidence: 0.9,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to create action: response.success is false');
    }
  });
});
