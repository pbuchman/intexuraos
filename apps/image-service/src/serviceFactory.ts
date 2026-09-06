import { randomUUID } from 'node:crypto';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { HttpInternalAuthUsageSink, type UsageSink } from '@intexuraos/llm-pricing';
import { type OpenRouter } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import type { ImageGenerationModel, PromptGenerator, ImageGenerator } from './domain/index.js';
import { createGeneratedImageRepository } from './infra/firestore/index.js';
import { createOpenRouterImageGenerator } from './infra/image/index.js';
import { createOpenRouterPromptAdapter } from './infra/llm/index.js';
import { createGcsImageStorage } from './infra/storage/index.js';
import { createUserServiceClient } from '@intexuraos/internal-clients';
import { setServices } from './serviceContainer.js';

export function initializeServices(): void {
  const bucketName = process.env['INTEXURAOS_IMAGE_BUCKET'] ?? '';
  const publicBaseUrl = process.env['INTEXURAOS_IMAGE_PUBLIC_BASE_URL'];
  const storage = createGcsImageStorage(bucketName, publicBaseUrl);

  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
  const platformOpenRouterApiKey = process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] ?? '';
  const llmUsageServiceUrl = process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] ?? '';
  const sinkLogger = createAppLogger({ name: 'image-service-usage-sink' });
  const buildUsageSink = (component: string): UsageSink =>
    new HttpInternalAuthUsageSink({
      usageServiceUrl: llmUsageServiceUrl,
      internalAuthToken,
      service: 'image-service',
      component,
      logger: sinkLogger,
    });

  const userServiceClient = createUserServiceClient({
    baseUrl: process.env['INTEXURAOS_USER_SERVICE_URL'] ?? 'http://localhost:8110',
    internalAuthToken,
    logger: createAppLogger({ name: 'user-service-client' }),
    usageSink: buildUsageSink('user-service-client'),
    platformOpenRouterApiKey,
  });

  const container = {
    generatedImageRepository: createGeneratedImageRepository(),
    imageStorage: storage,
    userServiceClient,
    createPromptGenerator: (
      _provider: OpenRouter,
      _model: string,
      apiKey: string,
      userId: string,
      logger: Logger
    ): PromptGenerator => {
      return createOpenRouterPromptAdapter({
        apiKey,
        userId,
        logger,
        usageSink: buildUsageSink('openrouter-prompt-adapter'),
      });
    },
    createImageGenerator: (
      model: ImageGenerationModel,
      apiKey: string,
      userId: string,
      logger: Logger
    ): ImageGenerator => {
      return createOpenRouterImageGenerator({
        apiKey,
        model,
        storage,
        userId,
        logger,
        usageSink: buildUsageSink('openrouter-image-generator'),
      });
    },
    generateId: (): string => randomUUID(),
  };

  setServices(container);
}
