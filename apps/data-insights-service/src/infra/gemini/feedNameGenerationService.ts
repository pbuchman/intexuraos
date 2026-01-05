/**
 * Feed name generation service using Gemini.
 * Generates concise names for composite feeds based on their purpose and components.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import { createGeminiClient } from '@intexuraos/infra-gemini';
import type { UserServiceClient } from '../user/userServiceClient.js';
import type {
  FeedNameGenerationService,
  NameGenerationError,
} from '../../domain/compositeFeed/index.js';
import { MAX_FEED_NAME_LENGTH } from '../../domain/compositeFeed/index.js';

const NAME_GENERATION_MODEL = 'gemini-2.5-flash';

const NAME_PROMPT_TEMPLATE = `Generate a concise, descriptive name for a data feed based on the following information.

Purpose: {PURPOSE}
Data sources included: {SOURCES}
Notification filters: {FILTERS}

Requirements:
- Maximum ${String(MAX_FEED_NAME_LENGTH)} characters
- Be specific and descriptive
- Do not include quotes around the name
- Do not include any explanations, just the name itself
- The name should reflect what data the feed aggregates

Name:`;

/**
 * Create a feed name generation service.
 */
export function createFeedNameGenerationService(
  userServiceClient: UserServiceClient
): FeedNameGenerationService {
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
      });

      const sourcesText = sourceNames.length > 0 ? sourceNames.join(', ') : 'None';
      const filtersText = filterNames.length > 0 ? filterNames.join(', ') : 'None';

      const prompt = NAME_PROMPT_TEMPLATE.replace('{PURPOSE}', purpose)
        .replace('{SOURCES}', sourcesText)
        .replace('{FILTERS}', filtersText);

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
