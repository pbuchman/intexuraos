import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import type { UsageLogParams } from '../usageLogger.js';
import { HttpInternalAuthUsageSink } from '../httpInternalAuthUsageSink.js';
import type { HttpInternalAuthUsageSinkConfig } from '../httpInternalAuthUsageSink.js';

const USAGE_SERVICE_URL = 'http://localhost:8132';
const INTERNAL_AUTH_TOKEN = 'test-internal-auth';

const fakeLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeConfig(
  overrides?: Partial<HttpInternalAuthUsageSinkConfig>
): HttpInternalAuthUsageSinkConfig {
  return {
    usageServiceUrl: USAGE_SERVICE_URL,
    internalAuthToken: INTERNAL_AUTH_TOKEN,
    service: 'research-agent',
    component: 'llm-client',
    logger: fakeLogger,
    ...overrides,
  };
}

interface CapturedEvent {
  schemaVersion: number;
  eventId: string;
  occurredAt: string;
  owner: { type: string; id: string };
  source: { service: string; component: string; client: string; environment: string };
  request: {
    provider: string;
    model: string;
    operation: string;
    success: boolean;
    durationMs: number;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
    thinkingTokens: number;
    webSearchCalls: number;
    groundingEnabled: boolean;
    imageCount: number;
  };
  cost: {
    billedUsd: number;
    providerReportedUsd: number | null;
    calculatedUsd: number | null;
    pricingSource: string;
  };
  correlation: {
    requestId: string | null;
    traceId: string | null;
    taskId: string | null;
    researchId: string | null;
    attempt: number | null;
    sessionId: string | null;
  };
  error: { code: string | null; message: string | null } | null;
}

interface CapturedBody {
  schemaVersion: number;
  events: CapturedEvent[];
}

function parseBody(raw: string | undefined): CapturedBody {
  return JSON.parse(raw ?? '{}') as CapturedBody;
}

const baseParams: UsageLogParams = {
  userId: 'user-123',
  provider: LlmProviders.Google,
  model: LlmModels.Gemini25Flash,
  callType: 'research',
  usage: {
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    costUsd: 0.0105,
    cacheTokens: 200,
    reasoningTokens: 50,
    webSearchCalls: 3,
    groundingEnabled: true,
    thinkingTokens: 10,
  },
  success: true,
};

