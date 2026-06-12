import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLinearAgentServiceClient } from '../client.js';
import type { LinearAgentServiceConfig } from '../types.js';

const BASE_URL = 'http://linear-agent.test';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as LinearAgentServiceConfig['logger'];

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createLinearAgentServiceClient', () => {
  it('posts the action payload and returns service feedback on success', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/linear/process-action', {
        action: {
          id: 'action-1',
          userId: 'user-1',
          text: 'Fix authentication bug',
          summary: 'Key points about the bug',
        },
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, {
        success: true,
        data: {
          status: 'completed',
          message: 'Linear issue created: INT-1',
          resourceUrl: 'https://linear.app/intexuraos/issue/INT-1',
        },
      });

    const client = createLinearAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.processAction('action-1', 'user-1', 'Fix authentication bug', {
      summary: 'Key points about the bug',
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        status: 'completed',
        message: 'Linear issue created: INT-1',
        resourceUrl: 'https://linear.app/intexuraos/issue/INT-1',
      },
    });
  });

  it('maps non-2xx JSON error envelopes to failed service feedback', async () => {
    nock(BASE_URL)
      .post('/internal/linear/process-action')
      .reply(401, {
        success: false,
        error: {
          code: 'TOKEN_ERROR',
          message: 'Token expired',
        },
      });

    const client = createLinearAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.processAction('action-1', 'user-1', 'Fix authentication bug');

    expect(result).toEqual({
      ok: true,
      value: {
        status: 'failed',
        message: 'Token expired',
        errorCode: 'TOKEN_ERROR',
      },
    });
  });

  it('returns an error when the envelope has no data payload', async () => {
    nock(BASE_URL).post('/internal/linear/process-action').reply(200, { success: true });

    const client = createLinearAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.processAction('action-1', 'user-1', 'Fix authentication bug');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from linear-agent');
    }
  });
});
