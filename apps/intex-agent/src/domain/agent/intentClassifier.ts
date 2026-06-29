import {
  IntexAgentIntentClassifierOutputSchema,
  intexAgentIntentClassifierPrompt,
  intexAgentIntentClassifierRepairPrompt,
  type IntexAgentBlockerReason,
  type IntexAgentIntentClassifierOutput,
  type IntexAgentIntentClassifierPromptMessage,
  type IntexAgentIntentClassifierToolName,
  type IntexAgentStylePreferenceAction,
} from '@intexuraos/llm-prompts';
import type { Logger as AppLogger } from '@intexuraos/common-core';
import {
  formatZodErrors,
  generateStructured,
  type StructuredClient,
  withRetry,
} from '@intexuraos/llm-utils';
import {
  selectIntexAgentReplyLanguage,
  type IntexAgentLanguageMessage,
  type IntexAgentReplyLanguage,
} from './capabilities.js';
import {
  formatUserMessageWithReplyContext,
  parseIncomingReplyContext,
} from '../messages/sessionMessageFormatting.js';
import type { IntexIncomingMessageReplyContext } from '../ports/incomingMessageHandler.js';
import type { IntexAgentSessionEvent, IntexAgentToolName } from '../sessions/types.js';
import { classifyIntexAgentIntent } from './intentGate.js';

export const INTEX_AGENT_INTENT_CLASSIFIER_PROMPT_TYPE = 'intex-agent-intent-classifier';
const GENERIC_CLARIFICATION_QUESTIONS: Record<IntexAgentReplyLanguage, string> = {
  en: 'What would you like me to do with this?',
  pl: 'Co mam z tym zrobić?',
};
const GENERIC_CLARIFICATION_NEXT_STEPS: Record<IntexAgentReplyLanguage, string> = {
  en: 'Ask the user to restate the action.',
  pl: 'Poproś użytkownika o doprecyzowanie akcji.',
};

const PREFERENCE_TOOL_NAMES = [
  'get_user_preferences',
  'add_user_preference',
  'update_user_preference',
  'delete_user_preference',
] as const satisfies readonly IntexAgentToolName[];

const PREFERENCE_TOOL_NAME_SET = new Set<IntexAgentToolName>(PREFERENCE_TOOL_NAMES);

export interface IntexAgentIntentClassifierInput {
  message: string;
  events: IntexAgentSessionEvent[];
  currentDateTime: string;
  replyContext?: IntexIncomingMessageReplyContext;
}

export type IntexAgentIntentClassification =
  | {
      kind: 'tool';
      allowedToolNames: IntexAgentToolName[];
      reason?: string;
      stylePreferenceAction?: IntexAgentStylePreferenceAction;
      languageOverride?: string;
      decisionEvidence?: string;
    }
  | {
      kind: 'no_action';
      reason: 'greeting' | 'conversation';
      stylePreferenceAction?: IntexAgentStylePreferenceAction;
      languageOverride?: string;
      decisionEvidence?: string;
    }
  | {
      kind: 'needs_clarification';
      question: string;
      blockerReason?: IntexAgentBlockerReason;
      missingFields?: string[];
      candidateIntents?: IntexAgentToolName[];
      suggestedNextStep?: string;
      stylePreferenceAction?: IntexAgentStylePreferenceAction;
      languageOverride?: string;
      reason?: string;
      decisionEvidence?: string;
    }
  | {
      kind: 'unsupported';
      reason: IntexAgentBlockerReason;
      blockerReason: IntexAgentBlockerReason;
      suggestedNextStep: string;
      stylePreferenceAction?: IntexAgentStylePreferenceAction;
      languageOverride?: string;
      decisionEvidence?: string;
    };

export interface IntexAgentIntentClassifier {
  classify(input: IntexAgentIntentClassifierInput): Promise<IntexAgentIntentClassification>;
}

