import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import nock from 'nock';
import pino from 'pino';
import { createWebAgentClient } from '../../infra/linkpreview/webAgentClient.js';
import type { LinkPreviewFetcherPort } from '../../domain/ports/linkPreviewFetcher.js';

const silentLogger = pino({ level: 'silent' });

describe('webAgentClient', () => {
  const baseUrl = 'https://web-agent.example.com';
  const internalAuthToken = 'test-auth-token';
  let client: LinkPreviewFetcherPort;

  beforeAll(() => {
    nock.disableNetConnect();
    client = createWebAgentClient({
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
            metadata: { requestedCount: 1, successCount: 1, failedCount: 0, durationMs: 100 },
          },
        });

      const result = await client.fetchPreview('https://example.com/page');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Example Page');
        expect(result.value.description).toBe('A test page');
        expect(result.value.image).toBe('https://example.com/image.jpg');
      }
    });
  });

  describe('error handling', () => {
    it('returns error on HTTP 500', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(500, 'Internal Server Error');

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
      }
    });

    it('returns error on network failure', async () => {
      nock(baseUrl).post('/internal/link-previews').replyWithError('Connection refused');

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
      }
    });

    it('maps TIMEOUT error code correctly', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, {
        success: true,
        data: {
          results: [
            {
              url: 'https://example.com/',
              status: 'failed',
              error: { code: 'TIMEOUT', message: 'Request timed out' },
            },
          ],
          metadata: { requestedCount: 1, successCount: 0, failedCount: 1, durationMs: 5000 },
        },
      });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
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

    it('returns error when success is false', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Server error' },
      });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toBe('Server error');
      }
    });

    it('returns error when data is undefined', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, {
        success: true,
      });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toBe('Invalid response from web-agent');
      }
    });

    it('returns error when results array is empty', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, {
        success: true,
        data: {
          results: [],
          metadata: { requestedCount: 1, successCount: 0, failedCount: 0, durationMs: 50 },
        },
      });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toBe('No results returned');
      }
    });

    it('returns error when success but no preview object', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, {
        success: true,
        data: {
          results: [
            {
              url: 'https://example.com/',
              status: 'success',
            },
          ],
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

    it('handles failed status with no error object', async () => {
      nock(baseUrl).post('/internal/link-previews').reply(200, {
        success: true,
        data: {
          results: [
            {
              url: 'https://example.com/',
              status: 'failed',
            },
          ],
          metadata: { requestedCount: 1, successCount: 0, failedCount: 1, durationMs: 50 },
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

  describe('preview field defaults', () => {
    it('returns null for missing preview fields', async () => {
      nock(baseUrl)
        .post('/internal/link-previews')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            results: [
              {
                url: 'https://example.com/',
                status: 'success',
                preview: {
                  url: 'https://example.com/',
                },
              },
            ],
            metadata: { requestedCount: 1, successCount: 1, failedCount: 0, durationMs: 50 },
          },
        });

      const result = await client.fetchPreview('https://example.com/');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBeNull();
        expect(result.value.description).toBeNull();
        expect(result.value.image).toBeNull();
        expect(result.value.siteName).toBeNull();
        expect(result.value.favicon).toBeNull();
      }
    });
  });
});
