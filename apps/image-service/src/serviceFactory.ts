import { randomUUID } from 'node:crypto';
import { createAppLogger } from '@intexuraos/infra-sentry';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import { LlmModels, LlmProviders, type Google, type OpenAI } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import type { ImageGenerationModel, PromptGenerator, ImageGenerator } from './domain/index.js';
import { IMAGE_GENERATION_MODELS } from './domain/index.js';
import { createGeneratedImageRepository } from './infra/firestore/index.js';
import { createOpenAIImageGenerator, createGoogleImageGenerator } from './infra/image/index.js';
import { createGeminiPromptAdapter, createGptPromptAdapter } from './infra/llm/index.js';
import { createGcsImageStorage } from './infra/storage/index.js';
import { createUserServiceClient } from '@intexuraos/internal-clients';
import { setServices } from './serviceContainer.js';

export function initializeServices(pricingContext: IPricingContext): void {
  const bucketName =
    process.env['INTEXURAOS_IMAGE_BUCKET'] ?? ''; /* v8 ignore module-init -- Tested via integration tests @preserve */
  const publicBaseUrl = process.env['INTEXURAOS_IMAGE_PUBLIC_BASE_URL'];
  const storage = createGcsImageStorage(bucketName, publicBaseUrl);

  const userServiceClient = createUserServiceClient({
    baseUrl:
      process.env['INTEXURAOS_USER_SERVICE_URL'] ??
      'http://localhost:8110' /* v8 ignore module-init -- Tested via integration tests @preserve */,
    internalAuthToken:
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ??
      '' /* v8 ignore module-init -- Tested via integration tests @preserve */,
    pricingContext,
    logger: createAppLogger({ name: 'user-service-client' }),
    platformGeminiApiKey: process.env['INTEXURAOS_GEMINI_APP_API_KEY'],
  });

  // Get pricing for prompt generation models
  const geminiPricing = pricingContext.getPricing(LlmModels.Gemini25Flash);
  const gptPricing = pricingContext.getPricing(LlmModels.GPT4oMini);

  // Get pricing for image generation models
  const openaiImagePricing = pricingContext.getPricing(LlmModels.GPTImage1);
  const googleImagePricing = pricingContext.getPricing(LlmModels.Gemini25FlashImage);

  const container = {
    generatedImageRepository: createGeneratedImageRepository(),
    imageStorage: storage,
    userServiceClient,
    pricingContext,
    createPromptGenerator: (
      provider: Google | OpenAI,
      apiKey: string,
      userId: string,
      logger: Logger
    ): PromptGenerator => {
      if (provider === LlmProviders.Google) {
        return createGeminiPromptAdapter({ apiKey, userId, pricing: geminiPricing, logger });
      }
      return createGptPromptAdapter({ apiKey, userId, pricing: gptPricing, logger });
    },
    createImageGenerator: (
      model: ImageGenerationModel,
      apiKey: string,
      userId: string,
      logger: Logger
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
          logger,
        });
      }
      return createGoogleImageGenerator({
        apiKey,
        model,
        storage,
        userId,
        pricing: geminiPricing,
        imagePricing: googleImagePricing,
        logger,
      });
    },
    generateId: (): string => randomUUID(),
  };

  setServices(container);
}
