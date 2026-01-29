/**
 * Tests for notionServiceClient getPagePreview function.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import type { Logger } from 'pino';
import { createNotionServiceClient } from '../../notion/notionServiceClient.js';
import type { NotionServiceError } from '../../notion/notionServiceClient.js';
import type { Result } from '@intexuraos/common-core';

describe('getPagePreview', () => {
  const notionServiceUrl = 'http://notion-service:8080';
  const internalAuthToken = 'internal-service-key';
  const userId = 'user123';
  const pageId = 'page456';
  const mockLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  function assertPagePreviewResult(
    result: Result<{ title: string; url: string }, NotionServiceError>,
    expectedTitle: string,
    expectedUrl: string
  ): void {
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe(expectedTitle);
      expect(result.value.url).toBe(expectedUrl);
    }
  }

  describe('success cases', () => {
    it('returns page title and url on success', async () => {
      nock(notionServiceUrl)
        .get(`/internal/notion/users/${userId}/pages/${pageId}/preview`)
        .matchHeader('x-internal-auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            title: 'My Page Title',
            url: 'https://notion.so/My-Page-Title-page456',
          },
        });

      const client = createNotionServiceClient({ baseUrl: notionServiceUrl, internalAuthToken });
      const result = await client.getPagePreview(userId, pageId, mockLogger as unknown as Logger);

      assertPagePreviewResult(result, 'My Page Title', 'https://notion.so/My-Page-Title-page456');
    });

    it('URL-encodes userId and pageId in the request path', async () => {
      const specialUserId = 'user/with/slashes';
      const specialPageId = 'page?with=query';

      nock(notionServiceUrl)
        .get(
          `/internal/notion/users/${encodeURIComponent(specialUserId)}/pages/${encodeURIComponent(specialPageId)}/preview`
        )
        .reply(200, { success: true, data: { title: 'T', url: 'U' } });

      const client = createNotionServiceClient({ baseUrl: notionServiceUrl, internalAuthToken });
      const result = await client.getPagePreview(specialUserId, specialPageId, mockLogger);

      expect(result.ok).toBe(true);
    });
  });

  describe('error handling', () => {
    it('returns NOT_FOUND error when page does not exist', async () => {
      nock(notionServiceUrl)
        .get(`/internal/notion/users/${userId}/pages/${pageId}/preview`)
        .reply(404, {
          success: false,
          error: 'Page not found or not accessible',
        });

      const client = createNotionServiceClient({ baseUrl: notionServiceUrl, internalAuthToken });
      const result = await client.getPagePreview(userId, pageId, mockLogger as unknown as Logger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Page not found or not accessible');
      }
    });

    it('returns INTERNAL_ERROR on 5xx response', async () => {
      nock(notionServiceUrl)
        .get(`/internal/notion/users/${userId}/pages/${pageId}/preview`)
        .reply(502, {
          success: false,
          error: 'Downstream error',
        });

      const client = createNotionServiceClient({ baseUrl: notionServiceUrl, internalAuthToken });
      const result = await client.getPagePreview(userId, pageId, mockLogger as unknown as Logger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
      }
    });

    it('returns INTERNAL_ERROR on network failure', async () => {
      nock(notionServiceUrl)
        .get(`/internal/notion/users/${userId}/pages/${pageId}/preview`)
        .replyWithError('Connection refused');

      const client = createNotionServiceClient({ baseUrl: notionServiceUrl, internalAuthToken });
      const result = await client.getPagePreview(userId, pageId, mockLogger as unknown as Logger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns UNAVAILABLE with default message when response has no error field', async () => {
      nock(notionServiceUrl)
        .get(`/internal/notion/users/${userId}/pages/${pageId}/preview`)
        .reply(500, {
          success: false,
          // Missing error field
        });

      const client = createNotionServiceClient({ baseUrl: notionServiceUrl, internalAuthToken });
      const result = await client.getPagePreview(userId, pageId, mockLogger as unknown as Logger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('Unknown error');
      }
    });
  });

  describe('logging', () => {
    it('logs debug message before fetching', async () => {
      nock(notionServiceUrl)
        .get(`/internal/notion/users/${userId}/pages/${pageId}/preview`)
        .reply(200, { success: true, data: { title: 'T', url: 'U' } });

      const client = createNotionServiceClient({ baseUrl: notionServiceUrl, internalAuthToken });
      await client.getPagePreview(userId, pageId, mockLogger);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        { userId, pageId },
        'Fetching page preview from notion-service'
      );
    });

    it('logs error on failure', async () => {
      nock(notionServiceUrl)
        .get(`/internal/notion/users/${userId}/pages/${pageId}/preview`)
        .replyWithError('Network error');

      const client = createNotionServiceClient({ baseUrl: notionServiceUrl, internalAuthToken });
      await client.getPagePreview(userId, pageId, mockLogger);

      expect(mockLogger.error).toHaveBeenCalledWith(
        { error: expect.any(Error), userId, pageId },
        'Failed to fetch page preview'
      );
    });
  });
});
