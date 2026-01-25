import type { Result, Logger } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import {
  itemExtractionPrompt,
  TodoExtractionResponseSchema,
  type TodoExtractionResponse,
} from '@intexuraos/llm-prompts';
import { formatZodErrors } from '@intexuraos/llm-utils';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type {
  TodoItemExtractionService,
  ExtractionError,
  ExtractedItem,
} from '../../domain/ports/todoItemExtractionService.js';

export type { TodoItemExtractionService, ExtractionError, ExtractedItem };

const MAX_ITEMS = 50;
const MAX_DESCRIPTION_LENGTH = 10000;

export function createTodoItemExtractionService(
  userServiceClient: UserServiceClient,
  logger: Logger
): TodoItemExtractionService {
  return {
    async extractItems(
      userId: string,
      description: string
    ): Promise<Result<ExtractedItem[], ExtractionError>> {
      logger.info(
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
          logger.warn({ userId }, 'No API key configured for LLM extraction');
          return err({
            code: 'NO_API_KEY',
            message: error.message,
          });
        }
        logger.error(
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

      logger.info(
        {
          userId,
          promptLength: prompt.length,
        },
        'Sending LLM generation request'
      );

      const result = await llmClient.generate(prompt);

      if (!result.ok) {
        const llmError = result.error;
        logger.error(
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

      logger.info(
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
        logger.debug({ userId }, 'Response wrapped in markdown code block, stripping');
        cleaned = codeBlockMatch[1].trim();
      }

      try {
        const parsed = JSON.parse(cleaned) as unknown;

        const result = TodoExtractionResponseSchema.safeParse(parsed);
        if (!result.success) {
          const zodErrors = formatZodErrors(result.error);
          logger.error(
            {
              userId,
              zodErrors,
              rawResponsePreview: cleaned.slice(0, 500),
            },
            'LLM returned invalid response format'
          );
          return err({
            code: 'INVALID_RESPONSE',
            message: `LLM returned invalid response format: ${zodErrors}`,
            details: {
              zodErrors,
              rawResponsePreview: cleaned.slice(0, 1000),
              wasWrappedInMarkdown,
            },
          });
        }

        const response: TodoExtractionResponse = result.data;
        const items = response.items.slice(0, MAX_ITEMS);

        const itemsWithDates = items.map((item) => ({
          ...item,
          dueDate: item.dueDate !== null ? new Date(item.dueDate) : null,
        }));

        logger.info(
          {
            userId,
            itemCount: itemsWithDates.length,
          },
          'LLM item extraction completed successfully'
        );

        return ok(itemsWithDates);
      } catch (error) {
        logger.error(
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
