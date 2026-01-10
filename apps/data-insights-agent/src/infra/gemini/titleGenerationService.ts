/**
 * Title generation service using Gemini.
 * Generates concise titles from content using user's Gemini API key.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import { createGeminiClient } from '@intexuraos/infra-gemini';
import { LlmModels, type FastModel } from '@intexuraos/llm-contract';
import { titlePrompt } from '@intexuraos/llm-common';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import type { UserServiceClient } from '../user/userServiceClient.js';
import { MAX_TITLE_LENGTH } from '../../domain/dataSource/index.js';

const TITLE_GENERATION_MODEL: FastModel = LlmModels.Gemini25Flash;

/**
 * Error from title generation operations.
 */
export interface TitleGenerationError {
  code: 'NO_API_KEY' | 'GENERATION_ERROR' | 'USER_SERVICE_ERROR';
  message: string;
}

/**
 * Title generation service interface.
 */
export interface TitleGenerationService {
  generateTitle(userId: string, content: string): Promise<Result<string, TitleGenerationError>>;
}

/**
 * Create a title generation service.
 */
export function createTitleGenerationService(
  userServiceClient: UserServiceClient,
  pricingContext: IPricingContext
): TitleGenerationService {
  const pricing = pricingContext.getPricing(TITLE_GENERATION_MODEL);

  return {
    async generateTitle(
      userId: string,
      content: string
    ): Promise<Result<string, TitleGenerationError>> {
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
        model: TITLE_GENERATION_MODEL,
        userId,
        pricing,
      });

      const prompt = titlePrompt.build(
        { content },
        { maxLength: MAX_TITLE_LENGTH, contentPreviewLimit: 5000 }
      );

      const result = await geminiClient.generate(prompt);

      if (!result.ok) {
        return err({
          code: 'GENERATION_ERROR',
          message: result.error.message,
        });
      }

      const title = result.value.content.trim().slice(0, MAX_TITLE_LENGTH);

      return ok(title);
    },
  };
}
