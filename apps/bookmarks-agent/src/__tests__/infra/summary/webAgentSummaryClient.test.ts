import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import nock from 'nock';
import pino from 'pino';
import { createWebAgentSummaryClient } from '../../../infra/summary/webAgentSummaryClient.js';

const TEST_BASE_URL = 'http://web-agent.local';
const TEST_INTERNAL_TOKEN = 'test-internal-auth-token';
const silentLogger = pino({ level: 'silent' });

describe('webAgentSummaryClient', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('generateSummary', () => {
    it('returns summary on successful response', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL)
        .post('/internal/page-summaries')
        .reply(200, {
          success: true,
          data: {
            result: {
              url: 'https://example.com/article',
              status: 'success',
              summary: {
                url: 'https://example.com/article',
                summary: 'This is a summary of the article.',
                wordCount: 7,
                estimatedReadingMinutes: 1,
              },
            },
            metadata: {
              durationMs: 1500,
            },
          },
        });

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com/article',
        title: 'Article Title',
        description: 'Article description',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe('This is a summary of the article.');
    });

    it('sends correct X-Internal-Auth header', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      const scope = nock(TEST_BASE_URL)
        .post('/internal/page-summaries')
        .matchHeader('X-Internal-Auth', TEST_INTERNAL_TOKEN)
        .reply(200, {
          success: true,
          data: {
            result: {
              url: 'https://example.com',
              status: 'success',
              summary: {
                url: 'https://example.com',
                summary: 'Content.',
                wordCount: 1,
                estimatedReadingMinutes: 1,
              },
            },
            metadata: { durationMs: 100 },
          },
        });

      await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(scope.isDone()).toBe(true);
    });

    it('sends correct request body', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      const scope = nock(TEST_BASE_URL)
        .post('/internal/page-summaries', {
          url: 'https://example.com/page',
          userId: 'user-456',
          maxSentences: 20,
          maxReadingMinutes: 3,
        })
        .reply(200, {
          success: true,
          data: {
            result: {
              url: 'https://example.com/page',
              status: 'success',
              summary: {
                url: 'https://example.com/page',
                summary: 'Summary.',
                wordCount: 1,
                estimatedReadingMinutes: 1,
              },
            },
            metadata: { durationMs: 100 },
          },
        });

      await client.generateSummary('user-456', {
        url: 'https://example.com/page',
        title: 'Page Title',
        description: 'Description',
      });

      expect(scope.isDone()).toBe(true);
    });

    it('returns GENERATION_ERROR on network failure', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL).post('/internal/page-summaries').replyWithError('Network error');

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('GENERATION_ERROR');
      expect(result.error.message).toContain('Failed to call web-agent');
    });

    it('returns GENERATION_ERROR on HTTP error response', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL)
        .post('/internal/page-summaries')
        .reply(500, { error: 'Internal server error' });

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('GENERATION_ERROR');
      expect(result.error.message).toContain('HTTP 500');
    });

    it('returns GENERATION_ERROR when response success is false', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL).post('/internal/page-summaries').reply(200, {
        success: false,
        error: 'Service unavailable',
      });

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('GENERATION_ERROR');
      expect(result.error.message).toBe('Service unavailable');
    });

    it('returns NO_CONTENT when result status is failed with NO_CONTENT code', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL)
        .post('/internal/page-summaries')
        .reply(200, {
          success: true,
          data: {
            result: {
              url: 'https://example.com/empty',
              status: 'failed',
              error: {
                code: 'NO_CONTENT',
                message: 'No content extracted',
              },
            },
            metadata: { durationMs: 100 },
          },
        });

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com/empty',
        title: 'Empty',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NO_CONTENT');
      expect(result.error.message).toBe('No content extracted');
    });

    it('maps API_ERROR to GENERATION_ERROR', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL)
        .post('/internal/page-summaries')
        .reply(200, {
          success: true,
          data: {
            result: {
              url: 'https://example.com/api-error',
              status: 'failed',
              error: {
                code: 'API_ERROR',
                message: 'External API failed',
              },
            },
            metadata: { durationMs: 100 },
          },
        });

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com/api-error',
        title: 'API Error',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('GENERATION_ERROR');
    });

    it('maps TIMEOUT to GENERATION_ERROR', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL)
        .post('/internal/page-summaries')
        .reply(200, {
          success: true,
          data: {
            result: {
              url: 'https://example.com/slow',
              status: 'failed',
              error: {
                code: 'TIMEOUT',
                message: 'Request timed out',
              },
            },
            metadata: { durationMs: 60000 },
          },
        });

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com/slow',
        title: 'Slow Page',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('GENERATION_ERROR');
    });

    it('returns default error message when body.error is undefined', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL).post('/internal/page-summaries').reply(200, {
        success: false,
        // Note: no error field provided
      });

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('GENERATION_ERROR');
      expect(result.error.message).toBe('Invalid response from web-agent');
    });

    it('uses default error code and message when result.error is missing', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL)
        .post('/internal/page-summaries')
        .reply(200, {
          success: true,
          data: {
            result: {
              url: 'https://example.com/failed',
              status: 'failed',
              // Note: no error object provided
            },
            metadata: { durationMs: 100 },
          },
        });

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com/failed',
        title: 'Failed Page',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('GENERATION_ERROR');
      expect(result.error.message).toBe('Unknown error');
    });

    it('uses default message when result.error.message is missing', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL)
        .post('/internal/page-summaries')
        .reply(200, {
          success: true,
          data: {
            result: {
              url: 'https://example.com/partial-error',
              status: 'failed',
              error: {
                code: 'NO_CONTENT',
                // Note: no message field
              },
            },
            metadata: { durationMs: 100 },
          },
        });

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com/partial-error',
        title: 'Partial Error',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NO_CONTENT');
      expect(result.error.message).toBe('Unknown error');
    });

    it('returns GENERATION_ERROR when summary is missing in successful result', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL)
        .post('/internal/page-summaries')
        .reply(200, {
          success: true,
          data: {
            result: {
              url: 'https://example.com',
              status: 'success',
            },
            metadata: { durationMs: 100 },
          },
        });

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Missing Summary',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('GENERATION_ERROR');
      expect(result.error.message).toBe('No summary in successful result');
    });
  });

  describe('transient error classification', () => {
    it('marks network failure as transient', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL).post('/internal/page-summaries').replyWithError('Network error');

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.transient).toBe(true);
    });

    it('marks HTTP 429 as transient', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL).post('/internal/page-summaries').reply(429, {});

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.transient).toBe(true);
    });

    it('marks HTTP 503 as transient', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL).post('/internal/page-summaries').reply(503, {});

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.transient).toBe(true);
    });

    it('marks HTTP 504 as transient', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL).post('/internal/page-summaries').reply(504, {});

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.transient).toBe(true);
    });

    it('marks HTTP 500 as NOT transient', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL).post('/internal/page-summaries').reply(500, {});

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.transient).toBe(false);
    });

    it('marks HTTP 400 as NOT transient', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL).post('/internal/page-summaries').reply(400, {});

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.transient).toBe(false);
    });

    it('marks TIMEOUT error code as transient', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL)
        .post('/internal/page-summaries')
        .reply(200, {
          success: true,
          data: {
            result: {
              url: 'https://example.com',
              status: 'failed',
              error: { code: 'TIMEOUT', message: 'Timed out' },
            },
            metadata: { durationMs: 60000 },
          },
        });

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.transient).toBe(true);
    });

    it('marks FETCH_FAILED error code as transient', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL)
        .post('/internal/page-summaries')
        .reply(200, {
          success: true,
          data: {
            result: {
              url: 'https://example.com',
              status: 'failed',
              error: { code: 'FETCH_FAILED', message: 'Network error' },
            },
            metadata: { durationMs: 1000 },
          },
        });

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.transient).toBe(true);
    });

    it('marks NO_CONTENT error code as NOT transient', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL)
        .post('/internal/page-summaries')
        .reply(200, {
          success: true,
          data: {
            result: {
              url: 'https://example.com',
              status: 'failed',
              error: { code: 'NO_CONTENT', message: 'No content' },
            },
            metadata: { durationMs: 1000 },
          },
        });

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.transient).toBe(false);
    });

    it('marks invalid response as NOT transient', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL).post('/internal/page-summaries').reply(200, {
        success: false,
        error: 'Bad response',
      });

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.transient).toBe(false);
    });

    it('marks missing summary as NOT transient', async () => {
      const client = createWebAgentSummaryClient({
        baseUrl: TEST_BASE_URL,
        internalAuthToken: TEST_INTERNAL_TOKEN,
        logger: silentLogger,
      });

      nock(TEST_BASE_URL)
        .post('/internal/page-summaries')
        .reply(200, {
          success: true,
          data: {
            result: { url: 'https://example.com', status: 'success' },
            metadata: { durationMs: 1000 },
          },
        });

      const result = await client.generateSummary('user-123', {
        url: 'https://example.com',
        title: 'Title',
        description: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.transient).toBe(false);
    });
  });
});
