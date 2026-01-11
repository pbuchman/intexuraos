/**
 * Feed name generation service using Gemini.
 * Generates concise names for composite feeds based on their purpose and components.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import { createGeminiClient } from '@intexuraos/infra-gemini';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import { LlmModels, type FastModel } from '@intexuraos/llm-contract';
import { feedNamePrompt } from '@intexuraos/llm-common';
import type { UserServiceClient } from '../user/userServiceClient.js';
import type {
  FeedNameGenerationService,
  NameGenerationError,
} from '../../domain/compositeFeed/index.js';
import { MAX_FEED_NAME_LENGTH } from '../../domain/compositeFeed/index.js';

const NAME_GENERATION_MODEL: FastModel = LlmModels.Gemini25Flash;

/**
 * Create a feed name generation service.
 */
export function createFeedNameGenerationService(
  userServiceClient: UserServiceClient,
  pricingContext: IPricingContext
): FeedNameGenerationService {
  const pricing = pricingContext.getPricing(NAME_GENERATION_MODEL);

  return {
    async generateName(
      userId: string,
      purpose: string,
      sourceNames: string[],
      filterNames: string[]
    ): Promise<Result<string, NameGenerationError>> {
      const keyResult = await userServiceClient.getGeminiApiKey(userId);

      if (!keyResult.ok) {
        const error = keyResult.error;
        if (error.code === 'NO_API_KEY') {
          return err({
            code: 'NO_API_KEY',
            message: 'Please configure your Gemini API key in settings first',
          });
        }
        return err({
          code: 'USER_SERVICE_ERROR',
          message: error.message,
        });
      }

      const apiKey = keyResult.value;
      const geminiClient = createGeminiClient({
        apiKey,
        model: NAME_GENERATION_MODEL,
        userId,
        pricing,
      });

      const prompt = feedNamePrompt.build(
        { purpose, sourceNames, filterNames },
        { maxLength: MAX_FEED_NAME_LENGTH }
      );

      const result = await geminiClient.generate(prompt);

      if (!result.ok) {
        return err({
          code: 'GENERATION_ERROR',
          message: result.error.message,
        });
      }

      const name = result.value.content.trim().slice(0, MAX_FEED_NAME_LENGTH);

      return ok(name);
    },
  };
}
