import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { LegacyGoogleModels, LlmProviders } from '@intexuraos/llm-contract';
import type { UsageLogParams } from '../usageLogger.js';
import { HttpInternalAuthUsageSink } from '../httpInternalAuthUsageSink.js';
import type { HttpInternalAuthUsageSinkConfig } from '../httpInternalAuthUsageSink.js';
import { clearUsageSinkRegistry } from '../usageSinkRegistry.js';

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
  provider: LlmProviders.Google,
  model: LegacyGoogleModels.Gemini25Flash,
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
  durationMs: 0,
};

describe('HttpInternalAuthUsageSink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00.000Z'));
    clearUsageSinkRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
    nock.cleanAll();
    clearUsageSinkRegistry();
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
      await sink.flushSync();

      expect(scope.isDone()).toBe(true);

      // Verify headers — no HMAC signature headers
      expect(capturedHeaders?.['x-internal-auth']).toBe(INTERNAL_AUTH_TOKEN);
      expect(capturedHeaders?.['content-type']).toBe('application/json');
      expect(capturedHeaders?.['x-request-signature']).toBeUndefined();
      expect(capturedHeaders?.['x-request-timestamp']).toBeUndefined();

      // Verify body structure
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
        service: 'research-agent',
        component: 'llm-client',
        client: 'llm-client',
        environment: 'dev',
      });
      expect(event?.request).toEqual({
        provider: LlmProviders.Google,
        model: LegacyGoogleModels.Gemini25Flash,
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

    it('forwards params.correlation overrides into the emitted event', async () => {
      const config = makeConfig({ getCorrelationTaskId: () => 'sink-task' });
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

    it('falls back to sink-level taskId when params.correlation omits taskId', async () => {
      const config = makeConfig({ getCorrelationTaskId: () => 'sink-task' });
      const sink = new HttpInternalAuthUsageSink(config);

      let capturedBody: string | undefined;

      nock(USAGE_SERVICE_URL)
        .post('/internal/usage/events', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          return true;
        })
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });

      await sink.log(baseParams);
      await sink.flushSync();

      const parsedBody = parseBody(capturedBody);
      const event = parsedBody.events[0];
      expect(event?.correlation.taskId).toBe('sink-task');
      expect(event?.correlation.researchId).toBeNull();
      expect(event?.correlation.sessionId).toBeNull();
      expect(event?.correlation.requestId).toBeNull();
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
      await sink.flushSync();

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

      await sink.log(baseParams);
      // flushSync rethrows on non-2xx — that's the contract for shutdown callers.
      await expect(sink.flushSync()).rejects.toThrow();

      expect(scope.isDone()).toBe(true);
      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
        }),
        expect.stringContaining('Usage ingest')
      );
    });

    it('does not throw from log() when timer-driven flush hits a 5xx', async () => {
      vi.useRealTimers();
      const config = makeConfig({ flushIntervalMs: 5 });
      const sink = new HttpInternalAuthUsageSink(config);

      const scope = nock(USAGE_SERVICE_URL)
        .post('/internal/usage/events')
        .reply(500, { error: 'Internal Server Error' });

      await expect(sink.log(baseParams)).resolves.toBeUndefined();
      // Wait for the timer + fetch round-trip on real timers.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(scope.isDone()).toBe(true);
      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
        }),
        expect.stringContaining('Usage ingest')
      );
    });

    it('logs warning and does not throw from log() on network error', async () => {
      vi.useRealTimers();
      const config = makeConfig({ flushIntervalMs: 5 });
      const sink = new HttpInternalAuthUsageSink(config);

      const scope = nock(USAGE_SERVICE_URL)
        .post('/internal/usage/events')
        .replyWithError('ECONNREFUSED');

      await expect(sink.log(baseParams)).resolves.toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(scope.isDone()).toBe(true);
      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(String),
        }),
        expect.stringContaining('Usage ingest')
      );
    });

    it('flushSync() rethrows on network error', async () => {
      const config = makeConfig();
      const sink = new HttpInternalAuthUsageSink(config);

      nock(USAGE_SERVICE_URL).post('/internal/usage/events').replyWithError('ECONNREFUSED');

      await sink.log(baseParams);
      await expect(sink.flushSync()).rejects.toThrow();
    });
  });

  describe('batching', () => {
    it('coalesces multiple events within the flush window into a single POST', async () => {
      const config = makeConfig({ flushIntervalMs: 500, maxBatchSize: 100 });
      const sink = new HttpInternalAuthUsageSink(config);

      let capturedBody: string | undefined;
      let postCount = 0;

      const scope = nock(USAGE_SERVICE_URL)
        .post('/internal/usage/events', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          postCount++;
          return true;
        })
        .reply(200, { accepted: 3, duplicates: 0, rejected: [] });

      await sink.log(baseParams);
      await sink.log(baseParams);
      await sink.log(baseParams);

      // Before the timer fires, no POST should have happened.
      expect(postCount).toBe(0);

      // Fire the flush window.
      await vi.advanceTimersByTimeAsync(500);

      expect(scope.isDone()).toBe(true);
      expect(postCount).toBe(1);

      const parsed = parseBody(capturedBody);
      expect(parsed.events).toHaveLength(3);
    });

    it('flushes immediately when the buffer reaches maxBatchSize', async () => {
      vi.useRealTimers();
      const config = makeConfig({ flushIntervalMs: 60_000, maxBatchSize: 2 });
      const sink = new HttpInternalAuthUsageSink(config);

      let capturedBody: string | undefined;
      let postCount = 0;

      const scope = nock(USAGE_SERVICE_URL)
        .post('/internal/usage/events', (body: unknown) => {
          capturedBody = JSON.stringify(body);
          postCount++;
          return true;
        })
        .reply(200, { accepted: 2, duplicates: 0, rejected: [] });

      await sink.log(baseParams);
      await sink.log(baseParams);
      // Wait for the in-flight POST to land. The buffer-full path fires the
      // flush asynchronously and we deliberately don't await it from log().
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(scope.isDone()).toBe(true);
      expect(postCount).toBe(1);
      const parsed = parseBody(capturedBody);
      expect(parsed.events).toHaveLength(2);
    });

    it('flushSync() resolves cleanly when buffer is empty', async () => {
      const config = makeConfig();
      const sink = new HttpInternalAuthUsageSink(config);
      await expect(sink.flushSync()).resolves.toBeUndefined();
    });

    it('clears the buffer after flushSync()', async () => {
      const config = makeConfig();
      const sink = new HttpInternalAuthUsageSink(config);

      const scope = nock(USAGE_SERVICE_URL)
        .post('/internal/usage/events')
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });

      await sink.log(baseParams);
      await sink.flushSync();
      expect(scope.isDone()).toBe(true);

      // Second flush with no new events: no further POST.
      await expect(sink.flushSync()).resolves.toBeUndefined();
      expect(nock.pendingMocks()).toHaveLength(0);
    });
  });

  describe('async-timing branches', () => {
    // Covers httpInternalAuthUsageSink.ts:119 — `if (this.inFlight !== null)`
    // in flushSync. The timer fires, flushBuffered starts a POST, and before it
    // resolves we call flushSync — which must await the in-flight promise.
    it('flushSync awaits an already-in-flight timer-driven flush', async () => {
      vi.useRealTimers();
      const config = makeConfig({ flushIntervalMs: 5, maxBatchSize: 100 });
      const sink = new HttpInternalAuthUsageSink(config);

      let postCount = 0;
      const scope = nock(USAGE_SERVICE_URL)
        .post('/internal/usage/events')
        // delay the response so flushSync overlaps the in-flight POST
        .delay(50)
        .reply(() => {
          postCount += 1;
          return [200, { accepted: 1, duplicates: 0, rejected: [] }];
        });

      await sink.log(baseParams);
      // Let the 5ms timer fire, starting flushBuffered → inFlight = promise
      await new Promise((resolve) => setTimeout(resolve, 10));
      // Now inFlight !== null; flushSync should await it (no double-POST).
      await sink.flushSync();

      expect(scope.isDone()).toBe(true);
      expect(postCount).toBe(1);
    });

    // Covers httpInternalAuthUsageSink.ts:139 — `if (this.buffer.length === 0)`
    // early-return in flushBuffered. Reachable when flushBuffered runs after
    // the buffer was already drained (timer-after-flushSync race). Invoked via
    // a typed cast since the natural racing path is timing-fragile.
    it('flushBuffered early-returns when buffer is empty', async () => {
      vi.useRealTimers();
      const config = makeConfig();
      const sink = new HttpInternalAuthUsageSink(config);

      // No nock interceptor: any HTTP call would error out.
      await (sink as unknown as { flushBuffered(): Promise<void> }).flushBuffered();
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    // Covers httpInternalAuthUsageSink.ts:146 — the `if (this.inFlight === promise)`
    // FALSE branch. Concurrent flushes overlap: flush A's `.finally` runs
    // AFTER flush B has already overwritten `inFlight`, so the guard must
    // skip the `inFlight = null` assignment.
    it('finally guard skips reset when a newer flush replaced inFlight', async () => {
      vi.useRealTimers();
      const config = makeConfig({ flushIntervalMs: 60_000, maxBatchSize: 100 });
      const sink = new HttpInternalAuthUsageSink(config);

      // Two interceptors; the first delays so it's still in flight when we
      // start the second.
      const scopeA = nock(USAGE_SERVICE_URL)
        .post('/internal/usage/events')
        .delay(40)
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });
      const scopeB = nock(USAGE_SERVICE_URL)
        .post('/internal/usage/events')
        .reply(200, { accepted: 1, duplicates: 0, rejected: [] });

      // Kick off flush A directly (sets inFlight = promiseA).
      const flushA = (sink as unknown as { flushBuffered(): Promise<void> }).flushBuffered.bind(
        sink
      );
      await sink.log(baseParams);
      const aDone = flushA();
      // While A is in flight, kick off flush B (overwrites inFlight = promiseB).
      await sink.log(baseParams);
      const bDone = flushA();

      await Promise.all([aDone, bDone]);

      expect(scopeA.isDone()).toBe(true);
      expect(scopeB.isDone()).toBe(true);
    });
  });
});
