import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createPageContentFetcher } from '../../../infra/pagesummary/pageContentFetcher.js';
import type { Logger } from 'pino';

// Mock fetch at module level
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('PageContentFetcher', () => {
  let logger: Logger;
  const testApiKey = 'test-crawl4ai-key';
  const testUrl = 'https://example.com/article';

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    mockFetch.mockClear();
  });

  describe('success path', () => {
    it('returns markdown content on successful fetch', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          markdown: { raw_markdown: '# Article Title\n\nThis is content.' },
        }),
      });

      const fetcher = createPageContentFetcher({ apiKey: testApiKey }, logger);
      const result = await fetcher.fetchPageContent(testUrl);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('# Article Title\n\nThis is content.');
      }
    });

    it('trims whitespace from markdown content', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          markdown: { raw_markdown: '  # Title\n\nContent with spaces  ' },
        }),
      });

      const fetcher = createPageContentFetcher({ apiKey: testApiKey }, logger);
      const result = await fetcher.fetchPageContent(testUrl);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('# Title\n\nContent with spaces');
      }
    });

    it('logs success with content length', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          markdown: { raw_markdown: '# Title\n\nContent' },
        }),
      });

      const fetcher = createPageContentFetcher({ apiKey: testApiKey }, logger);
      await fetcher.fetchPageContent(testUrl);

      expect(logger.info).toHaveBeenCalledWith(
        { url: testUrl, contentLength: expect.any(Number) },
        'Page content fetched successfully'
      );
    });
  });

  describe('payload structure', () => {
    it('sends correct payload to Crawl4AI API', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          markdown: { raw_markdown: 'Content' },
        }),
      });

      const fetcher = createPageContentFetcher({ apiKey: testApiKey }, logger);
      await fetcher.fetchPageContent(testUrl);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs).toBeDefined();
      const [callUrl, callOptions] = callArgs ?? [];

      expect(callUrl).toBe('https://api.crawl4ai.com/v1/crawl');
      expect(callOptions?.method).toBe('POST');

      const payload = JSON.parse(callOptions?.body as string);
      expect(payload).toEqual({
        url: testUrl,
        strategy: 'browser',
        bypass_cache: true,
      });
    });

    it('includes X-API-Key header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          markdown: { raw_markdown: 'Content' },
        }),
      });

      const fetcher = createPageContentFetcher({ apiKey: testApiKey }, logger);
      await fetcher.fetchPageContent(testUrl);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs).toBeDefined();
      expect(callArgs?.[1]?.headers).toHaveProperty('X-API-Key', testApiKey);
    });
  });

  describe('error handling - HTTP status', () => {
    it('returns API_ERROR on non-200 status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const fetcher = createPageContentFetcher({ apiKey: testApiKey }, logger);
      const result = await fetcher.fetchPageContent(testUrl);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('HTTP 401');
      }
    });

    it('returns API_ERROR on 500 status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const fetcher = createPageContentFetcher({ apiKey: testApiKey }, logger);
      const result = await fetcher.fetchPageContent(testUrl);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });
  });

  describe('error handling - Crawl4AI response', () => {
    it('returns FETCH_FAILED when success=false', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: false,
          error_message: 'Crawl failed',
        }),
      });

      const fetcher = createPageContentFetcher({ apiKey: testApiKey }, logger);
      const result = await fetcher.fetchPageContent(testUrl);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toBe('Crawl failed');
      }
    });

    it('returns NO_CONTENT when markdown is undefined', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          // No markdown field
        }),
      });

      const fetcher = createPageContentFetcher({ apiKey: testApiKey }, logger);
      const result = await fetcher.fetchPageContent(testUrl);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_CONTENT');
      }
    });

    it('returns NO_CONTENT when markdown is empty string', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          markdown: { raw_markdown: '' },
        }),
      });

      const fetcher = createPageContentFetcher({ apiKey: testApiKey }, logger);
      const result = await fetcher.fetchPageContent(testUrl);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_CONTENT');
      }
    });

    it('returns NO_CONTENT when markdown is whitespace only', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          markdown: { raw_markdown: '   \n\n  ' },
        }),
      });

      const fetcher = createPageContentFetcher({ apiKey: testApiKey }, logger);
      const result = await fetcher.fetchPageContent(testUrl);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_CONTENT');
      }
    });

    it('returns API_ERROR on invalid JSON response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const fetcher = createPageContentFetcher({ apiKey: testApiKey }, logger);
      const result = await fetcher.fetchPageContent(testUrl);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('Crawl4AI returned invalid JSON response');
      }
    });
  });

  describe('error handling - timeout', () => {
    it('returns TIMEOUT on AbortError', async () => {
      const fetcher = createPageContentFetcher({ apiKey: testApiKey, timeoutMs: 1 }, logger);

      // Mock fetch to respect the AbortSignal and throw AbortError when aborted
      mockFetch.mockImplementation(
        (_url: string, options?: { signal?: AbortSignal }) =>
          new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
              resolve({
                ok: true,
                json: async () => ({
                  success: true,
                  markdown: { raw_markdown: 'Content' },
                }),
              });
            }, 100);

            // Listen for abort signal
            options?.signal?.addEventListener('abort', () => {
              clearTimeout(timeoutHandle);
              const abortError = new Error('The operation was aborted');
              abortError.name = 'AbortError';
              reject(abortError);
            });
          })
      );

      const result = await fetcher.fetchPageContent(testUrl);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
        expect(result.error.message).toContain('Request timed out after');
      }
    });

    it('logs timeout warning', async () => {
      const fetcher = createPageContentFetcher({ apiKey: testApiKey, timeoutMs: 1 }, logger);

      // Mock fetch to respect the AbortSignal
      mockFetch.mockImplementation(
        (_url: string, options?: { signal?: AbortSignal }) =>
          new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
              resolve({
                ok: true,
                json: async () => ({ success: true, markdown: { raw_markdown: 'Content' } }),
              });
            }, 100);

            options?.signal?.addEventListener('abort', () => {
              clearTimeout(timeoutHandle);
              const abortError = new Error('The operation was aborted');
              abortError.name = 'AbortError';
              reject(abortError);
            });
          })
      );

      await fetcher.fetchPageContent(testUrl);

      expect(logger.warn).toHaveBeenCalledWith(
        { url: testUrl, timeoutMs: 1 },
        'Request timed out (AbortError)'
      );
    });
  });

  describe('error handling - network errors', () => {
    it('returns FETCH_FAILED on network error', async () => {
      const networkError = new Error('Network error');
      mockFetch.mockRejectedValue(networkError);

      const fetcher = createPageContentFetcher({ apiKey: testApiKey }, logger);
      const result = await fetcher.fetchPageContent(testUrl);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toBe('Network error');
      }
    });

    it('logs network error', async () => {
      mockFetch.mockRejectedValue(new Error('Connection failed'));

      const fetcher = createPageContentFetcher({ apiKey: testApiKey }, logger);
      await fetcher.fetchPageContent(testUrl);

      expect(logger.error).toHaveBeenCalledWith(
        { url: testUrl, error: 'Connection failed' },
        'Crawl4AI request failed'
      );
    });
  });

  describe('configuration', () => {
    it('uses custom baseUrl when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          markdown: { raw_markdown: 'Content' },
        }),
      });

      const customBaseUrl = 'https://custom.crawl4ai.com';
      const fetcher = createPageContentFetcher(
        { apiKey: testApiKey, baseUrl: customBaseUrl },
        logger
      );
      await fetcher.fetchPageContent(testUrl);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = mockFetch.mock.calls[0]?.[0];
      expect(url).toBe(`${customBaseUrl}/v1/crawl`);
    });

    it('uses custom timeoutMs when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          markdown: { raw_markdown: 'Content' },
        }),
      });

      const fetcher = createPageContentFetcher({ apiKey: testApiKey, timeoutMs: 5000 }, logger);
      await fetcher.fetchPageContent(testUrl);

      // Should complete successfully with 5s timeout
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
