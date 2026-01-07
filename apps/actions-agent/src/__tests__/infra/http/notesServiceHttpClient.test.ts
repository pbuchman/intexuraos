import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { isOk, isErr } from '@intexuraos/common-core';
import { createNotesServiceHttpClient } from '../../../infra/http/notesServiceHttpClient.js';

describe('createNotesServiceHttpClient', () => {
  const baseUrl = 'http://notes-agent.local';
  const internalAuthToken = 'test-internal-token';

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('createNote', () => {
    it('returns note on successful creation', async () => {
      nock(baseUrl)
        .post('/internal/notes/notes')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200, {
          success: true,
          data: {
            id: 'note-123',
            userId: 'user-456',
            title: 'Meeting notes',
          },
        });

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken });
      const result = await client.createNote({
        userId: 'user-456',
        title: 'Meeting notes',
        content: 'Discussed quarterly goals',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.id).toBe('note-123');
        expect(result.value.userId).toBe('user-456');
        expect(result.value.title).toBe('Meeting notes');
      }
    });

    it('returns error on HTTP 500', async () => {
      nock(baseUrl).post('/internal/notes/notes').reply(500, 'Internal Server Error');

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken });
      const result = await client.createNote({
        userId: 'user-456',
        title: 'Test',
        content: '',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 500');
      }
    });

    it('returns error on HTTP 401', async () => {
      nock(baseUrl).post('/internal/notes/notes').reply(401, { error: 'Unauthorized' });

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken });
      const result = await client.createNote({
        userId: 'user-456',
        title: 'Test',
        content: '',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 401');
      }
    });

    it('returns error when response success is false', async () => {
      nock(baseUrl)
        .post('/internal/notes/notes')
        .reply(200, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Title is required' },
        });

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken });
      const result = await client.createNote({
        userId: 'user-456',
        title: '',
        content: '',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe('Title is required');
      }
    });

    it('returns error when response data is undefined', async () => {
      nock(baseUrl).post('/internal/notes/notes').reply(200, { success: true });

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken });
      const result = await client.createNote({
        userId: 'user-456',
        title: 'Test',
        content: '',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Invalid response');
      }
    });

    it('returns error on network failure', async () => {
      nock(baseUrl).post('/internal/notes/notes').replyWithError('Connection refused');

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken });
      const result = await client.createNote({
        userId: 'user-456',
        title: 'Test',
        content: '',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Failed to call notes-agent');
      }
    });

    it('sends correct request body', async () => {
      const scope = nock(baseUrl)
        .post('/internal/notes/notes', {
          userId: 'user-456',
          title: 'Meeting notes',
          content: 'Discussed quarterly goals',
          tags: ['work'],
          source: 'actions-agent',
          sourceId: 'action-789',
        })
        .reply(200, {
          success: true,
          data: {
            id: 'note-new',
            userId: 'user-456',
            title: 'Meeting notes',
          },
        });

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken });
      await client.createNote({
        userId: 'user-456',
        title: 'Meeting notes',
        content: 'Discussed quarterly goals',
        tags: ['work'],
        source: 'actions-agent',
        sourceId: 'action-789',
      });

      expect(scope.isDone()).toBe(true);
    });
  });
});
