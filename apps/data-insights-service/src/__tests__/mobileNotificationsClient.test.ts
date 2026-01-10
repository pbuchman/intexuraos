import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { createMobileNotificationsClient } from '../infra/http/mobileNotificationsClient.js';

describe('mobileNotificationsClient', () => {
  const baseUrl = 'http://mobile-notifications.local';
  const internalAuthToken = 'test-internal-token';
  const userId = 'user-123';

  let client: ReturnType<typeof createMobileNotificationsClient>;

  beforeEach(() => {
    client = createMobileNotificationsClient({ baseUrl, internalAuthToken });
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('queryNotifications', () => {
    it('queries notifications successfully', async () => {
      nock(baseUrl)
        .post('/internal/mobile-notifications/query')
        .reply(200, {
          success: true,
          data: {
            notifications: [
              {
                id: 'n1',
                app: 'WhatsApp',
                title: 'Message',
                body: 'Hello',
                timestamp: '2024-01-01T10:00:00Z',
              },
            ],
          },
        });

      const result = await client.queryNotifications(userId, { id: 'f1', name: 'Test' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.app).toBe('WhatsApp');
      }
    });

    it('sends correct headers', async () => {
      nock(baseUrl, {
        reqheaders: {
          'Content-Type': 'application/json',
          'X-Internal-Auth': internalAuthToken,
        },
      })
        .post('/internal/mobile-notifications/query')
        .reply(200, { success: true, data: { notifications: [] } });

      await client.queryNotifications(userId, { id: 'f1', name: 'Test' });

      expect(nock.isDone()).toBe(true);
    });

    it('sends userId and limit in request body', async () => {
      nock(baseUrl)
        .post('/internal/mobile-notifications/query', (body) => {
          return body.userId === userId && body.limit === 1000;
        })
        .reply(200, { success: true, data: { notifications: [] } });

      await client.queryNotifications(userId, { id: 'f1', name: 'Test' });

      expect(nock.isDone()).toBe(true);
    });

    it('sends filter criteria when provided', async () => {
      nock(baseUrl)
        .post('/internal/mobile-notifications/query', (body) => {
          return (
            body.filter?.app?.includes('WhatsApp') === true &&
            body.filter?.source === 'work' &&
            body.filter?.title === 'urgent'
          );
        })
        .reply(200, { success: true, data: { notifications: [] } });

      await client.queryNotifications(userId, {
        id: 'f1',
        name: 'Test',
        app: ['WhatsApp'],
        source: 'work',
        title: 'urgent',
      });

      expect(nock.isDone()).toBe(true);
    });

    it('sends empty filter object when filter fields are empty', async () => {
      nock(baseUrl)
        .post('/internal/mobile-notifications/query', (body) => {
          return (
            body.filter !== undefined &&
            body.filter.app === undefined &&
            body.filter.source === undefined &&
            body.filter.title === undefined
          );
        })
        .reply(200, { success: true, data: { notifications: [] } });

      await client.queryNotifications(userId, {
        id: 'f1',
        name: 'Test',
        app: [],
        source: '',
        title: '',
      });

      expect(nock.isDone()).toBe(true);
    });

    it('omits filter when all filter fields are undefined', async () => {
      nock(baseUrl)
        .post('/internal/mobile-notifications/query', (body) => {
          return body.filter === undefined;
        })
        .reply(200, { success: true, data: { notifications: [] } });

      await client.queryNotifications(userId, { id: 'f1', name: 'Test' });

      expect(nock.isDone()).toBe(true);
    });

    it('returns error on HTTP error response', async () => {
      nock(baseUrl)
        .post('/internal/mobile-notifications/query')
        .reply(500, { error: 'Internal server error' });

      const result = await client.queryNotifications(userId, { id: 'f1', name: 'Test' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('HTTP 500');
      }
    });

    it('returns error when success is false', async () => {
      nock(baseUrl)
        .post('/internal/mobile-notifications/query')
        .reply(200, { success: false, error: 'Invalid request' });

      const result = await client.queryNotifications(userId, { id: 'f1', name: 'Test' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Invalid request');
      }
    });

    it('returns error when data is undefined', async () => {
      nock(baseUrl).post('/internal/mobile-notifications/query').reply(200, { success: true });

      const result = await client.queryNotifications(userId, { id: 'f1', name: 'Test' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Unknown error from mobile-notifications-service');
      }
    });

    it('handles network errors', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      try {
        const result = await client.queryNotifications(userId, { id: 'f1', name: 'Test' });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain('Connection refused');
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('includes only non-empty filter fields', async () => {
      nock(baseUrl)
        .post('/internal/mobile-notifications/query', (body) => {
          return (
            body.filter?.app?.includes('WhatsApp') === true &&
            body.filter?.source === undefined &&
            body.filter?.title === undefined
          );
        })
        .reply(200, { success: true, data: { notifications: [] } });

      await client.queryNotifications(userId, {
        id: 'f1',
        name: 'Test',
        app: ['WhatsApp'],
        source: '',
        title: '',
      });

      expect(nock.isDone()).toBe(true);
    });
  });
});
