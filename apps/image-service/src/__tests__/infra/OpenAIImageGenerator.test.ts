import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { ok, err } from '@intexuraos/common-core';
import {
  OpenAIImageGenerator,
  createOpenAIImageGenerator,
} from '../../infra/image/OpenAIImageGenerator.js';
import type { ImageStorage, ImageUrls, StorageError } from '../../domain/ports/imageStorage.js';
import type { Result } from '@intexuraos/common-core';

function createMockStorage(): ImageStorage & {
  uploadMock: ReturnType<
    typeof vi.fn<(id: string, data: Buffer) => Promise<Result<ImageUrls, StorageError>>>
  >;
  deleteMock: ReturnType<typeof vi.fn<(id: string) => Promise<Result<void, StorageError>>>>;
} {
  const uploadMock =
    vi.fn<(id: string, data: Buffer) => Promise<Result<ImageUrls, StorageError>>>();
  const deleteMock = vi.fn<(id: string) => Promise<Result<void, StorageError>>>();
  return {
    uploadMock,
    deleteMock,
    upload: uploadMock,
    delete: deleteMock,
  };
}

describe('OpenAIImageGenerator', () => {
  const testApiKey = 'test-api-key';
  const testModel = 'gpt-image-1' as const;
  const testImageId = 'test-image-123';
  const testPrompt = 'A beautiful sunset over mountains';
  const testImageUrl = 'https://oaidalleapiprodscus.blob.core.windows.net/test-image.png';

  let mockStorage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    nock.cleanAll();
    mockStorage = createMockStorage();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
  });

  describe('generate', () => {
    it('returns GeneratedImage on successful generation with b64_json', async () => {
      const fakeImageData = 'fake image data';
      const b64Image = Buffer.from(fakeImageData).toString('base64');

      nock('https://api.openai.com')
        .post('/v1/images/generations')
        .reply(200, {
          created: 1234567890,
          data: [{ b64_json: b64Image }],
        });

      mockStorage.uploadMock.mockResolvedValue(
        ok({
          thumbnailUrl: 'https://storage.googleapis.com/bucket/images/test-image-123/thumbnail.jpg',
          fullSizeUrl: 'https://storage.googleapis.com/bucket/images/test-image-123/full.png',
        })
      );

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      const result = await generator.generate(testPrompt);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe(testImageId);
        expect(result.value.prompt).toBe(testPrompt);
        expect(result.value.model).toBe(testModel);
        expect(result.value.thumbnailUrl).toContain('thumbnail.jpg');
        expect(result.value.fullSizeUrl).toContain('full.png');
        expect(result.value.createdAt).toBeDefined();
      }
    });

    it('returns GeneratedImage on successful generation with url fallback', async () => {
      const fakeImageData = 'fake image data from url';

      nock('https://api.openai.com')
        .post('/v1/images/generations')
        .reply(200, {
          created: 1234567890,
          data: [{ url: testImageUrl }],
        });

      nock('https://oaidalleapiprodscus.blob.core.windows.net')
        .get('/test-image.png')
        .reply(200, fakeImageData);

      mockStorage.uploadMock.mockResolvedValue(
        ok({
          thumbnailUrl: 'https://storage.googleapis.com/bucket/images/test-image-123/thumbnail.jpg',
          fullSizeUrl: 'https://storage.googleapis.com/bucket/images/test-image-123/full.png',
        })
      );

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      const result = await generator.generate(testPrompt);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe(testImageId);
        expect(result.value.prompt).toBe(testPrompt);
        expect(result.value.model).toBe(testModel);
      }
    });

    it('calls OpenAI API with correct parameters', async () => {
      const fakeImageData = 'fake image data';
      const b64Image = Buffer.from(fakeImageData).toString('base64');

      const scope = nock('https://api.openai.com')
        .post('/v1/images/generations', (body) => {
          expect(body.model).toBe(testModel);
          expect(body.prompt).toBe(testPrompt);
          expect(body.n).toBe(1);
          expect(body.size).toBe('1024x1024');
          expect(body.response_format).toBe('b64_json');
          return true;
        })
        .reply(200, {
          created: 1234567890,
          data: [{ b64_json: b64Image }],
        });

      mockStorage.uploadMock.mockResolvedValue(ok({ thumbnailUrl: 'thumb', fullSizeUrl: 'full' }));

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      await generator.generate(testPrompt);

      expect(scope.isDone()).toBe(true);
    });

    it('uploads image buffer to storage from b64_json', async () => {
      const fakeImageData = 'fake image data';
      const b64Image = Buffer.from(fakeImageData).toString('base64');

      nock('https://api.openai.com')
        .post('/v1/images/generations')
        .reply(200, {
          created: 1234567890,
          data: [{ b64_json: b64Image }],
        });

      mockStorage.uploadMock.mockResolvedValue(ok({ thumbnailUrl: 'thumb', fullSizeUrl: 'full' }));

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      await generator.generate(testPrompt);

      expect(mockStorage.uploadMock).toHaveBeenCalledWith(testImageId, Buffer.from(fakeImageData));
    });

    it('returns API_ERROR when no image data in response', async () => {
      nock('https://api.openai.com').post('/v1/images/generations').reply(200, {
        created: 1234567890,
        data: [],
      });

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      const result = await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('No image data in response');
      }
    });

    it('returns API_ERROR when response has neither url nor b64_json', async () => {
      nock('https://api.openai.com')
        .post('/v1/images/generations')
        .reply(200, {
          created: 1234567890,
          data: [{}],
        });

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      const result = await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('No image URL or b64_json in response');
      }
    });

    it('returns API_ERROR when image fetch from url fails', async () => {
      nock('https://api.openai.com')
        .post('/v1/images/generations')
        .reply(200, {
          created: 1234567890,
          data: [{ url: testImageUrl }],
        });

      nock('https://oaidalleapiprodscus.blob.core.windows.net').get('/test-image.png').reply(500);

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      const result = await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('Failed to fetch image');
      }
    });

    it('returns STORAGE_ERROR when upload fails', async () => {
      const fakeImageData = 'fake image data';
      const b64Image = Buffer.from(fakeImageData).toString('base64');

      nock('https://api.openai.com')
        .post('/v1/images/generations')
        .reply(200, {
          created: 1234567890,
          data: [{ b64_json: b64Image }],
        });

      mockStorage.uploadMock.mockResolvedValue(
        err({ code: 'STORAGE_ERROR', message: 'GCS upload failed' })
      );

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      const result = await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toBe('GCS upload failed');
      }
    });

    it('returns INVALID_KEY for authentication errors', async () => {
      nock('https://api.openai.com')
        .post('/v1/images/generations')
        .reply(401, {
          error: { message: 'Incorrect API key provided' },
        });

      const generator = new OpenAIImageGenerator({
        apiKey: 'bad-key',
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      const result = await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('returns RATE_LIMITED for 429 errors', async () => {
      nock('https://api.openai.com')
        .post('/v1/images/generations')
        .times(3)
        .reply(429, {
          error: { message: 'Rate limit exceeded' },
        });

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      const result = await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns API_ERROR for other errors', async () => {
      nock('https://api.openai.com')
        .post('/v1/images/generations')
        .times(3)
        .reply(500, {
          error: { message: 'Internal server error' },
        });

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      const result = await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('uses default generateId when not provided', async () => {
      const fakeImageData = 'fake image data';
      const b64Image = Buffer.from(fakeImageData).toString('base64');

      nock('https://api.openai.com')
        .post('/v1/images/generations')
        .reply(200, {
          created: 1234567890,
          data: [{ b64_json: b64Image }],
        });

      mockStorage.uploadMock.mockResolvedValue(ok({ thumbnailUrl: 'thumb', fullSizeUrl: 'full' }));

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
      });

      const result = await generator.generate(testPrompt);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
      }
    });
  });

  describe('createOpenAIImageGenerator', () => {
    it('creates OpenAIImageGenerator instance', () => {
      const generator = createOpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
      });

      expect(generator).toBeInstanceOf(OpenAIImageGenerator);
    });
  });
});
