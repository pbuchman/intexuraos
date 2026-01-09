import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { isOk, isErr } from '@intexuraos/common-core';
import { createTodosServiceHttpClient } from '../../../infra/http/todosServiceHttpClient.js';

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
    it('returns todo on successful creation', async () => {
      nock(baseUrl)
        .post('/internal/todos')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200, {
          success: true,
          data: {
            id: 'todo-123',
            userId: 'user-456',
            title: 'Buy groceries',
            status: 'pending',
          },
        });

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken });
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
        expect(result.value.id).toBe('todo-123');
        expect(result.value.userId).toBe('user-456');
        expect(result.value.title).toBe('Buy groceries');
        expect(result.value.status).toBe('pending');
      }
    });

    it('returns error on HTTP 500', async () => {
      nock(baseUrl).post('/internal/todos').reply(500, 'Internal Server Error');

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken });
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

    it('returns error on HTTP 401', async () => {
      nock(baseUrl).post('/internal/todos').reply(401, { error: 'Unauthorized' });

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken });
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
        expect(result.error.message).toContain('HTTP 401');
      }
    });

    it('returns error when response success is false', async () => {
      nock(baseUrl)
        .post('/internal/todos')
        .reply(200, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Title is required' },
        });

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken });
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

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken });
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

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken });
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
            id: 'todo-new',
            userId: 'user-456',
            title: 'Buy groceries',
            status: 'pending',
          },
        });

      const client = createTodosServiceHttpClient({ baseUrl, internalAuthToken });
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
