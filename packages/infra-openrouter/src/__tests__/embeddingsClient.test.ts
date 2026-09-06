import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import type { Logger } from '@intexuraos/common-core';
import { FakeUsageSink } from '@intexuraos/llm-pricing';
import { createOpenRouterEmbeddingsClient, OPENROUTER_TEXT_EMBEDDING_3_SMALL } from '../index.js';

const API_BASE_URL = 'https://openrouter.ai';
const vector = (value: number): number[] =>
  Array.from({ length: OPENROUTER_TEXT_EMBEDDING_3_SMALL.dimensions }, () => value);

const logger: Logger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

describe('createOpenRouterEmbeddingsClient', () => {
  let usageSink: FakeUsageSink;

  beforeEach(() => {
    nock.disableNetConnect();
    nock.cleanAll();
    usageSink = new FakeUsageSink();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  function createClient(
    overrides: {
      maxAttempts?: number;
      retryBaseDelayMs?: number;
      timeoutMs?: number;
    } = {}
  ): ReturnType<typeof createOpenRouterEmbeddingsClient> {
    return createOpenRouterEmbeddingsClient({
      apiKey: 'or-test-key',
      userId: 'user-1',
      logger,
      usageSink,
      ...overrides,
    });
  }

  it('posts a single embedding request with the raw OpenRouter model and fixed dimensions', async () => {
    let body: unknown;
    nock(API_BASE_URL)
      .post('/api/v1/embeddings', (candidate) => {
        body = candidate;
        return true;
      })
      .matchHeader('authorization', 'Bearer or-test-key')
      .matchHeader('http-referer', 'https://intexuraos.cloud')
      .matchHeader('x-title', 'IntexuraOS')
      .reply(200, {
        data: [{ embedding: vector(0.1), index: 0, object: 'embedding' }],
        model: OPENROUTER_TEXT_EMBEDDING_3_SMALL.apiModelId,
        object: 'list',
        usage: { prompt_tokens: 3, total_tokens: 3, cost: 0.00001 },
      });

    const result = await createClient().embed('  hello world  ', {
      promptType: 'execution-memory-embedding',
      correlation: { taskId: 'task-1' },
    });

    expect(result).toEqual({ ok: true, value: vector(0.1) });
    expect(body).toEqual({
      model: OPENROUTER_TEXT_EMBEDDING_3_SMALL.apiModelId,
      input: 'hello world',
      dimensions: OPENROUTER_TEXT_EMBEDDING_3_SMALL.dimensions,
      encoding_format: 'float',
    });
    expect(usageSink.records).toHaveLength(1);
    expect(usageSink.records[0]).toMatchObject({
      userId: 'user-1',
      provider: 'openrouter',
      model: OPENROUTER_TEXT_EMBEDDING_3_SMALL.evidenceModelId,
      callType: 'embedding',
      success: true,
      providerReportedUsd: 0.00001,
      promptType: 'execution-memory-embedding',
      correlation: { taskId: 'task-1' },
      usage: {
        inputTokens: 3,
        outputTokens: 0,
        totalTokens: 3,
        costUsd: 0.00001,
      },
    });
  });

  it('preserves batch response order using the provider indexes', async () => {
    nock(API_BASE_URL)
      .post('/api/v1/embeddings', {
        model: OPENROUTER_TEXT_EMBEDDING_3_SMALL.apiModelId,
        input: ['first', 'second'],
        dimensions: OPENROUTER_TEXT_EMBEDDING_3_SMALL.dimensions,
        encoding_format: 'float',
      })
      .reply(200, {
        data: [
          { embedding: vector(0.2), index: 1, object: 'embedding' },
          { embedding: vector(0.1), index: 0, object: 'embedding' },
        ],
        usage: { prompt_tokens: 4, total_tokens: 4 },
      });

    const result = await createClient().embedMany(['first', 'second']);

    expect(result).toEqual({ ok: true, value: [vector(0.1), vector(0.2)] });
    expect(usageSink.records).toHaveLength(1);
  });

  it('rejects empty input without an HTTP request and records one failed usage event', async () => {
    const result = await createClient().embed('   ');

    expect(result).toEqual({
      ok: false,
      error: { code: 'API_ERROR', message: 'Embedding input cannot be empty' },
    });
    expect(nock.isDone()).toBe(true);
    expect(usageSink.records).toHaveLength(1);
    expect(usageSink.records[0]).toMatchObject({
      callType: 'embedding',
      success: false,
      errorMessage: 'OPENROUTER_CLIENT_ERROR',
    });
  });

  it('rejects an unexpected embedding dimension', async () => {
    nock(API_BASE_URL)
      .post('/api/v1/embeddings')
      .reply(200, { data: [{ embedding: [0.1, 0.2], index: 0 }] });

    const result = await createClient().embed('hello');

    expect(result).toEqual({
      ok: false,
      error: { code: 'API_ERROR', message: 'OpenRouter returned an invalid embedding response' },
    });
    expect(usageSink.records).toHaveLength(1);
    expect(usageSink.records[0]?.success).toBe(false);
  });

  it('rejects a response without an embedding array', async () => {
    nock(API_BASE_URL).post('/api/v1/embeddings').reply(200, {});

    const result = await createClient({ maxAttempts: 1 }).embed('hello');

    expect(result).toEqual({
      ok: false,
      error: { code: 'API_ERROR', message: 'OpenRouter returned an invalid embedding response' },
    });
  });

  it('rejects batch entries without numeric provider indexes', async () => {
    nock(API_BASE_URL)
      .post('/api/v1/embeddings')
      .reply(200, {
        data: [
          { embedding: vector(0.1), index: '0' },
          { embedding: vector(0.2), index: '1' },
        ],
      });

    const result = await createClient({ maxAttempts: 1 }).embedMany(['first', 'second']);

    expect(result).toEqual({
      ok: false,
      error: { code: 'API_ERROR', message: 'OpenRouter returned an invalid embedding response' },
    });
  });

  it.each([
    [401, 'INVALID_KEY'],
    [402, 'API_ERROR'],
    [429, 'RATE_LIMITED'],
    [500, 'OVERLOADED'],
  ] as const)('maps HTTP %s and emits exactly one failed event', async (status, code) => {
    nock(API_BASE_URL)
      .post('/api/v1/embeddings')
      .reply(status, { error: { message: 'failed' } });

    const result = await createClient({ maxAttempts: 1 }).embed('hello');

    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(usageSink.records).toHaveLength(1);
    expect(usageSink.records[0]).toMatchObject({
      success: false,
      errorMessage: `OPENROUTER_HTTP_${String(status)}`,
    });
  });

  it('retries a transient response but emits one logical usage event', async () => {
    nock(API_BASE_URL)
      .post('/api/v1/embeddings')
      .reply(429, { error: { message: 'slow down' } })
      .post('/api/v1/embeddings')
      .reply(200, {
        data: [{ embedding: vector(0.3), index: 0 }],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      });

    const result = await createClient({ maxAttempts: 2, retryBaseDelayMs: 0 }).embed('hello');

    expect(result.ok).toBe(true);
    expect(usageSink.records).toHaveLength(1);
    expect(usageSink.records[0]?.success).toBe(true);
  });

  it('maps a request timeout and records one failed usage event', async () => {
    nock(API_BASE_URL)
      .post('/api/v1/embeddings')
      .delay(50)
      .reply(200, {
        data: [{ embedding: vector(0.4), index: 0 }],
      });

    const result = await createClient({ maxAttempts: 1, timeoutMs: 5 }).embed('hello');

    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
    expect(usageSink.records).toHaveLength(1);
    expect(usageSink.records[0]).toMatchObject({
      success: false,
      errorMessage: 'OPENROUTER_TIMEOUT',
    });
  });
});
