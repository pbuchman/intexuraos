import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebAgentServiceClient } from '../client.js';
import type { WebAgentServiceConfig } from '../types.js';

const BASE_URL = 'https://web-agent.example.com';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as WebAgentServiceConfig['logger'];

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createWebAgentServiceClient', () => {
  it('returns a preview on success', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/link-previews', { urls: ['https://example.com/page'] })
      .matchHeader('x-internal-auth', 'secret')
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

    const client = createWebAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.fetchPreview('https://example.com/page');

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        url: 'https://example.com/page',
        title: 'Example Page',
        description: 'A test page',
        image: 'https://example.com/image.jpg',
        favicon: 'https://example.com/favicon.ico',
        siteName: 'Example',
      },
    });
  });

  it('maps failed preview results to typed errors', async () => {
    nock(BASE_URL)
      .post('/internal/link-previews')
      .reply(200, {
        success: true,
        data: {
          results: [
            {
              url: 'https://example.com/page',
              status: 'failed',
              error: { code: 'TIMEOUT', message: 'Request timed out' },
            },
          ],
          metadata: { requestedCount: 1, successCount: 0, failedCount: 1, durationMs: 5000 },
        },
      });

    const client = createWebAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.fetchPreview('https://example.com/page');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'TIMEOUT',
        message: 'Request timed out',
      },
    });
  });

  it('returns a page summary on success', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/page-summaries', {
        url: 'https://example.com/article',
        userId: 'user-1',
        title: 'Example article',
        maxSentences: 5,
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, {
        success: true,
        data: {
          result: {
            url: 'https://example.com/article',
            status: 'success',
            summary: {
              url: 'https://example.com/article',
              summary: 'Short summary',
              wordCount: 2,
              estimatedReadingMinutes: 1,
            },
          },
          metadata: {
            durationMs: 125,
          },
        },
      });

    const client = createWebAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.summarizePage({
      url: 'https://example.com/article',
      userId: 'user-1',
      title: 'Example article',
      maxSentences: 5,
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        url: 'https://example.com/article',
        summary: 'Short summary',
        wordCount: 2,
        estimatedReadingMinutes: 1,
      },
    });
  });

  it('maps failed page summaries to typed errors', async () => {
    nock(BASE_URL)
      .post('/internal/page-summaries')
      .reply(200, {
        success: true,
        data: {
          result: {
            url: 'https://example.com/article',
            status: 'failed',
            error: {
              code: 'TIMEOUT',
              message: 'Summary timed out',
            },
          },
          metadata: {
            durationMs: 5_000,
          },
        },
      });

    const client = createWebAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.summarizePage({
      url: 'https://example.com/article',
      userId: 'user-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'TIMEOUT',
        message: 'Summary timed out',
        transient: true,
      },
    });
  });

  it('maps INVALID_URL page-summary failures to the specific error code', async () => {
    nock(BASE_URL)
      .post('/internal/page-summaries')
      .reply(200, {
        success: true,
        data: {
          result: {
            url: 'https://example.com/article',
            status: 'failed',
            error: {
              code: 'INVALID_URL',
              message: 'URL is invalid',
            },
          },
          metadata: {
            durationMs: 10,
          },
        },
      });

    const client = createWebAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.summarizePage({
      url: 'https://example.com/article',
      userId: 'user-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_URL',
        message: 'URL is invalid',
        transient: false,
      },
    });
  });

  it('maps TOO_LARGE page-summary failures to the specific error code', async () => {
    nock(BASE_URL)
      .post('/internal/page-summaries')
      .reply(200, {
        success: true,
        data: {
          result: {
            url: 'https://example.com/article',
            status: 'failed',
            error: {
              code: 'TOO_LARGE',
              message: 'Page too large',
            },
          },
          metadata: {
            durationMs: 10,
          },
        },
      });

    const client = createWebAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.summarizePage({
      url: 'https://example.com/article',
      userId: 'user-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'TOO_LARGE',
        message: 'Page too large',
        transient: false,
      },
    });
  });

  it('maps summarizePage transport timeouts to TIMEOUT', async () => {
    nock(BASE_URL)
      .post('/internal/page-summaries')
      .delay(50)
      .reply(200, {
        success: true,
        data: {
          result: {
            url: 'https://example.com/article',
            status: 'success',
            summary: {
              url: 'https://example.com/article',
              summary: 'Will not arrive in time',
              wordCount: 4,
              estimatedReadingMinutes: 1,
            },
          },
          metadata: {
            durationMs: 50,
          },
        },
      });

    const client = createWebAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
      defaultTimeoutMs: 1,
    });
    const result = await client.summarizePage({
      url: 'https://example.com/article',
      userId: 'user-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'TIMEOUT',
        message: 'Failed to call web-agent: Request exceeded 1ms',
        transient: true,
      },
    });
  });

  it('maps success=false page summary envelopes to API_ERROR', async () => {
    nock(BASE_URL).post('/internal/page-summaries').reply(200, {
      success: false,
      error: 'Summary unavailable',
    });

    const client = createWebAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.summarizePage({
      url: 'https://example.com/article',
      userId: 'user-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'API_ERROR',
        message: 'Summary unavailable',
        transient: false,
      },
    });
  });

  it('uses a fallback error for success=false page summary envelopes without messages', async () => {
    nock(BASE_URL).post('/internal/page-summaries').reply(200, { success: false });

    const client = createWebAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.summarizePage({
      url: 'https://example.com/article',
      userId: 'user-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'API_ERROR',
        message: 'Invalid response from web-agent',
        transient: false,
      },
    });
  });

  it('uses a fallback error for malformed page summary success envelopes', async () => {
    nock(BASE_URL).post('/internal/page-summaries').reply(200, { success: true });

    const client = createWebAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.summarizePage({
      url: 'https://example.com/article',
      userId: 'user-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'API_ERROR',
        message: 'Invalid response from web-agent',
        transient: false,
      },
    });
  });
});
