import {
  INTEX_AGENT_INTENT_CLASSIFIER_CONFIDENCE_THRESHOLDS,
  IntexAgentIntentClassifierOutputSchema,
  intexAgentIntentClassifierPrompt,
  intexAgentIntentClassifierRepairPrompt,
  type IntexAgentIntentClassifierOutput,
  type IntexAgentIntentClassifierPromptMessage,
  type IntexAgentIntentClassifierToolName,
} from '@intexuraos/llm-prompts';
import type { Logger as AppLogger } from '@intexuraos/common-core';
import { formatZodErrors, generateStructured, type StructuredClient } from '@intexuraos/llm-utils';
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
const DEFAULT_CLARIFICATION_QUESTIONS: Record<IntexAgentReplyLanguage, string> = {
  en: 'Which one should I handle first?',
  pl: 'Którą rzecz mam obsłużyć najpierw?',
};
const GENERIC_CLARIFICATION_QUESTIONS: Record<IntexAgentReplyLanguage, string> = {
  en: 'What would you like me to do with this?',
  pl: 'Co mam z tym zrobić?',
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
  | { kind: 'tool'; allowedToolNames: IntexAgentToolName[] }
  | { kind: 'no_action'; reason: 'greeting' | 'conversation' }
  | { kind: 'needs_clarification'; question: string }
  | { kind: 'unsupported'; reason: 'unsupported_request' };

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
      if (directIntent.kind === 'unsupported') {
        return {
          kind: 'needs_clarification',
          question: DEFAULT_CLARIFICATION_QUESTIONS[replyLanguage],
        };
      }
      if (directIntent.kind === 'tool' || directIntent.reason === 'greeting') {
        return directIntent;
      }

      const prompt = intexAgentIntentClassifierPrompt.build({
        currentDateTime: input.currentDateTime,
        messages: buildClassifierMessages(input.events, input.message, input.replyContext),
      });
      const result = await generateStructured({
        client: deps.client,
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
          'Intex Agent intent classifier failed; falling back to conversation'
        );
        return { kind: 'no_action', reason: 'conversation' };
      }

      return mapValidatedClassifierOutput(result.value.data, replyLanguage);
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
      output.confidence < INTEX_AGENT_INTENT_CLASSIFIER_CONFIDENCE_THRESHOLDS.tool ||
      allowedToolNames.length === 0
    ) {
      return clarificationFromQuestion(output.question, replyLanguage);
    }
    if (
      allowedToolNames.length > 1 &&
      !allowedToolNames.every((toolName) => PREFERENCE_TOOL_NAME_SET.has(toolName))
    ) {
      return clarificationFromQuestion(output.question, replyLanguage);
    }
    return {
      kind: 'tool',
      allowedToolNames: allowedToolNames.some((toolName) =>
        PREFERENCE_TOOL_NAME_SET.has(toolName)
      )
        ? [...PREFERENCE_TOOL_NAMES]
        : allowedToolNames,
    };
  }

  if (output.outcome === 'needs_clarification') {
    return clarificationFromQuestion(output.question, replyLanguage);
  }

  if (output.outcome === 'unsupported') {
    if (output.confidence < INTEX_AGENT_INTENT_CLASSIFIER_CONFIDENCE_THRESHOLDS.unsupported) {
      return clarificationFromQuestion(output.question, replyLanguage);
    }
    return { kind: 'unsupported', reason: 'unsupported_request' };
  }

  if (output.outcome === 'greeting') {
    return { kind: 'no_action', reason: 'greeting' };
  }

  return { kind: 'no_action', reason: 'conversation' };
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

function clarificationFromQuestion(
  question: string | undefined,
  replyLanguage: IntexAgentReplyLanguage
): IntexAgentIntentClassification {
  return {
    kind: 'needs_clarification',
    question: readQuestion(question) ?? GENERIC_CLARIFICATION_QUESTIONS[replyLanguage],
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
