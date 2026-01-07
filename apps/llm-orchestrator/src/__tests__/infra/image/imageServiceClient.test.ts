import { LlmModels } from '@intexuraos/llm-contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import {
  createImageServiceClient,
  type ThumbnailPrompt,
  type GeneratedImageData,
} from '../../../infra/image/imageServiceClient.js';

describe('createImageServiceClient', () => {
  const baseUrl = 'http://image-service.local';
  const internalAuthToken = 'test-token';

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('generatePrompt', () => {
    const mockPrompt: ThumbnailPrompt = {
      title: 'Test Title',
      visualSummary: 'A summary',
      prompt: 'Generate an image',
      negativePrompt: 'no blur',
      parameters: {
        aspectRatio: '16:9',
        framing: 'medium shot',
        textOnImage: 'none',
        realism: 'photorealistic',
        people: 'none',
        logosTrademarks: 'none',
      },
    };

    it('returns prompt when successful', async () => {
      nock(baseUrl)
        .post('/internal/images/prompts/generate', {
          text: 'test text',
          model: 'gpt-4.1',
          userId: 'user-1',
        })
        .matchHeader('Content-Type', 'application/json')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, { success: true, data: mockPrompt });

      const client = createImageServiceClient({ baseUrl, internalAuthToken });
      const result = await client.generatePrompt('test text', 'gpt-4.1', 'user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockPrompt);
      }
    });

    it('supports gemini model', async () => {
      nock(baseUrl)
        .post('/internal/images/prompts/generate', {
          text: 'gemini text',
          model: LlmModels.Gemini25Pro,
          userId: 'user-2',
        })
        .reply(200, { success: true, data: mockPrompt });

      const client = createImageServiceClient({ baseUrl, internalAuthToken });
      const result = await client.generatePrompt('gemini text', LlmModels.Gemini25Pro, 'user-2');

      expect(result.ok).toBe(true);
    });

    it('returns API_ERROR on non-200 response', async () => {
      nock(baseUrl).post('/internal/images/prompts/generate').reply(500, 'Internal Server Error');

      const client = createImageServiceClient({ baseUrl, internalAuthToken });
      const result = await client.generatePrompt('text', 'gpt-4.1', 'user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('500');
        expect(result.error.message).toContain('Internal Server Error');
      }
    });

    it('returns NETWORK_ERROR on network failure', async () => {
      nock(baseUrl).post('/internal/images/prompts/generate').replyWithError('Connection refused');

      const client = createImageServiceClient({ baseUrl, internalAuthToken });
      const result = await client.generatePrompt('text', 'gpt-4.1', 'user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });
  });

  describe('generateImage', () => {
    const mockImageData: GeneratedImageData = {
      id: 'img-123',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      fullSizeUrl: 'https://example.com/full.jpg',
    };

    it('returns image data when successful', async () => {
      nock(baseUrl)
        .post('/internal/images/generate', {
          prompt: 'A beautiful sunset',
          model: LlmModels.GPTImage1,
          userId: 'user-1',
          title: undefined,
        })
        .matchHeader('Content-Type', 'application/json')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, { success: true, data: mockImageData });

      const client = createImageServiceClient({ baseUrl, internalAuthToken });
      const result = await client.generateImage('A beautiful sunset', LlmModels.GPTImage1, 'user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockImageData);
      }
    });

    it('includes title in request when provided', async () => {
      nock(baseUrl)
        .post('/internal/images/generate', {
          prompt: 'Mountain landscape',
          model: LlmModels.Gemini25FlashImage,
          userId: 'user-1',
          title: 'My Mountain Photo',
        })
        .reply(200, { success: true, data: mockImageData });

      const client = createImageServiceClient({ baseUrl, internalAuthToken });
      const result = await client.generateImage(
        'Mountain landscape',
        LlmModels.Gemini25FlashImage,
        'user-1',
        {
          title: 'My Mountain Photo',
        }
      );

      expect(result.ok).toBe(true);
    });

    it('returns API_ERROR on non-200 response', async () => {
      nock(baseUrl).post('/internal/images/generate').reply(400, 'Bad Request');

      const client = createImageServiceClient({ baseUrl, internalAuthToken });
      const result = await client.generateImage('prompt', LlmModels.GPTImage1, 'user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('400');
      }
    });

    it('returns NETWORK_ERROR on network failure', async () => {
      nock(baseUrl).post('/internal/images/generate').replyWithError('ECONNRESET');

      const client = createImageServiceClient({ baseUrl, internalAuthToken });
      const result = await client.generateImage('prompt', LlmModels.GPTImage1, 'user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });
  });

  describe('deleteImage', () => {
    it('returns success when image deleted', async () => {
      nock(baseUrl)
        .delete('/internal/images/img-123')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200);

      const client = createImageServiceClient({ baseUrl, internalAuthToken });
      const result = await client.deleteImage('img-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeUndefined();
      }
    });

    it('returns API_ERROR on non-200 response', async () => {
      nock(baseUrl).delete('/internal/images/img-456').reply(404, 'Not Found');

      const client = createImageServiceClient({ baseUrl, internalAuthToken });
      const result = await client.deleteImage('img-456');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('404');
        expect(result.error.message).toContain('Not Found');
      }
    });

    it('returns NETWORK_ERROR on network failure', async () => {
      nock(baseUrl).delete('/internal/images/img-789').replyWithError('Connection timeout');

      const client = createImageServiceClient({ baseUrl, internalAuthToken });
      const result = await client.deleteImage('img-789');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });
  });
});
