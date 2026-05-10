import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCommandsAgentServiceClient } from '../client.js';
import type { CommandsAgentServiceConfig } from '../types.js';

const BASE_URL = 'http://commands-agent.test';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as CommandsAgentServiceConfig['logger'];

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createCommandsAgentServiceClient', () => {
  it('returns the command payload on success', async () => {
    const scope = nock(BASE_URL)
      .get('/internal/commands/cmd-123')
      .matchHeader('x-internal-auth', 'secret')
      .matchHeader('content-type', 'application/json')
      .reply(200, {
        success: true,
        data: {
          command: {
            id: 'cmd-123',
            text: 'Research AI trends',
            sourceType: 'whatsapp',
          },
        },
      });

    const client = createCommandsAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getCommand('cmd-123');

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'cmd-123',
        text: 'Research AI trends',
        sourceType: 'whatsapp',
      },
    });
  });

  it('returns null on 404', async () => {
    nock(BASE_URL).get('/internal/commands/missing').reply(404);

    const client = createCommandsAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getCommand('missing');

    expect(result).toEqual({ ok: true, value: null });
  });

  it('returns a malformed response error when the envelope is incomplete', async () => {
    nock(BASE_URL).get('/internal/commands/cmd-bad').reply(200, { success: true });

    const client = createCommandsAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getCommand('cmd-bad');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from commands-agent');
    }
  });

  it('returns a malformed response error when the command payload is missing id', async () => {
    nock(BASE_URL)
      .get('/internal/commands/cmd-missing-id')
      .reply(200, {
        success: true,
        data: {
          command: {
            text: 'Missing id',
            sourceType: 'whatsapp',
          },
        },
      });

    const client = createCommandsAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getCommand('cmd-missing-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from commands-agent');
    }
  });

  it('returns a malformed response error when the command payload is missing text', async () => {
    nock(BASE_URL)
      .get('/internal/commands/cmd-missing-text')
      .reply(200, {
        success: true,
        data: {
          command: {
            id: 'cmd-missing-text',
            sourceType: 'whatsapp',
          },
        },
      });

    const client = createCommandsAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getCommand('cmd-missing-text');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from commands-agent');
    }
  });
});
