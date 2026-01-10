import { describe, it, expect } from 'vitest';
import { setupTestContext } from './testUtils.js';

describe('pubsubRoutes', () => {
  const ctx = setupTestContext();

  describe('POST /internal/bookmarks/pubsub/enrich', () => {
    it('enriches bookmark on valid event', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com/page',
        source: 'test',
        sourceId: 'test-1',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const bookmarkId = createResult.value.id;

      const event = {
        type: 'bookmarks.enrich',
        bookmarkId,
        userId: 'user-1',
        url: 'https://example.com/page',
      };

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks/pubsub/enrich',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'content-type': 'application/json',
        },
        payload: {
          message: {
            data: Buffer.from(JSON.stringify(event)).toString('base64'),
            messageId: 'msg-1',
            publishTime: new Date().toISOString(),
          },
          subscription: 'test-subscription',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });

      const findResult = await ctx.bookmarkRepository.findById(bookmarkId);
      expect(findResult.ok).toBe(true);
      if (findResult.ok && findResult.value !== null) {
        expect(findResult.value.ogFetchStatus).toBe('processed');
        expect(findResult.value.ogPreview).not.toBeNull();
      }
    });

    it('returns 401 without auth header', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks/pubsub/enrich',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          message: {
            data: Buffer.from('{}').toString('base64'),
            messageId: 'msg-1',
          },
          subscription: 'test-subscription',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns success for invalid event type', async () => {
      const event = { type: 'invalid.type' };

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks/pubsub/enrich',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'content-type': 'application/json',
        },
        payload: {
          message: {
            data: Buffer.from(JSON.stringify(event)).toString('base64'),
            messageId: 'msg-1',
          },
          subscription: 'test-subscription',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
    });

    it('returns success even when bookmark not found', async () => {
      const event = {
        type: 'bookmarks.enrich',
        bookmarkId: 'non-existent',
        userId: 'user-1',
        url: 'https://example.com',
      };

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks/pubsub/enrich',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'content-type': 'application/json',
        },
        payload: {
          message: {
            data: Buffer.from(JSON.stringify(event)).toString('base64'),
            messageId: 'msg-1',
          },
          subscription: 'test-subscription',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
    });

    it('returns success for invalid JSON in message data', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks/pubsub/enrich',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'content-type': 'application/json',
        },
        payload: {
          message: {
            data: Buffer.from('not valid json').toString('base64'),
            messageId: 'msg-1',
          },
          subscription: 'test-subscription',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
    });

    it('accepts Pub/Sub push from Google', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        source: 'test',
        sourceId: 'test-1',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const event = {
        type: 'bookmarks.enrich',
        bookmarkId: createResult.value.id,
        userId: 'user-1',
        url: 'https://example.com',
      };

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks/pubsub/enrich',
        headers: {
          from: 'noreply@google.com',
          'content-type': 'application/json',
        },
        payload: {
          message: {
            data: Buffer.from(JSON.stringify(event)).toString('base64'),
            messageId: 'msg-1',
          },
          subscription: 'test-subscription',
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
