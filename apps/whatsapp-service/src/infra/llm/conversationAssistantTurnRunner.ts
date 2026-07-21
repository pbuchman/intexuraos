import { err, ok } from '@intexuraos/common-core';
import {
  WHATSAPP_CONVERSATION_ASSISTANT_PROMPT,
} from '@intexuraos/llm-prompts';
import type { ConversationAssistantLlmClientFactory } from '../../domain/conversation-assistant/ports.js';
import type {
  ConversationAssistantTurnRequestRunner,
} from '../../domain/conversation-assistant/turnRequestPorts.js';
import {
  CONVERSATION_ASSISTANT_HARD_PROMPT_TOKEN_UPPER_BOUND,
  buildConversationAssistantTurnPromptMessages,
  estimateConversationAssistantTurnPromptTokens,
} from '../../domain/conversation-assistant/turnPromptBudget.js';

export const CONVERSATION_ASSISTANT_TURN_RUNNER_HARD_PROMPT_TOKEN_LIMIT =
  CONVERSATION_ASSISTANT_HARD_PROMPT_TOKEN_UPPER_BOUND;
export { estimateConversationAssistantTurnPromptTokens };

const SAFE_LLM_ERROR = {
  code: 'LLM_ERROR',
  message: 'The answer could not be generated',
} as const;

const CONTEXT_WINDOW_EXCEEDED_ERROR = {
  code: 'CONTEXT_WINDOW_EXCEEDED',
  message: 'This update is too large to include in one question.',
} as const;

export interface ConversationAssistantTurnRunnerDeps {
  llmClientFactory: ConversationAssistantLlmClientFactory;
}

export function createConversationAssistantTurnRunner(
  deps: ConversationAssistantTurnRunnerDeps
): ConversationAssistantTurnRequestRunner {
  return {
    async generateAnswer(
      input,
      onDelta
    ): ReturnType<ConversationAssistantTurnRequestRunner['generateAnswer']> {
      try {
        const messages = buildConversationAssistantTurnPromptMessages(input);
        if (
          estimateConversationAssistantTurnPromptTokens(messages) >
          CONVERSATION_ASSISTANT_TURN_RUNNER_HARD_PROMPT_TOKEN_LIMIT
        ) {
          return err(CONTEXT_WINDOW_EXCEEDED_ERROR);
        }

        const clientResult = await deps.llmClientFactory.createLlmClientForUser(
          input.userId,
          input.model
        );
        if (!clientResult.ok || clientResult.value.generateChatStream === undefined) {
          return err(SAFE_LLM_ERROR);
        }

        const generated = await clientResult.value.generateChatStream(
          messages,
          {
            promptType: WHATSAPP_CONVERSATION_ASSISTANT_PROMPT.promptType,
            temperature: 0.2,
            reasoning: { enabled: true },
          },
          (event) => {
            if (event.type === 'delta') onDelta(event.text);
          }
        );
        if (!generated.ok) return err(SAFE_LLM_ERROR);
        return ok({ text: generated.value.content, usage: generated.value.usage });
      } catch {
        return err(SAFE_LLM_ERROR);
      }
    },
  };
}
