import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import { calendarActionExtractionPrompt } from '@intexuraos/llm-common';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { LlmUserServiceClient } from '../user/llmUserServiceClient.js';
import type {
  CalendarActionExtractionService,
  ExtractedCalendarEvent,
  ExtractionError,
} from '../../domain/ports.js';
import pino from 'pino';

export type { CalendarActionExtractionService, ExtractedCalendarEvent, ExtractionError };

const MAX_DESCRIPTION_LENGTH = 1000;

type MinimalLogger = pino.Logger;

export function createCalendarActionExtractionService(
  llmUserServiceClient: LlmUserServiceClient,
  logger: MinimalLogger
): CalendarActionExtractionService {
  const log: MinimalLogger = logger;

  return {
    async extractEvent(
      userId: string,
      text: string,
      currentDate: string
    ): Promise<Result<ExtractedCalendarEvent, ExtractionError>> {
      log.info(
        {
          userId,
          textLength: text.length,
        },
        'Starting LLM calendar event extraction'
      );

      const clientResult = await llmUserServiceClient.getLlmClient(userId);

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

      const prompt = calendarActionExtractionPrompt.build(
        { text, currentDate },
        { maxDescriptionLength: MAX_DESCRIPTION_LENGTH }
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

        const event = parsed as ExtractedCalendarEvent;

        log.info(
          {
            userId,
            summary: event.summary,
            valid: event.valid,
          },
          'LLM calendar event extraction completed successfully'
        );

        return ok(event);
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

  if (typeof obj['summary'] !== 'string') return false;
  if (obj['start'] !== null && typeof obj['start'] !== 'string') return false;
  if (obj['end'] !== null && typeof obj['end'] !== 'string') return false;
  if (obj['location'] !== null && typeof obj['location'] !== 'string') return false;
  if (obj['description'] !== null && typeof obj['description'] !== 'string') return false;
  if (typeof obj['valid'] !== 'boolean') return false;
  if (obj['error'] !== null && typeof obj['error'] !== 'string') return false;
  if (typeof obj['reasoning'] !== 'string') return false;

  return true;
}
