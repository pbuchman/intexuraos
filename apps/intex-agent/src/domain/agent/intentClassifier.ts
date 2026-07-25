import {
  IntexAgentIntentClassifierProviderOutputSchema,
  INTEX_AGENT_INTENT_CLASSIFIER_RESPONSE_FORMAT,
  IntexAgentIntentClassifierToolNameSchema,
  IntexAgentBlockerReasonSchema,
  intexAgentIntentClassifierPrompt,
  intexAgentIntentClassifierRepairPrompt,
  type IntexAgentBlockerReason,
  type IntexAgentIntentClassifierOutput,
  type IntexAgentIntentClassifierPromptMessage,
  type IntexAgentIntentClassifierToolName,
  type IntexAgentStylePreferenceAction,
} from '@intexuraos/llm-prompts';
import type { Logger as AppLogger } from '@intexuraos/common-core';
import type {
  MatrixCorpusLlmCallContextV1,
  MatrixCorpusLlmStageV1,
  MatrixCorpusProviderCallUsageV1,
} from '@intexuraos/llm-contract';
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
const MULTIPLE_TOOL_CLARIFICATION_NEXT_STEP =
  'Ask the user which supported action to handle first.';

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
  timeZone: string;
  replyContext?: IntexIncomingMessageReplyContext;
  matrixCorpusLlm?: MatrixCorpusLlmRecorder;
}

