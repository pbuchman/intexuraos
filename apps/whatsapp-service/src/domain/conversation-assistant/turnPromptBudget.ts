import type { LlmChatMessage } from '@intexuraos/llm-contract';
import {
  buildWhatsAppConversationAssistantMessages,
  type WhatsAppConversationAssistantStructuredPromptInput,
} from '@intexuraos/llm-prompts';
import type { ConversationAssistantTurnRequestPromptSnapshot } from './turnRequestPorts.js';

export const CONVERSATION_ASSISTANT_HARD_PROMPT_TOKEN_UPPER_BOUND = 200_000;

export function buildConversationAssistantTurnPromptMessages(
  input: ConversationAssistantTurnRequestPromptSnapshot
): LlmChatMessage[] {
  return buildWhatsAppConversationAssistantMessages(toPromptInput(input));
}

export function estimateConversationAssistantTurnPromptTokens(
  messages: readonly LlmChatMessage[]
): number {
  // Provider-independent hard upper bound: in the worst case each serialized
  // UTF-8 byte may become a token. This avoids undercounting punctuation and
  // base64-like content before selecting a model-specific client.
  return Buffer.byteLength(JSON.stringify(messages), 'utf8');
}

function toPromptInput(
  input: ConversationAssistantTurnRequestPromptSnapshot
): WhatsAppConversationAssistantStructuredPromptInput {
  return {
    transcriptText: input.transcriptText,
    ...(input.chatDisplayName === undefined
      ? {}
      : { chatDisplayName: input.chatDisplayName }),
    range: input.range,
    effectiveRange: input.effectiveRange,
    history: input.history,
    currentTurn: {
      text: input.currentQuestion,
      ...(input.currentContextUpdate === undefined
        ? {}
        : { contextUpdate: input.currentContextUpdate }),
    },
  };
}
