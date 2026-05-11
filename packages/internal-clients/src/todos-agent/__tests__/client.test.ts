import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTodosAgentServiceClient } from '../client.js';
import type { TodosAgentServiceConfig } from '../types.js';

const BASE_URL = 'http://todos-agent.test';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as TodosAgentServiceConfig['logger'];

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createTodosAgentServiceClient', () => {
  it('returns service feedback on success', async () => {
    nock(BASE_URL)
      .post('/internal/todos')
      .reply(200, {
        success: true,
        data: {
          status: 'completed',
          message: 'Todo created successfully',
          resourceUrl: '/#/todos/todo-1',
        },
      });

    const client = createTodosAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createTodo({
      userId: 'user-1',
      title: 'Buy groceries',
      description: 'Milk, eggs',
      tags: ['shopping'],
      source: 'actions-agent',
      sourceId: 'action-1',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        status: 'completed',
        message: 'Todo created successfully',
        resourceUrl: '/#/todos/todo-1',
      },
    });
  });

  it('returns an error for invalid JSON on a 200 response', async () => {
    nock(BASE_URL).post('/internal/todos').reply(200, 'not valid json', {
      'Content-Type': 'text/plain',
    });

    const client = createTodosAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createTodo({
      userId: 'user-1',
      title: 'Buy groceries',
      description: 'Milk, eggs',
      tags: ['shopping'],
      source: 'actions-agent',
      sourceId: 'action-1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from todos-agent');
    }
  });

  it('returns network failures with the service-specific prefix', async () => {
    nock(BASE_URL).post('/internal/todos').replyWithError('Connection refused');

    const client = createTodosAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createTodo({
      userId: 'user-1',
      title: 'Buy groceries',
      description: 'Milk, eggs',
      tags: ['shopping'],
      source: 'actions-agent',
      sourceId: 'action-1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Failed to call todos-agent');
    }
  });
});