describe('HttpInternalAuthUsageSink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    nock.cleanAll();
  });

  describe('happy path', () => {
    it('sends POST to /internal/usage/events with correct body and headers', async () => {
      const config = makeConfig();
      const sink = new HttpInternalAuthUsageSink(config);

      let capturedBody: string | undefined;
      let capturedHeaders: Record<string, string | string[] | undefined> | undefined;

      const scope = nock(USAGE_SERVICE_URL)
        .post('/internal/usage/events', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          return true;
        })
        .reply(function () {
          capturedHeaders = this.req.headers;
          return [200, { accepted: 1, duplicates: 0, rejected: [] }];
        });

      await sink.log(baseParams);

      expect(scope.isDone()).toBe(true);

      // Verify headers — no HMAC signature headers
      expect(capturedHeaders?.['x-internal-auth']).toBe(INTERNAL_AUTH_TOKEN);
      expect(capturedHeaders?.['content-type']).toBe('application/json');
      expect(capturedHeaders?.['x-request-signature']).toBeUndefined();
      expect(capturedHeaders?.['x-request-timestamp']).toBeUndefined();

      // Verify body structure
      const parsedBody = parseBody(capturedBody);
      expect(parsedBody.schemaVersion).toBe(1);
      expect(parsedBody.events).toHaveLength(1);

      const event = parsedBody.events[0];
      expect(event).toBeDefined();
      expect(event?.schemaVersion).toBe(1);
      expect(event?.eventId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(event?.occurredAt).toBe('2025-06-15T12:00:00.000Z');
      expect(event?.owner).toEqual({ type: 'system', id: 'user-123' });
      expect(event?.source).toEqual({
        service: 'research-agent',
        component: 'llm-client',
        client: LlmModels.Gemini25Flash,
        environment: 'dev',
      });
      expect(event?.request).toEqual({
        provider: LlmProviders.Google,
        model: LlmModels.Gemini25Flash,
        operation: 'research',
        success: true,
        durationMs: 0,
      });
      expect(event?.usage).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cacheReadTokens: 200,
        cacheWriteTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 50,
        thinkingTokens: 10,
        webSearchCalls: 3,
        groundingEnabled: true,
        imageCount: 0,
      });
      expect(event?.cost).toEqual({
        billedUsd: 0.0105,
        providerReportedUsd: null,
        calculatedUsd: 0.0105,
        pricingSource: 'calculated',
      });
      expect(event?.correlation).toEqual({
        requestId: null,
        traceId: null,
        taskId: null,
        researchId: null,
        attempt: null,
        sessionId: null,
      });
      expect(event?.error).toBeNull();
    });

    it('defaults optional NormalizedUsage fields to 0 or false', async () => {
      const config = makeConfig();
      const sink = new HttpInternalAuthUsageSink(config);

      let capturedBody: string | undefined;

      const scope = nock(USAGE_SERVICE_URL)
        .post('/internal/usage/events', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          return true;
        })
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });

      const minimalParams: UsageLogParams = {
        userId: 'user-456',
        provider: LlmProviders.OpenAI,
        model: 'gpt-4o',
        callType: 'generate',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          costUsd: 0.005,
        },
        success: true,
      };

      await sink.log(minimalParams);

      expect(scope.isDone()).toBe(true);

      const parsedBody = parseBody(capturedBody);
      const event = parsedBody.events[0];
      expect(event).toBeDefined();
      expect(event?.usage.cacheReadTokens).toBe(0);
      expect(event?.usage.cacheWriteTokens).toBe(0);
      expect(event?.usage.cachedTokens).toBe(0);
      expect(event?.usage.reasoningTokens).toBe(0);
      expect(event?.usage.thinkingTokens).toBe(0);
      expect(event?.usage.webSearchCalls).toBe(0);
      expect(event?.usage.groundingEnabled).toBe(false);
      expect(event?.usage.imageCount).toBe(0);
    });

    it('maps error fields when success is false', async () => {
      const config = makeConfig();
      const sink = new HttpInternalAuthUsageSink(config);

      let capturedBody: string | undefined;

      nock(USAGE_SERVICE_URL)
        .post('/internal/usage/events', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          return true;
        })
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });

      await sink.log({
        ...baseParams,
        success: false,
        errorMessage: 'Rate limit exceeded',
      });

      const parsedBody = parseBody(capturedBody);
      const event = parsedBody.events[0];
      expect(event).toBeDefined();
      expect(event?.request.success).toBe(false);
      expect(event?.error).toEqual({ code: null, message: 'Rate limit exceeded' });
    });
  });

  describe('non-fatal error handling', () => {
    it('logs warning and does not throw on 5xx response', async () => {
      const config = makeConfig();
      const sink = new HttpInternalAuthUsageSink(config);

      const scope = nock(USAGE_SERVICE_URL)
        .post('/internal/usage/events')
        .reply(500, { error: 'Internal Server Error' });

      await expect(sink.log(baseParams)).resolves.toBeUndefined();

      expect(scope.isDone()).toBe(true);
      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
        }),
        expect.stringContaining('Usage ingest')
      );
    });

    it('logs warning and does not throw on network error', async () => {
      const config = makeConfig();
      const sink = new HttpInternalAuthUsageSink(config);

      const scope = nock(USAGE_SERVICE_URL)
        .post('/internal/usage/events')
        .replyWithError('ECONNREFUSED');

      await expect(sink.log(baseParams)).resolves.toBeUndefined();

      expect(scope.isDone()).toBe(true);
      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(String),
        }),
        expect.stringContaining('Usage ingest')
      );
    });
  });
});
