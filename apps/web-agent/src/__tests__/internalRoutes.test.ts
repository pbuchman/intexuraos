import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import nock from 'nock';
import { err } from '@intexuraos/common-core';
import { buildServer } from '../server.js';
import { resetServices, setServices, type ServiceContainer } from '../services.js';
import { FakeLinkPreviewFetcher, FakePageSummaryService } from './fakes.js';

const TEST_INTERNAL_TOKEN = 'test-internal-auth-token';

interface LinkPreviewResponse {
  success: boolean;
  data: {
    results: {
      url: string;
      status: 'success' | 'failed';
      preview?: {
        url: string;
        title?: string;
        description?: string;
        image?: string;
        siteName?: string;
        favicon?: string;
      };
      error?: {
        code: string;
        message: string;
      };
    }[];
    metadata: {
      requestedCount: number;
      successCount: number;
      failedCount: number;
      durationMs: number;
    };
  };
}

interface HealthResponse {
  status: string;
  serviceName: string;
  version: string;
  timestamp: string;
  checks: { name: string; status: string; latencyMs: number }[];
}

interface ErrorResponse {
  error: string;
}

describe('Internal Routes', () => {
  let app: FastifyInstance;
  let fakeFetcher: FakeLinkPreviewFetcher;
  let fakeSummaryService: FakePageSummaryService;

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = TEST_INTERNAL_TOKEN;

    fakeFetcher = new FakeLinkPreviewFetcher();
    fakeSummaryService = new FakePageSummaryService();

    const services: ServiceContainer = {
      linkPreviewFetcher: fakeFetcher,
      pageSummaryService: fakeSummaryService,
    };

    setServices(services);
    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    nock.cleanAll();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  describe('POST /internal/link-previews', () => {
    it('returns 401 when X-Internal-Auth header is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        payload: {
          urls: ['https://example.com'],
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload) as ErrorResponse;
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when X-Internal-Auth header has wrong value', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': 'wrong-token' },
        payload: {
          urls: ['https://example.com'],
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when INTEXURAOS_INTERNAL_AUTH_TOKEN is not configured', async () => {
      delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: ['https://example.com'],
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when urls array is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: [],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when urls array has more than 10 items', async () => {
      const tooManyUrls = Array.from({ length: 11 }, (_, i) => `https://example${String(i)}.com`);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: tooManyUrls,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when urls is a number', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: 123,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when urls is null', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: null,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when url format is invalid (schema validation)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: ['not-a-valid-url'],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('fetches single URL successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: ['https://example.com'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as LinkPreviewResponse;
      expect(body.success).toBe(true);
      expect(body.data.results).toHaveLength(1);
      expect(body.data.results[0]?.status).toBe('success');
      expect(body.data.results[0]?.preview?.title).toBe('Test Title');
      expect(body.data.metadata.requestedCount).toBe(1);
      expect(body.data.metadata.successCount).toBe(1);
      expect(body.data.metadata.failedCount).toBe(0);
    });

    it('fetches multiple URLs successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: ['https://example1.com', 'https://example2.com', 'https://example3.com'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as LinkPreviewResponse;
      expect(body.data.results).toHaveLength(3);
      expect(body.data.metadata.requestedCount).toBe(3);
      expect(body.data.metadata.successCount).toBe(3);
      expect(body.data.metadata.failedCount).toBe(0);
    });

    it('handles non-HTTP protocol in route validation', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: ['ftp://example.com/file.txt'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as LinkPreviewResponse;
      expect(body.data.results[0]?.status).toBe('failed');
      expect(body.data.results[0]?.error?.code).toBe('INVALID_URL');
      expect(body.data.results[0]?.error?.message).toContain('unsupported protocol');
    });

    it('handles partial success with mixed results', async () => {
      fakeFetcher.setResultForUrl(
        'https://failing.com',
        err({ code: 'FETCH_FAILED', message: 'Network error' })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: ['https://success.com', 'https://failing.com'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as LinkPreviewResponse;
      expect(body.data.results).toHaveLength(2);
      expect(body.data.metadata.successCount).toBe(1);
      expect(body.data.metadata.failedCount).toBe(1);

      const successResult = body.data.results.find((r) => r.url === 'https://success.com');
      const failedResult = body.data.results.find((r) => r.url === 'https://failing.com');

      expect(successResult?.status).toBe('success');
      expect(failedResult?.status).toBe('failed');
      expect(failedResult?.error?.code).toBe('FETCH_FAILED');
    });

    it('handles TIMEOUT error from fetcher', async () => {
      fakeFetcher.setResultForUrl(
        'https://slow.com',
        err({ code: 'TIMEOUT', message: 'Request timed out' })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: ['https://slow.com'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as LinkPreviewResponse;
      expect(body.data.results[0]?.status).toBe('failed');
      expect(body.data.results[0]?.error?.code).toBe('TIMEOUT');
    });

    it('handles TOO_LARGE error from fetcher', async () => {
      fakeFetcher.setResultForUrl(
        'https://large.com',
        err({ code: 'TOO_LARGE', message: 'Response too large' })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: ['https://large.com'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as LinkPreviewResponse;
      expect(body.data.results[0]?.status).toBe('failed');
      expect(body.data.results[0]?.error?.code).toBe('TOO_LARGE');
    });

    it('accepts optional timeoutMs parameter', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: ['https://example.com'],
          timeoutMs: 3000,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns durationMs in metadata', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: ['https://example.com'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as LinkPreviewResponse;
      expect(typeof body.data.metadata.durationMs).toBe('number');
      expect(body.data.metadata.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('handles maximum allowed URLs (10)', async () => {
      const maxUrls = Array.from({ length: 10 }, (_, i) => `https://example${String(i)}.com`);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: maxUrls,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as LinkPreviewResponse;
      expect(body.data.results).toHaveLength(10);
      expect(body.data.metadata.requestedCount).toBe(10);
    });

    it('handles HTTP URLs', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/link-previews',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          urls: ['http://example.com'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as LinkPreviewResponse;
      expect(body.data.results[0]?.status).toBe('success');
    });
  });

  describe('POST /internal/page-summaries', () => {
    interface PageSummaryResponse {
      success: boolean;
      data: {
        result: {
          url: string;
          status: 'success' | 'failed';
          summary?: {
            url: string;
            summary: string;
            wordCount: number;
            estimatedReadingMinutes: number;
          };
          error?: {
            code: string;
            message: string;
          };
        };
        metadata: {
          durationMs: number;
        };
      };
    }

    it('returns 401 when X-Internal-Auth header is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        payload: {
          url: 'https://example.com',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload) as ErrorResponse;
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when X-Internal-Auth header has wrong value', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': 'wrong-token' },
        payload: {
          url: 'https://example.com',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when url is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when url format is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'not-a-valid-url',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('summarizes page successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com/article',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as PageSummaryResponse;
      expect(body.success).toBe(true);
      expect(body.data.result.status).toBe('success');
      expect(body.data.result.summary?.summary).toBe('Test summary of the page content.');
      expect(body.data.result.summary?.wordCount).toBe(8);
      expect(typeof body.data.metadata.durationMs).toBe('number');
    });

    it('accepts optional maxSentences parameter', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com',
          maxSentences: 10,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(fakeSummaryService.calls[0]?.options?.maxSentences).toBe(10);
    });

    it('accepts optional maxReadingMinutes parameter', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com',
          maxReadingMinutes: 5,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(fakeSummaryService.calls[0]?.options?.maxReadingMinutes).toBe(5);
    });

    it('handles INVALID_URL for non-HTTP protocols', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'ftp://example.com/file.txt',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as PageSummaryResponse;
      expect(body.data.result.status).toBe('failed');
      expect(body.data.result.error?.code).toBe('INVALID_URL');
    });

    it('handles NO_CONTENT error from summary service', async () => {
      fakeSummaryService.setFailNext('NO_CONTENT', 'No extractable content');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com/empty',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as PageSummaryResponse;
      expect(body.data.result.status).toBe('failed');
      expect(body.data.result.error?.code).toBe('NO_CONTENT');
    });

    it('handles API_ERROR from summary service', async () => {
      fakeSummaryService.setFailNext('API_ERROR', 'External API failure');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com/error',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as PageSummaryResponse;
      expect(body.data.result.status).toBe('failed');
      expect(body.data.result.error?.code).toBe('API_ERROR');
    });

    it('handles TIMEOUT error from summary service', async () => {
      fakeSummaryService.setFailNext('TIMEOUT', 'Request timed out');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com/slow',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as PageSummaryResponse;
      expect(body.data.result.status).toBe('failed');
      expect(body.data.result.error?.code).toBe('TIMEOUT');
    });

  });

  describe('GET /health', () => {
    it('returns health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as HealthResponse;
      expect(body.status).toBe('ok');
      expect(body.serviceName).toBe('web-agent');
      expect(body.version).toBe('1.0.0');
      expect(body.timestamp).toBeDefined();
      expect(body.checks).toBeInstanceOf(Array);
    });
  });

  describe('GET /openapi.json', () => {
    it('returns OpenAPI spec', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { openapi: string; info: { title: string } };
      expect(body.openapi).toBe('3.1.1');
      expect(body.info.title).toBe('web-agent');
    });
  });
});
