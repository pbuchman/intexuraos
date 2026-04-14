import { randomUUID } from 'node:crypto';
import { createAppLogger } from '@intexuraos/infra-sentry';
import {
  HttpInternalAuthUsageSink,
  type IPricingContext,
  type UsageSink,
} from '@intexuraos/llm-pricing';
import { LlmModels, LlmProviders, type Google, type LLMModel, type OpenAI } from '@intexuraos/llm-contract';
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
    pricingContext,
    logger: createAppLogger({ name: 'user-service-client' }),
    usageSink: buildUsageSink('user-service-client'),
    platformGeminiApiKey: process.env['INTEXURAOS_GEMINI_APP_API_KEY'],
  });

  // Get pricing for text prompt generation (GPT model pricing is fixed; Gemini prompt pricing is resolved per-model at call time)
  const gptPricing = pricingContext.getPricing(LlmModels.GPT4oMini);

  // Get pricing for image generation models
  const openaiImagePricing = pricingContext.getPricing(LlmModels.GPTImage1);
  const googleImagePricing = pricingContext.getPricing(LlmModels.Gemini25FlashImage);
  const geminiFlashPricing = pricingContext.getPricing(LlmModels.Gemini25Flash);

  const container = {
    generatedImageRepository: createGeneratedImageRepository(),
    imageStorage: storage,
    userServiceClient,
    pricingContext,
    createPromptGenerator: (
      provider: Google | OpenAI,
      model: string,
      apiKey: string,
      userId: string,
      logger: Logger
    ): PromptGenerator => {
      if (provider === LlmProviders.Google) {
        const pricing = pricingContext.getPricing(model as LLMModel);
        return createGeminiPromptAdapter({
          apiKey,
          model,
          userId,
          pricing,
          logger,
          usageSink: buildUsageSink('gemini-prompt-adapter'),
        });
      }
      return createGptPromptAdapter({
        apiKey,
        userId,
        pricing: gptPricing,
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
          usageSink: buildUsageSink('openai-image-generator'),
        });
      }
      return createGoogleImageGenerator({
        apiKey,
        model,
        storage,
        userId,
        pricing: geminiFlashPricing,
        imagePricing: googleImagePricing,
        logger,
        usageSink: buildUsageSink('google-image-generator'),
      });
    },
    generateId: (): string => randomUUID(),
  };

  setServices(container);
}
