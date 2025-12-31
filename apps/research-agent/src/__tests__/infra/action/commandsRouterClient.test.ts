import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { createCommandsRouterClient } from '../../../infra/action/commandsRouterClient.js';

describe('createCommandsRouterClient', () => {
  const baseUrl = 'http://commands-router.local';
  const internalAuthToken = 'test-token';

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('updateActionStatus', () => {
    it('returns ok on successful status update', async () => {
      nock(baseUrl)
        .patch('/internal/actions/action-123/status')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200);

      const client = createCommandsRouterClient({ baseUrl, internalAuthToken });
      const result = await client.updateActionStatus('action-123', 'completed');

      expect(result.ok).toBe(true);
    });

    it('sends status in request body', async () => {
      const scope = nock(baseUrl)
        .patch('/internal/actions/action-456/status', { status: 'in_progress' })
        .reply(200);

      const client = createCommandsRouterClient({ baseUrl, internalAuthToken });
      await client.updateActionStatus('action-456', 'in_progress');

      expect(scope.isDone()).toBe(true);
    });

    it('returns error on non-ok response', async () => {
      nock(baseUrl).patch('/internal/actions/action-123/status').reply(500);

      const client = createCommandsRouterClient({ baseUrl, internalAuthToken });
      const result = await client.updateActionStatus('action-123', 'completed');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('500');
      }
    });

    it('returns error on network failure', async () => {
      nock(baseUrl)
        .patch('/internal/actions/action-123/status')
        .replyWithError('Connection refused');

      const client = createCommandsRouterClient({ baseUrl, internalAuthToken });
      const result = await client.updateActionStatus('action-123', 'completed');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Network error');
      }
    });
  });

  describe('updateAction', () => {
    it('returns ok on successful action update', async () => {
      nock(baseUrl)
        .patch('/internal/actions/action-789')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200);

      const client = createCommandsRouterClient({ baseUrl, internalAuthToken });
      const result = await client.updateAction('action-789', { status: 'completed' });

      expect(result.ok).toBe(true);
    });

    it('sends status and payload in request body', async () => {
      const scope = nock(baseUrl)
        .patch('/internal/actions/action-789', {
          status: 'completed',
          payload: { researchId: 'research-123' },
        })
        .reply(200);

      const client = createCommandsRouterClient({ baseUrl, internalAuthToken });
      await client.updateAction('action-789', {
        status: 'completed',
        payload: { researchId: 'research-123' },
      });

      expect(scope.isDone()).toBe(true);
    });

    it('returns error on non-ok response', async () => {
      nock(baseUrl).patch('/internal/actions/action-789').reply(404);

      const client = createCommandsRouterClient({ baseUrl, internalAuthToken });
      const result = await client.updateAction('action-789', { status: 'failed' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('404');
      }
    });

    it('returns error on network failure', async () => {
      nock(baseUrl).patch('/internal/actions/action-789').replyWithError('ECONNREFUSED');

      const client = createCommandsRouterClient({ baseUrl, internalAuthToken });
      const result = await client.updateAction('action-789', { status: 'failed' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Network error');
      }
    });
  });
});