export function createLlmIntexAgentIntentClassifier(deps: {
  client: StructuredClient;
  logger: AppLogger;
}): IntexAgentIntentClassifier {
  return {
    async classify(input): Promise<IntexAgentIntentClassification> {
      const replyLanguage = classifierReplyLanguage(input);
      const directIntent = classifyIntexAgentIntent(input.message);
      if (directIntent.kind === 'no_action' && directIntent.reason === 'greeting') {
        return directIntent;
      }

      const prompt = intexAgentIntentClassifierPrompt.build({
        currentDateTime: input.currentDateTime,
        messages: buildClassifierMessages(input.events, input.message, input.replyContext),
      });
      const retryingClient = createRetryingStructuredClient(deps.client);
      const result = await generateStructured({
        client: retryingClient,
        prompt,
        schema: IntexAgentIntentClassifierOutputSchema,
        promptType: INTEX_AGENT_INTENT_CLASSIFIER_PROMPT_TYPE,
        repairBuilder: (raw, error) =>
          intexAgentIntentClassifierRepairPrompt.build({
            originalPrompt: prompt,
            invalidResponse: raw,
            errorMessage: formatZodErrors(error),
          }),
        maxRepairAttempts: 1,
      });

      if (!result.ok) {
        deps.logger.warn(
          {
            errorKind: result.error.kind,
            ...(result.error.kind === 'llm' ? { errorCode: result.error.error.code } : {}),
            promptType: INTEX_AGENT_INTENT_CLASSIFIER_PROMPT_TYPE,
          },
          'Intex Agent intent classifier failed; falling back to clarification'
        );
        return genericClarification(replyLanguage);
      }

      return mapValidatedClassifierOutput(result.value.data, replyLanguage);
    },
  };
}

function createRetryingStructuredClient(client: StructuredClient): StructuredClient {
  return {
    generate(prompt, options): ReturnType<StructuredClient['generate']> {
      return withRetry(() => client.generate(prompt, options), {
        maxAttempts: 3,
        baseDelayMs: 250,
      });
    },
  };
}

function mapValidatedClassifierOutput(
  output: IntexAgentIntentClassifierOutput,
  replyLanguage: IntexAgentReplyLanguage
): IntexAgentIntentClassification {
  if (output.outcome === 'tool') {
    const allowedToolNames = normalizeAllowedToolNames(output.allowedToolNames);
    if (
      allowedToolNames.length > 1 &&
      !allowedToolNames.every((toolName) => PREFERENCE_TOOL_NAME_SET.has(toolName))
    ) {
      return clarificationFromOutput(output, replyLanguage);
    }
    return {
      kind: 'tool',
      allowedToolNames,
      ...(output.reason !== undefined ? { reason: output.reason } : {}),
      ...stylePreferenceFields(output.stylePreferenceAction),
      ...(output.languageOverride !== undefined ? { languageOverride: output.languageOverride } : {}),
      ...(output.decisionEvidence !== undefined ? { decisionEvidence: output.decisionEvidence } : {}),
    };
  }

  if (output.outcome === 'needs_clarification') {
    return clarificationFromOutput(output, replyLanguage);
  }

  if (output.outcome === 'unsupported') {
    return {
      kind: 'unsupported',
      reason: output.blockerReason,
      blockerReason: output.blockerReason,
      suggestedNextStep: output.suggestedNextStep,
      ...stylePreferenceFields(output.stylePreferenceAction),
      ...(output.languageOverride !== undefined ? { languageOverride: output.languageOverride } : {}),
      ...(output.decisionEvidence !== undefined ? { decisionEvidence: output.decisionEvidence } : {}),
    };
  }

  if (output.outcome === 'greeting') {
    return {
      kind: 'no_action',
      reason: 'greeting',
      ...stylePreferenceFields(output.stylePreferenceAction),
      ...(output.languageOverride !== undefined ? { languageOverride: output.languageOverride } : {}),
      ...(output.decisionEvidence !== undefined ? { decisionEvidence: output.decisionEvidence } : {}),
    };
  }

  return {
    kind: 'no_action',
    reason: 'conversation',
    ...stylePreferenceFields(output.stylePreferenceAction),
    ...(output.languageOverride !== undefined ? { languageOverride: output.languageOverride } : {}),
    ...(output.decisionEvidence !== undefined ? { decisionEvidence: output.decisionEvidence } : {}),
  };
}

function buildClassifierMessages(
  events: IntexAgentSessionEvent[],
  currentMessage: string,
  currentReplyContext: IntexIncomingMessageReplyContext | undefined
): IntexAgentIntentClassifierPromptMessage[] {
  const messages: IntexAgentIntentClassifierPromptMessage[] = [];
  for (const event of events) {
    const message = classifierMessageFromEvent(event);
    if (message !== null) {
      // Unlike the runner, preserve duplicate assistant turns as intent signal for the classifier.
      messages.push(message);
    }
  }
  messages.push({
    role: 'user',
    content: formatUserMessageWithReplyContext(currentMessage, currentReplyContext),
  });
  return messages;
}

