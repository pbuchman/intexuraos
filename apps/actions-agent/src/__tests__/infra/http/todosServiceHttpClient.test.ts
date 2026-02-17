import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { isOk, isErr } from '@intexuraos/common-core';
import { createTodosServiceHttpClient } from '../../../infra/http/todosServiceHttpClient.js';
import { createMockLogger } from '../../fakes.js';

describe('createTodosServiceHttpClient', () => {
  const baseUrl = 'http://todos-agent.local';
  const internalAuthToken = 'test-internal-token';

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('createTodo', () => {
    it('returns ActionFeedback on successful creation', async () => {
      nock(baseUrl)
        .post('/internal/todos')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Todo created successfully',
            resourceUrl: '/#/todos/todo-123',
          },
        });

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken, logger: createMockLogger() });
      const result = await client.createTodo({
        userId: 'user-456',
        title: 'Buy groceries',
        description: 'Milk, eggs, bread',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('completed');
        expect(result.value.message).toBe('Todo created successfully');
        expect(result.value.resourceUrl).toBe('/#/todos/todo-123');
      }
    });

    it('returns error on HTTP 500', async () => {
      nock(baseUrl).post('/internal/todos').reply(500, 'Internal Server Error');

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken, logger: createMockLogger() });
      const result = await client.createTodo({
        userId: 'user-456',
        title: 'Test',
        description: '',
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
      nock(baseUrl).post('/internal/todos').reply(401, {
        success: false,
        error: { code: 'TOKEN_ERROR', message: 'Token expired' },
      });

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken, logger: createMockLogger() });
      const result = await client.createTodo({
        userId: 'user-456',
        title: 'Test',
        description: '',
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
      nock(baseUrl).post('/internal/todos').reply(401, {
        error: { message: 'Unauthorized' },
      });

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken, logger: createMockLogger() });
      const result = await client.createTodo({
        userId: 'user-456',
        title: 'Test',
        description: '',
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
        .post('/internal/todos')
        .reply(200, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Title is required' },
        });

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken, logger: createMockLogger() });
      const result = await client.createTodo({
        userId: 'user-456',
        title: '',
        description: '',
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
      nock(baseUrl).post('/internal/todos').reply(200, { success: true });

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken, logger: createMockLogger() });
      const result = await client.createTodo({
        userId: 'user-456',
        title: 'Test',
        description: '',
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
      nock(baseUrl).post('/internal/todos').replyWithError('Connection refused');

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken, logger: createMockLogger() });
      const result = await client.createTodo({
        userId: 'user-456',
        title: 'Test',
        description: '',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Failed to call todos-agent');
      }
    });

    it('returns error on OK response with invalid JSON', async () => {
      nock(baseUrl).post('/internal/todos').reply(200, 'not valid json', {
        'Content-Type': 'text/plain',
      });

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken, logger: createMockLogger() });
      const result = await client.createTodo({
        userId: 'user-456',
        title: 'Test',
        description: '',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Invalid response from todos-agent');
      }
    });

    it('returns ServiceFeedback with errorCode from successful data response', async () => {
      nock(baseUrl)
        .post('/internal/todos')
        .reply(200, {
          success: true,
          data: {
            status: 'failed',
            message: 'Processing failed',
            errorCode: 'PROCESSING_ERROR',
          },
        });

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken, logger: createMockLogger() });
      const result = await client.createTodo({
        userId: 'user-456',
        title: 'Test',
        description: '',
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
        .post('/internal/todos', {
          userId: 'user-456',
          title: 'Buy groceries',
          description: 'Milk, eggs, bread',
          tags: ['shopping'],
          source: 'actions-agent',
          sourceId: 'action-789',
        })
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Todo created successfully',
            resourceUrl: '/#/todos/todo-new',
          },
        });

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken, logger: createMockLogger() });
      await client.createTodo({
        userId: 'user-456',
        title: 'Buy groceries',
        description: 'Milk, eggs, bread',
        tags: ['shopping'],
        source: 'actions-agent',
        sourceId: 'action-789',
      });

      expect(scope.isDone()).toBe(true);
    });
  });
});
