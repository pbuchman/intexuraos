/**
 * LLM-based extraction service for Linear issues.
 * Parses natural language into structured issue data.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import { linearActionExtractionPrompt } from '@intexuraos/llm-common';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { LlmUserServiceClient } from '../user/llmUserServiceClient.js';
import type { ExtractedIssueData, LinearError } from '../../domain/index.js';
import pino from 'pino';

const MAX_DESCRIPTION_LENGTH = 2000;

type MinimalLogger = pino.Logger;

export interface LinearActionExtractionService {
  extractIssue(userId: string, text: string): Promise<Result<ExtractedIssueData, LinearError>>;
}

export function createLinearActionExtractionService(
  llmUserServiceClient: LlmUserServiceClient,
  logger: MinimalLogger
): LinearActionExtractionService {
  const log: MinimalLogger = logger;

  return {
    async extractIssue(
      userId: string,
      text: string
    ): Promise<Result<ExtractedIssueData, LinearError>> {
      log.info({ userId, textLength: text.length }, 'Starting LLM issue extraction');

      const clientResult = await llmUserServiceClient.getLlmClient(userId);

      if (!clientResult.ok) {
        const error = clientResult.error;
        if (error.code === 'NO_API_KEY') {
          log.warn({ userId }, 'No API key configured for LLM extraction');
          return err({ code: 'NOT_CONNECTED', message: error.message });
        }
        log.error({ userId, error: error.message }, 'Failed to get LLM client');
        return err({ code: 'INTERNAL_ERROR', message: error.message });
      }

      const llmClient: LlmGenerateClient = clientResult.value;

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

      // Clean response (remove markdown code blocks if present)
      let cleaned = result.value.content.trim();
      const codeBlockRegex = /^```(?:json)?\s*\n([\s\S]*?)\n```$/;
      const codeBlockMatch = codeBlockRegex.exec(cleaned);
      if (codeBlockMatch?.[1] !== undefined) {
        cleaned = codeBlockMatch[1].trim();
      }

      try {
        const parsed = JSON.parse(cleaned) as unknown;

        if (!isValidExtractionResponse(parsed)) {
          log.error({ userId, rawPreview: cleaned.slice(0, 500) }, 'Invalid response format');
          return err({ code: 'EXTRACTION_FAILED', message: 'Invalid LLM response format' });
        }

        const extracted = parsed as ExtractedIssueData;
        log.info({ userId, title: extracted.title, valid: extracted.valid }, 'Extraction complete');

        return ok(extracted);
      } catch (error) {
        log.error({ userId, parseError: getErrorMessage(error) }, 'Failed to parse LLM response');
        return err({
          code: 'EXTRACTION_FAILED',
          message: `Failed to parse: ${getErrorMessage(error)}`,
        });
      }
    },
  };
}

function isValidExtractionResponse(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;

  const obj = value as Record<string, unknown>;

  if (typeof obj['title'] !== 'string') return false;
  if (typeof obj['priority'] !== 'number') return false;
  if (obj['priority'] < 0 || obj['priority'] > 4) return false;
  if (obj['functionalRequirements'] !== null && typeof obj['functionalRequirements'] !== 'string')
    return false;
  if (obj['technicalDetails'] !== null && typeof obj['technicalDetails'] !== 'string') return false;
  if (typeof obj['valid'] !== 'boolean') return false;
  if (obj['error'] !== null && typeof obj['error'] !== 'string') return false;
  if (typeof obj['reasoning'] !== 'string') return false;

  return true;
}
