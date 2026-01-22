import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import pino from 'pino';
import { Crawl4AIClient } from '../../../infra/pagesummary/crawl4aiClient.js';

const TEST_API_KEY = 'test-api-key';
const silentLogger = pino({ level: 'silent' });

describe('Crawl4AIClient', () => {
  let client: Crawl4AIClient;

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('summarizePage', () => {
    it('returns summary on successful response with extracted_content', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/v1/crawl')
        .reply(200, {
          success: true,
          extracted_content: 'This is a test summary of the web page content.',
        });

      const result = await client.summarizePage('https://example.com/article');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.url).toBe('https://example.com/article');
      expect(result.value.summary).toBe('This is a test summary of the web page content.');
      expect(result.value.wordCount).toBe(10);
      expect(result.value.estimatedReadingMinutes).toBe(1);
    });

    it('uses markdown.raw_markdown if extracted_content is not available', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/v1/crawl')
        .reply(200, {
          success: true,
          markdown: {
            raw_markdown: 'Markdown content from the page.',
          },
        });

      const result = await client.summarizePage('https://example.com/page');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.summary).toBe('Markdown content from the page.');
    });

    it('sends X-API-Key in request header', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      const scope = nock('https://api.crawl4ai.com')
        .post('/v1/crawl')
        .matchHeader('X-API-Key', TEST_API_KEY)
        .reply(200, {
          success: true,
          extracted_content: 'Summary content.',
        });

      await client.summarizePage('https://example.com');

      expect(scope.isDone()).toBe(true);
    });

    it('sends correct payload structure', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      const scope = nock('https://api.crawl4ai.com')
        .post('/v1/crawl', (body) => {
          const payload = body as {
            url: string;
            strategy: string;
            bypass_cache: boolean;
            crawler_config: {
              extraction_strategy: {
                type: string;
                instruction: string;
              };
            };
          };
          return (
            payload.url === 'https://example.com/test' &&
            payload.strategy === 'browser' &&
            payload.bypass_cache === true &&
            payload.crawler_config.extraction_strategy.type === 'llm' &&
            typeof payload.crawler_config.extraction_strategy.instruction === 'string'
          );
        })
        .reply(200, {
          success: true,
          extracted_content: 'Content.',
        });

      await client.summarizePage('https://example.com/test');

      expect(scope.isDone()).toBe(true);
    });

    it('returns API_ERROR on non-200 response', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com').post('/v1/crawl').reply(500, { error_message: 'Internal server error' });

      const result = await client.summarizePage('https://example.com');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('API_ERROR');
      expect(result.error.message).toContain('HTTP 500');
    });

    it('returns API_ERROR on HTTP 401 unauthorized (invalid API key)', async () => {
      client = new Crawl4AIClient({ apiKey: 'invalid-key' }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/v1/crawl')
        .reply(401, { error_message: 'Invalid API key' });

      const result = await client.summarizePage('https://example.com');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('API_ERROR');
      expect(result.error.message).toContain('HTTP 401');
    });

    it('returns API_ERROR on HTTP 403 forbidden', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/v1/crawl')
        .reply(403, { error_message: 'Access denied' });

      const result = await client.summarizePage('https://example.com');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('API_ERROR');
      expect(result.error.message).toContain('HTTP 403');
    });

    it('returns API_ERROR on HTTP 429 rate limited', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/v1/crawl')
        .reply(429, { error_message: 'Rate limit exceeded' });

      const result = await client.summarizePage('https://example.com');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('API_ERROR');
      expect(result.error.message).toContain('HTTP 429');
    });

    it('returns FETCH_FAILED when success is false', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/v1/crawl')
        .reply(200, {
          success: false,
          error_message: 'Could not fetch page',
        });

      const result = await client.summarizePage('https://example.com/fail');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('FETCH_FAILED');
      expect(result.error.message).toBe('Could not fetch page');
    });

    it('returns NO_CONTENT when extracted_content is empty', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/v1/crawl')
        .reply(200, {
          success: true,
          extracted_content: '',
        });

      const result = await client.summarizePage('https://example.com/empty');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NO_CONTENT');
    });

    it('returns NO_CONTENT when content is missing', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/v1/crawl')
        .reply(200, {
          success: true,
        });

      const result = await client.summarizePage('https://example.com/no-result');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NO_CONTENT');
    });

    it('returns FETCH_FAILED on network error', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com').post('/v1/crawl').replyWithError('Network error');

      const result = await client.summarizePage('https://example.com');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('FETCH_FAILED');
    });

    it('uses custom baseUrl when provided', async () => {
      client = new Crawl4AIClient(
        { apiKey: TEST_API_KEY, baseUrl: 'https://custom-api.example.com' },
        silentLogger
      );

      const scope = nock('https://custom-api.example.com')
        .post('/v1/crawl')
        .reply(200, {
          success: true,
          extracted_content: 'Custom API response.',
        });

      const result = await client.summarizePage('https://example.com');

      expect(scope.isDone()).toBe(true);
      expect(result.ok).toBe(true);
    });

    it('calculates word count and reading time correctly', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      const longSummary = Array.from({ length: 400 }, () => 'word').join(' ');

      nock('https://api.crawl4ai.com')
        .post('/v1/crawl')
        .reply(200, {
          success: true,
          extracted_content: longSummary,
        });

      const result = await client.summarizePage('https://example.com/long');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.wordCount).toBe(400);
      expect(result.value.estimatedReadingMinutes).toBe(2);
    });

    it('passes maxSentences and maxReadingMinutes to extraction instruction', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      const scope = nock('https://api.crawl4ai.com')
        .post('/v1/crawl', (body) => {
          const payload = body as {
            crawler_config: {
              extraction_strategy: {
                instruction: string;
              };
            };
          };
          return (
            payload.crawler_config.extraction_strategy.instruction.includes('10 sentences') &&
            payload.crawler_config.extraction_strategy.instruction.includes('5 minutes')
          );
        })
        .reply(200, {
          success: true,
          extracted_content: 'Content.',
        });

      await client.summarizePage('https://example.com', {
        maxSentences: 10,
        maxReadingMinutes: 5,
      });

      expect(scope.isDone()).toBe(true);
    });

    it('uses default maxSentences and maxReadingMinutes when not provided', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      const scope = nock('https://api.crawl4ai.com')
        .post('/v1/crawl', (body) => {
          const payload = body as {
            crawler_config: {
              extraction_strategy: {
                instruction: string;
              };
            };
          };
          return (
            payload.crawler_config.extraction_strategy.instruction.includes('20 sentences') &&
            payload.crawler_config.extraction_strategy.instruction.includes('3 minutes')
          );
        })
        .reply(200, {
          success: true,
          extracted_content: 'Content.',
        });

      await client.summarizePage('https://example.com');

      expect(scope.isDone()).toBe(true);
    });

    it('trims whitespace from summary', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/v1/crawl')
        .reply(200, {
          success: true,
          extracted_content: '  Content with whitespace.  ',
        });

      const result = await client.summarizePage('https://example.com');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.summary).toBe('Content with whitespace.');
    });

    it('prefers extracted_content over markdown.raw_markdown', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/v1/crawl')
        .reply(200, {
          success: true,
          extracted_content: 'LLM summary from extracted_content field.',
          markdown: {
            raw_markdown: 'Raw markdown content.',
          },
        });

      const result = await client.summarizePage('https://example.com/extractions');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.summary).toBe('LLM summary from extracted_content field.');
    });

    it('returns TIMEOUT when request times out', async () => {
      vi.useFakeTimers();

      const shortTimeoutClient = new Crawl4AIClient(
        { apiKey: TEST_API_KEY, timeoutMs: 100 },
        silentLogger
      );

      nock('https://api.crawl4ai.com').post('/v1/crawl').delay(200).reply(200, {
        success: true,
        extracted_content: 'Too late.',
      });

      const resultPromise = shortTimeoutClient.summarizePage('https://example.com/slow');

      await vi.advanceTimersByTimeAsync(150);

      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('TIMEOUT');
      expect(result.error.message).toContain('100ms');

      vi.useRealTimers();
    });

    it('returns FETCH_FAILED for unknown non-Error exceptions', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      const originalFetch = global.fetch;
      global.fetch = (): never => {
        throw 'string-error';
      };

      try {
        const result = await client.summarizePage('https://example.com/error');

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toBe('Unknown error');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('falls back to markdown when extracted_content is whitespace-only', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/v1/crawl')
        .reply(200, {
          success: true,
          extracted_content: '   ',
          markdown: {
            raw_markdown: 'Fallback markdown content.',
          },
        });

      const result = await client.summarizePage('https://example.com/whitespace');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.summary).toBe('Fallback markdown content.');
    });

    it('returns API_ERROR when response body is not valid JSON', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/v1/crawl')
        .reply(200, 'not-valid-json', { 'Content-Type': 'text/plain' });

      const result = await client.summarizePage('https://example.com/malformed');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('API_ERROR');
      expect(result.error.message).toBe('Crawl4AI returned invalid JSON response');
    });
  });
});
