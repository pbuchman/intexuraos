/**
 * Tests for actions-agent HTTP client.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import nock from 'nock';
import { createActionsAgentClient } from '../../infra/actionsAgent/client.js';

const BASE_URL = 'http://localhost:8082';
const INTERNAL_AUTH_TOKEN = 'test-internal-token';

describe('ActionsAgentClient', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('createAction', () => {
    it('creates action successfully', async () => {
      const actionData = {
        id: 'action-123',
        userId: 'user-123',
        commandId: 'command-123',
        type: 'research' as const,
        confidence: 0.95,
        title: 'Test Research',
        status: 'pending' as const,
        payload: { query: 'test' },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      nock(BASE_URL)
        .post('/internal/actions')
        .matchHeader('x-internal-auth', INTERNAL_AUTH_TOKEN)
        .matchHeader('content-type', 'application/json')
        .reply(200, { success: true, data: actionData });

      const client = createActionsAgentClient({
        baseUrl: BASE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.createAction({
        userId: 'user-123',
        commandId: 'command-123',
        type: 'research',
        title: 'Test Research',
        confidence: 0.95,
        payload: { query: 'test' },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('action-123');
        expect(result.value.type).toBe('research');
        expect(result.value.title).toBe('Test Research');
      }
    });

    it('creates action without payload', async () => {
      const actionData = {
        id: 'action-456',
        userId: 'user-123',
        commandId: 'command-456',
        type: 'todo' as const,
        confidence: 0.9,
        title: 'Simple Todo',
        status: 'pending' as const,
        payload: {},
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      nock(BASE_URL).post('/internal/actions').reply(200, { success: true, data: actionData });

      const client = createActionsAgentClient({
        baseUrl: BASE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.createAction({
        userId: 'user-123',
        commandId: 'command-456',
        type: 'todo',
        title: 'Simple Todo',
        confidence: 0.9,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe('todo');
      }
    });

    it('returns error on HTTP 400', async () => {
      nock(BASE_URL).post('/internal/actions').reply(400, { error: 'Bad request' });

      const client = createActionsAgentClient({
        baseUrl: BASE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.createAction({
        userId: 'user-123',
        commandId: 'command-123',
        type: 'research',
        title: 'Test',
        confidence: 0.9,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('400');
      }
    });

    it('returns error on HTTP 401', async () => {
      nock(BASE_URL).post('/internal/actions').reply(401, { error: 'Unauthorized' });

      const client = createActionsAgentClient({
        baseUrl: BASE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.createAction({
        userId: 'user-123',
        commandId: 'command-123',
        type: 'research',
        title: 'Test',
        confidence: 0.9,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('401');
      }
    });

    it('returns error on HTTP 500', async () => {
      nock(BASE_URL).post('/internal/actions').reply(500, { error: 'Internal server error' });

      const client = createActionsAgentClient({
        baseUrl: BASE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.createAction({
        userId: 'user-123',
        commandId: 'command-123',
        type: 'research',
        title: 'Test',
        confidence: 0.9,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('500');
      }
    });

    it('returns error when success is false', async () => {
      nock(BASE_URL).post('/internal/actions').reply(200, { success: false });

      const client = createActionsAgentClient({
        baseUrl: BASE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.createAction({
        userId: 'user-123',
        commandId: 'command-123',
        type: 'research',
        title: 'Test',
        confidence: 0.9,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('success is false');
      }
    });

    it('returns error on network failure', async () => {
      nock(BASE_URL).post('/internal/actions').replyWithError('Connection refused');

      const client = createActionsAgentClient({
        baseUrl: BASE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.createAction({
        userId: 'user-123',
        commandId: 'command-123',
        type: 'research',
        title: 'Test',
        confidence: 0.9,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Connection refused');
      }
    });

    it('sends correct auth header', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/actions')
        .matchHeader('x-internal-auth', 'custom-token')
        .reply(200, {
          success: true,
          data: {
            id: 'action-789',
            userId: 'user-123',
            commandId: 'cmd',
            type: 'note',
            confidence: 0.8,
            title: 'Note',
            status: 'pending',
            payload: {},
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        });

      const client = createActionsAgentClient({
        baseUrl: BASE_URL,
        internalAuthToken: 'custom-token',
      });

      await client.createAction({
        userId: 'user-123',
        commandId: 'cmd',
        type: 'note',
        title: 'Note',
        confidence: 0.8,
      });

      expect(scope.isDone()).toBe(true);
    });
  });
});
