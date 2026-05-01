import { createHmac } from 'node:crypto';
import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
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
    providerReportedUsd: number | null;
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
  provider: LlmProviders.Anthropic,
  model: LlmModels.ClaudeSonnet46,
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
  durationMs: 0,
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
      await sink.flushSync();

      expect(scope.isDone()).toBe(true);

      const parsedBody = parseBody(capturedBody);
      expect(parsedBody.schemaVersion).toBe(2);
      expect(parsedBody.events).toHaveLength(1);

      const event = parsedBody.events[0];
      expect(event).toBeDefined();
      expect(event?.schemaVersion).toBe(2);
      expect(event?.eventId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(event?.occurredAt).toBe('2025-06-15T12:00:00.000Z');
      expect(event?.owner).toEqual({ type: 'system', id: 'user-123' });
      expect(event?.source).toEqual({
        service: 'orchestrator',
        component: 'agent-loop',
        client: 'agent-loop',
        environment: 'dev',
      });
      expect(event?.request).toEqual({
        provider: LlmProviders.Anthropic,
        model: LlmModels.ClaudeSonnet46,
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
        providerReportedUsd: null,
        pricingSource: 'pending',
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
        durationMs: 0,
      };

      await sink.log(minimalParams);
      await sink.flushSync();

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
      await sink.flushSync();

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
      await sink.flushSync();

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
      await sink.flushSync();

      const parsedBody = parseBody(capturedBody);
      expect(parsedBody.events[0]?.error).toEqual({ code: null, message: null });
    });
  });

  describe('correlation overrides', () => {
    it('populates correlation.taskId from getCorrelationTaskId callback', async () => {
      const config = makeConfig({
        getCorrelationTaskId: () => 'task_abc-123',
      });
      const sink = new HttpWebhookUsageSink(config);

      let capturedBody: string | undefined;

      const scope = nock('http://localhost:9999')
        .post('/webhook/usage', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          return true;
        })
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });

      await sink.log(baseParams);
      await sink.flushSync();

      expect(scope.isDone()).toBe(true);

      const parsedBody = parseBody(capturedBody);
      const event = parsedBody.events[0];
      expect(event).toBeDefined();
      expect(event?.correlation.taskId).toBe('task_abc-123');
    });

    it('defaults correlation.taskId to null when getCorrelationTaskId returns null', async () => {
      const config = makeConfig({
        getCorrelationTaskId: () => null,
      });
      const sink = new HttpWebhookUsageSink(config);

      let capturedBody: string | undefined;

      nock('http://localhost:9999')
        .post('/webhook/usage', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          return true;
        })
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });

      await sink.log(baseParams);
      await sink.flushSync();

      const parsedBody = parseBody(capturedBody);
      expect(parsedBody.events[0]?.correlation.taskId).toBeNull();
    });

    it('defaults correlation.taskId to null when getCorrelationTaskId is not provided', async () => {
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
      await sink.flushSync();

      const parsedBody = parseBody(capturedBody);
      expect(parsedBody.events[0]?.correlation.taskId).toBeNull();
    });

    it('forwards params.correlation overrides (researchId/sessionId/requestId/taskId) into the event', async () => {
      const config = makeConfig({ getCorrelationTaskId: () => 'sink-task' });
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
        correlation: {
          taskId: 'override-task',
          sessionId: 'sess-1',
          requestId: 'req-1',
          researchId: 'research-1',
        },
      });
      await sink.flushSync();

      const parsedBody = parseBody(capturedBody);
      const event = parsedBody.events[0];
      expect(event?.correlation).toEqual({
        requestId: 'req-1',
        traceId: null,
        taskId: 'override-task',
        researchId: 'research-1',
        attempt: null,
        sessionId: 'sess-1',
      });
    });
  });

  describe('non-fatal error handling', () => {
    it('flushSync() rethrows on 5xx response', async () => {
      const config = makeConfig();
      const sink = new HttpWebhookUsageSink(config);

      const scope = nock('http://localhost:9999')
        .post('/webhook/usage')
        .reply(500, { error: 'Internal Server Error' });

      await sink.log(baseParams);
      await expect(sink.flushSync()).rejects.toThrow();

      expect(scope.isDone()).toBe(true);
      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
        }),
        expect.stringContaining('Usage webhook')
      );
    });

    it('does not throw from log() when timer-driven flush hits a 5xx', async () => {
      vi.useRealTimers();
      const config = makeConfig({ flushIntervalMs: 5 });
      const sink = new HttpWebhookUsageSink(config);

      const scope = nock('http://localhost:9999')
        .post('/webhook/usage')
        .reply(500, { error: 'Internal Server Error' });

      await expect(sink.log(baseParams)).resolves.toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(scope.isDone()).toBe(true);
      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
        }),
        expect.stringContaining('Usage webhook')
      );
    });

    it('logs warning and does not throw from log() on network error', async () => {
      vi.useRealTimers();
      const config = makeConfig({ flushIntervalMs: 5 });
      const sink = new HttpWebhookUsageSink(config);

      const scope = nock('http://localhost:9999')
        .post('/webhook/usage')
        .replyWithError('ECONNREFUSED');

      await expect(sink.log(baseParams)).resolves.toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(scope.isDone()).toBe(true);
      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(String),
        }),
        expect.stringContaining('Usage webhook')
      );
    });

    it('flushSync() rethrows on network error', async () => {
      const config = makeConfig();
      const sink = new HttpWebhookUsageSink(config);

      nock('http://localhost:9999').post('/webhook/usage').replyWithError('ECONNREFUSED');

      await sink.log(baseParams);
      await expect(sink.flushSync()).rejects.toThrow();
    });
  });

  describe('batching', () => {
    it('coalesces multiple events within the flush window into a single POST', async () => {
      const config = makeConfig({ flushIntervalMs: 500, maxBatchSize: 100 });
      const sink = new HttpWebhookUsageSink(config);

      let capturedBody: string | undefined;
      let postCount = 0;

      const scope = nock('http://localhost:9999')
        .post('/webhook/usage', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          postCount++;
          return true;
        })
        .reply(200, { accepted: 3, duplicates: 0, rejected: [] });

      await sink.log(baseParams);
      await sink.log(baseParams);
      await sink.log(baseParams);

      expect(postCount).toBe(0);

      await vi.advanceTimersByTimeAsync(500);

      expect(scope.isDone()).toBe(true);
      expect(postCount).toBe(1);

      const parsed = parseBody(capturedBody);
      expect(parsed.events).toHaveLength(3);
    });

    it('flushes immediately when the buffer reaches maxBatchSize', async () => {
      vi.useRealTimers();
      const config = makeConfig({ flushIntervalMs: 60_000, maxBatchSize: 2 });
      const sink = new HttpWebhookUsageSink(config);

      let capturedBody: string | undefined;
      let postCount = 0;

      const scope = nock('http://localhost:9999')
        .post('/webhook/usage', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          postCount++;
          return true;
        })
        .reply(200, { accepted: 2, duplicates: 0, rejected: [] });

      await sink.log(baseParams);
      await sink.log(baseParams);
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(scope.isDone()).toBe(true);
      expect(postCount).toBe(1);
      const parsed = parseBody(capturedBody);
      expect(parsed.events).toHaveLength(2);
    });

    it('flushSync() resolves cleanly when buffer is empty', async () => {
      const config = makeConfig();
      const sink = new HttpWebhookUsageSink(config);
      await expect(sink.flushSync()).resolves.toBeUndefined();
    });

    it('clears the buffer after flushSync()', async () => {
      const config = makeConfig();
      const sink = new HttpWebhookUsageSink(config);

      const scope = nock('http://localhost:9999')
        .post('/webhook/usage')
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });

      await sink.log(baseParams);
      await sink.flushSync();
      expect(scope.isDone()).toBe(true);

      await expect(sink.flushSync()).resolves.toBeUndefined();
      expect(nock.pendingMocks()).toHaveLength(0);
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
      await sink.flushSync();

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
      await sink.flushSync();

      const parsedBody = parseBody(capturedBody);
      expect(parsedBody.events[0]?.source.environment).toBe('dev');

      if (originalNodeEnv === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = originalNodeEnv;
      }
    });
  });

  describe('async-timing branches', () => {
    // Covers httpWebhookUsageSink.ts:118 — `if (this.inFlight !== null)` in
    // flushSync. The timer fires, flushBuffered starts a POST, and before it
    // resolves we call flushSync — which must await the in-flight promise.
    it('flushSync awaits an already-in-flight timer-driven flush', async () => {
      vi.useRealTimers();
      const config = makeConfig({ flushIntervalMs: 5, maxBatchSize: 100 });
      const sink = new HttpWebhookUsageSink(config);

      let postCount = 0;
      const scope = nock('http://localhost:9999')
        .post('/webhook/usage')
        .delay(50)
        .reply(() => {
          postCount += 1;
          return [200, { accepted: 1, duplicates: 0, rejected: [] }];
        });

      await sink.log(baseParams);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await sink.flushSync();

      expect(scope.isDone()).toBe(true);
      expect(postCount).toBe(1);
    });

    // Covers httpWebhookUsageSink.ts:136 — `if (this.buffer.length === 0)`
    // early-return in flushBuffered.
    it('flushBuffered early-returns when buffer is empty', async () => {
      vi.useRealTimers();
      const config = makeConfig();
      const sink = new HttpWebhookUsageSink(config);
      await (sink as unknown as { flushBuffered(): Promise<void> }).flushBuffered();
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    // Covers httpWebhookUsageSink.ts:143 — the FALSE arm of the
    // `if (this.inFlight === wrapped)` guard inside the finally callback.
    // Concurrent flushes overlap so that A's finally runs after B has
    // already overwritten inFlight.
    it('finally guard skips reset when a newer flush replaced inFlight', async () => {
      vi.useRealTimers();
      const config = makeConfig({ flushIntervalMs: 60_000, maxBatchSize: 100 });
      const sink = new HttpWebhookUsageSink(config);

      const scopeA = nock('http://localhost:9999')
        .post('/webhook/usage')
        .delay(40)
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });
      const scopeB = nock('http://localhost:9999')
        .post('/webhook/usage')
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });

      const flushA = (sink as unknown as { flushBuffered(): Promise<void> }).flushBuffered.bind(
        sink
      );
      await sink.log(baseParams);
      const aDone = flushA();
      await sink.log(baseParams);
      const bDone = flushA();

      await Promise.all([aDone, bDone]);

      expect(scopeA.isDone()).toBe(true);
      expect(scopeB.isDone()).toBe(true);
    });
  });
});
