import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
    it('returns summary on successful response', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/query')
        .reply(200, {
          success: true,
          llm_extraction: 'This is a test summary of the web page content.',
        });

      const result = await client.summarizePage('https://example.com/article');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.url).toBe('https://example.com/article');
      expect(result.value.summary).toBe('This is a test summary of the web page content.');
      expect(result.value.wordCount).toBe(10);
      expect(result.value.estimatedReadingMinutes).toBe(1);
    });

    it('uses markdown if llm_extraction is not available', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/query')
        .reply(200, {
          success: true,
          markdown: 'Markdown content from the page.',
        });

      const result = await client.summarizePage('https://example.com/page');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.summary).toBe('Markdown content from the page.');
    });

    it('sends apikey in request body', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      const scope = nock('https://api.crawl4ai.com')
        .post('/query', (body) => {
          const payload = body as { apikey: string };
          return payload.apikey === TEST_API_KEY;
        })
        .reply(200, {
          success: true,
          llm_extraction: 'Summary content.',
        });

      await client.summarizePage('https://example.com');

      expect(scope.isDone()).toBe(true);
    });

    it('sends correct payload structure', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      const scope = nock('https://api.crawl4ai.com')
        .post('/query', (body) => {
          const payload = body as {
            url: string;
            apikey: string;
            output_format: string;
            magic: boolean;
            cache_mode: string;
            llm_instruction: string;
          };
          return (
            payload.url === 'https://example.com/test' &&
            payload.apikey === TEST_API_KEY &&
            payload.output_format === 'markdown' &&
            payload.magic === true &&
            payload.cache_mode === 'bypass' &&
            typeof payload.llm_instruction === 'string'
          );
        })
        .reply(200, {
          success: true,
          llm_extraction: 'Content.',
        });

      await client.summarizePage('https://example.com/test');

      expect(scope.isDone()).toBe(true);
    });

    it('returns API_ERROR on non-200 response', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com').post('/query').reply(500, { error: 'Internal server error' });

      const result = await client.summarizePage('https://example.com');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('API_ERROR');
      expect(result.error.message).toContain('HTTP 500');
    });

    it('returns FETCH_FAILED when success is false', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/query')
        .reply(200, {
          success: false,
          error: 'Could not fetch page',
        });

      const result = await client.summarizePage('https://example.com/fail');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('FETCH_FAILED');
      expect(result.error.message).toBe('Could not fetch page');
    });

    it('returns NO_CONTENT when llm_extraction is empty', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/query')
        .reply(200, {
          success: true,
          llm_extraction: '',
        });

      const result = await client.summarizePage('https://example.com/empty');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NO_CONTENT');
    });

    it('returns NO_CONTENT when content is missing', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/query')
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

      nock('https://api.crawl4ai.com').post('/query').replyWithError('Network error');

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
        .post('/query')
        .reply(200, {
          success: true,
          llm_extraction: 'Custom API response.',
        });

      const result = await client.summarizePage('https://example.com');

      expect(scope.isDone()).toBe(true);
      expect(result.ok).toBe(true);
    });

    it('calculates word count and reading time correctly', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      const longSummary = Array.from({ length: 400 }, () => 'word').join(' ');

      nock('https://api.crawl4ai.com')
        .post('/query')
        .reply(200, {
          success: true,
          llm_extraction: longSummary,
        });

      const result = await client.summarizePage('https://example.com/long');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.wordCount).toBe(400);
      expect(result.value.estimatedReadingMinutes).toBe(2);
    });

    it('passes maxSentences and maxReadingMinutes to llm_instruction', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      const scope = nock('https://api.crawl4ai.com')
        .post('/query', (body) => {
          const payload = body as { llm_instruction: string };
          return (
            payload.llm_instruction.includes('10 sentences') &&
            payload.llm_instruction.includes('5 minutes')
          );
        })
        .reply(200, {
          success: true,
          llm_extraction: 'Content.',
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
        .post('/query', (body) => {
          const payload = body as { llm_instruction: string };
          return (
            payload.llm_instruction.includes('20 sentences') &&
            payload.llm_instruction.includes('3 minutes')
          );
        })
        .reply(200, {
          success: true,
          llm_extraction: 'Content.',
        });

      await client.summarizePage('https://example.com');

      expect(scope.isDone()).toBe(true);
    });

    it('trims whitespace from summary', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/query')
        .reply(200, {
          success: true,
          llm_extraction: '  Content with whitespace.  ',
        });

      const result = await client.summarizePage('https://example.com');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.summary).toBe('Content with whitespace.');
    });

    it('uses nested result.llm_extraction if available', async () => {
      client = new Crawl4AIClient({ apiKey: TEST_API_KEY }, silentLogger);

      nock('https://api.crawl4ai.com')
        .post('/query')
        .reply(200, {
          success: true,
          result: {
            llm_extraction: 'Nested content from result.',
          },
        });

      const result = await client.summarizePage('https://example.com/nested');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.summary).toBe('Nested content from result.');
    });
  });
});
