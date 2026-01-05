import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import {
  OpenAIImageGenerator,
  createOpenAIImageGenerator,
} from '../../infra/image/OpenAIImageGenerator.js';
import type { ImageStorage, ImageUrls, StorageError } from '../../domain/ports/imageStorage.js';
import type { Result } from '@intexuraos/common-core';
import type {
  GeneratedImageData,
  ImageGenerationError,
} from '../../domain/ports/imageGenerator.js';

const mockGenerateImage = vi.fn();

vi.mock('@intexuraos/infra-gpt', () => ({
  createGptClient: vi.fn(() => ({
    generateImage: mockGenerateImage,
  })),
}));

vi.mock('@intexuraos/llm-pricing', () => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
}));

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

  let mockStorage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mockStorage = createMockStorage();
    vi.clearAllMocks();
  });

  describe('generate', () => {
    it('returns GeneratedImage on successful generation', async () => {
      const fakeImageData = Buffer.from('fake image data');

      mockGenerateImage.mockResolvedValue(
        ok({
          imageData: fakeImageData,
          model: 'dall-e-3',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0.04 },
        })
      );

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
        userId: 'test-user-id',
      });

      const result: Result<GeneratedImageData, ImageGenerationError> =
        await generator.generate(testPrompt);

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

    it('uploads image buffer to storage', async () => {
      const fakeImageData = Buffer.from('fake image data');

      mockGenerateImage.mockResolvedValue(
        ok({
          imageData: fakeImageData,
          model: 'dall-e-3',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0.04 },
        })
      );

      mockStorage.uploadMock.mockResolvedValue(ok({ thumbnailUrl: 'thumb', fullSizeUrl: 'full' }));

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
        userId: 'test-user-id',
      });

      await generator.generate(testPrompt);

      expect(mockStorage.uploadMock).toHaveBeenCalledWith(testImageId, fakeImageData, {
        slug: undefined,
      });
    });

    it('passes slug option to storage when provided', async () => {
      const fakeImageData = Buffer.from('fake image data');

      mockGenerateImage.mockResolvedValue(
        ok({
          imageData: fakeImageData,
          model: 'dall-e-3',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0.04 },
        })
      );

      mockStorage.uploadMock.mockResolvedValue(ok({ thumbnailUrl: 'thumb', fullSizeUrl: 'full' }));

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
        userId: 'test-user-id',
      });

      const result = await generator.generate(testPrompt, { slug: 'my-cool-image' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.slug).toBe('my-cool-image');
      }
      expect(mockStorage.uploadMock).toHaveBeenCalledWith(testImageId, fakeImageData, {
        slug: 'my-cool-image',
      });
    });

    it('returns API_ERROR when generateImage returns error', async () => {
      mockGenerateImage.mockResolvedValue(
        err({ code: 'API_ERROR', message: 'No image data in response' })
      );

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
        userId: 'test-user-id',
      });

      const result: Result<GeneratedImageData, ImageGenerationError> =
        await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('No image data in response');
      }
    });

    it('returns STORAGE_ERROR when upload fails', async () => {
      const fakeImageData = Buffer.from('fake image data');

      mockGenerateImage.mockResolvedValue(
        ok({
          imageData: fakeImageData,
          model: 'dall-e-3',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0.04 },
        })
      );

      mockStorage.uploadMock.mockResolvedValue(
        err({ code: 'STORAGE_ERROR', message: 'GCS upload failed' })
      );

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
        userId: 'test-user-id',
      });

      const result: Result<GeneratedImageData, ImageGenerationError> =
        await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
        expect(result.error.message).toBe('GCS upload failed');
      }
    });

    it('returns INVALID_KEY for authentication errors', async () => {
      mockGenerateImage.mockResolvedValue(err({ code: 'INVALID_KEY', message: 'Invalid API key' }));

      const generator = new OpenAIImageGenerator({
        apiKey: 'bad-key',
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
        userId: 'test-user-id',
      });

      const result: Result<GeneratedImageData, ImageGenerationError> =
        await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('returns RATE_LIMITED for rate limit errors', async () => {
      mockGenerateImage.mockResolvedValue(
        err({ code: 'RATE_LIMITED', message: 'Rate limit exceeded' })
      );

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
        userId: 'test-user-id',
      });

      const result: Result<GeneratedImageData, ImageGenerationError> =
        await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns TIMEOUT for timeout errors', async () => {
      mockGenerateImage.mockResolvedValue(err({ code: 'TIMEOUT', message: 'Request timed out' }));

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
        userId: 'test-user-id',
      });

      const result: Result<GeneratedImageData, ImageGenerationError> =
        await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('returns API_ERROR for other errors', async () => {
      mockGenerateImage.mockResolvedValue(
        err({ code: 'API_ERROR', message: 'Internal server error' })
      );

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
        userId: 'test-user-id',
      });

      const result: Result<GeneratedImageData, ImageGenerationError> =
        await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('uses default generateId when not provided', async () => {
      const fakeImageData = Buffer.from('fake image data');

      mockGenerateImage.mockResolvedValue(
        ok({
          imageData: fakeImageData,
          model: 'dall-e-3',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0.04 },
        })
      );

      mockStorage.uploadMock.mockResolvedValue(ok({ thumbnailUrl: 'thumb', fullSizeUrl: 'full' }));

      const generator = new OpenAIImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        userId: 'test-user-id',
      });

      const result: Result<GeneratedImageData, ImageGenerationError> =
        await generator.generate(testPrompt);

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
        userId: 'test-user-id',
      });

      expect(generator).toBeInstanceOf(OpenAIImageGenerator);
    });
  });
});
