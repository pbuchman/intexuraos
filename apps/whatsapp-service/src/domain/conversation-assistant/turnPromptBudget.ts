import {
  getConversationAssistantModelInputTokenBudget,
  isConversationAssistantModel,
  type LlmChatMessage,
} from '@intexuraos/llm-contract';
import {
  buildWhatsAppConversationAssistantMessages,
  type WhatsAppConversationAssistantStructuredPromptInput,
} from '@intexuraos/llm-prompts';
import type { ConversationAssistantTurnRequestPromptSnapshot } from './turnRequestPorts.js';

const CONVERSATION_ASSISTANT_LEGACY_INPUT_TOKEN_BUDGET = 100_000;

export function buildConversationAssistantTurnPromptMessages(
  input: ConversationAssistantTurnRequestPromptSnapshot
): LlmChatMessage[] {
  return buildWhatsAppConversationAssistantMessages(toPromptInput(input));
}

export function estimateConversationAssistantTurnPromptTokens(
  messages: readonly LlmChatMessage[]
): number {
  // Conversation transcripts are natural-language text. Two UTF-8 bytes per
  // token is deliberately more conservative than typical provider tokenizers
  // while avoiding the previous byte-equals-token overcount.
  return Math.ceil(Buffer.byteLength(JSON.stringify(messages), 'utf8') / 2);
}

export function getConversationAssistantTurnPromptTokenBudget(model: string): number {
  return isConversationAssistantModel(model)
    ? getConversationAssistantModelInputTokenBudget(model)
    : CONVERSATION_ASSISTANT_LEGACY_INPUT_TOKEN_BUDGET;
}

export function isConversationAssistantTurnPromptWithinBudget(
  model: string,
  messages: readonly LlmChatMessage[]
): boolean {
  return (
    estimateConversationAssistantTurnPromptTokens(messages) <=
    getConversationAssistantTurnPromptTokenBudget(model)
  );
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
