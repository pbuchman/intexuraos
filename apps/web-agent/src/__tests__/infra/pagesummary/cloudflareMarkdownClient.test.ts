import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { createCloudflareMarkdownClient } from '../../../infra/pagesummary/cloudflareMarkdownClient.js';
import pino from 'pino';

const ACCOUNT_ID = 'test-account-id';
const API_TOKEN = 'test-api-token';
const BASE_URL = 'https://api.cloudflare.com';

function createClient(overrides?: { timeoutMs?: number }): ReturnType<typeof createCloudflareMarkdownClient> {
  return createCloudflareMarkdownClient(
    {
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      timeoutMs: overrides?.timeoutMs ?? 60000,
    },
    pino({ level: 'silent' })
  );
}

describe('cloudflareMarkdownClient', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('returns markdown content on successful response', async () => {
    const markdown = '# Example Page\n\nThis is the page content.';

    nock(BASE_URL)
      .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
      .reply(200, {
        success: true,
        errors: [],
        messages: [],
        result: markdown,
      });

    const client = createClient();
    const result = await client.fetchPageContent('https://example.com');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(markdown);
    }
  });

  it('sends correct Authorization header and request body', async () => {
    let capturedBody: unknown;
    nock(BASE_URL)
      .post(
        `/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`,
        (body: Record<string, unknown>) => {
          capturedBody = body;
          return true;
        }
      )
      .matchHeader('Authorization', `Bearer ${API_TOKEN}`)
      .matchHeader('Content-Type', 'application/json')
      .reply(200, { success: true, errors: [], messages: [], result: '# Content' });

    const client = createClient();
    const result = await client.fetchPageContent('https://example.com/page');

    expect(result.ok).toBe(true);
    expect(capturedBody).toStrictEqual({
      url: 'https://example.com/page',
      rejectResourceTypes: ['image', 'media', 'font', 'stylesheet'],
    });
  });

  it.each([
    [429, 'RATE_LIMITED' as const],
    [401, 'API_ERROR' as const],
    [403, 'API_ERROR' as const],
    [500, 'API_ERROR' as const],
  ])('HTTP %i returns %s', async (status, expectedCode) => {
    nock(BASE_URL)
      .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
      .reply(status, 'error');

    const client = createClient();
    const result = await client.fetchPageContent('https://example.com');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(expectedCode);
    }
  });

  it('returns FETCH_FAILED when success is false', async () => {
    nock(BASE_URL)
      .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
      .reply(200, {
        success: false,
        errors: [{ code: 1001, message: 'Page could not be loaded' }],
        messages: [],
        result: null,
      });

    const client = createClient();
    const result = await client.fetchPageContent('https://example.com');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FETCH_FAILED');
      expect(result.error.message).toBe('Page could not be loaded');
    }
  });

  it.each([
    ['empty string', '   '],
    ['null', null],
  ])('returns NO_CONTENT when result is %s', async (_label, resultValue) => {
    nock(BASE_URL)
      .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
      .reply(200, { success: true, errors: [], messages: [], result: resultValue });

    const client = createClient();
    const result = await client.fetchPageContent('https://example.com');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NO_CONTENT');
    }
  });

  it('returns API_ERROR on invalid JSON response', async () => {
    nock(BASE_URL)
      .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
      .reply(200, 'not json', { 'Content-Type': 'text/plain' });

    const client = createClient();
    const result = await client.fetchPageContent('https://example.com');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('API_ERROR');
    }
  });

  it('returns TIMEOUT on AbortError', async () => {
    nock(BASE_URL)
      .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
      .delay(200)
      .reply(200, { success: true, errors: [], messages: [], result: '# Content' });

    const client = createClient({ timeoutMs: 50 });
    const result = await client.fetchPageContent('https://example.com');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TIMEOUT');
    }
  });

  it('returns FETCH_FAILED on network error', async () => {
    nock(BASE_URL)
      .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
      .replyWithError('Connection refused');

    const client = createClient();
    const result = await client.fetchPageContent('https://example.com');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FETCH_FAILED');
      expect(result.error.message).toContain('Connection refused');
    }
  });

  it('trims whitespace from markdown result', async () => {
    nock(BASE_URL)
      .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
      .reply(200, {
        success: true,
        errors: [],
        messages: [],
        result: '  \n# Trimmed Content\n  ',
      });

    const client = createClient();
    const result = await client.fetchPageContent('https://example.com');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('# Trimmed Content');
    }
  });

  it('returns INVALID_URL for malformed URLs', async () => {
    const client = createClient();
    const result = await client.fetchPageContent('not-a-valid-url');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_URL');
      expect(result.error.message).toContain('not-a-valid-url');
    }
  });

  it('returns FETCH_FAILED with default message when errors array is empty', async () => {
    nock(BASE_URL)
      .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
      .reply(200, {
        success: false,
        errors: [],
        messages: [],
        result: null,
      });

    const client = createClient();
    const result = await client.fetchPageContent('https://example.com');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FETCH_FAILED');
      expect(result.error.message).toBe('Cloudflare request failed');
    }
  });

  it('returns FETCH_FAILED when a non-Error is thrown', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (): never => {
      throw 'string-error';
    };

    try {
      const client = createClient();
      const result = await client.fetchPageContent('https://example.com');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toBe('Unknown error');
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles result as object with markdown field', async () => {
    nock(BASE_URL)
      .post(`/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/markdown`)
      .reply(200, {
        success: true,
        errors: [],
        messages: [],
        result: { markdown: '# Object Format Content' },
      });

    const client = createClient();
    const result = await client.fetchPageContent('https://example.com');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('# Object Format Content');
    }
  });
});
