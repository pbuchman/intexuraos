import { describe, it, expect, vi, afterEach } from 'vitest';
import nock from 'nock';
import type { Logger } from 'pino';
import { createTodosServiceHttpClient } from './todosServiceHttpClient.js';
import type { CreateTodoRequest } from '../../domain/ports/todosServiceClient.js';

const BASE_URL = 'http://localhost:9991';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  level: 'silent',
} as unknown as Logger;

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test helper
function makeClient() {
  return createTodosServiceHttpClient({
    baseUrl: BASE_URL,
    internalAuthToken: 'test-token',
    logger: fakeLogger,
  });
}

const validRequest: CreateTodoRequest = {
  userId: 'user_001',
  title: 'Test Todo',
  tags: ['tag1'],
  source: 'actions-agent',
  sourceId: 'action_001',
};

describe('todosServiceHttpClient', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('returns ok with service feedback on success', async () => {
    nock(BASE_URL)
      .post('/internal/todos')
      .reply(200, {
        success: true,
        data: {
          status: 'completed',
          message: 'Todo created',
          resourceUrl: 'https://example.com/todo/1',
        },
      });

    const client = makeClient();
    const result = await client.createTodo(validRequest);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('completed');
      expect(result.value.message).toBe('Todo created');
      expect(result.value.resourceUrl).toBe('https://example.com/todo/1');
    }
  });

  it('returns ok with errorCode when present in data', async () => {
    nock(BASE_URL)
      .post('/internal/todos')
      .reply(200, {
        success: true,
        data: {
          status: 'failed',
          message: 'Validation error',
          errorCode: 'VALIDATION_ERROR',
        },
      });

    const client = makeClient();
    const result = await client.createTodo(validRequest);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('failed');
      expect(result.value.errorCode).toBe('VALIDATION_ERROR');
    }
  });

  it('returns err on network/fetch error', async () => {
    nock(BASE_URL)
      .post('/internal/todos')
      .replyWithError('connection refused');

    const client = makeClient();
    const result = await client.createTodo(validRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Failed to call todos-agent');
    }
  });

  it('returns err on non-JSON error response (!response.ok)', async () => {
    nock(BASE_URL)
      .post('/internal/todos')
      .reply(500, 'Internal Server Error', { 'Content-Type': 'text/plain' });

    const client = makeClient();
    const result = await client.createTodo(validRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/HTTP 500/);
    }
  });

  it('returns err on non-JSON success response (response.ok)', async () => {
    nock(BASE_URL)
      .post('/internal/todos')
      .reply(200, 'not json', { 'Content-Type': 'text/plain' });

    const client = makeClient();
    const result = await client.createTodo(validRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from todos-agent');
    }
  });

  it('returns ok with failed status when response is not ok but has JSON with error.message', async () => {
    nock(BASE_URL)
      .post('/internal/todos')
      .reply(422, {
        success: false,
        error: { code: 'VALIDATION', message: 'Title is required' },
      });

    const client = makeClient();
    const result = await client.createTodo(validRequest);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('failed');
      expect(result.value.message).toBe('Title is required');
      expect(result.value.errorCode).toBe('VALIDATION');
    }
  });

  it('returns ok with fallback error message when error.message is undefined (v8-ignore path)', async () => {
    nock(BASE_URL)
      .post('/internal/todos')
      .reply(422, {
        success: false,
        error: { code: 'SOME_CODE' },
      });

    const client = makeClient();
    const result = await client.createTodo(validRequest);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('failed');
      expect(result.value.message).toMatch(/^HTTP 422:/);
      expect(result.value.errorCode).toBe('SOME_CODE');
    }
  });

  it('returns ok with fallback when error object is missing entirely', async () => {
    nock(BASE_URL)
      .post('/internal/todos')
      .reply(400, { success: false });

    const client = makeClient();
    const result = await client.createTodo(validRequest);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('failed');
      expect(result.value.message).toMatch(/HTTP 400/);
    }
  });

  it('returns err when body.success is false on 200', async () => {
    nock(BASE_URL)
      .post('/internal/todos')
      .reply(200, { success: false });

    const client = makeClient();
    const result = await client.createTodo(validRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from todos-agent');
    }
  });

  it('returns err when body.data is undefined on 200', async () => {
    nock(BASE_URL)
      .post('/internal/todos')
      .reply(200, { success: true });

    const client = makeClient();
    const result = await client.createTodo(validRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from todos-agent');
    }
  });
});
