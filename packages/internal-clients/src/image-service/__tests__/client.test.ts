import { LlmModels } from '@intexuraos/llm-contract';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
