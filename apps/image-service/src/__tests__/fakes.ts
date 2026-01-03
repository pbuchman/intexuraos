import { err, ok, type Result } from '@intexuraos/common-core';
import type { GeneratedImage, ThumbnailPrompt } from '../domain/index.js';
import type {
  GeneratedImageRepository,
  RepositoryError,
} from '../domain/ports/generatedImageRepository.js';
import type { ImageGenerator, ImageGenerationError } from '../domain/ports/imageGenerator.js';
import type { PromptGenerator, PromptGenerationError } from '../domain/ports/promptGenerator.js';
import type { UserServiceClient, DecryptedApiKeys, UserServiceError } from '../infra/user/index.js';

export class FakeGeneratedImageRepository implements GeneratedImageRepository {
  private images = new Map<string, GeneratedImage>();
  private shouldFailSave = false;
  private shouldFailFind = false;

  setFailNextSave(fail: boolean): void {
    this.shouldFailSave = fail;
  }

  setFailNextFind(fail: boolean): void {
    this.shouldFailFind = fail;
  }

  async save(image: GeneratedImage): Promise<Result<GeneratedImage, RepositoryError>> {
    if (this.shouldFailSave) {
      this.shouldFailSave = false;
      return err({ code: 'WRITE_FAILED', message: 'Simulated save failure' });
    }
    this.images.set(image.id, image);
    return ok(image);
  }

  async findById(id: string): Promise<Result<GeneratedImage, RepositoryError>> {
    if (this.shouldFailFind) {
      this.shouldFailFind = false;
      return err({ code: 'READ_FAILED', message: 'Simulated find failure' });
    }
    const image = this.images.get(id);
    if (image === undefined) {
      return err({ code: 'NOT_FOUND', message: `Image ${id} not found` });
    }
    return ok(image);
  }

  clear(): void {
    this.images.clear();
  }

  getAll(): GeneratedImage[] {
    return Array.from(this.images.values());
  }
}

export class FakeImageGenerator implements ImageGenerator {
  private shouldFail = false;
  private errorCode: ImageGenerationError['code'] = 'API_ERROR';
  private idCounter = 1;

  setFailNext(fail: boolean, code: ImageGenerationError['code'] = 'API_ERROR'): void {
    this.shouldFail = fail;
    this.errorCode = code;
  }

  async generate(
    prompt: string,
    model: string
  ): Promise<Result<GeneratedImage, ImageGenerationError>> {
    if (this.shouldFail) {
      this.shouldFail = false;
      return err({ code: this.errorCode, message: 'Simulated generation failure' });
    }

    const id = `img-${String(this.idCounter++)}`;
    return ok({
      id,
      prompt,
      thumbnailUrl: `https://storage.googleapis.com/test-bucket/${id}/thumbnail.png`,
      fullSizeUrl: `https://storage.googleapis.com/test-bucket/${id}/full.png`,
      model,
      createdAt: new Date().toISOString(),
    });
  }
}

export class FakePromptGenerator implements PromptGenerator {
  private shouldFail = false;
  private errorCode: PromptGenerationError['code'] = 'API_ERROR';
  private generatedPrompt: ThumbnailPrompt = {
    title: 'Test Title',
    visualSummary: 'A test visual summary',
    prompt: 'A detailed prompt for generating a test thumbnail image',
    negativePrompt: 'blurry, low quality, text, watermark',
    parameters: {
      aspectRatio: '16:9',
      framing: 'center subject',
      textOnImage: 'none',
      realism: 'photorealistic',
      people: 'generic silhouettes',
      logosTrademarks: 'none',
    },
  };

  setFailNext(fail: boolean, code: PromptGenerationError['code'] = 'API_ERROR'): void {
    this.shouldFail = fail;
    this.errorCode = code;
  }

  setGeneratedPrompt(prompt: ThumbnailPrompt): void {
    this.generatedPrompt = prompt;
  }

  async generateThumbnailPrompt(
    _text: string
  ): Promise<Result<ThumbnailPrompt, PromptGenerationError>> {
    if (this.shouldFail) {
      this.shouldFail = false;
      return err({ code: this.errorCode, message: 'Simulated prompt generation failure' });
    }
    return ok(this.generatedPrompt);
  }
}

export class FakeUserServiceClient implements UserServiceClient {
  private apiKeys: DecryptedApiKeys = {};
  private shouldFail = false;
  private errorCode: UserServiceError['code'] = 'API_ERROR';

  setApiKeys(keys: DecryptedApiKeys): void {
    this.apiKeys = keys;
  }

  setFailNext(fail: boolean, code: UserServiceError['code'] = 'API_ERROR'): void {
    this.shouldFail = fail;
    this.errorCode = code;
  }

  async getApiKeys(_userId: string): Promise<Result<DecryptedApiKeys, UserServiceError>> {
    if (this.shouldFail) {
      this.shouldFail = false;
      return err({ code: this.errorCode, message: 'Simulated user service failure' });
    }
    return ok(this.apiKeys);
  }
}
