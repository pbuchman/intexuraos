import type {
  GeneratedImageRepository,
  PromptGenerator,
  ImageGenerator,
  ImageGenerationModel,
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

export interface ServiceContainer {
  generatedImageRepository: GeneratedImageRepository;
  userServiceClient: UserServiceClient;
  createPromptGenerator: (provider: 'google' | 'openai', apiKey: string) => PromptGenerator;
  createImageGenerator: (model: ImageGenerationModel, apiKey: string) => ImageGenerator;
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

export function initializeServices(): void {
  const bucketName = process.env['INTEXURAOS_IMAGE_BUCKET'] ?? '';
  const storage = createGcsImageStorage(bucketName);

  const userServiceClient = createUserServiceClient({
    baseUrl: process.env['INTEXURAOS_USER_SERVICE_URL'] ?? 'http://localhost:8110',
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
  });

  container = {
    generatedImageRepository: createGeneratedImageRepository(),
    userServiceClient,
    createPromptGenerator: (provider: 'google' | 'openai', apiKey: string): PromptGenerator => {
      if (provider === 'google') {
        return createGeminiPromptAdapter({ apiKey });
      }
      return createGptPromptAdapter({ apiKey });
    },
    createImageGenerator: (model: ImageGenerationModel, apiKey: string): ImageGenerator => {
      const config = IMAGE_GENERATION_MODELS[model];
      if (config.provider === 'openai') {
        return createOpenAIImageGenerator({ apiKey, model, storage });
      }
      return createGoogleImageGenerator({ apiKey, model, storage });
    },
    generateId: (): string => crypto.randomUUID(),
  };
}

export type { DecryptedApiKeys };
