/**
 * Chat Client Factory
 *
 * Creates a chat client adapter from an LlmGenerateClient.
 * Handles RAG-augmented chat with system prompts and conversation history.
 */

import type { Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { Logger } from 'pino';
import type {
  LLMResponse,
  LLMError,
  LLMClient,
} from '../../domain/usecases/generateResponse.js';
import type { ConversationHistory, SuggestedAction } from '../../domain/index.js';

/**
 * Configuration for creating the chat client.
 */
export interface ChatClientConfig {
  /** LLM client for generating responses (from userServiceClient.getLlmClient) */
  llmClient: LlmGenerateClient;
  /** Logger instance */
  logger: Logger;
}

/**
 * Creates a chat client that wraps an LlmGenerateClient with additional
 * functionality for conversation history, system prompts, and action extraction.
 */
export function createChatClient(config: ChatClientConfig): LLMClient {
  const { llmClient, logger } = config;

  return {
    async generate(
      prompt: string,
      options: {
        systemPrompt: string;
        conversationHistory?: ConversationHistory[];
      }
    ): Promise<Result<LLMResponse, LLMError>> {
      try {
        // Build the full prompt with system prompt and conversation history
        let fullPrompt = `${options.systemPrompt}\n\n`;

        if (options.conversationHistory !== undefined && options.conversationHistory.length > 0) {
          fullPrompt += 'Conversation History:\n';
          for (const msg of options.conversationHistory) {
            fullPrompt += `${msg.role}: ${msg.content}\n`;
          }
          fullPrompt += '\n';
        }

        fullPrompt += prompt;

        // Call the LLM client's generate method
        const result = await llmClient.generate(fullPrompt);

        if (!result.ok) {
          return result;
        }

        // Try to extract suggested action from the response
        const suggestedAction = extractSuggestedAction(result.value.content);
        const response = stripActionFromResponse(result.value.content, suggestedAction);

        const baseValue: LLMResponse = {
          response,
        };
        if (suggestedAction !== null) {
          baseValue.suggestedAction = suggestedAction;
        }

        return {
          ok: true,
          value: baseValue,
        };
      } catch (error) {
        logger.error({ error }, 'Chat generation failed');
        return {
          ok: false,
          error: {
            code: 'LLM_ERROR',
            message: getErrorMessage(error, 'Unknown error'),
          },
        };
      }
    },
  };
}

/**
 * Extract suggested action from LLM response.
 * Looks for structured action annotations in the response.
 */
function extractSuggestedAction(response: string): SuggestedAction | null {
  // Look for action annotations like: [ACTION: create_command {"text": "..."}]
  const actionRegex = /\[ACTION:\s*(create_command)\s+({.*?})\]/s;
  const match = actionRegex.exec(response);

  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- Explicit null check clearer for regex exec result
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return null;
  }

  const payloadStr = match[2];
  try {
    return {
      type: match[1] as 'create_command',
      payload: JSON.parse(payloadStr) as Record<string, unknown>,
      awaitingConfirmation: true,
    };
  } catch {
    return null;
  }
}

/**
 * Remove action annotation from response before returning to user.
 */
function stripActionFromResponse(response: string, action: SuggestedAction | null): string {
  if (action === null) {
    return response;
  }
  return response.replace(/\[ACTION:\s*\w+\s+{.*?}\]/s, '').trim();
}
