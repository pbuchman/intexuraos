import type { IPricingContext } from '@intexuraos/llm-pricing';
import type { Google, OpenAI } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import type {
  GeneratedImageRepository,
  PromptGenerator,
  ImageGenerator,
  ImageGenerationModel,
  ImageStorage,
} from './domain/index.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';

export interface ServiceContainer {
  generatedImageRepository: GeneratedImageRepository;
  imageStorage: ImageStorage;
  userServiceClient: UserServiceClient;
  pricingContext: IPricingContext;
  createPromptGenerator: (
    provider: Google | OpenAI,
    apiKey: string,
    userId: string,
    logger: Logger
  ) => PromptGenerator;
  createImageGenerator: (
    model: ImageGenerationModel,
    apiKey: string,
    userId: string,
    logger: Logger
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
