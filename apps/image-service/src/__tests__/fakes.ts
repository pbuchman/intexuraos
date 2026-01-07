import { err, ok, type Result } from '@intexuraos/common-core';
import { LlmModels } from '@intexuraos/llm-contract';
import type {
  GeneratedImage,
  ImageStorage,
  ImageUrls,
  StorageError,
  GeneratedImageRepository,
  RepositoryError,
  ImageGenerator,
  GeneratedImageData,
  ImageGenerationError,
  PromptGenerator,
  PromptGenerationError,
  ThumbnailPrompt,
} from '../domain/index.js';
import type { UserServiceClient, DecryptedApiKeys } from '../infra/user/index.js';

export class FakeImageStorage implements ImageStorage {
  private images = new Map<string, { fullPath: string; thumbPath: string }>();
  private shouldFailUpload = false;
  private shouldFailDelete = false;

  async upload(id: string, _imageData: Buffer): Promise<Result<ImageUrls, StorageError>> {
    if (this.shouldFailUpload) {
      this.shouldFailUpload = false;
      return err({ code: 'STORAGE_ERROR', message: 'Simulated upload failure' });
    }

    const fullPath = `images/${id}/full.png`;
    const thumbPath = `images/${id}/thumbnail.jpg`;
    this.images.set(id, { fullPath, thumbPath });

    return ok({
      thumbnailUrl: `https://storage.googleapis.com/test-bucket/${thumbPath}`,
      fullSizeUrl: `https://storage.googleapis.com/test-bucket/${fullPath}`,
    });
  }

  async delete(id: string): Promise<Result<void, StorageError>> {
    if (this.shouldFailDelete) {
      this.shouldFailDelete = false;
      return err({ code: 'STORAGE_ERROR', message: 'Simulated delete failure' });
    }

    this.images.delete(id);
    return ok(undefined);
  }

  setFailNextUpload(fail: boolean): void {
    this.shouldFailUpload = fail;
  }

  setFailNextDelete(fail: boolean): void {
    this.shouldFailDelete = fail;
  }

  hasImage(id: string): boolean {
    return this.images.has(id);
  }

  clear(): void {
    this.images.clear();
  }
}

export class FakeGeneratedImageRepository implements GeneratedImageRepository {
  private images = new Map<string, GeneratedImage>();
  private shouldFailSave = false;
  private shouldFailFindById = false;
  private shouldFailDelete = false;

  async save(image: GeneratedImage): Promise<Result<GeneratedImage, RepositoryError>> {
    if (this.shouldFailSave) {
      this.shouldFailSave = false;
      return err({ code: 'WRITE_FAILED', message: 'Simulated save failure' });
    }

    this.images.set(image.id, image);
    return ok(image);
  }

  async findById(id: string): Promise<Result<GeneratedImage, RepositoryError>> {
    if (this.shouldFailFindById) {
      this.shouldFailFindById = false;
      return err({ code: 'READ_FAILED', message: 'Simulated findById failure' });
    }

    const image = this.images.get(id);
    if (image === undefined) {
      return err({ code: 'NOT_FOUND', message: `Generated image with id ${id} not found` });
    }
    return ok(image);
  }

  async delete(id: string): Promise<Result<void, RepositoryError>> {
    if (this.shouldFailDelete) {
      this.shouldFailDelete = false;
      return err({ code: 'WRITE_FAILED', message: 'Simulated delete failure' });
    }

    this.images.delete(id);
    return ok(undefined);
  }

  setFailNextSave(fail: boolean): void {
    this.shouldFailSave = fail;
  }

  setFailNextFindById(fail: boolean): void {
    this.shouldFailFindById = fail;
  }

  setFailNextDelete(fail: boolean): void {
    this.shouldFailDelete = fail;
  }

  setImage(image: GeneratedImage): void {
    this.images.set(image.id, image);
  }

  getImage(id: string): GeneratedImage | undefined {
    return this.images.get(id);
  }

  hasImage(id: string): boolean {
    return this.images.has(id);
  }

  clear(): void {
    this.images.clear();
  }
}

export class FakeUserServiceClient implements UserServiceClient {
  private apiKeys: DecryptedApiKeys = {};
  private shouldFail = false;
  private failErrorCode: 'NETWORK_ERROR' | 'API_ERROR' = 'API_ERROR';

  async getApiKeys(
    _userId: string
  ): Promise<Result<DecryptedApiKeys, { code: 'NETWORK_ERROR' | 'API_ERROR'; message: string }>> {
    if (this.shouldFail) {
      this.shouldFail = false;
      return err({
        code: this.failErrorCode,
        message: `Simulated getApiKeys failure: ${this.failErrorCode}`,
      });
    }

    return ok(this.apiKeys);
  }

  setApiKeys(keys: DecryptedApiKeys): void {
    this.apiKeys = keys;
  }

  setFailNext(fail: boolean, errorCode?: 'NETWORK_ERROR' | 'API_ERROR'): void {
    this.shouldFail = fail;
    if (errorCode !== undefined) {
      this.failErrorCode = errorCode;
    }
  }

  clear(): void {
    this.apiKeys = {};
  }
}

export class FakePromptGenerator implements PromptGenerator {
  private shouldFail = false;
  private failErrorCode: PromptGenerationError['code'] = 'API_ERROR';

  async generateThumbnailPrompt(
    _text: string
  ): Promise<Result<ThumbnailPrompt, PromptGenerationError>> {
    if (this.shouldFail) {
      this.shouldFail = false;
      return err({ code: this.failErrorCode, message: `Simulated failure: ${this.failErrorCode}` });
    }

    return ok({
      title: 'Test Title',
      visualSummary: 'A test visual summary',
      prompt: 'A test prompt for image generation',
      negativePrompt: 'bad, ugly, distorted',
      parameters: {
        aspectRatio: '16:9',
        framing: 'centered',
        textOnImage: 'none',
        realism: 'photorealistic',
        people: 'none',
        logosTrademarks: 'none',
      },
    });
  }

  setFailNext(fail: boolean, errorCode?: PromptGenerationError['code']): void {
    this.shouldFail = fail;
    if (errorCode !== undefined) {
      this.failErrorCode = errorCode;
    }
  }
}

export class FakeImageGenerator implements ImageGenerator {
  private shouldFail = false;
  private failError: ImageGenerationError = { code: 'API_ERROR', message: 'Simulated failure' };
  private generatedId = 'test-generated-id';

  async generate(prompt: string): Promise<Result<GeneratedImageData, ImageGenerationError>> {
    if (this.shouldFail) {
      this.shouldFail = false;
      return err(this.failError);
    }

    return ok({
      id: this.generatedId,
      prompt,
      thumbnailUrl: `https://storage.googleapis.com/test-bucket/images/${this.generatedId}/thumbnail.jpg`,
      fullSizeUrl: `https://storage.googleapis.com/test-bucket/images/${this.generatedId}/full.png`,
      model: LlmModels.GPTImage1,
      createdAt: new Date().toISOString(),
    });
  }

  setFailNext(fail: boolean, error?: ImageGenerationError): void {
    this.shouldFail = fail;
    if (error !== undefined) {
      this.failError = error;
    }
  }

  setGeneratedId(id: string): void {
    this.generatedId = id;
  }
}
