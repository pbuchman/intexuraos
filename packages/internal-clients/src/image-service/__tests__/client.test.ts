import { LlmModels } from '@intexuraos/llm-contract';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageServiceClient } from '../client.js';

const BASE_URL = 'http://image-service.local';

function stubAbortablePendingFetch(): () => AbortSignal | undefined {
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            const error = new Error('This operation was aborted');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true }
        );
      });
    })
  );
  return () => signal;
}

beforeEach(() => {
  nock.cleanAll();
});

afterEach(() => {
  nock.cleanAll();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('createImageServiceClient', () => {
  it('returns generated prompts on success', async () => {
    const prompt = {
      title: 'Test Title',
      visualSummary: 'A summary',
      prompt: 'Generate an image',
      negativePrompt: 'no blur',
      parameters: {
        framing: 'medium shot',
        realism: 'photorealistic' as const,
        people: 'none',
      },
    };
    const scope = nock(BASE_URL)
      .post('/internal/images/prompts/generate', {
        text: 'test text',
        model: 'gpt-4.1',
        userId: 'user-1',
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, { success: true, data: prompt });

    const client = createImageServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
    });
    const result = await client.generatePrompt('test text', 'gpt-4.1', 'user-1');

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({ ok: true, value: prompt });
  });

  it('returns API_ERROR with the response body on image generation failures', async () => {
    nock(BASE_URL).post('/internal/images/generate').reply(400, 'Bad Request');

    const client = createImageServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
    });
    const result = await client.generateImage('prompt', LlmModels.GPTImage1, 'user-1');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'API_ERROR',
        message: 'HTTP 400: Bad Request',
      },
    });
  });

  it('uses the exact 15-minute image generation timeout', async () => {
    vi.useFakeTimers();
    const getSignal = stubAbortablePendingFetch();
    const client = createImageServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
    });
    const resultPromise = client.generateImage('prompt', LlmModels.GPTImage1, 'user-1');

    await vi.advanceTimersByTimeAsync(899_999);
    expect(getSignal()?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    expect(getSignal()?.aborted).toBe(true);
    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Request exceeded 900000ms',
      },
    });
  });

  it('keeps the generic 30-second timeout for prompt generation', async () => {
    vi.useFakeTimers();
    const getSignal = stubAbortablePendingFetch();
    const client = createImageServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
    });
    const resultPromise = client.generatePrompt('text', 'gpt-4.1', 'user-1');

    await vi.advanceTimersByTimeAsync(29_999);
    expect(getSignal()?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    expect(getSignal()?.aborted).toBe(true);
    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Request exceeded 30000ms',
      },
    });
  });

  it('keeps the generic 30-second timeout for image deletion', async () => {
    vi.useFakeTimers();
    const getSignal = stubAbortablePendingFetch();
    const client = createImageServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
    });
    const resultPromise = client.deleteImage('image-1');

    await vi.advanceTimersByTimeAsync(29_999);
    expect(getSignal()?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    expect(getSignal()?.aborted).toBe(true);
    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Request exceeded 30000ms',
      },
    });
  });

  it('fails closed when prompt generation returns success=false', async () => {
    nock(BASE_URL)
      .post('/internal/images/prompts/generate')
      .reply(200, {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Prompt generation overloaded',
        },
      });

    const client = createImageServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
    });
    const result = await client.generatePrompt('test text', 'gpt-4.1', 'user-1');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'API_ERROR',
        message: 'RATE_LIMITED: Prompt generation overloaded',
      },
    });
  });

  it('treats delete success envelopes as deleted', async () => {
    const scope = nock(BASE_URL)
      .delete('/internal/images/image-1')
      .reply(200, { success: true, data: null });

    const client = createImageServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
    });
    const result = await client.deleteImage('image-1');

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({ ok: true, value: undefined });
  });
});
