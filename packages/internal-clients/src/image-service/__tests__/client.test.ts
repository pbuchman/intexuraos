import { LlmModels } from '@intexuraos/llm-contract';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageServiceClient } from '../client.js';

const BASE_URL = 'http://image-service.local';

beforeEach(() => {
  nock.cleanAll();
});

afterEach(() => {
  nock.cleanAll();
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

  it('allows image generation to run longer than the generic internal request timeout', async () => {
    vi.useFakeTimers();
    const image = {
      id: 'image-1',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      fullSizeUrl: 'https://example.com/full.jpg',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((resolve, reject) => {
          const responseTimer = setTimeout(() => {
            resolve(
              new Response(JSON.stringify({ success: true, data: image }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            );
          }, 30_001);
          init?.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(responseTimer);
              const error = new Error('This operation was aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true }
          );
        });
      })
    );

    try {
      const client = createImageServiceClient({
        baseUrl: BASE_URL,
        internalAuthToken: 'secret',
      });
      const resultPromise = client.generateImage('prompt', LlmModels.GPTImage1, 'user-1');

      await vi.advanceTimersByTimeAsync(30_001);

      await expect(resultPromise).resolves.toEqual({ ok: true, value: image });
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
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
