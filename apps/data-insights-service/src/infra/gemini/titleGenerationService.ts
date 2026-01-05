/**
 * Title generation service using Gemini.
 * Generates concise titles from content using user's Gemini API key.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import { createGeminiClient } from '@intexuraos/infra-gemini';
import type { UserServiceClient } from '../user/userServiceClient.js';
import { MAX_TITLE_LENGTH } from '../../domain/dataSource/index.js';

const TITLE_GENERATION_MODEL = 'gemini-2.5-flash';

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

const TITLE_PROMPT_TEMPLATE = `Analyze the following content and generate a concise, descriptive title that captures the main topic or purpose of the data.

Requirements:
- Maximum ${String(MAX_TITLE_LENGTH)} characters
- Be specific and descriptive
- Do not include quotes around the title
- Do not include any explanations, just the title itself

Content:
---
{CONTENT}
---

Title:`;

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
      });

      const contentPreview = content.length > 5000 ? content.slice(0, 5000) + '...' : content;
      const prompt = TITLE_PROMPT_TEMPLATE.replace('{CONTENT}', contentPreview);

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