export interface MatrixCorpusLlmRecorder {
  nextContext(stage: MatrixCorpusLlmStageV1): MatrixCorpusLlmCallContextV1;
  recordProviderCall(call: MatrixCorpusProviderCallUsageV1): Promise<void>;
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
      reason: 'greeting' | 'conversation' | 'retain_context';
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
      fallbackReason?: 'llm_call_failed';
      fallbackSourceOutcome?: string;
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

export type IntexAgentIntentClassifierResponseFormatMode = 'json_schema' | 'prompt_json';

export function createLlmIntexAgentIntentClassifier(deps: {
  client: StructuredClient;
  logger: AppLogger;
  responseFormatMode?: IntexAgentIntentClassifierResponseFormatMode;
}): IntexAgentIntentClassifier {
  return {
    async classify(input): Promise<IntexAgentIntentClassification> {
      const matrixCorpusLlm = input.matrixCorpusLlm;
      const replyLanguage = classifierReplyLanguage(input);
      const directIntent = classifyIntexAgentIntent(input.message);
      if (
        (directIntent.kind === 'no_action' &&
          (directIntent.reason === 'greeting' || directIntent.reason === 'retain_context')) ||
        (directIntent.kind === 'tool' && directIntent.allowedToolNames.includes('create_note'))
      ) {
        return directIntent;
      }

      const activeClarification = readActiveClarificationContext(input.events);
      const prompt = intexAgentIntentClassifierPrompt.build({
        currentDateTime: input.currentDateTime,
        timeZone: input.timeZone,
        messages: buildClassifierMessages(input.events, input.message, input.replyContext),
        ...(activeClarification !== undefined ? { activeClarification } : {}),
      });
      // The production OpenRouter client already retries transient failures. Avoid
      // multiplying those attempts inside the lease-bounded Matrix corpus lane.
      const retryingClient =
        matrixCorpusLlm === undefined ? createRetryingStructuredClient(deps.client) : deps.client;
      const result = await generateStructured<IntexAgentIntentClassifierOutput>({
        client: retryingClient,
        prompt,
        schema: classifierSchemaFor(activeClarification),
        promptType: INTEX_AGENT_INTENT_CLASSIFIER_PROMPT_TYPE,
        options:
          deps.responseFormatMode === 'prompt_json'
            ? {}
            : { responseFormat: INTEX_AGENT_INTENT_CLASSIFIER_RESPONSE_FORMAT },
        repairBuilder: (raw, error) =>
          intexAgentIntentClassifierRepairPrompt.build({
            originalPrompt: prompt,
            invalidResponse: raw,
            errorMessage: formatZodErrors(error),
            currentTurnContext: {
              message: formatUserMessageWithReplyContext(input.message, input.replyContext),
              ...(activeClarification !== undefined ? { activeClarification } : {}),
            },
          }),
        maxRepairAttempts: 1,
        ...(matrixCorpusLlm === undefined
          ? {}
          : {
              optionsForAttempt: (attempt: number): Record<string, unknown> => ({
                matrixCorpusContext: matrixCorpusLlm.nextContext(
                  attempt === 0 ? 'intent_classification' : 'response_schema_repair'
                ),
              }),
              onProviderCall: async (call: MatrixCorpusProviderCallUsageV1): Promise<void> => {
                await matrixCorpusLlm.recordProviderCall(call);
              },
            }),
      });

      if (!result.ok) {
        if (matrixCorpusLlm !== undefined) {
          throw new Error('Matrix corpus intent classification failed');
        }
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
      return clarificationFromOutput(output, replyLanguage, {
        blockerReason: 'multiple_possible_intents',
        candidateIntents: allowedToolNames,
        suggestedNextStep: MULTIPLE_TOOL_CLARIFICATION_NEXT_STEP,
      });
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
    return clarificationFromOutput(output, replyLanguage, {
      blockerReason: output.blockerReason,
      ...(output.candidateIntents !== undefined
        ? { candidateIntents: output.candidateIntents }
        : {}),
      ...(output.suggestedNextStep !== undefined
        ? { suggestedNextStep: output.suggestedNextStep }
        : {}),
    });
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

  if (output.outcome === 'retain_context') {
    return {
      kind: 'no_action',
      reason: 'retain_context',
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

interface ActiveClarificationContext {
  blockerReason: IntexAgentBlockerReason;
  candidateIntents: IntexAgentIntentClassifierToolName[];
}

type IntentClassifierSchema =
  | typeof IntexAgentIntentClassifierProviderOutputSchema
  | ReturnType<typeof IntexAgentIntentClassifierProviderOutputSchema.superRefine>;

function classifierSchemaFor(
  activeClarification: ActiveClarificationContext | undefined
): IntentClassifierSchema {
  if (activeClarification === undefined) {
    return IntexAgentIntentClassifierProviderOutputSchema;
  }

  return IntexAgentIntentClassifierProviderOutputSchema.superRefine((output, context) => {
    if (
      output.outcome === 'needs_clarification' &&
      (output.candidateIntents === undefined || output.candidateIntents.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'active clarification continuation requires at least one candidate tool intent',
        path: ['candidateIntents'],
      });
    }
  });
}

function readActiveClarificationContext(
  events: readonly IntexAgentSessionEvent[]
): ActiveClarificationContext | undefined {
  for (const event of [...events].reverse()) {
    if (event.type === 'assistant_message' || event.type === 'agent_fallback') {
      continue;
    }
    if (event.type !== 'clarification_requested') {
      return undefined;
    }

    const blockerReason = IntexAgentBlockerReasonSchema.safeParse(event.payload['blockerReason']);
    const rawCandidateIntents = event.payload['candidateIntents'];
    if (!blockerReason.success || !Array.isArray(rawCandidateIntents)) {
      return undefined;
    }

    const candidateIntents: IntexAgentIntentClassifierToolName[] = [];
    for (const rawCandidateIntent of rawCandidateIntents) {
      const parsed = IntexAgentIntentClassifierToolNameSchema.safeParse(rawCandidateIntent);
      if (!parsed.success) {
        return undefined;
      }
      if (!candidateIntents.includes(parsed.data)) {
        candidateIntents.push(parsed.data);
      }
    }
    if (candidateIntents.length === 0) {
      return undefined;
    }

    return { blockerReason: blockerReason.data, candidateIntents };
  }

  return undefined;
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
  replyLanguage: IntexAgentReplyLanguage,
  metadata: {
    blockerReason: IntexAgentBlockerReason;
    candidateIntents?: IntexAgentToolName[];
    suggestedNextStep?: string;
  }
): IntexAgentIntentClassification {
  return {
    kind: 'needs_clarification',
    question:
      readQuestion(output.question) ??
      readQuestion(output.clarification) ??
      GENERIC_CLARIFICATION_QUESTIONS[replyLanguage],
    blockerReason: metadata.blockerReason,
    ...(output.missingFields !== undefined ? { missingFields: output.missingFields } : {}),
    ...(metadata.candidateIntents !== undefined
      ? { candidateIntents: normalizeAllowedToolNames(metadata.candidateIntents) }
      : {}),
    ...(metadata.suggestedNextStep !== undefined
      ? { suggestedNextStep: metadata.suggestedNextStep }
      : {}),
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
    fallbackReason: 'llm_call_failed',
    fallbackSourceOutcome: 'classifier',
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