function classifierMessageFromEvent(
  event: IntexAgentSessionEvent
): IntexAgentIntentClassifierPromptMessage | null {
  if (event.type === 'user_message') {
    const text = event.payload['text'];
    const replyContext = parseIncomingReplyContext(event.payload['replyContext']);
    return typeof text === 'string'
      ? { role: 'user', content: formatUserMessageWithReplyContext(text, replyContext) }
      : null;
  }

  if (event.type === 'clarification_requested' || event.type === 'assistant_message') {
    const message = event.payload['message'] ?? event.payload['text'];
    return typeof message === 'string' ? { role: 'assistant', content: message } : null;
  }

  if (event.type === 'tool_call_completed') {
    const toolName = event.payload['toolName'];
    const result = event.payload['result'];
    return typeof toolName === 'string'
      ? { role: 'assistant', content: `Tool ${toolName} completed: ${JSON.stringify(result ?? {})}` }
      : null;
  }

  return null;
}

function normalizeAllowedToolNames(
  values: readonly IntexAgentIntentClassifierToolName[]
): IntexAgentToolName[] {
  const toolNames: IntexAgentToolName[] = [];
  for (const value of values) {
    if (!toolNames.includes(value)) {
      toolNames.push(value);
    }
  }
  return toolNames;
}

function clarificationFromOutput(
  output: Extract<IntexAgentIntentClassifierOutput, { outcome: 'needs_clarification' | 'tool' }>,
  replyLanguage: IntexAgentReplyLanguage
): IntexAgentIntentClassification {
  return {
    kind: 'needs_clarification',
    question:
      readQuestion(output.question) ??
      readQuestion(output.clarification) ??
      GENERIC_CLARIFICATION_QUESTIONS[replyLanguage],
    ...(output.blockerReason !== undefined ? { blockerReason: output.blockerReason } : {}),
    ...(output.missingFields !== undefined ? { missingFields: output.missingFields } : {}),
    ...(output.candidateIntents !== undefined
      ? { candidateIntents: normalizeAllowedToolNames(output.candidateIntents) }
      : {}),
    ...(output.suggestedNextStep !== undefined ? { suggestedNextStep: output.suggestedNextStep } : {}),
    ...stylePreferenceFields(output.stylePreferenceAction),
    ...(output.languageOverride !== undefined ? { languageOverride: output.languageOverride } : {}),
    ...(output.reason !== undefined ? { reason: output.reason } : {}),
    ...(output.decisionEvidence !== undefined ? { decisionEvidence: output.decisionEvidence } : {}),
  };
}

function stylePreferenceFields(
  stylePreferenceAction: IntexAgentStylePreferenceAction
): { stylePreferenceAction?: IntexAgentStylePreferenceAction } {
  return stylePreferenceAction === 'none' ? {} : { stylePreferenceAction };
}

function genericClarification(replyLanguage: IntexAgentReplyLanguage): IntexAgentIntentClassification {
  return {
    kind: 'needs_clarification',
    question: GENERIC_CLARIFICATION_QUESTIONS[replyLanguage],
    blockerReason: 'not_enough_context',
    suggestedNextStep: GENERIC_CLARIFICATION_NEXT_STEPS[replyLanguage],
  };
}

function readQuestion(question: string | undefined): string | undefined {
  return question !== undefined && question.trim() !== '' ? question.trim() : undefined;
}

function classifierReplyLanguage(input: IntexAgentIntentClassifierInput): IntexAgentReplyLanguage {
  return selectIntexAgentReplyLanguage({
    currentMessage: { text: input.message },
    priorMessages: classifierPriorLanguageMessages(input.events),
  });
}

function classifierPriorLanguageMessages(
  events: IntexAgentSessionEvent[]
): IntexAgentLanguageMessage[] {
  const messages: IntexAgentLanguageMessage[] = [];
  for (const event of events) {
    if (event.type !== 'user_message') {
      continue;
    }
    const text = event.payload['text'];
    if (typeof text === 'string') {
      messages.push({ text });
    }
  }
  return messages.reverse();
}
