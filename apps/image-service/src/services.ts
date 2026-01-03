import type { GeneratedImageRepository, PromptGenerator, ImageGenerator } from './domain/index.js';
import { createGeneratedImageRepository } from './infra/firestore/index.js';
import { createFakeImageGenerator } from './infra/image/index.js';
import { createGeminiPromptAdapter, createGptPromptAdapter } from './infra/llm/index.js';
import {
  createUserServiceClient,
  type UserServiceClient,
  type DecryptedApiKeys,
} from './infra/user/index.js';

export interface ServiceContainer {
  generatedImageRepository: GeneratedImageRepository;
  imageGenerator: ImageGenerator;
  userServiceClient: UserServiceClient;
  createPromptGenerator: (provider: 'google' | 'openai', apiKey: string) => PromptGenerator;
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

  const userServiceClient = createUserServiceClient({
    baseUrl: process.env['INTEXURAOS_USER_SERVICE_URL'] ?? 'http://localhost:8110',
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
  });

  container = {
    generatedImageRepository: createGeneratedImageRepository(),
    imageGenerator: createFakeImageGenerator({ bucketName }),
    userServiceClient,
    createPromptGenerator: (provider: 'google' | 'openai', apiKey: string): PromptGenerator => {
      if (provider === 'google') {
        return createGeminiPromptAdapter({ apiKey });
      }
      return createGptPromptAdapter({ apiKey });
    },
    generateId: (): string => crypto.randomUUID(),
  };
}

export type { DecryptedApiKeys };
