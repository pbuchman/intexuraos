import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import type { Logger } from '@intexuraos/common-core';
import type { OwnerType } from '@intexuraos/llm-contract';
import { FakeUsageSink } from '@intexuraos/llm-pricing';
import { createOpenRouterImageClient, OPENROUTER_GPT_IMAGE_1 } from '../index.js';

const API_BASE_URL = 'https://openrouter.ai';
const logger: Logger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

describe('createOpenRouterImageClient', () => {
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
      ownerType?: OwnerType;
      retryBaseDelayMs?: number;
      timeoutMs?: number;
    } = {}
  ): ReturnType<typeof createOpenRouterImageClient> {
    return createOpenRouterImageClient({
      apiKey: 'or-test-key',
      userId: 'user-1',
      logger,
      usageSink,
      ...overrides,
    });
  }

  it('posts to the dedicated images API while preserving the public result alias', async () => {
    const imageBytes = Buffer.from('synthetic image');
    let body: unknown;
    nock(API_BASE_URL)
      .post('/api/v1/images', (candidate) => {
        body = candidate;
        return true;
      })
      .matchHeader('authorization', 'Bearer or-test-key')
      .matchHeader('http-referer', 'https://intexuraos.cloud')
      .matchHeader('x-title', 'IntexuraOS')
      .reply(200, {
        created: 1,
        data: [{ b64_json: imageBytes.toString('base64') }],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 17,
          total_tokens: 28,
          cost: 0.04,
        },
      });

    const result = await createClient().generateImage('A red panda astronaut', {
      size: '1536x1024',
      promptType: 'research-cover',
      correlation: { researchId: 'research-1' },
    });

    expect(body).toEqual({
      model: OPENROUTER_GPT_IMAGE_1.apiModelId,
      prompt: 'A red panda astronaut',
      n: 1,
      size: '1536x1024',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        imageData: imageBytes,
        model: OPENROUTER_GPT_IMAGE_1.publicModelId,
        usage: {
          inputTokens: 11,
          outputTokens: 17,
          totalTokens: 28,
          costUsd: 0.04,
          imageCount: 1,
          imageSize: '1536x1024',
        },
      },
    });
    expect(usageSink.records).toHaveLength(1);
    expect(usageSink.records[0]).toMatchObject({
      provider: 'openrouter',
      model: OPENROUTER_GPT_IMAGE_1.evidenceModelId,
      callType: 'image_generation',
      success: true,
      providerReportedUsd: 0.04,
      promptType: 'research-cover',
      correlation: { researchId: 'research-1' },
    });
  });

  it('uses the existing default image size', async () => {
    nock(API_BASE_URL)
      .post('/api/v1/images', (body) => (body as { size?: string }).size === '1024x1024')
      .reply(200, { data: [{ b64_json: Buffer.from('image').toString('base64') }] });

    const result = await createClient().generateImage('A lake');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.usage.imageSize).toBe('1024x1024');
    }
  });

  it('records the configured usage owner type', async () => {
    nock(API_BASE_URL)
      .post('/api/v1/images')
      .reply(200, { data: [{ b64_json: Buffer.from('image').toString('base64') }] });

    const result = await createClient({ ownerType: 'user' }).generateImage('A lake');

    expect(result.ok).toBe(true);
    expect(usageSink.records[0]?.ownerType).toBe('user');
  });

  it('rejects a response without image bytes and records one failure', async () => {
    nock(API_BASE_URL).post('/api/v1/images').reply(200, { data: [] });

    const result = await createClient().generateImage('A lake');

    expect(result).toEqual({
      ok: false,
      error: { code: 'API_ERROR', message: 'OpenRouter returned no image data' },
    });
    expect(usageSink.records).toHaveLength(1);
    expect(usageSink.records[0]?.success).toBe(false);
  });

  it.each([
    [401, 'INVALID_KEY'],
    [402, 'API_ERROR'],
    [429, 'RATE_LIMITED'],
    [503, 'OVERLOADED'],
  ] as const)('maps HTTP %s and emits exactly one failed event', async (status, code) => {
    nock(API_BASE_URL)
      .post('/api/v1/images')
      .reply(status, { error: { message: 'failed' } });

    const result = await createClient({ maxAttempts: 1 }).generateImage('A lake');

    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(usageSink.records).toHaveLength(1);
    expect(usageSink.records[0]).toMatchObject({
      success: false,
      errorMessage: `OPENROUTER_HTTP_${String(status)}`,
    });
  });

  it('retries a transient response but emits one logical usage event', async () => {
    nock(API_BASE_URL)
      .post('/api/v1/images')
      .reply(500, { error: { message: 'overloaded' } })
      .post('/api/v1/images')
      .reply(200, { data: [{ b64_json: Buffer.from('image').toString('base64') }] });

    const result = await createClient({ maxAttempts: 2, retryBaseDelayMs: 0 }).generateImage(
      'A lake'
    );

    expect(result.ok).toBe(true);
    expect(usageSink.records).toHaveLength(1);
    expect(usageSink.records[0]?.success).toBe(true);
  });

  it('maps a timeout and records one failed usage event', async () => {
    nock(API_BASE_URL)
      .post('/api/v1/images')
      .delay(50)
      .reply(200, { data: [{ b64_json: Buffer.from('image').toString('base64') }] });

    const result = await createClient({ maxAttempts: 1, timeoutMs: 5 }).generateImage('A lake');

    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
    expect(usageSink.records).toHaveLength(1);
    expect(usageSink.records[0]?.errorMessage).toBe('OPENROUTER_TIMEOUT');
  });
});
