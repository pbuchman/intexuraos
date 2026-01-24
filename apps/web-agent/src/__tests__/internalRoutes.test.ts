import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import nock from 'nock';
import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { GenerateResult, LLMError } from '@intexuraos/llm-factory';
import { buildServer } from '../server.js';
import { resetServices, setServices, type ServiceContainer } from '../services.js';
import { createLlmSummarizer } from '../infra/pagesummary/llmSummarizer.js';
import {
  FakeLinkPreviewFetcher,
  FakePageContentFetcher,
  FakeLlmSummarizer,
  FakeUserServiceClient,
  FakeLlmGenerateClient,
} from './fakes.js';

const fakeLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

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
  let fakePageContentFetcher: FakePageContentFetcher;
  let fakeLlmSummarizer: FakeLlmSummarizer;
  let fakeUserServiceClient: FakeUserServiceClient;

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
    fakePageContentFetcher = new FakePageContentFetcher();
    fakeLlmSummarizer = new FakeLlmSummarizer();
    fakeUserServiceClient = new FakeUserServiceClient();

    const services: ServiceContainer = {
      linkPreviewFetcher: fakeFetcher,
      pageContentFetcher: fakePageContentFetcher,
      llmSummarizer: fakeLlmSummarizer,
      userServiceClient: fakeUserServiceClient,
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

    const testUserId = 'test-user-123';

    it('returns 401 when X-Internal-Auth header is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        payload: {
          url: 'https://example.com',
          userId: testUserId,
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
          userId: testUserId,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when url is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          userId: testUserId,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when userId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com',
        },
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
          userId: testUserId,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('summarizes page successfully with userId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com/article',
          userId: testUserId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as PageSummaryResponse;
      expect(body.success).toBe(true);
      expect(body.data.result.status).toBe('success');
      expect(body.data.result.summary?.summary).toBe('This is a clean summary.');
      expect(body.data.result.summary?.wordCount).toBe(5);
      expect(typeof body.data.metadata.durationMs).toBe('number');

      // Verify the flow: content fetch, user service, summarization
      expect(fakePageContentFetcher.getFetchCalls()).toEqual(['https://example.com/article']);
    });

    it('accepts optional maxSentences parameter', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com',
          userId: testUserId,
          maxSentences: 10,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(fakeLlmSummarizer.getSummarizeCalls()[0]?.options?.maxSentences).toBe(10);
    });

    it('accepts optional maxReadingMinutes parameter', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com',
          userId: testUserId,
          maxReadingMinutes: 5,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(fakeLlmSummarizer.getSummarizeCalls()[0]?.options?.maxReadingMinutes).toBe(5);
    });

    it('handles INVALID_URL for non-HTTP protocols', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'ftp://example.com/file.txt',
          userId: testUserId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as PageSummaryResponse;
      expect(body.data.result.status).toBe('failed');
      expect(body.data.result.error?.code).toBe('INVALID_URL');
    });

    it('handles NO_CONTENT error from page content fetcher', async () => {
      fakePageContentFetcher.setFailNext('NO_CONTENT');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com/empty',
          userId: testUserId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as PageSummaryResponse;
      expect(body.data.result.status).toBe('failed');
      expect(body.data.result.error?.code).toBe('NO_CONTENT');
    });

    it('handles API_ERROR from page content fetcher', async () => {
      fakePageContentFetcher.setFailNext('API_ERROR');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com/error',
          userId: testUserId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as PageSummaryResponse;
      expect(body.data.result.status).toBe('failed');
      expect(body.data.result.error?.code).toBe('API_ERROR');
    });

    it('handles NO_API_KEY error from user service', async () => {
      fakeUserServiceClient.setFailNext('NO_API_KEY', 'No API key configured for Google');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com',
          userId: testUserId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as PageSummaryResponse;
      expect(body.data.result.status).toBe('failed');
      expect(body.data.result.error?.code).toBe('API_ERROR');
      expect(body.data.result.error?.message).toContain('No API key');
    });

    it('handles API_ERROR from LLM summarizer', async () => {
      fakeLlmSummarizer.setShouldFail(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com',
          userId: testUserId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as PageSummaryResponse;
      expect(body.data.result.status).toBe('failed');
      expect(body.data.result.error?.code).toBe('API_ERROR');
    });

    it('returns durationMs in metadata', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com',
          userId: testUserId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as PageSummaryResponse;
      expect(typeof body.data.metadata.durationMs).toBe('number');
      expect(body.data.metadata.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('triggers repair and succeeds when LLM returns invalid JSON', async () => {
      // Setup fake LLM client to return JSON first, then valid summary
      const fakeLlm = new FakeLlmGenerateClient();
      let callCount = 0;
      const mockUsage = { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 };
      fakeLlm.generate = async (): Promise<Result<GenerateResult, LLMError>> => {
        callCount++;
        if (callCount === 1) {
          return ok({ content: '[{"summary": "invalid json"}]', usage: mockUsage });
        }
        return ok({ content: 'Repaired valid summary text.', usage: mockUsage });
      };

      const fakeUserService = new FakeUserServiceClient();
      fakeUserService.setLlmClient(fakeLlm);

      setServices({
        linkPreviewFetcher: fakeFetcher,
        pageContentFetcher: fakePageContentFetcher,
        llmSummarizer: createLlmSummarizer(fakeLogger as unknown as Logger),
        userServiceClient: fakeUserService,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/page-summaries',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          url: 'https://example.com',
          userId: testUserId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as PageSummaryResponse;
      expect(body.data.result.status).toBe('success');
      if (body.data.result.summary) {
        expect(body.data.result.summary.summary).toBe('Repaired valid summary text.');
        expect(body.data.result.summary.summary).not.toContain('[{');
      }
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
