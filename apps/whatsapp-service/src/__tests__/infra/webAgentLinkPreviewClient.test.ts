import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import nock from 'nock';
import { createWebAgentLinkPreviewClient } from '../../infra/linkpreview/webAgentLinkPreviewClient.js';
import type { LinkPreviewFetcherPort } from '../../domain/whatsapp/ports/linkPreviewFetcher.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('webAgentLinkPreviewClient', () => {
  const baseUrl = 'https://web-agent.example.com';
  const internalAuthToken = 'test-auth-token';
  let client: LinkPreviewFetcherPort;

  beforeAll(() => {
    nock.disableNetConnect();
    client = createWebAgentLinkPreviewClient({
      baseUrl,
      internalAuthToken,
      logger: silentLogger,
    });
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('successful fetch', () => {
    it('returns preview on successful response', async () => {
      nock(baseUrl)
        .post('/internal/link-previews', { urls: ['https://example.com/page'] })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200, {
          success: true,
          data: {
            results: [
              {
                url: 'https://example.com/page',
                status: 'success',
                preview: {
                  url: 'https://example.com/page',
                  title: 'Example Page',
                  description: 'A test page',
                  image: 'https://example.com/image.jpg',
                  favicon: 'https://example.com/favicon.ico',
                  siteName: 'Example',
                },
              },
            ],
            metadata: {
              requestedCount: 1,
              successCount: 1,
              failedCount: 0,
              durationMs: 100,
            },
          },
        });

      const result = await client.fetchPreview('https://example.com/page');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toBe('https://example.com/page');
        expect(result.value.title).toBe('Example Page');
        expect(result.value.description).toBe('A test page');
        expect(result.value.image).toBe('https://example.com/image.jpg');
        expect(result.value.favicon).toBe('https://example.com/favicon.ico');
        expect(result.value.siteName).toBe('Example');
      }
    });

    it('returns preview with minimal fields', async () => {
      nock(baseUrl)
        .post('/internal/link-previews')
        .reply(200, {
          success: true,
          data: {
            results: [
              {
                url: 'https://example.com/',
                status: 'success',
                preview: {
                  url: 'https://example.com/',
                  title: 'Just a Title',
                },
              },
            ],
            metadata: { requestedCount: 1, successCount: 1, failedCount: 0, durationMs: 50 },
          },
        });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Just a Title');
        expect(result.value.description).toBeUndefined();
      }
    });
  });

  describe('HTTP errors', () => {
    it('returns error on HTTP 500', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(500, 'Internal Server Error');

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toContain('500');
      }
    });

    it('returns error on HTTP 401', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(401, 'Unauthorized');

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toContain('401');
      }
    });

    it('returns error on network failure', async () => {
      nock(baseUrl).post('/internal/link-previews').replyWithError('Connection refused');

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toContain('Failed to call web-agent');
      }
    });
  });

  describe('API response errors', () => {
    it('returns error when success is false', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
      });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toBe('Something went wrong');
      }
    });

    it('returns error when data is undefined', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, { success: true });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toContain('Invalid response');
      }
    });

    it('returns error when results array is empty', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, {
        success: true,
        data: {
          results: [],
          metadata: { requestedCount: 1, successCount: 0, failedCount: 0, durationMs: 10 },
        },
      });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toBe('No results returned');
      }
    });

    it('returns error when result status is failed', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, {
        success: true,
        data: {
          results: [
            {
              url: 'https://example.com/',
              status: 'failed',
              error: { code: 'TIMEOUT', message: 'Request timed out after 5000ms' },
            },
          ],
          metadata: { requestedCount: 1, successCount: 0, failedCount: 1, durationMs: 5000 },
        },
      });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
        expect(result.error.message).toBe('Request timed out after 5000ms');
      }
    });

    it('maps TOO_LARGE error code correctly', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, {
        success: true,
        data: {
          results: [
            {
              url: 'https://example.com/',
              status: 'failed',
              error: { code: 'TOO_LARGE', message: 'Response exceeded size limit' },
            },
          ],
          metadata: { requestedCount: 1, successCount: 0, failedCount: 1, durationMs: 100 },
        },
      });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOO_LARGE');
      }
    });

    it('maps PARSE_FAILED error code correctly', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, {
        success: true,
        data: {
          results: [
            {
              url: 'https://example.com/',
              status: 'failed',
              error: { code: 'PARSE_FAILED', message: 'Could not parse HTML' },
            },
          ],
          metadata: { requestedCount: 1, successCount: 0, failedCount: 1, durationMs: 50 },
        },
      });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PARSE_FAILED');
        expect(result.error.message).toBe('Could not parse HTML');
      }
    });

    it('maps unknown error codes to FETCH_FAILED', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, {
        success: true,
        data: {
          results: [
            {
              url: 'https://example.com/',
              status: 'failed',
              error: { code: 'INVALID_URL', message: 'URL is invalid' },
            },
          ],
          metadata: { requestedCount: 1, successCount: 0, failedCount: 1, durationMs: 10 },
        },
      });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toBe('URL is invalid');
      }
    });

    it('returns error when preview is missing in successful result', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, {
        success: true,
        data: {
          results: [{ url: 'https://example.com/', status: 'success' }],
          metadata: { requestedCount: 1, successCount: 1, failedCount: 0, durationMs: 50 },
        },
      });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toBe('No preview in successful result');
      }
    });

    it('returns fallback message when success is false without error object', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, { success: false });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toBe('Invalid response from web-agent');
      }
    });

    it('returns fallback values when failed result has no error object', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, {
        success: true,
        data: {
          results: [{ url: 'https://example.com/', status: 'failed' }],
          metadata: { requestedCount: 1, successCount: 0, failedCount: 1, durationMs: 10 },
        },
      });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toBe('Unknown error');
      }
    });
  });

  describe('default logger', () => {
    it('uses default logger when none provided', async () => {
      const clientWithDefaultLogger = createWebAgentLinkPreviewClient({
        baseUrl,
        internalAuthToken,
      });

      nock(baseUrl).post('/internal/link-previews').reply(200, {
        success: true,
        data: {
          results: [
            {
              url: 'https://example.com/',
              status: 'success',
              preview: { url: 'https://example.com/', title: 'Test' },
            },
          ],
          metadata: { requestedCount: 1, successCount: 1, failedCount: 0, durationMs: 50 },
        },
      });

      const result = await clientWithDefaultLogger.fetchPreview('https://example.com/');

      expect(result.ok).toBe(true);
    });
  });
});
