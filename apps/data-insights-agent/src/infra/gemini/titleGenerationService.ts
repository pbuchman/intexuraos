/**
 * Title generation service using LLM client.
 * Generates concise titles from content.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import { titlePrompt } from '@intexuraos/llm-prompts';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { MAX_TITLE_LENGTH } from '../../domain/dataSource/index.js';

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
  userServiceClient: UserServiceClient
): TitleGenerationService {
  return {
    async generateTitle(
      userId: string,
      content: string
    ): Promise<Result<string, TitleGenerationError>> {
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

      const prompt = titlePrompt.build(
        { content },
        { maxLength: MAX_TITLE_LENGTH, contentPreviewLimit: 5000 }
      );

      const result = await llmClient.generate(prompt);

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
