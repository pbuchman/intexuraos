import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import {
  calendarActionExtractionPrompt,
  CalendarEventSchema,
  buildCalendarExtractionRepairPrompt,
} from '@intexuraos/llm-prompts';
import { formatZodErrors } from '@intexuraos/llm-utils';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type {
  CalendarActionExtractionService,
  ExtractionError,
} from '../../domain/ports.js';
import type { ExtractedCalendarEvent } from '../../domain/ports.js';
import type pino from 'pino';

export type { CalendarActionExtractionService, ExtractedCalendarEvent, ExtractionError };

const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_REPAIR_ATTEMPTS = 1;

type MinimalLogger = pino.Logger;

interface ParseResult {
  success: true;
  event: ExtractedCalendarEvent;
}

interface ParseError {
  success: false;
  errorMessage: string;
  rawResponse: string;
  wasWrappedInMarkdown: boolean;
}

type ParseAttemptResult = ParseResult | ParseError;

function parseAndValidateResponse(rawContent: string): ParseAttemptResult {
  let cleaned = rawContent.trim();
  const codeBlockRegex = /^```(?:json)?\s*\n([\s\S]*?)\n```$/;
  const codeBlockMatch = codeBlockRegex.exec(cleaned);
  const wasWrappedInMarkdown = codeBlockMatch !== null;
  if (wasWrappedInMarkdown && codeBlockMatch[1] !== undefined) {
    cleaned = codeBlockMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return {
      success: false,
      errorMessage: `JSON parse error: ${getErrorMessage(e)}`,
      rawResponse: cleaned,
      wasWrappedInMarkdown,
    };
  }

  const validationResult = CalendarEventSchema.safeParse(parsed);
  if (!validationResult.success) {
    const zodErrors = formatZodErrors(validationResult.error);
    return {
      success: false,
      errorMessage: `Schema validation failed: ${zodErrors}`,
      rawResponse: cleaned,
      wasWrappedInMarkdown,
    };
  }

  return {
    success: true,
    event: {
      summary: validationResult.data.summary,
      start: validationResult.data.start,
      end: validationResult.data.end,
      location: validationResult.data.location,
      description: validationResult.data.description,
      valid: validationResult.data.valid,
      error: validationResult.data.error,
      reasoning: validationResult.data.reasoning,
    },
  };
}

export function createCalendarActionExtractionService(
  llmUserServiceClient: UserServiceClient,
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

      const result = await llmClient.generate(prompt, { promptType: 'calendar-action-extraction' });

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
          responseLength: result.value.content.length, // @allow-result-access -- ok checked at line 148
        },
        'LLM generation successful'
      );

      const parseResult = parseAndValidateResponse(result.value.content); // @allow-result-access -- ok checked at line 148

      if (parseResult.success) {
        log.info(
          {
            userId,
            summary: parseResult.event.summary,
            valid: parseResult.event.valid,
          },
          'LLM calendar event extraction completed successfully'
        );
        return ok(parseResult.event);
      }

      log.warn(
        {
          userId,
          errorMessage: parseResult.errorMessage,
          rawResponsePreview: parseResult.rawResponse.slice(0, 500),
          wasWrappedInMarkdown: parseResult.wasWrappedInMarkdown,
        },
        'Initial extraction failed, attempting repair'
      );

      for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt++) {
        const repairPrompt = buildCalendarExtractionRepairPrompt(
          text,
          currentDate,
          parseResult.rawResponse,
          parseResult.errorMessage
        );

        log.info(
          {
            userId,
            repairAttempt: attempt + 1,
            maxAttempts: MAX_REPAIR_ATTEMPTS,
            repairPromptLength: repairPrompt.length,
          },
          'Sending repair prompt'
        );

        const repairResult = await llmClient.generate(repairPrompt, { promptType: 'calendar-action-extraction-repair' });

        if (!repairResult.ok) {
          log.error(
            {
              userId,
              repairAttempt: attempt + 1,
              llmErrorCode: repairResult.error.code,
              errorMessage: repairResult.error.message,
            },
            'Repair LLM generation failed'
          );
          continue;
        }

        log.info(
          {
            userId,
            repairAttempt: attempt + 1,
            responseLength: repairResult.value.content.length, // @allow-result-access -- ok checked at line 219
          },
          'Repair LLM generation successful'
        );

        const repairParseResult = parseAndValidateResponse(repairResult.value.content); // @allow-result-access -- ok checked at line 219

        if (repairParseResult.success) {
          log.info(
            {
              userId,
              repairAttempt: attempt + 1,
              summary: repairParseResult.event.summary,
              valid: repairParseResult.event.valid,
            },
            'Repair extraction succeeded'
          );
          return ok(repairParseResult.event);
        }

        log.warn(
          {
            userId,
            repairAttempt: attempt + 1,
            errorMessage: repairParseResult.errorMessage,
            rawResponsePreview: repairParseResult.rawResponse.slice(0, 500),
          },
          'Repair attempt failed'
        );
      }

      log.error(
        {
          userId,
          errorMessage: parseResult.errorMessage,
          rawResponsePreview: parseResult.rawResponse.slice(0, 500),
          wasWrappedInMarkdown: parseResult.wasWrappedInMarkdown,
          repairAttemptsMade: MAX_REPAIR_ATTEMPTS,
        },
        'LLM extraction failed after repair attempts'
      );

      return err({
        code: 'INVALID_RESPONSE',
        message: `LLM returned invalid response format: ${parseResult.errorMessage}`,
        details: {
          parseError: parseResult.errorMessage,
          rawResponsePreview: parseResult.rawResponse.slice(0, 1000),
          wasWrappedInMarkdown: parseResult.wasWrappedInMarkdown,
        },
      });
    },
  };
}
