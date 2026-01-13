import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import { itemExtractionPrompt } from '@intexuraos/llm-common';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { UserServiceClient } from '../user/userServiceClient.js';
import pino from 'pino';

const MAX_ITEMS = 50;
const MAX_DESCRIPTION_LENGTH = 10000;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Extends Logger for type compatibility
interface MinimalLogger extends pino.Logger {}

const defaultLogger: MinimalLogger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'todoItemExtractionService',
}) as unknown as MinimalLogger;

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
  userServiceClient: UserServiceClient,
  logger?: MinimalLogger
): TodoItemExtractionService {
  const log: MinimalLogger = logger ?? defaultLogger;

  return {
    async extractItems(
      userId: string,
      description: string
    ): Promise<Result<ExtractedItem[], ExtractionError>> {
      log.info(
        {
          userId,
          descriptionLength: description.length,
        },
        'Starting LLM item extraction'
      );

      const clientResult = await userServiceClient.getLlmClient(userId);

      if (!clientResult.ok) {
        const error = clientResult.error;
        if (error.code === 'NO_API_KEY') {
          log.warn({ userId }, 'No API key configured for LLM extraction');
          return err({
            code: 'NO_API_KEY',
            message: error.message,
          });
        }
        log.error(
          {
            userId,
            userServiceError: error.message,
          },
          'Failed to get LLM client'
        );
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

      log.info(
        {
          userId,
          promptLength: prompt.length,
        },
        'Sending LLM generation request'
      );

      const result = await llmClient.generate(prompt);

      if (!result.ok) {
        const llmError = result.error;
        log.error(
          {
            userId,
            llmErrorCode: llmError.code,
            errorMessage: llmError.message,
          },
          'LLM generation failed'
        );
        return err({
          code: 'GENERATION_ERROR',
          message: `LLM generation failed: ${llmError.message}`,
          details: {
            llmErrorCode: llmError.code,
          },
        });
      }

      log.info(
        {
          userId,
          responseLength: result.value.content.length,
        },
        'LLM generation successful'
      );

      // Strip markdown code blocks if present (LLMs often wrap JSON in ```json ... ```)
      let cleaned = result.value.content.trim();
      const codeBlockRegex = /^```(?:json)?\s*\n([\s\S]*?)\n```$/;
      const codeBlockMatch = codeBlockRegex.exec(cleaned);
      const wasWrappedInMarkdown = codeBlockMatch !== null;
      if (wasWrappedInMarkdown && codeBlockMatch[1] !== undefined) {
        log.debug({ userId }, 'Response wrapped in markdown code block, stripping');
        cleaned = codeBlockMatch[1].trim();
      }

      try {
        const parsed = JSON.parse(cleaned) as unknown;

        if (!isValidExtractionResponse(parsed)) {
          log.error(
            {
              userId,
              parseError: 'Schema validation failed',
              rawResponsePreview: cleaned.slice(0, 500),
            },
            'LLM returned invalid response format'
          );
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

        log.info(
          {
            userId,
            itemCount: itemsWithDates.length,
          },
          'LLM item extraction completed successfully'
        );

        return ok(itemsWithDates);
      } catch (error) {
        log.error(
          {
            userId,
            parseError: getErrorMessage(error),
            rawResponsePreview: cleaned.slice(0, 500),
          },
          'Failed to parse LLM response'
        );
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
