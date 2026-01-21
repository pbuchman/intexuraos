import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import pino from 'pino';
import { isOk, isErr } from '@intexuraos/common-core';
import { createNotesServiceHttpClient } from '../../../infra/http/notesServiceHttpClient.js';

const silentLogger = pino({ level: 'silent' });

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
    it('returns ActionFeedback on successful creation', async () => {
      nock(baseUrl)
        .post('/internal/notes')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Note created successfully',
            resourceUrl: '/#/notes/note-123',
          },
        });

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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
        expect(result.value.status).toBe('completed');
        expect(result.value.message).toBe('Note created successfully');
        expect(result.value.resourceUrl).toBe('/#/notes/note-123');
      }
    });

    it('returns error on HTTP 500', async () => {
      nock(baseUrl).post('/internal/notes').reply(500, 'Internal Server Error');

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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

    it('returns failed ServiceFeedback with errorCode on HTTP 401', async () => {
      nock(baseUrl).post('/internal/notes').reply(401, {
        success: false,
        error: { code: 'TOKEN_ERROR', message: 'Token expired' },
      });

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
      const result = await client.createNote({
        userId: 'user-456',
        title: 'Test',
        content: '',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Token expired');
        expect(result.value.errorCode).toBe('TOKEN_ERROR');
      }
    });

    it('returns failed ServiceFeedback with default message on HTTP 401 without error body', async () => {
      nock(baseUrl).post('/internal/notes').reply(401, {
        error: { message: 'Unauthorized' },
      });

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
      const result = await client.createNote({
        userId: 'user-456',
        title: 'Test',
        content: '',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Unauthorized');
        expect(result.value.errorCode).toBeUndefined();
      }
    });

    it('returns error when response success is false', async () => {
      nock(baseUrl)
        .post('/internal/notes')
        .reply(200, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Title is required' },
        });

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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
      nock(baseUrl).post('/internal/notes').reply(200, { success: true });

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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
      nock(baseUrl).post('/internal/notes').replyWithError('Connection refused');

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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

    it('returns error on OK response with invalid JSON', async () => {
      nock(baseUrl).post('/internal/notes').reply(200, 'not valid json', {
        'Content-Type': 'text/plain',
      });

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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
        expect(result.error.message).toContain('Invalid response from notes-agent');
      }
    });

    it('returns ServiceFeedback with errorCode from successful data response', async () => {
      nock(baseUrl)
        .post('/internal/notes')
        .reply(200, {
          success: true,
          data: {
            status: 'failed',
            message: 'Processing failed',
            errorCode: 'PROCESSING_ERROR',
          },
        });

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
      const result = await client.createNote({
        userId: 'user-456',
        title: 'Test',
        content: '',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Processing failed');
        expect(result.value.errorCode).toBe('PROCESSING_ERROR');
      }
    });

    it('sends correct request body', async () => {
      const scope = nock(baseUrl)
        .post('/internal/notes', {
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
            status: 'completed',
            message: 'Note created successfully',
            resourceUrl: '/#/notes/note-new',
          },
        });

      const client = createNotesServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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
