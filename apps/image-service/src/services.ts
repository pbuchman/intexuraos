import { randomUUID } from 'node:crypto';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import { LlmModels, LlmProviders, type Google, type OpenAI } from '@intexuraos/llm-contract';
import type {
  GeneratedImageRepository,
  PromptGenerator,
  ImageGenerator,
  ImageGenerationModel,
  ImageStorage,
} from './domain/index.js';
import { IMAGE_GENERATION_MODELS } from './domain/index.js';
import { createGeneratedImageRepository } from './infra/firestore/index.js';
import { createOpenAIImageGenerator, createGoogleImageGenerator } from './infra/image/index.js';
import { createGeminiPromptAdapter, createGptPromptAdapter } from './infra/llm/index.js';
import { createGcsImageStorage } from './infra/storage/index.js';
import {
  createUserServiceClient,
  type UserServiceClient,
  type DecryptedApiKeys,
} from './infra/user/index.js';

interface LoggerLike {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface ServiceContainer {
  generatedImageRepository: GeneratedImageRepository;
  imageStorage: ImageStorage;
  userServiceClient: UserServiceClient;
  pricingContext: IPricingContext;
  createPromptGenerator: (
    provider: Google | OpenAI,
    apiKey: string,
    userId: string,
    logger?: LoggerLike
  ) => PromptGenerator;
  createImageGenerator: (
    model: ImageGenerationModel,
    apiKey: string,
    userId: string
  ) => ImageGenerator;
  generateId: () => string;
}

let container: ServiceContainer | null = null;

export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initializeServices() first.');
  }
  return container;
}

export function setServices(services: ServiceContainer): void {
  container = services;
}

export function resetServices(): void {
  container = null;
}

export function initializeServices(pricingContext: IPricingContext): void {
  const bucketName = process.env['INTEXURAOS_IMAGE_BUCKET'] ?? '';
  const publicBaseUrl = process.env['INTEXURAOS_IMAGE_PUBLIC_BASE_URL'];
  const storage = createGcsImageStorage(bucketName, publicBaseUrl);

  const userServiceClient = createUserServiceClient({
    baseUrl: process.env['INTEXURAOS_USER_SERVICE_URL'] ?? 'http://localhost:8110',
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
  });

  // Get pricing for prompt generation models
  const geminiPricing = pricingContext.getPricing(LlmModels.Gemini25Flash);
  const gptPricing = pricingContext.getPricing(LlmModels.GPT4oMini);

  // Get pricing for image generation models
  const openaiImagePricing = pricingContext.getPricing(LlmModels.GPTImage1);
  const googleImagePricing = pricingContext.getPricing(LlmModels.Gemini25FlashImage);

  container = {
    generatedImageRepository: createGeneratedImageRepository(),
    imageStorage: storage,
    userServiceClient,
    pricingContext,
    createPromptGenerator: (
      provider: Google | OpenAI,
      apiKey: string,
      userId: string,
      _logger?: LoggerLike
    ): PromptGenerator => {
      if (provider === LlmProviders.Google) {
        return createGeminiPromptAdapter({ apiKey, userId, pricing: geminiPricing });
      }
      return createGptPromptAdapter({ apiKey, userId, pricing: gptPricing });
    },
    createImageGenerator: (
      model: ImageGenerationModel,
      apiKey: string,
      userId: string
    ): ImageGenerator => {
      const config = IMAGE_GENERATION_MODELS[model];
      if (config.provider === LlmProviders.OpenAI) {
        return createOpenAIImageGenerator({
          apiKey,
          model,
          storage,
          userId,
          pricing: gptPricing,
          imagePricing: openaiImagePricing,
        });
      }
      return createGoogleImageGenerator({
        apiKey,
        model,
        storage,
        userId,
        pricing: geminiPricing,
        imagePricing: googleImagePricing,
      });
    },
    generateId: (): string => randomUUID(),
  };
}

export type { DecryptedApiKeys };
