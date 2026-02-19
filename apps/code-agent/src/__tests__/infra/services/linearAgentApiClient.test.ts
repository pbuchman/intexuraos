/**
 * Tests for Linear Agent API Client.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { ok, err } from '@intexuraos/common-core';
import pino from 'pino';
import { createLinearAgentApiClient } from '../../../infra/services/linearAgentApiClient.js';
import type { LinearOAuthRepository, LinearOAuthCredentials } from '../../../domain/ports/linearOAuthRepository.js';

const LINEAR_API = 'https://api.linear.app';

describe('createLinearAgentApiClient', () => {
  let mockOAuthRepo: LinearOAuthRepository;
  const logger = pino({ name: 'test', level: 'silent' });

  const testCredentials: LinearOAuthCredentials = {
    accessToken: 'lin_api_test_token_123',
    appUserId: 'app-user-abc-123',
    workspaceId: 'default',
    installedAt: '2026-02-19T12:00:00.000Z',
    installedBy: 'oauth-flow',
  };

  beforeEach(() => {
    mockOAuthRepo = {
      save: vi.fn().mockResolvedValue(ok(undefined)),
      get: vi.fn().mockResolvedValue(ok(testCredentials)),
      findByAppUserId: vi.fn().mockResolvedValue(ok(testCredentials)),
    };
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('emitActivity', () => {
    it('sends GraphQL mutation to Linear API', async () => {
      const scope = nock(LINEAR_API)
        .post('/graphql')
        .reply(200, { data: { agentActivityCreate: { success: true } } });

      const client = createLinearAgentApiClient({ linearOAuthRepo: mockOAuthRepo, logger });
      const result = await client.emitActivity({
        sessionId: 'session-123',
        type: 'thought',
        body: 'Analyzing issue...',
      });

      expect(result.ok).toBe(true);
      expect(scope.isDone()).toBe(true);
    });

    it('returns error when no OAuth credentials found', async () => {
      (mockOAuthRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(ok(null));

      const client = createLinearAgentApiClient({ linearOAuthRepo: mockOAuthRepo, logger });
      const result = await client.emitActivity({
        sessionId: 'session-123',
        type: 'thought',
        body: 'Analyzing issue...',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('returns error when OAuth repo fails', async () => {
      (mockOAuthRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        err({ code: 'internal_error', message: 'Firestore error' })
      );

      const client = createLinearAgentApiClient({ linearOAuthRepo: mockOAuthRepo, logger });
      const result = await client.emitActivity({
        sessionId: 'session-123',
        type: 'thought',
        body: 'Analyzing issue...',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
      }
    });

    it('returns UNAUTHORIZED on 401 response', async () => {
      nock(LINEAR_API).post('/graphql').reply(401, 'Unauthorized');

      const client = createLinearAgentApiClient({ linearOAuthRepo: mockOAuthRepo, logger });
      const result = await client.emitActivity({
        sessionId: 'session-123',
        type: 'thought',
        body: 'Test',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('returns UNAVAILABLE on 500 response', async () => {
      nock(LINEAR_API).post('/graphql').reply(500, 'Internal Server Error');

      const client = createLinearAgentApiClient({ linearOAuthRepo: mockOAuthRepo, logger });
      const result = await client.emitActivity({
        sessionId: 'session-123',
        type: 'thought',
        body: 'Test',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
      }
    });

    it('returns UNAVAILABLE on network error', async () => {
      nock(LINEAR_API).post('/graphql').replyWithError('ECONNREFUSED');

      const client = createLinearAgentApiClient({ linearOAuthRepo: mockOAuthRepo, logger });
      const result = await client.emitActivity({
        sessionId: 'session-123',
        type: 'thought',
        body: 'Test',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
      }
    });
  });

  describe('updateSessionPlan', () => {
    it('sends plan update mutation', async () => {
      const scope = nock(LINEAR_API)
        .post('/graphql')
        .reply(200, { data: { agentSessionUpdate: { success: true } } });

      const client = createLinearAgentApiClient({ linearOAuthRepo: mockOAuthRepo, logger });
      const result = await client.updateSessionPlan({
        sessionId: 'session-123',
        plan: [
          { content: 'Step 1', status: 'completed' },
          { content: 'Step 2', status: 'in-progress' },
          { content: 'Step 3', status: 'pending' },
        ],
      });

      expect(result.ok).toBe(true);
      expect(scope.isDone()).toBe(true);
    });

    it('returns error when no credentials', async () => {
      (mockOAuthRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(ok(null));

      const client = createLinearAgentApiClient({ linearOAuthRepo: mockOAuthRepo, logger });
      const result = await client.updateSessionPlan({
        sessionId: 'session-123',
        plan: [{ content: 'Step 1', status: 'pending' }],
      });

      expect(result.ok).toBe(false);
    });

    it('returns error when GraphQL call fails', async () => {
      nock(LINEAR_API).post('/graphql').reply(500, 'Internal Server Error');

      const client = createLinearAgentApiClient({ linearOAuthRepo: mockOAuthRepo, logger });
      const result = await client.updateSessionPlan({
        sessionId: 'session-123',
        plan: [{ content: 'Step 1', status: 'pending' }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
      }
    });
  });

  describe('updateSessionExternalUrls', () => {
    it('sends external URL update mutation', async () => {
      const scope = nock(LINEAR_API)
        .post('/graphql')
        .reply(200, { data: { agentSessionUpdate: { success: true } } });

      const client = createLinearAgentApiClient({ linearOAuthRepo: mockOAuthRepo, logger });
      const result = await client.updateSessionExternalUrls({
        sessionId: 'session-123',
        externalUrls: [{ label: 'Pull Request', url: 'https://github.com/org/repo/pull/42' }],
      });

      expect(result.ok).toBe(true);
      expect(scope.isDone()).toBe(true);
    });

    it('returns error when no credentials', async () => {
      (mockOAuthRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(ok(null));

      const client = createLinearAgentApiClient({ linearOAuthRepo: mockOAuthRepo, logger });
      const result = await client.updateSessionExternalUrls({
        sessionId: 'session-123',
        externalUrls: [{ label: 'PR', url: 'https://example.com' }],
      });

      expect(result.ok).toBe(false);
    });

    it('returns error when GraphQL call fails', async () => {
      nock(LINEAR_API).post('/graphql').reply(500, 'Internal Server Error');

      const client = createLinearAgentApiClient({ linearOAuthRepo: mockOAuthRepo, logger });
      const result = await client.updateSessionExternalUrls({
        sessionId: 'session-123',
        externalUrls: [{ label: 'PR', url: 'https://example.com' }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
      }
    });
  });

  describe('authorization header', () => {
    it('sends access token in Authorization header', async () => {
      let capturedAuth = '';
      nock(LINEAR_API)
        .post('/graphql')
        .reply(function () {
          capturedAuth = String(this.req.headers['authorization'] ?? '');
          return [200, { data: { agentActivityCreate: { success: true } } }];
        });

      const client = createLinearAgentApiClient({ linearOAuthRepo: mockOAuthRepo, logger });
      await client.emitActivity({
        sessionId: 'session-123',
        type: 'thought',
        body: 'Test',
      });

      expect(capturedAuth).toBe('Bearer lin_api_test_token_123');
    });
  });
});
