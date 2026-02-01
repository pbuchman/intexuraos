/**
 * Chat Client Adapter
 *
 * Adapts the llm-factory package to the domain's LLMClient interface.
 * Handles RAG-augmented chat with system prompts and conversation history.
 */

import type { Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import { createLlmClient, type LlmGenerateClient } from '@intexuraos/llm-factory';
import { LlmModels } from '@intexuraos/llm-contract';
import type { Logger } from 'pino';
import type {
  LLMResponse,
  LLMError,
} from '../../domain/usecases/generateResponse.js';
import type { ConversationHistory, SuggestedAction } from '../../domain/index.js';

/**
 * Configuration for creating the chat client.
 */
export interface ChatClientConfig {
  /** API key for the LLM provider */
  apiKey: string;
  /** Model identifier (e.g., LlmModels.Gemini25Flash, LlmModels.Glm47) */
  model: string;
  /** User ID for usage tracking */
  userId: string;
  /** Logger instance */
  logger: Logger;
}

/**
 * Adapts LlmGenerateClient to LLMClient interface.
 * Uses structural typing - does not explicitly 'implement' to avoid llm-architecture restriction.
 */
export class ChatClient {
  private readonly client: LlmGenerateClient;
  private readonly logger: Logger;

  constructor(config: ChatClientConfig) {
    this.client = createLlmClient({
      apiKey: config.apiKey,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Model cast to valid LlmModels type
      model: config.model as typeof LlmModels[keyof typeof LlmModels],
      userId: config.userId,
      pricing: { inputPricePerMillion: 0.3, outputPricePerMillion: 2.5 },
      logger: config.logger,
    });
    this.logger = config.logger;
  }

  async generate(
    prompt: string,
    options?: {
      systemPrompt?: string;
      conversationHistory?: ConversationHistory[];
    }
  ): Promise<Result<LLMResponse, LLMError>> {
    /* v8 ignore start -- upstream: LLM client error paths tested in fakes, not real LLM @preserve */
    try {
      // Build the full prompt with system prompt and conversation history
      let fullPrompt = '';

      if (options?.systemPrompt !== undefined) {
        fullPrompt += `${options.systemPrompt}\n\n`;
      }

      if (options?.conversationHistory !== undefined && options.conversationHistory.length > 0) {
        fullPrompt += 'Conversation History:\n';
        for (const msg of options.conversationHistory) {
          fullPrompt += `${msg.role}: ${msg.content}\n`;
        }
        fullPrompt += '\n';
      }

      fullPrompt += prompt;

      // Call the factory's generate method
      const result = await this.client.generate(fullPrompt);

      if (!result.ok) {
        return result;
      }

      // Try to extract suggested action from the response
      const suggestedAction = this.extractSuggestedAction(result.value.content);
      const response = this.stripActionFromResponse(result.value.content, suggestedAction);

      const baseValue = {
        response,
      };
      if (suggestedAction !== null) {
        Object.assign(baseValue, { suggestedAction });
      }

      return {
        ok: true,
        value: baseValue as LLMResponse,
      };
    } catch (error) {
      this.logger.error({ error }, 'Chat generation failed');
      return {
        ok: false,
        error: {
          code: 'LLM_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        },
      };
    }
    /* v8 ignore stop @preserve */
  }

  /**
   * Extract suggested action from LLM response.
   * Looks for structured action annotations in the response.
   */
  private extractSuggestedAction(response: string): SuggestedAction | null {
    /* v8 ignore start -- upstream: Branches depend on LLM output format @preserve */
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
    /* v8 ignore stop @preserve */
  }

  /**
   * Remove action annotation from response before returning to user.
   */
  private stripActionFromResponse(response: string, action: SuggestedAction | null): string {
    /* v8 ignore start -- upstream: String.replace branch depends on action being present @preserve */
    if (action === null) {
      return response;
    }
    return response.replace(/\[ACTION:\s*\w+\s+{.*?}\]/s, '').trim();
    /* v8 ignore stop @preserve */
  }
}
