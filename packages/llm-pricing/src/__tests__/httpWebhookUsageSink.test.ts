import { createHmac } from 'node:crypto';
import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import type { UsageLogParams } from '../usageLogger.js';
import { HttpWebhookUsageSink } from '../httpWebhookUsageSink.js';
import type { HttpWebhookUsageSinkConfig } from '../httpWebhookUsageSink.js';

const WEBHOOK_URL = 'http://localhost:9999/webhook/usage';
const WEBHOOK_SECRET = 'test-secret-key';
const INTERNAL_AUTH_TOKEN = 'test-internal-auth';

const fakeLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeConfig(overrides?: Partial<HttpWebhookUsageSinkConfig>): HttpWebhookUsageSinkConfig {
  return {
    webhookUrl: WEBHOOK_URL,
    webhookSecret: WEBHOOK_SECRET,
    internalAuthToken: INTERNAL_AUTH_TOKEN,
    service: 'orchestrator',
    component: 'agent-loop',
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
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  callType: 'research',
  usage: {
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    costUsd: 0.0105,
    cacheTokens: 200,
    reasoningTokens: 50,
    webSearchCalls: 3,
    groundingEnabled: false,
    thinkingTokens: 10,
  },
  success: true,
};

describe('HttpWebhookUsageSink', () => {
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
    it('sends correctly signed POST request with proper body and headers', async () => {
      const config = makeConfig();
      const sink = new HttpWebhookUsageSink(config);

      let capturedBody: string | undefined;
      let capturedHeaders: Record<string, string | string[] | undefined> | undefined;

      const scope = nock('http://localhost:9999')
        .post('/webhook/usage', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          return true;
        })
        .reply(function () {
          capturedHeaders = this.req.headers;
          return [200, { accepted: 1, duplicates: 0, rejected: [] }];
        });

      await sink.log(baseParams);

      expect(scope.isDone()).toBe(true);

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
        service: 'orchestrator',
        component: 'agent-loop',
        client: 'claude-sonnet-4-5',
        environment: 'dev',
      });
      expect(event?.request).toEqual({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
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
        groundingEnabled: false,
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

      // Verify HMAC signature
      const timestamp = String(Math.floor(new Date('2025-06-15T12:00:00.000Z').getTime() / 1000));
      const expectedBody = JSON.stringify(parsedBody);
      const expectedMessage = `${timestamp}.${expectedBody}`;
      const expectedSignature = createHmac('sha256', WEBHOOK_SECRET)
        .update(expectedMessage)
        .digest('hex');

      expect(capturedHeaders?.['x-request-timestamp']).toBe(timestamp);
      expect(capturedHeaders?.['x-request-signature']).toBe(expectedSignature);
      expect(capturedHeaders?.['x-internal-auth']).toBe(INTERNAL_AUTH_TOKEN);
      expect(capturedHeaders?.['content-type']).toBe('application/json');
    });

    it('defaults optional NormalizedUsage fields to 0 or false', async () => {
      const config = makeConfig();
      const sink = new HttpWebhookUsageSink(config);

      let capturedBody: string | undefined;

      const scope = nock('http://localhost:9999')
        .post('/webhook/usage', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          return true;
        })
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });

      const minimalParams: UsageLogParams = {
        userId: 'user-456',
        provider: 'openai',
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
      const sink = new HttpWebhookUsageSink(config);

      let capturedBody: string | undefined;

      const scope = nock('http://localhost:9999')
        .post('/webhook/usage', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          return true;
        })
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });

      await sink.log({
        ...baseParams,
        success: false,
        errorMessage: 'Rate limit exceeded',
      });

      expect(scope.isDone()).toBe(true);

      const parsedBody = parseBody(capturedBody);
      const event = parsedBody.events[0];
      expect(event).toBeDefined();
      expect(event?.request.success).toBe(false);
      expect(event?.error).toEqual({ code: null, message: 'Rate limit exceeded' });
    });

    it('sets error to null when success is true', async () => {
      const config = makeConfig();
      const sink = new HttpWebhookUsageSink(config);

      let capturedBody: string | undefined;

      nock('http://localhost:9999')
        .post('/webhook/usage', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          return true;
        })
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });

      await sink.log(baseParams);

      const parsedBody = parseBody(capturedBody);
      expect(parsedBody.events[0]?.error).toBeNull();
    });

    it('sets error message to null when errorMessage is undefined on failure', async () => {
      const config = makeConfig();
      const sink = new HttpWebhookUsageSink(config);

      let capturedBody: string | undefined;

      nock('http://localhost:9999')
        .post('/webhook/usage', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          return true;
        })
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });

      await sink.log({
        ...baseParams,
        success: false,
      });

      const parsedBody = parseBody(capturedBody);
      expect(parsedBody.events[0]?.error).toEqual({ code: null, message: null });
    });
  });

  describe('non-fatal error handling', () => {
    it('logs warning and does not throw on 5xx response', async () => {
      const config = makeConfig();
      const sink = new HttpWebhookUsageSink(config);

      const scope = nock('http://localhost:9999')
        .post('/webhook/usage')
        .reply(500, { error: 'Internal Server Error' });

      await expect(sink.log(baseParams)).resolves.toBeUndefined();

      expect(scope.isDone()).toBe(true);
      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
        }),
        expect.stringContaining('Usage webhook')
      );
    });

    it('logs warning and does not throw on network error', async () => {
      const config = makeConfig();
      const sink = new HttpWebhookUsageSink(config);

      const scope = nock('http://localhost:9999')
        .post('/webhook/usage')
        .replyWithError('ECONNREFUSED');

      await expect(sink.log(baseParams)).resolves.toBeUndefined();

      expect(scope.isDone()).toBe(true);
      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(String),
        }),
        expect.stringContaining('Usage webhook')
      );
    });
  });

  describe('environment detection', () => {
    it('sets environment to prod when NODE_ENV is production', async () => {
      const originalNodeEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'production';

      const config = makeConfig();
      const sink = new HttpWebhookUsageSink(config);

      let capturedBody: string | undefined;

      nock('http://localhost:9999')
        .post('/webhook/usage', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          return true;
        })
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });

      await sink.log(baseParams);

      const parsedBody = parseBody(capturedBody);
      expect(parsedBody.events[0]?.source.environment).toBe('prod');

      if (originalNodeEnv === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = originalNodeEnv;
      }
    });

    it('sets environment to dev when NODE_ENV is not production', async () => {
      const originalNodeEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'development';

      const config = makeConfig();
      const sink = new HttpWebhookUsageSink(config);

      let capturedBody: string | undefined;

      nock('http://localhost:9999')
        .post('/webhook/usage', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          return true;
        })
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });

      await sink.log(baseParams);

      const parsedBody = parseBody(capturedBody);
      expect(parsedBody.events[0]?.source.environment).toBe('dev');

      if (originalNodeEnv === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = originalNodeEnv;
      }
    });
  });
});
