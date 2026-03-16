/**
 * Generate a chat response with RAG context.
 *
 * This use case:
 * 1. Searches documentation for relevant context
 * 2. Builds a prompt with system prompt, RAG context, and conversation history
 * 3. Generates a response using the LLM
 * 4. Extracts sources from used chunks
 * 5. Handles command intent detection and confirmation
 */

import { getSystemPrompt } from '../prompts/systemPrompt.js';
import type {
  ChatResponse,
  ConversationHistory,
  DocChunkWithScore,
  DocSource,
  SuggestedAction,
} from '../../domain/index.js';
import type { Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { searchDocumentation, type SearchDocumentationDeps } from './searchDocumentation.js';

/** Error codes for generate response operations. */
export type GenerateErrorCode =
  | 'LLM_ERROR'
  | 'SEARCH_ERROR'
  | 'INVALID_REQUEST'
  | 'EMPTY_MESSAGE';

/** Error type for generate response operations. */
export interface GenerateError {
  code: GenerateErrorCode;
  message: string;
}

/** Input for generating a chat response. */
export interface GenerateResponseInput {
  /** The user's message */
  message: string;
  /** Conversation history (last N messages) */
  conversationHistory: ConversationHistory[];
  /** User ID for fetching model settings */
  userId: string;
  /** Pending action from previous response (for confirmation flow) */
  pendingAction?: SuggestedAction;
}

/** Dependencies for generateResponse use case. */
export interface GenerateResponseDeps {
  /** LLM client for generating responses */
  llmClient: LLMClient;
  /** Search documentation dependency */
  searchDocumentation: SearchDocumentationDeps;
  /** Logger instance */
  logger: Logger;
}

/** LLM client interface for chat completion. */
export interface LLMClient {
  generate(
    prompt: string,
    options?: {
      systemPrompt?: string;
      conversationHistory?: ConversationHistory[];
    }
  ): Promise<Result<LLMResponse, LLMError>>;
}

/** Response from LLM client. */
export interface LLMResponse {
  /** The generated response text */
  response: string;
  /** Optional suggested action (command intent) */
  suggestedAction?: SuggestedAction;
}

/** Error from LLM client. */
export interface LLMError {
  code: string;
  message: string;
}

/** Maximum number of conversation messages to include */
const MAX_HISTORY_LENGTH = 20;

/** Affirmative phrases for confirmation (English and Polish) */
const AFFIRMATIVE_PHRASES = new Set([
  'yes',
  'yeah',
  'yep',
  'sure',
  'ok',
  'okay',
  'do it',
  'confirm',
  'go ahead',
  'tak',
  'jasne',
  'zrób to',
  'potwierdź',
]);

/**
 * Generate a chat response with RAG context.
 */
export async function generateResponse(
  deps: GenerateResponseDeps,
  input: GenerateResponseInput
): Promise<Result<ChatResponse, GenerateError>> {
  const { llmClient, logger } = deps;
  const { message, conversationHistory, userId, pendingAction } = input;

  // Validate input
  const trimmedMessage = message.trim();
  if (trimmedMessage.length === 0) {
    return {
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Message cannot be empty' },
    };
  }

  logger.info({ userId, messageLength: trimmedMessage.length }, 'Generating response');

  // Check for confirmation first (bypasses normal flow)
  const confirmationResult = checkConfirmation(trimmedMessage, pendingAction);
  if (confirmationResult !== null) {
    logger.info({ confirmed: confirmationResult.awaitingConfirmation }, 'Confirmation detected');
    // Still search docs to provide context, but confirmation takes priority
  }

  // Search for relevant documentation
  const searchResult = await searchDocumentation(
    {
      embeddingRepository: deps.searchDocumentation.embeddingRepository,
      embeddingClient: deps.searchDocumentation.embeddingClient,
      logger: deps.searchDocumentation.logger,
    },
    trimmedMessage,
    {
      limit: 5,
      minScore: 0.7,
    }
  );

  if (!searchResult.ok) {
    return {
      ok: false,
      error: { code: 'SEARCH_ERROR', message: searchResult.error.message },
    };
  }

  const chunks = searchResult.value;

  // Build RAG context string
  const ragContext = buildRAGContext(chunks);

  // Limit conversation history
  const limitedHistory = limitConversationHistory(conversationHistory);

  // Build system prompt with fallback if no docs
  const systemPrompt = chunks.length > 0
    ? getSystemPrompt()
    : `${getSystemPrompt()}

IMPORTANT: The user asked a question but I couldn't find specific documentation about it.
Start your response with: "I don't have specific IntexuraOS docs on this, but generally..."
Then provide helpful general guidance if applicable.`;

  // Build full prompt
  const prompt = buildPrompt(ragContext, limitedHistory, trimmedMessage);

  // Generate response
  const llmResult = await llmClient.generate(prompt, {
    systemPrompt,
    conversationHistory: limitedHistory,
  });

  if (!llmResult.ok) {
    logger.error({ error: llmResult.error }, 'LLM generation failed');
    return {
      ok: false,
      error: { code: 'LLM_ERROR', message: llmResult.error.message },
    };
  }

  const { response, suggestedAction: llmAction } = llmResult.value;

  // Extract sources from chunks
  const sources = extractSources(chunks);

  // Use confirmation result if detected, otherwise use LLM's suggested action
  const suggestedAction = confirmationResult ?? (llmAction ?? null);

  logger.info(
    {
      responseLength: response.length,
      sourceCount: sources.length,
      hasSuggestedAction: suggestedAction !== null,
    },
    'Response generated successfully'
  );

  return {
    ok: true,
    value: {
      response,
      sources,
      suggestedAction,
    },
  };
}

/**
 * Check if the user's message is a confirmation of a pending action.
 */
function checkConfirmation(
  message: string,
  pendingAction: SuggestedAction | undefined
): SuggestedAction | null {
  if (pendingAction === undefined) {
    return null;
  }

  const normalizedMessage = message.toLowerCase().trim();
  /* v8 ignore start -- ts-type: split() always returns at least one element for non-empty strings @preserve */
  const firstWord = normalizedMessage.split(/\s+/)[0] ?? ''; // fallback for TypeScript strict null checks
  /* v8 ignore stop @preserve */

  if (AFFIRMATIVE_PHRASES.has(firstWord) || AFFIRMATIVE_PHRASES.has(normalizedMessage)) {
    return {
      ...pendingAction,
      awaitingConfirmation: false,
    };
  }

  return null;
}

/**
 * Build RAG context string from document chunks.
 */
function buildRAGContext(chunks: DocChunkWithScore[]): string {
  if (chunks.length === 0) {
    return '';
  }

  const parts: string[] = [];
  for (const chunk of chunks) {
    parts.push(`[Source: ${chunk.filePath} - ${chunk.section}]\n${chunk.content}`);
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Limit conversation history to MAX_HISTORY_LENGTH messages.
 */
function limitConversationHistory(history: ConversationHistory[]): ConversationHistory[] {
  if (history.length <= MAX_HISTORY_LENGTH) {
    return history;
  }
  return history.slice(-MAX_HISTORY_LENGTH);
}

/**
 * Build the full prompt for the LLM.
 */
function buildPrompt(
  ragContext: string,
  history: ConversationHistory[],
  currentMessage: string
): string {
  let prompt = '';

  if (ragContext.length > 0) {
    prompt += `Relevant Documentation:\n${ragContext}\n\n`;
  }

  if (history.length > 0) {
    prompt += `Conversation History:\n`;
    for (const msg of history) {
      prompt += `${msg.role}: ${msg.content}\n`;
    }
    prompt += '\n';
  }

  prompt += `User: ${currentMessage}`;
  return prompt;
}

/**
 * Extract sources from document chunks.
 */
function extractSources(chunks: DocChunkWithScore[]): DocSource[] {
  return chunks.map((chunk) => ({
    filePath: chunk.filePath,
    section: chunk.section,
  }));
}
