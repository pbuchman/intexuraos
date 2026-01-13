import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import { itemExtractionPrompt } from '@intexuraos/llm-common';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { UserServiceClient } from '../user/userServiceClient.js';

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
    wasWrappedInMarkdown?: boolean;
    originalLength?: number;
    cleanedLength?: number;
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
  userServiceClient: UserServiceClient
): TodoItemExtractionService {
  return {
    async extractItems(
      userId: string,
      description: string
    ): Promise<Result<ExtractedItem[], ExtractionError>> {
      const clientResult = await userServiceClient.getLlmClient(userId);

      if (!clientResult.ok) {
        const error = clientResult.error;
        if (error.code === 'NO_API_KEY') {
          return err({
            code: 'NO_API_KEY',
            message: error.message,
          });
        }
        return err({
          code: 'USER_SERVICE_ERROR',
          message: `Failed to get LLM client: ${error.message}`,
          details: { userServiceError: error.message },
        });
      }

      const llmClient: LlmGenerateClient = clientResult.value;

      const prompt = itemExtractionPrompt.build(
        { description },
        { maxItems: MAX_ITEMS, maxDescriptionLength: MAX_DESCRIPTION_LENGTH }
      );

      const result = await llmClient.generate(prompt);

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

      // Strip markdown code blocks if present (LLMs often wrap JSON in ```json ... ```)
      let cleaned = result.value.content.trim();
      const codeBlockRegex = /^```(?:json)?\s*\n([\s\S]*?)\n```$/;
      const codeBlockMatch = codeBlockRegex.exec(cleaned);
      const wasWrappedInMarkdown = codeBlockMatch !== null;
      if (wasWrappedInMarkdown && codeBlockMatch[1] !== undefined) {
        cleaned = codeBlockMatch[1].trim();
      }

      try {
        const parsed = JSON.parse(cleaned) as unknown;

        if (!isValidExtractionResponse(parsed)) {
          return err({
            code: 'INVALID_RESPONSE',
            message: 'LLM returned invalid response format',
            details: {
              parseError: 'Schema validation failed',
              rawResponsePreview: cleaned.slice(0, 1000),
              wasWrappedInMarkdown,
            },
          });
        }

        const response = parsed as { items: ExtractedItem[]; summary: string };
        const items = response.items.slice(0, MAX_ITEMS);

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
            rawResponsePreview: cleaned.slice(0, 1000),
            wasWrappedInMarkdown,
            originalLength: result.value.content.length,
            cleanedLength: cleaned.length,
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
