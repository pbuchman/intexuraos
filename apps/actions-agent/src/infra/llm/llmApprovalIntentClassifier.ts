import type { Logger } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import {
  approvalIntentPrompt,
  parseApprovalIntentResponse,
} from '@intexuraos/llm-common';
import type {
  ApprovalIntentClassifier,
  ApprovalIntentResult,
} from '../../domain/ports/approvalIntentClassifier.js';

export interface LlmApprovalIntentClassifierConfig {
  llmClient: LlmGenerateClient;
  logger: Logger;
}

/**
 * Creates an LLM-based approval intent classifier.
 * Uses the user's configured LLM to determine approval intent from reply text.
 */
export function createLlmApprovalIntentClassifier(
  config: LlmApprovalIntentClassifierConfig
): ApprovalIntentClassifier {
  const { llmClient, logger } = config;

  return {
    async classify(text: string): Promise<ApprovalIntentResult> {
      logger.info({ textLength: text.length }, 'Classifying approval intent');

      // Handle empty/whitespace text as unclear
      const trimmedText = text.trim();
      if (trimmedText === '') {
        logger.info({}, 'Empty text received, returning unclear');
        return {
          intent: 'unclear',
          confidence: 1.0,
          reasoning: 'Empty or whitespace-only text',
        };
      }

      // Build the prompt
      const prompt = approvalIntentPrompt({
        input: { userReply: trimmedText },
      });

      // Call LLM
      const result = await llmClient.generate(prompt);

      if (!result.ok) {
        logger.error(
          { error: result.error },
          'LLM call failed, defaulting to unclear'
        );
        return {
          intent: 'unclear',
          confidence: 0.0,
          reasoning: `LLM error: ${result.error.message}`,
        };
      }

      // Parse response
      const parsed = parseApprovalIntentResponse(result.value.content);

      if (parsed === null) {
        logger.warn(
          { response: result.value.content },
          'Failed to parse LLM response, defaulting to unclear'
        );
        return {
          intent: 'unclear',
          confidence: 0.0,
          reasoning: 'Failed to parse LLM response',
        };
      }

      logger.info(
        {
          intent: parsed.intent,
          confidence: parsed.confidence,
          reasoning: parsed.reasoning,
        },
        'Approval intent classified'
      );

      return parsed;
    },
  };
}
