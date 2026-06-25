import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotesAgentServiceClient } from '../client.js';
import type { NotesAgentServiceConfig } from '../types.js';

const BASE_URL = 'http://notes-agent.test';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as NotesAgentServiceConfig['logger'];

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createNotesAgentServiceClient', () => {
  it('returns service feedback on success', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/notes', {
        userId: 'user-1',
        title: 'Meeting notes',
        content: 'Quarterly goals',
        tags: ['work'],
        source: 'intex-agent',
        sourceId: 'action-1',
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, {
        success: true,
        data: {
          status: 'completed',
          message: 'Note created successfully',
          resourceUrl: '/#/notes/note-1',
        },
      });

    const client = createNotesAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createNote({
      userId: 'user-1',
      title: 'Meeting notes',
      content: 'Quarterly goals',
      tags: ['work'],
      source: 'intex-agent',
      sourceId: 'action-1',
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        status: 'completed',
        message: 'Note created successfully',
        resourceUrl: '/#/notes/note-1',
      },
    });
  });

  it('maps non-2xx JSON envelopes into failed service feedback', async () => {
    nock(BASE_URL)
      .post('/internal/notes')
      .reply(401, {
        success: false,
        error: {
          code: 'TOKEN_ERROR',
          message: 'Token expired',
        },
      });

    const client = createNotesAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createNote({
      userId: 'user-1',
      title: 'Meeting notes',
      content: 'Quarterly goals',
      tags: ['work'],
      source: 'intex-agent',
      sourceId: 'action-1',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        status: 'failed',
        message: 'Token expired',
        errorCode: 'TOKEN_ERROR',
      },
    });
  });

  it('returns an error when the success envelope is missing data', async () => {
    nock(BASE_URL).post('/internal/notes').reply(200, { success: true });

    const client = createNotesAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createNote({
      userId: 'user-1',
      title: 'Meeting notes',
      content: 'Quarterly goals',
      tags: ['work'],
      source: 'intex-agent',
      sourceId: 'action-1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from notes-agent');
    }
  });
});
