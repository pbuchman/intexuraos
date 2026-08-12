import { randomUUID } from 'node:crypto';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { HttpInternalAuthUsageSink, type UsageSink } from '@intexuraos/llm-pricing';
import { type OpenAI } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import type { ImageGenerationModel, PromptGenerator, ImageGenerator } from './domain/index.js';
import { createGeneratedImageRepository } from './infra/firestore/index.js';
import { createOpenAIImageGenerator } from './infra/image/index.js';
import { createGptPromptAdapter } from './infra/llm/index.js';
import { createGcsImageStorage } from './infra/storage/index.js';
import { createUserServiceClient } from '@intexuraos/internal-clients';
import { setServices } from './serviceContainer.js';

export function initializeServices(): void {
  const bucketName = process.env['INTEXURAOS_IMAGE_BUCKET'] ?? '';
  const publicBaseUrl = process.env['INTEXURAOS_IMAGE_PUBLIC_BASE_URL'];
  const storage = createGcsImageStorage(bucketName, publicBaseUrl);

  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
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
  });

  const container = {
    generatedImageRepository: createGeneratedImageRepository(),
    imageStorage: storage,
    userServiceClient,
    createPromptGenerator: (
      _provider: OpenAI,
      _model: string,
      apiKey: string,
      userId: string,
      logger: Logger
    ): PromptGenerator => {
      return createGptPromptAdapter({
        apiKey,
        userId,
        logger,
        usageSink: buildUsageSink('gpt-prompt-adapter'),
      });
    },
    createImageGenerator: (
      model: ImageGenerationModel,
      apiKey: string,
      userId: string,
      logger: Logger
    ): ImageGenerator => {
      return createOpenAIImageGenerator({
        apiKey,
        model,
        storage,
        userId,
        logger,
        usageSink: buildUsageSink('openai-image-generator'),
      });
    },
    generateId: (): string => randomUUID(),
  };

  setServices(container);
}
