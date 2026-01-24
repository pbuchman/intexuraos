/**
 * Feed name generation service using LLM client.
 * Generates concise names for composite feeds based on their purpose and components.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import { feedNamePrompt } from '@intexuraos/llm-prompts';
import type { UserServiceClient } from '../user/userServiceClient.js';
import type {
  FeedNameGenerationService,
  NameGenerationError,
} from '../../domain/compositeFeed/index.js';
import { MAX_FEED_NAME_LENGTH } from '../../domain/compositeFeed/index.js';

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
      const clientResult = await userServiceClient.getLlmClient(userId);

      if (!clientResult.ok) {
        const error = clientResult.error;
        if (error.code === 'NO_API_KEY') {
          return err({
            code: 'NO_API_KEY',
            message: 'Please configure your LLM API key in settings first',
          });
        }
        return err({
          code: 'USER_SERVICE_ERROR',
          message: error.message,
        });
      }

      const llmClient = clientResult.value;

      const prompt = feedNamePrompt.build(
        { purpose, sourceNames, filterNames },
        { maxLength: MAX_FEED_NAME_LENGTH }
      );

      const result = await llmClient.generate(prompt);

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
