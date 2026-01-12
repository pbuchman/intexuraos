import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import { createGeminiClient } from '@intexuraos/infra-gemini';
import { LlmModels, type FastModel } from '@intexuraos/llm-contract';
import { itemExtractionPrompt } from '@intexuraos/llm-common';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import type { UserServiceClient } from '../user/userServiceClient.js';

const EXTRACTION_MODEL: FastModel = LlmModels.Gemini25Flash;
const MAX_ITEMS = 50;
const MAX_DESCRIPTION_LENGTH = 10000;

export interface ExtractionError {
  code: 'NO_API_KEY' | 'USER_SERVICE_ERROR' | 'GENERATION_ERROR' | 'INVALID_RESPONSE';
  message: string;
  details?: {
    llmErrorCode?: string;
    parseError?: string;
    rawResponsePreview?: string | undefined;
    userServiceError?: string;
  };
}

export interface ExtractedItem {
  title: string;
  priority: 'low' | 'medium' | 'high' | 'urgent' | null;
  dueDate: Date | null;
  reasoning: string;
}

export interface TodoItemExtractionService {
  extractItems(userId: string, description: string): Promise<Result<ExtractedItem[], ExtractionError>>;
}

export function createTodoItemExtractionService(
  userServiceClient: UserServiceClient,
  pricingContext: IPricingContext
): TodoItemExtractionService {
  const pricing = pricingContext.getPricing(EXTRACTION_MODEL);

  return {
    async extractItems(
      userId: string,
      description: string
    ): Promise<Result<ExtractedItem[], ExtractionError>> {
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
          message: `Failed to fetch API key: ${error.message}`,
          details: { userServiceError: error.message },
        });
      }

      const apiKey = keyResult.value;
      const geminiClient = createGeminiClient({
        apiKey,
        model: EXTRACTION_MODEL,
        userId,
        pricing,
      });

      const prompt = itemExtractionPrompt.build(
        { description },
        { maxItems: MAX_ITEMS, maxDescriptionLength: MAX_DESCRIPTION_LENGTH }
      );

      const result = await geminiClient.generate(prompt);

      if (!result.ok) {
        const llmError = result.error;
        return err({
          code: 'GENERATION_ERROR',
          message: `LLM generation failed: ${llmError.message}`,
          details: {
            llmErrorCode: llmError.code,
          },
        });
      }

      try {
        const trimmed = result.value.content.trim();
        const parsed = JSON.parse(trimmed) as unknown;

        if (!isValidExtractionResponse(parsed)) {
          return err({
            code: 'INVALID_RESPONSE',
            message: 'LLM returned invalid response format',
            details: {
              parseError: 'Schema validation failed',
              rawResponsePreview: trimmed.slice(0, 500),
            },
          });
        }

        const response = parsed as { items: ExtractedItem[]; summary: string };
        const items = response['items'].slice(0, MAX_ITEMS);

        const itemsWithDates = items.map((item) => ({
          ...item,
          dueDate: item.dueDate !== null ? new Date(item.dueDate) : null,
        }));

        return ok(itemsWithDates);
      } catch (error) {
        return err({
          code: 'INVALID_RESPONSE',
          message: `Failed to parse LLM response: ${getErrorMessage(error)}`,
          details: {
            parseError: getErrorMessage(error),
            rawResponsePreview: result.value.content.slice(0, 500),
          },
        });
      }
    },
  };
}

function isValidExtractionResponse(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;

  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj['items'])) return false;

  for (const item of obj['items'] as unknown[]) {
    if (typeof item !== 'object' || item === null) return false;
    const i = item as Record<string, unknown>;

    if (typeof i['title'] !== 'string') return false;
    if (i['priority'] !== null && typeof i['priority'] !== 'string') return false;
    if (i['dueDate'] !== null && typeof i['dueDate'] !== 'string') return false;
    if (typeof i['reasoning'] !== 'string') return false;

    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    if (i['priority'] !== null && !validPriorities.includes(i['priority'])) return false;
  }

  if (typeof obj['summary'] !== 'string') return false;

  return true;
}
