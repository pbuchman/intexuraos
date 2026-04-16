/**
 * LLM-based page summarizer with repair mechanism.
 * Uses user's LLM client to generate summaries from page content.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { Logger } from 'pino';
import { parseSummaryResponse, type ParseError } from './parseSummaryResponse.js';
import { summaryPrompt, summaryRepairPrompt } from './buildSummaryRepairPrompt.js';

/**
 * Summarization options.
 */
export interface SummarizeOptions {
  url: string;
  title?: string;
  description?: string;
  maxSentences?: number;
  maxReadingMinutes?: number;
}

/**
 * Error from page summarization.
 */
export interface PageSummaryError {
  code: 'API_ERROR' | 'PARSE_ERROR' | 'REPAIR_FAILED';
  message: string;
}

/**
 * Page summary result.
 */
export interface PageSummary {
  url: string;
  summary: string;
  wordCount: number;
  estimatedReadingMinutes: number;
}

const DEFAULT_MAX_SENTENCES = 20;
const DEFAULT_MAX_READING_MINUTES = 3;
const WORDS_PER_MINUTE = 200;

/**
 * Calculates estimated reading time from word count.
 */
function calculateReadingMinutes(wordCount: number): number {
  return Math.ceil(wordCount / WORDS_PER_MINUTE);
}

/**
 * Attempts to repair an invalid LLM response.
 */
async function attemptRepair(
  llmClient: LlmGenerateClient,
  originalContent: string,
  invalidResponse: string,
  parseError: ParseError,
  url: string,
  title: string | undefined, // @allow-undefined-type -- function parameter, not interface property
  description: string | undefined, // @allow-undefined-type -- function parameter, not interface property
  logger: Logger
): Promise<Result<PageSummary, PageSummaryError>> {
  logger.warn(
    { parseError: parseError.message },
    'Attempting repair of invalid summary response'
  );

  const repairPrompt = summaryRepairPrompt.build({
    originalContent,
    invalidResponse,
    errorMessage: parseError.message,
    url,
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
  });

  const repairResult = await llmClient.generate(repairPrompt, { promptType: 'page-summary-repair' });

  if (!repairResult.ok) {
    return err({
      code: 'REPAIR_FAILED',
      message: `Repair failed: ${repairResult.error.message}`,
    });
  }

  const parsed = parseSummaryResponse(repairResult.value.content, logger);
  if (!parsed.ok) {
    logger.error(
      { originalParseError: parseError.message, repairParseError: parsed.error.message },
      'Summary repair failed - second parse error'
    );
    return err({
      code: 'REPAIR_FAILED',
      message: `Parse failed after repair. Original: ${parseError.message}, Repair: ${parsed.error.message}`,
    });
  }

  const estimatedReadingMinutes = calculateReadingMinutes(parsed.value.wordCount); // @allow-result-access -- ok checked at line 90

  logger.info(
    { wordCount: parsed.value.wordCount, estimatedReadingMinutes }, // @allow-result-access -- ok checked at line 90
    'Summary repair successful'
  );

  return ok({
    url,
    summary: parsed.value.summary, // @allow-result-access -- ok checked at line 90
    wordCount: parsed.value.wordCount, // @allow-result-access -- ok checked at line 90
    estimatedReadingMinutes,
  });
}

/**
 * LLM summarizer interface.
 */
export interface LlmSummarizer {
  summarize(
    content: string,
    options: SummarizeOptions,
    llmClient: LlmGenerateClient
  ): Promise<Result<PageSummary, PageSummaryError>>;
}

/**
 * Creates an LLM summarizer with the given logger.
 */
export function createLlmSummarizer(logger: Logger): LlmSummarizer {
  return {
    async summarize(
      content: string,
      options: SummarizeOptions,
      llmClient: LlmGenerateClient
    ): Promise<Result<PageSummary, PageSummaryError>> {
      const maxSentences = options.maxSentences ?? DEFAULT_MAX_SENTENCES;
      const maxReadingMinutes = options.maxReadingMinutes ?? DEFAULT_MAX_READING_MINUTES;

      logger.info(
        { url: options.url, maxSentences, maxReadingMinutes },
        'Starting LLM summarization'
      );

      // Build prompt and append content
      const prompt = summaryPrompt.build({
        url: options.url,
        ...(options.title !== undefined && { title: options.title }),
        ...(options.description !== undefined && { description: options.description }),
        maxSentences,
        maxReadingMinutes,
      });
      const fullPrompt = `${prompt}\n\nContent to summarize:\n${content}`;

      // Generate summary
      const result = await llmClient.generate(fullPrompt, { promptType: 'page-summary' });

      if (!result.ok) {
        logger.error({ error: result.error.message }, 'LLM generation failed');
        return err({
          code: 'API_ERROR',
          message: result.error.message,
        });
      }

      // Parse response
      const parsed = parseSummaryResponse(result.value.content, logger);

      if (!parsed.ok) {
        // Attempt repair on parse error
        return await attemptRepair(
          llmClient,
          content,
          result.value.content, // @allow-result-access -- ok checked 16 lines above
          parsed.error,
          options.url,
          options.title,
          options.description,
          logger
        );
      }

      const estimatedReadingMinutes = calculateReadingMinutes(parsed.value.wordCount); // @allow-result-access -- ok checked at line 169

      logger.info(
        {
          url: options.url,
          wordCount: parsed.value.wordCount, // @allow-result-access -- ok checked at line 169
          estimatedReadingMinutes,
          summaryLength: parsed.value.summary.length, // @allow-result-access -- ok checked at line 169
        },
        'LLM summarization completed successfully'
      );

      return ok({
        url: options.url,
        summary: parsed.value.summary, // @allow-result-access -- ok checked at line 169
        wordCount: parsed.value.wordCount, // @allow-result-access -- ok checked at line 169
        estimatedReadingMinutes,
      });
    },
  };
}
