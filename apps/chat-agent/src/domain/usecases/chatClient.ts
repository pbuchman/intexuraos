/**
 * Chat completion LLM client.
 *
 * Wraps the LLM factory's generate client for chat completions.
 * Handles structured responses with command intent detection.
 */

import { type Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { SuggestedAction } from '../../domain/index.js';
import type { LLMClient, LLMResponse, LLMError } from './generateResponse.js';

/** Configuration for creating a chat client. */
export interface ChatClientConfig {
  /** API key for the LLM provider */
  apiKey: string;
  /** Model to use for generation */
  model: string;
  /** User ID for tracking */
  userId: string;
  /** Logger instance */
  logger: Logger;
}

/**
 * Create a chat completion LLM client.
 */
export function createChatClient(config: ChatClientConfig): LLMClient {
  return new ChatClient(config);
}

/**
 * Chat client implementation using LLM factory.
 *
 * Wraps the generic LLM generate client and extracts
 * structured responses including command intent.
 */
class ChatClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly userId: string;
  private readonly logger: Logger;

  constructor(config: ChatClientConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.userId = config.userId;
    this.logger = config.logger;
  }

  async generate(
    prompt: string,
    options?: {
      systemPrompt?: string;
      conversationHistory?: { role: string; content: string }[];
    }
  ): Promise<Result<LLMResponse, LLMError>> {
    /* v8 ignore start -- test-infra: Adapter tested via MockLLMClient in generateResponse tests @preserve */
    // Import dynamically to get the client factory
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Dynamic import from external package
    const { createLlmClient } = await import('@intexuraos/llm-factory');

    // Create the LLM client
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- Model from user settings
    const rawClient = createLlmClient({
      apiKey: this.apiKey,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- Model from user settings
      model: this.model as any,
      userId: this.userId,
      logger: this.logger,
      pricing: {
        inputPricePerMillion: 0.001, // Default pricing
        outputPricePerMillion: 0.002,
      },
    });

    // Type the client to prevent cascading 'any' types
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Casting from any to specific type
    const llmClient: {
      generate: (prompt: string) => Promise<
        { ok: true; value: { content: string; usage?: unknown } } | { ok: false; error: { code: string; message: string } }
      >;
    } = rawClient;

    // Build the full prompt with system instruction and history
    const fullPrompt = this.buildFullPrompt(prompt, options?.systemPrompt, options?.conversationHistory);

    // Generate response
    const result = await llmClient.generate(fullPrompt);

    if (!result.ok) {
      return {
        ok: false,
        error: {
          code: result.error.code,
          message: result.error.message,
        },
      };
    }

    const { content } = result.value;

    // Try to extract suggested action from response
    const suggestedAction = this.extractSuggestedAction(content);

    // If the response contains a structured JSON block at the end, remove it
    const cleanedResponse = this.cleanResponse(content);

    const value: LLMResponse = {
      response: cleanedResponse,
    };

    // Only add suggestedAction if it's defined (exactOptionalPropertyTypes requirement)
    if (suggestedAction !== undefined) {
      value.suggestedAction = suggestedAction;
    }

    return {
      ok: true,
      value,
    };
    /* v8 ignore stop @preserve */
  }

  /**
   * Build the full prompt with system instruction and conversation history.
   */
  private buildFullPrompt(
    userMessage: string,
    systemPrompt?: string,
    history?: { role: string; content: string }[]
  ): string {
    /* v8 ignore start -- test-infra: Adapter tested via MockLLMClient in generateResponse tests @preserve */
    let prompt = '';

    if (systemPrompt !== undefined) {
      prompt += `System: ${systemPrompt}\n\n`;
    }

    if (history !== undefined && history.length > 0) {
      for (const msg of history) {
        prompt += `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.content}\n`;
      }
    }

    prompt += `User: ${userMessage}\nAssistant:`;
    return prompt;
    /* v8 ignore stop @preserve */
  }

  /**
   * Extract suggested action from response content.
   *
   * Looks for patterns like "I'll create a todo: '...'" or similar.
   */
  private extractSuggestedAction(content: string): SuggestedAction | undefined {
    /* v8 ignore start -- test-infra: Adapter tested via MockLLMClient in generateResponse tests @preserve */
    // Pattern: "create a todo/todo: 'X'" or similar
    const todoMatch = /create (a )?todo(?: to)?:? ['"'](.+?)['"']/i.exec(content);
    if (todoMatch !== null) {
      return {
        type: 'create_command',
        payload: {
          text: todoMatch[2] ?? '',
          source: 'pwa-shared',
        },
        awaitingConfirmation: true,
      };
    }

    // Pattern: "create a note/note: 'X'" or similar
    const noteMatch = /create (a )?note(?: about)?:? ['"'](.+?)['"']/i.exec(content);
    if (noteMatch !== null) {
      return {
        type: 'create_command',
        payload: {
          text: noteMatch[2] ?? '',
          source: 'pwa-shared',
        },
        awaitingConfirmation: true,
      };
    }

    // Pattern: "create a bookmark/bookmark: 'X'" or similar
    const bookmarkMatch = /create (a )?bookmark(?: for)?:? ['"'](.+?)['"']/i.exec(content);
    if (bookmarkMatch !== null) {
      return {
        type: 'create_command',
        payload: {
          text: bookmarkMatch[2] ?? '',
          source: 'pwa-shared',
        },
        awaitingConfirmation: true,
      };
    }

    // Pattern: "remind me to X"
    const remindMatch = /remind me (?:to )?(.+?)(?:\.|$)/i.exec(content);
    if (remindMatch !== null) {
      return {
        type: 'create_command',
        payload: {
          text: remindMatch[1] ?? '',
          source: 'pwa-shared',
        },
        awaitingConfirmation: true,
      };
    }

    return undefined;
    /* v8 ignore stop @preserve */
  }

  /**
   * Clean the response by removing any JSON metadata blocks.
   */
  private cleanResponse(content: string): string {
    // Remove structured action blocks if present (for cleaner display)
    return content.replace(/\n```json\n[\s\S]*?\n```\s*$/g, '').trim();
  }
}
