import { randomUUID } from 'node:crypto';
// eslint-disable-next-line no-restricted-imports -- Gemini image API not available in infra-gemini
import { GoogleGenAI } from '@google/genai';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { ImageGenerationModel } from '../../domain/index.js';
import type {
  GeneratedImageData,
  ImageGenerationError,
  ImageGenerator,
} from '../../domain/ports/imageGenerator.js';
import type { ImageStorage } from '../../domain/ports/imageStorage.js';

export interface GoogleImageGeneratorConfig {
  apiKey: string;
  model: ImageGenerationModel;
  storage: ImageStorage;
  generateId?: () => string;
}

const GOOGLE_MODEL_ID = 'gemini-2.5-flash-image';

export class GoogleImageGenerator implements ImageGenerator {
  private readonly ai: GoogleGenAI;
  private readonly model: ImageGenerationModel;
  private readonly storage: ImageStorage;
  private readonly generateId: () => string;

  constructor(config: GoogleImageGeneratorConfig) {
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    this.model = config.model;
    this.storage = config.storage;
    this.generateId = config.generateId ?? ((): string => randomUUID());
  }

  async generate(prompt: string): Promise<Result<GeneratedImageData, ImageGenerationError>> {
    const id = this.generateId();

    try {
      const response = await this.ai.models.generateContent({
        model: GOOGLE_MODEL_ID,
        contents: prompt,
      });

      const parts = response.candidates?.[0]?.content?.parts;
      if (parts === undefined || parts.length === 0) {
        return err({ code: 'API_ERROR', message: 'No content in response' });
      }

      const imagePart = parts.find((part) => part.inlineData !== undefined);
      if (imagePart?.inlineData?.data === undefined) {
        return err({ code: 'API_ERROR', message: 'No image data in response' });
      }

      const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');

      const uploadResult = await this.storage.upload(id, imageBuffer);
      if (!uploadResult.ok) {
        return err({ code: 'STORAGE_ERROR', message: uploadResult.error.message });
      }

      const image: GeneratedImageData = {
        id,
        prompt,
        thumbnailUrl: uploadResult.value.thumbnailUrl,
        fullSizeUrl: uploadResult.value.fullSizeUrl,
        model: this.model,
        createdAt: new Date().toISOString(),
      };

      return ok(image);
    } catch (error) {
      const message = getErrorMessage(error);
      return err(mapGoogleError(message));
    }
  }
}

function mapGoogleError(message: string): ImageGenerationError {
  const messageLower = message.toLowerCase();
  if (messageLower.includes('api_key') || messageLower.includes('api key')) {
    return { code: 'INVALID_KEY', message };
  }
  if (message.includes('429') || messageLower.includes('quota') || messageLower.includes('rate')) {
    return { code: 'RATE_LIMITED', message };
  }
  if (messageLower.includes('timeout') || messageLower.includes('timed out')) {
    return { code: 'TIMEOUT', message };
  }
  return { code: 'API_ERROR', message };
}

export function createGoogleImageGenerator(config: GoogleImageGeneratorConfig): ImageGenerator {
  return new GoogleImageGenerator(config);
}
