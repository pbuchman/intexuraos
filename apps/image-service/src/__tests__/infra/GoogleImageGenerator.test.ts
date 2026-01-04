import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import {
  GoogleImageGenerator,
  createGoogleImageGenerator,
} from '../../infra/image/GoogleImageGenerator.js';
import type { ImageStorage, ImageUrls, StorageError } from '../../domain/ports/imageStorage.js';
import type { Result } from '@intexuraos/common-core';
import type {
  GeneratedImageData,
  ImageGenerationError,
} from '../../domain/ports/imageGenerator.js';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: mockGenerateContent,
      };
    },
  };
});

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

function createMockResponse(b64Image: string): object {
  return {
    candidates: [
      {
        content: {
          parts: [{ inlineData: { data: b64Image, mimeType: 'image/png' } }],
        },
      },
    ],
  };
}

describe('GoogleImageGenerator', () => {
  const testApiKey = 'test-api-key';
  const testModel = 'nano-banana-pro' as const;
  const testImageId = 'test-image-123';
  const testPrompt = 'A beautiful sunset over mountains';

  let mockStorage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mockStorage = createMockStorage();
    vi.clearAllMocks();
  });

  describe('generate', () => {
    it('returns GeneratedImage on successful generation', async () => {
      const fakeImageData = 'fake image data';
      const b64Image = Buffer.from(fakeImageData).toString('base64');

      mockGenerateContent.mockResolvedValue(createMockResponse(b64Image));

      mockStorage.uploadMock.mockResolvedValue(
        ok({
          thumbnailUrl: 'https://storage.googleapis.com/bucket/images/test-image-123/thumbnail.jpg',
          fullSizeUrl: 'https://storage.googleapis.com/bucket/images/test-image-123/full.png',
        })
      );

      const generator = new GoogleImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
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

    it('calls Google API with correct parameters', async () => {
      const b64Image = Buffer.from('fake image data').toString('base64');

      mockGenerateContent.mockResolvedValue(createMockResponse(b64Image));

      mockStorage.uploadMock.mockResolvedValue(ok({ thumbnailUrl: 'thumb', fullSizeUrl: 'full' }));

      const generator = new GoogleImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      await generator.generate(testPrompt);

      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: 'gemini-2.5-flash-image',
        contents: testPrompt,
      });
    });

    it('uploads image buffer to storage', async () => {
      const fakeImageData = 'fake image data';
      const b64Image = Buffer.from(fakeImageData).toString('base64');

      mockGenerateContent.mockResolvedValue(createMockResponse(b64Image));

      mockStorage.uploadMock.mockResolvedValue(ok({ thumbnailUrl: 'thumb', fullSizeUrl: 'full' }));

      const generator = new GoogleImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      await generator.generate(testPrompt);

      expect(mockStorage.uploadMock).toHaveBeenCalledWith(testImageId, Buffer.from(fakeImageData));
    });

    it('returns API_ERROR when no candidates in response', async () => {
      mockGenerateContent.mockResolvedValue({ candidates: [] });

      const generator = new GoogleImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      const result: Result<GeneratedImageData, ImageGenerationError> =
        await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('No content in response');
      }
    });

    it('returns API_ERROR when no image data in parts', async () => {
      mockGenerateContent.mockResolvedValue({
        candidates: [{ content: { parts: [{ text: 'Some text' }] } }],
      });

      const generator = new GoogleImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
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
      const b64Image = Buffer.from('fake image data').toString('base64');

      mockGenerateContent.mockResolvedValue(createMockResponse(b64Image));

      mockStorage.uploadMock.mockResolvedValue(
        err({ code: 'STORAGE_ERROR', message: 'GCS upload failed' })
      );

      const generator = new GoogleImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
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
      mockGenerateContent.mockRejectedValue(new Error('API_KEY invalid'));

      const generator = new GoogleImageGenerator({
        apiKey: 'bad-key',
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      const result: Result<GeneratedImageData, ImageGenerationError> =
        await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_KEY');
      }
    });

    it('returns RATE_LIMITED for quota errors', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Quota exceeded'));

      const generator = new GoogleImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      const result: Result<GeneratedImageData, ImageGenerationError> =
        await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns TIMEOUT for timeout errors', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Request timed out'));

      const generator = new GoogleImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      const result: Result<GeneratedImageData, ImageGenerationError> =
        await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('returns API_ERROR for other errors', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Internal server error'));

      const generator = new GoogleImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
        generateId: (): string => testImageId,
      });

      const result: Result<GeneratedImageData, ImageGenerationError> =
        await generator.generate(testPrompt);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('uses default generateId when not provided', async () => {
      const b64Image = Buffer.from('fake image data').toString('base64');

      mockGenerateContent.mockResolvedValue(createMockResponse(b64Image));

      mockStorage.uploadMock.mockResolvedValue(ok({ thumbnailUrl: 'thumb', fullSizeUrl: 'full' }));

      const generator = new GoogleImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
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

  describe('createGoogleImageGenerator', () => {
    it('creates GoogleImageGenerator instance', () => {
      const generator = createGoogleImageGenerator({
        apiKey: testApiKey,
        model: testModel,
        storage: mockStorage,
      });

      expect(generator).toBeInstanceOf(GoogleImageGenerator);
    });
  });
});
