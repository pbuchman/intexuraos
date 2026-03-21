/**
 * LLM-based extraction service for Linear issues.
 * Parses natural language into structured issue data.
 *
 * NOTE: Tested via FakeLinearActionExtractionService in route/use case tests.
 */

import type { Result } from '@intexuraos/common-core';
import { err } from '@intexuraos/common-core';
import { linearActionExtractionPrompt } from '@intexuraos/llm-prompts';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { ExtractedIssueData, LinearError } from '../../domain/index.js';
import { parseExtractionResponse } from '../../domain/index.js';
import type pino from 'pino';

const MAX_DESCRIPTION_LENGTH = 2000;

type MinimalLogger = pino.Logger;

export interface LinearActionExtractionService {
  extractIssue(userId: string, text: string): Promise<Result<ExtractedIssueData, LinearError>>;
}

export function createLinearActionExtractionService(
  userServiceClient: UserServiceClient,
  logger: MinimalLogger
): LinearActionExtractionService {
  const log: MinimalLogger = logger;

  return {
    async extractIssue(
      userId: string,
      text: string
    ): Promise<Result<ExtractedIssueData, LinearError>> {
      log.info({ userId, textLength: text.length }, 'Starting LLM issue extraction');

      const clientResult = await userServiceClient.getLlmClient(userId);

      if (!clientResult.ok) {
        const error = clientResult.error;
        if (error.code === 'NO_API_KEY') {
          log.warn({ userId }, 'No API key configured for LLM extraction');
          return err({ code: 'NOT_CONNECTED', message: error.message });
        }
        log.error({ userId, error: error.message }, 'Failed to get LLM client');
        return err({ code: 'INTERNAL_ERROR', message: error.message });
      }

      const llmClient = clientResult.value;

      const prompt = linearActionExtractionPrompt.build(
        { text },
        { maxDescriptionLength: MAX_DESCRIPTION_LENGTH }
      );

      log.info({ userId, promptLength: prompt.length }, 'Sending LLM generation request');

      const result = await llmClient.generate(prompt);

      if (!result.ok) {
        log.error({ userId, error: result.error.message }, 'LLM generation failed');
        return err({ code: 'EXTRACTION_FAILED', message: result.error.message });
      }

      log.info(
        { userId, responseLength: result.value.content.length },
        'LLM generation successful'
      );

      const parseResult = parseExtractionResponse(result.value.content);
      if (!parseResult.ok) {
        log.error(
          { userId, error: parseResult.error.message, rawResponsePreview: result.value.content.slice(0, 500) },
          'Failed to parse LLM response'
        );
        return parseResult;
      }

      log.info({ userId, title: parseResult.value.title, valid: parseResult.value.valid }, 'Extraction complete');

      return parseResult;
    },
  };
}

