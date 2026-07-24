import { getErrorMessage } from '@intexuraos/common-core';
import type {
  MatrixCorpusProviderCallUsageV1,
  ToolCallingClient,
  ToolCallingMessage,
} from '@intexuraos/llm-contract';
import {
  IntexAgentRunnerProviderOutputSchema,
  IntexAgentRunnerOutputSchema,
  INTEX_AGENT_RUNNER_RESPONSE_FORMAT,
  intexAgentRunnerOutputRepairPrompt,
  type IntexAgentBlockerReason,
  type IntexAgentRunnerOutput,
} from '@intexuraos/llm-prompts';
import {
  formatZodErrors,
  generateStructured,
  type StructuredClient,
  type StructuredGenerateResult,
} from '@intexuraos/llm-utils';
import type {
  IntexAgentFallbackReason,
  IntexAgentRunner,
  IntexAgentRunnerResult,
  IntexAgentToolSelectionMetadata,
} from '../messages/handleIncomingMessage.js';
import {
  formatUserMessageWithReplyContext,
  parseIncomingReplyContext,
} from '../messages/sessionMessageFormatting.js';
import type { IntexIncomingMessageReplyContext } from '../ports/incomingMessageHandler.js';
import type { IntexAgentSessionEvent, IntexAgentToolName } from '../sessions/types.js';
import {
  createIntexAgentToolDefinitions,
  type AddUserPreferenceToolArgs,
  type CreateCalendarEventToolArgs,
  type CreateCodeTaskToolArgs,
  type CreateLinkToolArgs,
  type CreateNoteToolArgs,
  type DeleteUserPreferenceToolArgs,
  type QueryCalendarEventsToolArgs,
  type CreateResearchToolArgs,
  type SaveExternalToolArgs,
  type UpdateUserPreferenceToolArgs,
  type IntexAgentToolExecutor,
} from './toolDefinitions.js';
import { buildIntexAgentSystemPrompt, INTEX_AGENT_RUNNER_PROMPT_TYPE } from './systemPrompt.js';
import { classifyIntexAgentIntent, type IntexAgentIntentDecision } from './intentGate.js';
import {
  buildGreetingReply,
  selectIntexAgentReplyLanguage,
  type IntexAgentReplyLanguage,
} from './capabilities.js';
import type {
  IntexAgentIntentClassification,
  IntexAgentIntentClassifier,
  MatrixCorpusLlmRecorder,
} from './intentClassifier.js';

const DEFAULT_WEB_APP_URL = 'https://intexuraos.cloud';
const CLARIFICATION_ONLY_BLOCKER_REASONS = new Set<IntexAgentBlockerReason>([
  'missing_required_details',
  'not_enough_context',
  'multiple_possible_intents',
  'ambiguous_preference_target',
]);

type MutatingIntexAgentToolName = Exclude<
  IntexAgentToolName,
  'query_calendar_events' | 'get_user_preferences'
>;

const MUTATING_TOOL_NAMES = new Set<MutatingIntexAgentToolName>([
  'create_note',
  'create_calendar_event',
  'create_research',
  'create_link',
  'create_code_task',
  'save_external',
  'add_user_preference',
  'update_user_preference',
  'delete_user_preference',
]);
const RUNTIME_TIME_ZONE_MISSING_FIELDS = new Set([
  'timezone',
  'ianatimezone',
  'usertimezone',
  'eventtimezone',
  'strefaczasowa',
]);

const OPAQUE_REFERENCE_PATTERN =
  /(?<![\p{L}\p{N}_-])(?=[\p{L}\p{N}_-]*\p{L})(?=[\p{L}\p{N}_-]*\p{N})[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)+(?![\p{L}\p{N}_-])/gu;
const EXPLICIT_REFERENCE_EXCLUSION_PREFIX_PATTERN =
  /(?<!\p{L})(?:(?:do not|don['’]?t)\s+(?:include|copy|keep|repeat|save)|(?:omit|exclude|remove|without)|nie\s+(?:uwzględniaj|uwzgledniaj|dodawaj|kopiuj|zapisuj|powtarzaj)|(?:pomiń|pomin|wyklucz|usuń|usun|bez))\s*(?:(?:the|this|ten|tego|tę|ta)\s+)?(?:(?:code|reference|identifier|token|kod|referencję|referencje|identyfikator)\s*)?(?:[:=-]\s*)?$/iu;
const REPLY_RAW_DATE_PATTERN =
  /(^|[\s([{"'“„])(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?)(?=$|[\s,.;!?)}\]"'”])/gimu;
const RAW_REPLY_DATE_TIME_PATTERN = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/u;
const STRICT_REPLY_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/u;
type LocalizedText = Record<IntexAgentReplyLanguage, string>;
interface ClassifierUnsupportedReplyMap {
  unsupported_capability: string;
  tool_boundary: string;
  permission_or_configuration: string;
  [key: string]: string | undefined;
}

const GENERIC_EXECUTION_FAILURE_PREFIX: LocalizedText = {
  en: 'I could not execute this action: ',
  pl: 'Nie udało się wykonać tej akcji: ',
};

const GENERIC_EXECUTION_FAILURE_SUFFIX: LocalizedText = {
  en: '. Please try again later.',
  pl: '. Spróbuj ponownie później.',
};

const EXTERNAL_SAVE_NOT_CONFIGURED_REPLIES: LocalizedText = {
  en: 'No external system is configured for this message, so I cannot process it. Configure external save in Intex Agent preferences and send it again.',
  pl: 'Nie skonfigurowano zewnętrznego systemu dla tej wiadomości, więc nie mogę jej przetworzyć. Skonfiguruj External Save w preferencjach agenta Intex i wyślij ją ponownie.',
};

const EXTERNAL_SAVE_FAILURE_PREFIX: LocalizedText = {
  en: 'I could not deliver this to the external system. The external save request failed: ',
  pl: 'Nie udało się dostarczyć tej treści do zewnętrznego systemu. Żądanie External Save nie powiodło się: ',
};

const EXTERNAL_SAVE_FAILURE_SUFFIX: LocalizedText = {
  en: '. Please check the external system configuration and try again.',
  pl: '. Sprawdź konfigurację zewnętrznego systemu i spróbuj ponownie.',
};

const PREFERENCE_VERSION_CONFLICT_REPLIES: LocalizedText = {
  en: 'Your instruction memory changed before I could save that. Send the request again so I can use the latest version.',
  pl: 'Pamięć instrukcji zmieniła się przed zapisem. Wyślij prośbę ponownie, żebym użył najnowszej wersji.',
};

const RETAIN_ONLY_REPLIES: LocalizedText = {
  en: 'Noted for this session only. No note or other resource was created.',
  pl: 'Zachowuję to tylko w tej sesji. Nie utworzono notatki ani innego zasobu.',
};

const CALENDAR_DATE_CLARIFICATION_REPLIES: LocalizedText = {
  en: 'Which day or date should I use for this calendar event?',
  pl: 'Którego dnia lub na jaką datę mam dodać to wydarzenie?',
};

const CALENDAR_DATE_CLARIFICATION_NEXT_STEPS: LocalizedText = {
  en: 'Provide the day or date for the calendar event.',
  pl: 'Podaj dzień lub datę wydarzenia w kalendarzu.',
};

const CALENDAR_DIRECT_DATE_SIGNAL_PATTERN =
  /(?<![\p{L}\p{N}])(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|poniedział(?:ek|ku)|wtorek|wtorku|środ(?:a|ę|y)|czwart(?:ek|ku)|pią(?:tek|tku)|sobot(?:a|ę|y)|niedziel(?:a|ę|i)|today|tomorrow|tonight|day\s+after\s+tomorrow|dzisiaj|dziś|jutro|pojutrze|(?:in|za)\s+(?:\d+|one|two|three|jeden|jedną|dwa|dwie|trzy)\s+(?:days?|dni|dzień))(?=$|[^\p{L}\p{N}])/iu;

const CALENDAR_ORDINAL_DATE_SIGNAL_PATTERN =
  /(?<![\p{L}\p{N}])on\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)(?=\s*(?:$|[,.;!?]|(?:at|from|between|until|for)\b))/iu;

const CALENDAR_CONTEXTUAL_MONTH_SIGNAL_PATTERN =
  /(?<![\p{L}\p{N}])(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?)(?=$|[^\p{L}\p{N}])/iu;
const EXPLICIT_IANA_TIME_ZONE_CANDIDATE_PATTERN =
  /(?<![\p{L}\p{N}_])([a-z](?:[a-z0-9._+-]*[a-z0-9_+-])?(?:\/[a-z](?:[a-z0-9._+-]*[a-z0-9_+-])?)+)(?![\p{L}\p{N}_])/giu;
const EXPLICIT_STANDALONE_TIME_ZONE_CANDIDATE_PATTERN =
  /(?<![\p{L}\p{N}_/])([A-Z][A-Z0-9]*(?:[-+][A-Z0-9]+)*)(?![\p{L}\p{N}_/])/gu;
const EXPLICIT_CONTEXTUAL_TIME_ZONE_CANDIDATE_PATTERN =
  /(?:(?<![\p{L}\p{N}_])(?:in|using|timezone|time\s+zone)\s+|(?<!\d)(?:\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,2}\s*(?:am|pm))\s+(?:in\s+)?)([a-z][a-z0-9]*(?:[-+][a-z0-9]+)*)(?![\p{L}\p{N}_/])/giu;
const EXPLICIT_ISO_TIME_ZONE_PATTERN =
  /(?<![\p{L}\p{N}_])(?:\d{4}-\d{2}-\d{2}t)?\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:\d{2})(?![\p{L}\p{N}_])/iu;
const EXPLICIT_NATURAL_TIME_ZONE_CANDIDATE_PATTERN =
  /(?<![\p{L}\p{N}_])([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,3})\s+time(?![\p{L}\p{N}_])/giu;
const EXPLICIT_TIME_ZONE_TOKEN_PATTERN =
  /(?<![\p{L}\p{N}_/])(?:(?:utc|gmt)\s*[+-]\s*\d{1,2}(?::?\d{2})?|[+-]\d{2}:\d{2}|utc|gmt|cet|cest|eet|eest|est|edt|cst|cdt|mst|mdt|pst|pdt)(?![\p{L}\p{N}_/])/iu;
const NATURAL_TIME_ZONE_QUALIFIERS = new Set(['daylight', 'local', 'standard', 'summer']);
const NATURAL_TIME_ZONE_NAMES = buildNaturalTimeZoneNames();

const CLASSIFIER_UNSUPPORTED_REPLIES: Record<
  IntexAgentReplyLanguage,
  ClassifierUnsupportedReplyMap
> = {
  en: {
    unsupported_capability:
      "I cannot perform that action because it is outside Intex Agent's supported capabilities.",
    tool_boundary: 'I cannot do that with the available Intex Agent tools.',
    permission_or_configuration:
      'I cannot do that because the required permission or configuration is missing.',
  },
  pl: {
    unsupported_capability:
      'Nie mogę wykonać tej akcji, bo wykracza poza obsługiwane możliwości agenta Intex.',
    tool_boundary: 'Nie mogę wykonać tej akcji dostępnymi narzędziami agenta Intex.',
    permission_or_configuration:
      'Nie mogę wykonać tej akcji, bo brakuje wymaganych uprawnień albo konfiguracji.',
  },
};

const CONFIRMATION_INTROS: Record<MutatingIntexAgentToolName, LocalizedText> = {
  create_note: { en: 'Add this note?', pl: 'Czy dodać notatkę?' },
  create_calendar_event: {
    en: 'Add this calendar event?',
    pl: 'Czy dodać wydarzenie w kalendarzu?',
  },
  create_research: { en: 'Create this research draft?', pl: 'Czy utworzyć szkic researchu?' },
  create_link: { en: 'Save this bookmark?', pl: 'Czy zapisać bookmark?' },
  create_code_task: { en: 'Create this code task?', pl: 'Czy utworzyć zadanie programistyczne?' },
  save_external: {
    en: 'Send this content to the external system?',
    pl: 'Czy wysłać tę treść do zewnętrznego systemu?',
  },
  add_user_preference: {
    en: 'Add this instruction memory entry?',
    pl: 'Czy dodać wpis w pamięci instrukcji?',
  },
  update_user_preference: {
    en: 'Update this instruction memory entry?',
    pl: 'Czy zmodyfikować wpis w pamięci instrukcji?',
  },
  delete_user_preference: {
    en: 'Delete this instruction memory entry?',
    pl: 'Czy usunąć wpis z pamięci instrukcji?',
  },
};

const LINK_CONFIRMATION_ACTION_HINT: LocalizedText = {
  en: 'Confirm to save it, or cancel to leave it unchanged.',
  pl: 'Potwierdź, aby go zapisać, albo anuluj, aby niczego nie zmieniać.',
};

const CONFIRMATION_LABELS = {
  title: { en: 'Title', pl: 'Tytuł' },
  content: { en: 'Content', pl: 'Treść' },
  start: { en: 'Start', pl: 'Początek' },
  end: { en: 'End', pl: 'Koniec' },
  location: { en: 'Location', pl: 'Miejsce' },
  attendees: { en: 'Attendees', pl: 'Uczestnicy' },
  prompt: { en: 'Prompt', pl: 'Polecenie' },
  mode: { en: 'Mode', pl: 'Tryb' },
  worker: { en: 'Worker', pl: 'Typ workera' },
  source: { en: 'Source', pl: 'Źródło' },
  newEntry: { en: 'New entry', pl: 'Nowy wpis' },
  entry: { en: 'Entry', pl: 'Wpis' },
  before: { en: 'Before', pl: 'Wcześniej' },
  after: { en: 'After', pl: 'Po zmianie' },
} satisfies Record<string, LocalizedText>;

const COMPLETED_REPLIES = {
  create_note: { en: 'Saved the note.', pl: 'Zapisałem notatkę.' },
  create_calendar_event: {
    en: 'Created the calendar event.',
    pl: 'Utworzyłem wydarzenie w kalendarzu.',
  },
  create_research: { en: 'Created the research draft.', pl: 'Utworzyłem szkic researchu.' },
  create_link: { en: 'Saved the bookmark.', pl: 'Zapisałem bookmark.' },
  create_code_task: { en: 'Created the code task.', pl: 'Utworzyłem zadanie programistyczne.' },
  save_external: { en: 'Saved externally', pl: 'Wysłano do zewnętrznego systemu.' },
  preference: {
    en: 'Updated the instruction memory.',
    pl: 'Zaktualizowałem pamięć instrukcji.',
  },
  preferencesEmpty: {
    en: 'No Intex Agent preferences are defined yet.',
    pl: 'Nie zdefiniowano jeszcze preferencji agenta Intex.',
  },
  linkUrl: { en: 'Saved the link.', pl: 'Zapisałem link.' },
} satisfies Record<string, LocalizedText>;

const TOOL_SELECTION_REJECTED_REPLIES = {
  en: "I couldn't complete that request because the selected action is not allowed.",
  pl: 'Nie mogę zrealizować tej prośby, ponieważ wybrana akcja jest niedozwolona.',
} satisfies LocalizedText;

const CTA_LABELS = {
  openNote: { en: 'Open note', pl: 'Otwórz notatkę' },
  openResearch: { en: 'Open research', pl: 'Otwórz research' },
  viewProgress: { en: 'View progress', pl: 'Zobacz postęp' },
  openBookmark: { en: 'Open bookmark', pl: 'Otwórz zakładkę' },
  openCalendar: { en: 'Open calendar', pl: 'Otwórz kalendarz' },
  openLink: { en: 'Open link', pl: 'Otwórz link' },
} satisfies Record<string, LocalizedText>;

export interface IntexAgentRunnerConfig {
  client: ToolCallingClient;
  responseRepairClient?: StructuredClient;
  toolExecutor: IntexAgentToolExecutor;
  intentClassifier?: IntexAgentIntentClassifier;
  webAppUrl?: string;
  userPreferences?: string | null;
  toolSelectionGate?: (input: Readonly<{
    toolName: IntexAgentToolName;
    args: Record<string, unknown>;
  }>) => Promise<
    | Readonly<{ decision: 'allow'; metadata: IntexAgentToolSelectionMetadata }>
    | Readonly<{
        decision: 'reject';
        category: 'behavioral_failure' | 'safety_stop';
        code: string;
        metadata: IntexAgentToolSelectionMetadata;
      }>
  >;
  matrixCorpusLlm?: MatrixCorpusLlmRecorder;
}

export function createIntexAgentRunner(config: IntexAgentRunnerConfig): IntexAgentRunner {
  return {
    async executeConfirmed(input): Promise<IntexAgentRunnerResult> {
      const replyLanguage = detectReplyLanguage(input.events ?? []);
      if (!isMutatingToolName(input.toolName)) {
        return fallbackClarificationResult(
          replyLanguage,
          'tool_result_mismatch',
          'confirmed_execution'
        );
      }

      const toolExecutions: IntexAgentToolExecution[] = [];
      const tools = createIntexAgentToolDefinitions(
        createTrackingToolExecutor(config.toolExecutor, toolExecutions)
      );
      const tool = tools.find((candidate) => candidate.name === input.toolName);
      /* v8 ignore start -- schema: mutating tool registry and tool definitions cannot diverge without breaking startup tests @preserve */
      if (tool === undefined) {
        return fallbackClarificationResult(
          replyLanguage,
          'tool_result_mismatch',
          'confirmed_execution'
        );
      }
      /* v8 ignore stop @preserve */

      try {
        const rawResult = await tool.run(input.toolArgs);
        const toolExecution = getCompletedToolExecution(toolExecutions);
        /* v8 ignore start -- schema: every mutating tool definition executes through the tracking executor after argument validation @preserve */
        if (toolExecution === undefined) {
          return fallbackClarificationResult(
            replyLanguage,
            'tool_result_mismatch',
            'confirmed_execution'
          );
        }
        /* v8 ignore stop @preserve */
        const parsedResult = parseToolResult(rawResult);
        const completedReply = buildCompletedReply(
          input.toolName,
          parsedResult,
          defaultCompletedReply(input.toolName, replyLanguage),
          config.webAppUrl ?? DEFAULT_WEB_APP_URL,
          replyLanguage
        );

        return {
          outcome: 'completed',
          reply: completedReply.reply,
          toolName: input.toolName,
          ...(parsedResult !== undefined ? { toolResult: parsedResult } : {}),
          ...(completedReply.ctaUrl !== undefined ? { ctaUrl: completedReply.ctaUrl } : {}),
        };
      } catch (error) {
        const errorMessage = getErrorMessage(error, 'Unknown tool execution error');
        const failureMetadata = toolFailureMetadata(input.toolName, errorMessage);
        return {
          outcome: 'tool_failed',
          reply: buildConfirmedExecutionFailureReply(input.toolName, errorMessage, replyLanguage),
          toolName: input.toolName,
          error: errorMessage,
          ...failureMetadata,
        };
      }
    },
    async run(input): Promise<IntexAgentRunnerResult> {
      const detectedReplyLanguage = detectReplyLanguage(input.events, {
        text: input.message,
        ...(input.sourceType !== undefined ? { sourceType: input.sourceType } : {}),
        ...(input.sourceUrl !== undefined ? { hasSourceUrl: true } : {}),
      });

      if (input.sourceType === 'whatsapp_image' && input.sourceUrl !== undefined) {
        const args = {
          message: input.message.trim() === '' ? 'Image shared via WhatsApp.' : input.message.trim(),
          sourceUrl: input.sourceUrl,
        };
        return {
          outcome: 'needs_confirmation',
          reply: buildConfirmationReply(
            'save_external',
            args,
            config.userPreferences ?? null,
            detectedReplyLanguage,
            input.timeZone
          ),
          toolName: 'save_external',
          toolArgs: args,
        };
      }

      const classifiedIntent =
        config.intentClassifier === undefined
          ? classifyIntexAgentIntent(input.message)
          : await config.intentClassifier.classify({
              message: input.message,
              events: input.events,
              currentDateTime: input.currentDateTime,
              timeZone: input.timeZone,
              ...(input.replyContext !== undefined ? { replyContext: input.replyContext } : {}),
              ...(config.matrixCorpusLlm !== undefined
                ? { matrixCorpusLlm: config.matrixCorpusLlm }
                : {}),
            });
      const intent = applyOptionalNoteFieldClarification(
        applyRuntimeTimeZoneToCalendarIntent(classifiedIntent, {
          timeZone: input.timeZone,
          message: input.message,
          events: input.events,
          replyContext: input.replyContext,
        })
      );
      const replyLanguage = replyLanguageForIntent(intent, detectedReplyLanguage);
      if (intent.kind === 'unsupported') {
        return normalizeClassifierUnsupportedIntent(intent, replyLanguage);
      }

      if (intent.kind === 'needs_clarification') {
        return {
          outcome: 'needs_clarification',
          reply: intent.question,
          ...(intent.blockerReason !== undefined ? { blockerReason: intent.blockerReason } : {}),
          ...(intent.missingFields !== undefined ? { missingFields: intent.missingFields } : {}),
          ...(intent.candidateIntents !== undefined
            ? { candidateIntents: intent.candidateIntents }
            : {}),
          ...(intent.suggestedNextStep !== undefined
            ? { suggestedNextStep: intent.suggestedNextStep }
            : {}),
          ...(intent.fallbackReason !== undefined ? { fallbackReason: intent.fallbackReason } : {}),
          ...(intent.fallbackSourceOutcome !== undefined
            ? { fallbackSourceOutcome: intent.fallbackSourceOutcome }
            : {}),
        };
      }

      if (intent.kind === 'no_action' && intent.reason === 'greeting') {
        return {
          outcome: 'no_action',
          reply: buildGreetingReply(replyLanguage),
        };
      }

      if (intent.kind === 'no_action' && intent.reason === 'retain_context') {
        const retainOnlyLanguage = detectRetainOnlyLanguage(input.message);
        if (retainOnlyLanguage !== null) {
          return {
            outcome: 'no_action',
            reply: RETAIN_ONLY_REPLIES[replyLanguageForIntent(intent, retainOnlyLanguage)],
          };
        }
      }

      if (
        intent.kind === 'tool' &&
        intent.allowedToolNames.includes('create_calendar_event') &&
        !hasCalendarDateSignal(input.message, input.events, input.replyContext)
      ) {
        const clarification = CALENDAR_DATE_CLARIFICATION_REPLIES[replyLanguage];
        return {
          outcome: 'needs_clarification',
          reply: clarification,
          clarification,
          blockerReason: 'missing_required_details',
          missingFields: ['date'],
          candidateIntents: ['create_calendar_event'],
          suggestedNextStep: CALENDAR_DATE_CLARIFICATION_NEXT_STEPS[replyLanguage],
        };
      }

      const toolExecutions: IntexAgentToolExecution[] = [];
      const tools = createIntexAgentToolDefinitions(
        createTrackingToolExecutor(
          createConfirmationPreviewExecutor(config.toolExecutor),
          toolExecutions,
          config.toolSelectionGate
        )
      )
        .filter(
          (tool) =>
            intent.kind === 'tool' &&
            intent.allowedToolNames.includes(tool.name as IntexAgentToolName)
        )
        .map((tool) =>
          isMutatingToolName(tool.name as IntexAgentToolName) ||
          tool.name === 'get_user_preferences'
            ? { ...tool, stopAfterRun: true }
            : tool
        );
      const exposedToolNames = tools.map((tool) => tool.name as IntexAgentToolName);
      const systemPrompt = buildIntexAgentSystemPrompt.build({
        currentDateTime: input.currentDateTime,
        timeZone: input.timeZone,
        userPreferences: config.userPreferences ?? null,
      });
      const messages = buildMessages(input.events, input.message, input.replyContext);
      const matrixCorpusLlm = config.matrixCorpusLlm;
      const recordedProviderCalls = new Map<string, string>();
      const recordProviderCallOnce = async (
        recorder: MatrixCorpusLlmRecorder,
        providerCall: MatrixCorpusProviderCallUsageV1
      ): Promise<void> => {
        const key = matrixProviderCallKey(providerCall);
        const serialized = JSON.stringify(providerCall);
        const existing = recordedProviderCalls.get(key);
        if (existing !== undefined) {
          if (existing !== serialized)
            throw new Error('Matrix corpus provider usage replay conflict');
          return;
        }
        await recorder.recordProviderCall(providerCall);
        recordedProviderCalls.set(key, serialized);
      };
      const result = await config.client.run({
        systemPrompt,
        messages,
        tools,
        toolChoice: exposedToolNames.length > 0 ? 'required' : 'auto',
        promptType: INTEX_AGENT_RUNNER_PROMPT_TYPE,
        maxIterations: 5,
        ...(matrixCorpusLlm === undefined
          ? {}
          : {
              matrixCorpusContext: matrixCorpusLlm.nextContext('agent_generation'),
              onMatrixCorpusProviderCall: async (providerCall): Promise<void> => {
                await recordProviderCallOnce(matrixCorpusLlm, providerCall);
              },
            }),
      });

      if (!result.ok) {
        if (matrixCorpusLlm !== undefined) {
          throw new Error('Matrix corpus agent generation failed');
        }
        return fallbackClarificationResult(replyLanguage, 'llm_call_failed');
      }
      if (matrixCorpusLlm !== undefined) {
        if (result.value.providerCalls?.length !== result.value.iterationCount) {
          throw new Error('Matrix corpus provider usage is incomplete');
        }
        for (const providerCall of result.value.providerCalls) {
          await recordProviderCallOnce(matrixCorpusLlm, providerCall);
        }
      }

      const runnerResult = await parseRunnerContent(
        {
          content: result.value.content,
          repairClient: config.responseRepairClient,
          systemPrompt,
          messages,
          intent,
          exposedToolNames,
          currentMessage: input.message,
          ...(config.matrixCorpusLlm === undefined
            ? {}
            : { matrixCorpusLlm: config.matrixCorpusLlm }),
        },
        toolExecutions,
        config.webAppUrl ?? DEFAULT_WEB_APP_URL,
        config.userPreferences ?? null,
        replyLanguage,
        input.timeZone
      );
      return {
        ...runnerResult,
        reply: formatReplyDateRecords(runnerResult.reply, input.timeZone, replyLanguage),
      };
    },
  };
}

function applyRuntimeTimeZoneToCalendarIntent(
  intent: IntexAgentIntentClassification,
  context: Readonly<{
    timeZone: string;
    message: string;
    events: readonly IntexAgentSessionEvent[];
    replyContext: IntexIncomingMessageReplyContext | undefined;
  }>
): IntexAgentIntentClassification {
  if (
    context.timeZone.trim() === '' ||
    hasExplicitTimeZoneContext(context) ||
    intent.kind !== 'needs_clarification' ||
    intent.blockerReason !== 'missing_required_details' ||
    intent.missingFields === undefined ||
    intent.missingFields.length === 0 ||
    !intent.missingFields.every(isRuntimeTimeZoneMissingField) ||
    intent.candidateIntents === undefined ||
    intent.candidateIntents.length === 0 ||
    !intent.candidateIntents.every((candidate) => candidate === 'create_calendar_event')
  ) {
    return intent;
  }

  return {
    kind: 'tool',
    allowedToolNames: ['create_calendar_event'],
    ...(intent.reason !== undefined ? { reason: intent.reason } : {}),
    ...(intent.stylePreferenceAction !== undefined
      ? { stylePreferenceAction: intent.stylePreferenceAction }
      : {}),
    ...(intent.languageOverride !== undefined ? { languageOverride: intent.languageOverride } : {}),
    ...(intent.decisionEvidence !== undefined ? { decisionEvidence: intent.decisionEvidence } : {}),
  };
}

function applyOptionalNoteFieldClarification(
  intent: IntexAgentIntentClassification
): IntexAgentIntentClassification {
  if (
    intent.kind !== 'needs_clarification' ||
    intent.blockerReason !== 'missing_required_details' ||
    intent.candidateIntents?.length !== 1 ||
    intent.candidateIntents[0] !== 'create_note' ||
    intent.missingFields === undefined ||
    intent.missingFields.length === 0 ||
    !intent.missingFields.every(isOptionalNoteField)
  ) {
    return intent;
  }

  return {
    kind: 'tool',
    allowedToolNames: ['create_note'],
    ...(intent.reason !== undefined ? { reason: intent.reason } : {}),
    ...(intent.stylePreferenceAction !== undefined
      ? { stylePreferenceAction: intent.stylePreferenceAction }
      : {}),
    ...(intent.languageOverride !== undefined ? { languageOverride: intent.languageOverride } : {}),
    ...(intent.decisionEvidence !== undefined ? { decisionEvidence: intent.decisionEvidence } : {}),
  };
}

function isOptionalNoteField(field: string): boolean {
  const canonical = field.trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/gu, '');
  return canonical === 'title' || canonical === 'tags' || canonical === 'sourcemessageids';
}

function isRuntimeTimeZoneMissingField(field: string): boolean {
  const canonical = field.trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/gu, '');
  return RUNTIME_TIME_ZONE_MISSING_FIELDS.has(canonical);
}

function hasExplicitTimeZoneContext(context: {
  message: string;
  events: readonly IntexAgentSessionEvent[];
  replyContext: IntexIncomingMessageReplyContext | undefined;
}): boolean {
  if (containsExplicitTimeZoneSignal(context.message)) return true;
  if (
    context.replyContext?.source === 'inbound_user_message' &&
    containsExplicitTimeZoneSignal(context.replyContext.text)
  ) {
    return true;
  }

  for (let index = context.events.length - 1; index >= 0; index -= 1) {
    const event = context.events[index];
    if (event?.type === 'user_message') return false;
    if (event?.type !== 'clarification_requested') continue;
    if (!isCalendarClarification(event)) return false;
    return activeCalendarClarificationChainContainsTimeZone(context.events, index);
  }

  return false;
}

function activeCalendarClarificationChainContainsTimeZone(
  events: readonly IntexAgentSessionEvent[],
  latestClarificationIndex: number
): boolean {
  let expectsUserMessage = true;

  for (let index = latestClarificationIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined) continue;

    if (expectsUserMessage) {
      if (event.type === 'clarification_requested') return false;
      if (event.type !== 'user_message') continue;

      const priorMessage = event.payload['text'];
      if (typeof priorMessage === 'string' && containsExplicitTimeZoneSignal(priorMessage)) {
        return true;
      }
      const priorReplyContext = parseIncomingReplyContext(event.payload['replyContext']);
      if (
        priorReplyContext?.source === 'inbound_user_message' &&
        containsExplicitTimeZoneSignal(priorReplyContext.text)
      ) {
        return true;
      }
      expectsUserMessage = false;
      continue;
    }

    if (event.type === 'user_message') return false;
    if (event.type !== 'clarification_requested') continue;
    if (!isCalendarClarification(event)) return false;
    expectsUserMessage = true;
  }

  return false;
}

function containsExplicitTimeZoneSignal(message: string): boolean {
  const normalized = message.normalize('NFKC');
  if (
    EXPLICIT_ISO_TIME_ZONE_PATTERN.test(normalized) ||
    EXPLICIT_TIME_ZONE_TOKEN_PATTERN.test(normalized)
  ) {
    return true;
  }
  for (const match of normalized.matchAll(EXPLICIT_IANA_TIME_ZONE_CANDIDATE_PATTERN)) {
    const candidate = match[1];
    if (candidate !== undefined && isValidExplicitTimeZone(candidate)) return true;
  }
  for (const match of normalized.matchAll(EXPLICIT_STANDALONE_TIME_ZONE_CANDIDATE_PATTERN)) {
    const candidate = match[1];
    if (candidate !== undefined && isValidExplicitTimeZone(candidate)) return true;
  }
  for (const match of normalized.matchAll(EXPLICIT_CONTEXTUAL_TIME_ZONE_CANDIDATE_PATTERN)) {
    const candidate = match[1];
    if (candidate !== undefined && isValidExplicitTimeZone(candidate)) return true;
  }
  for (const match of normalized.matchAll(EXPLICIT_NATURAL_TIME_ZONE_CANDIDATE_PATTERN)) {
    const candidate = match[1];
    if (candidate !== undefined && isKnownNaturalTimeZoneName(candidate)) return true;
  }
  return false;
}

function buildNaturalTimeZoneNames(): ReadonlySet<string> {
  const names = new Set([
    'alaska',
    'atlantic',
    'central',
    'central european',
    'eastern',
    'eastern european',
    'greenwich',
    'hawaii',
    'indian standard',
    'korea standard',
    'mountain',
    'pacific',
    'western european',
  ]);
  for (const timeZone of Intl.supportedValuesOf('timeZone')) {
    const leaf = timeZone.slice(timeZone.lastIndexOf('/') + 1);
    names.add(normalizeNaturalTimeZoneName(leaf));
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'long',
    });
    for (const timestamp of [Date.UTC(2026, 0, 15, 12), Date.UTC(2026, 6, 15, 12)]) {
      for (const part of formatter.formatToParts(timestamp)) {
        if (part.type !== 'timeZoneName') continue;
        names.add(normalizeNaturalTimeZoneName(part.value).replace(/\s+time$/u, ''));
      }
    }
  }
  return names;
}

function isKnownNaturalTimeZoneName(value: string): boolean {
  const words = normalizeNaturalTimeZoneName(value).split(' ');
  if (hasKnownNaturalTimeZoneNameSuffix(words)) return true;
  while (
    words.length > 0 &&
    NATURAL_TIME_ZONE_QUALIFIERS.has(words[words.length - 1] as string)
  ) {
    words.pop();
  }
  return hasKnownNaturalTimeZoneNameSuffix(words);
}

function hasKnownNaturalTimeZoneNameSuffix(words: string[]): boolean {
  return words.some((_word, index) => NATURAL_TIME_ZONE_NAMES.has(words.slice(index).join(' ')));
}

function normalizeNaturalTimeZoneName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[_-]+/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function isValidExplicitTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function matrixProviderCallKey(call: MatrixCorpusProviderCallUsageV1): string {
  return `${call.context.runId}:${call.context.scenarioId}:${call.context.sessionId}:${String(call.context.turnIndex)}:${call.context.stage}:${String(call.context.callOrdinal)}`;
}

export function isWhatsAppImageWithSourceUrl(input: {
  sourceType?: string;
  sourceUrl?: string;
}): boolean {
  return input.sourceType === 'whatsapp_image' && input.sourceUrl !== undefined;
}

function hasCalendarDateSignal(
  message: string,
  events: readonly IntexAgentSessionEvent[],
  replyContext: IntexIncomingMessageReplyContext | undefined
): boolean {
  if (containsCalendarDateSignal(message)) return true;
  if (
    replyContext?.source === 'inbound_user_message' &&
    containsCalendarDateSignal(replyContext.text)
  ) {
    return true;
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'user_message') return false;
    if (event?.type !== 'clarification_requested') continue;
    if (!isCalendarClarification(event)) return false;
    return activeCalendarClarificationChainContainsDate(events, index);
  }

  return false;
}

function activeCalendarClarificationChainContainsDate(
  events: readonly IntexAgentSessionEvent[],
  latestClarificationIndex: number
): boolean {
  let expectsUserMessage = true;

  for (let index = latestClarificationIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined) continue;

    if (expectsUserMessage) {
      if (event.type === 'clarification_requested') return false;
      if (event.type !== 'user_message') continue;

      const priorMessage = event.payload['text'];
      if (typeof priorMessage === 'string' && containsCalendarDateSignal(priorMessage)) {
        return true;
      }
      const priorReplyContext = parseIncomingReplyContext(event.payload['replyContext']);
      if (
        priorReplyContext?.source === 'inbound_user_message' &&
        containsCalendarDateSignal(priorReplyContext.text)
      ) {
        return true;
      }
      expectsUserMessage = false;
      continue;
    }

    if (event.type === 'user_message') return false;
    if (event.type !== 'clarification_requested') continue;
    if (!isCalendarClarification(event)) return false;
    expectsUserMessage = true;
  }

  return false;
}

function containsCalendarDateSignal(message: string): boolean {
  const normalized = message.normalize('NFKC');
  return (
    CALENDAR_DIRECT_DATE_SIGNAL_PATTERN.test(normalized) ||
    CALENDAR_ORDINAL_DATE_SIGNAL_PATTERN.test(normalized) ||
    CALENDAR_CONTEXTUAL_MONTH_SIGNAL_PATTERN.test(normalized)
  );
}

function isCalendarClarification(event: IntexAgentSessionEvent): boolean {
  const candidateIntents = event.payload['candidateIntents'];
  const missingFields = event.payload['missingFields'];
  return (
    (Array.isArray(candidateIntents) && candidateIntents.includes('create_calendar_event')) ||
    (Array.isArray(missingFields) && missingFields.includes('date'))
  );
}

function detectRetainOnlyLanguage(message: string): IntexAgentReplyLanguage | null {
  const normalized = message.normalize('NFKC').toLowerCase();
  if (/https?:\/\//u.test(normalized)) return null;
  const englishNoSaveMatch = /\b(?:do not|don['’]?t)\s+(?:save|store|persist)\b/u.exec(
    normalized
  );
  const polishNoSaveMatch = /\bnie\s+(?:zapisuj|utrwalaj)\b/u.exec(normalized);
  const englishNoSave = englishNoSaveMatch !== null;
  const englishRetainOnlyMatch =
    /\b(?:only|just)\s+(?:retain|hold|keep)\s+(?:(?:this|the|provided)\s+)?context\s*[.!?]*\s*$/u.exec(
      normalized
    ) ??
    /\b(?:retain|hold|keep)\s+(?:(?:this|the|provided)\s+)?context\s+(?:only|just)\s*[.!?]*\s*$/u.exec(
      normalized
    );
  const polishNoSave = polishNoSaveMatch !== null;
  const polishRetainOnlyMatch =
    /\btylko\s+(?:zachowaj|zapamiętaj|przechowaj)\s+(?:(?:ten|podany)\s+)?kontekst\s*[.!?]*\s*$/u.exec(
      normalized
    ) ??
    /\b(?:zachowaj|zapamiętaj|przechowaj)\s+(?:(?:ten|podany)\s+)?kontekst\s+tylko\s*[.!?]*\s*$/u.exec(
      normalized
    );

  const retainOnly =
    polishNoSave && polishRetainOnlyMatch !== null
      ? { language: 'pl' as const, clauseIndex: polishRetainOnlyMatch.index }
      : englishNoSave && englishRetainOnlyMatch !== null
        ? { language: 'en' as const, clauseIndex: englishRetainOnlyMatch.index }
        : null;
  if (retainOnly === null) return null;

  const prefix = normalized.slice(0, retainOnly.clauseIndex);
  if (
    /\b(?:translate|rewrite|quote|explain|analy[sz]e|summari[sz]e)\b/u.test(prefix) ||
    /\b(?:przetłumacz(?:yć)?|przetlumacz(?:yc)?|przeformułuj|zacytuj|wyjaśnij|wyjasnij|przeanalizuj|streść|stresc)(?!\p{L})/u.test(
      prefix
    )
  ) {
    return null;
  }

  return retainOnly.language;
}

function toolFailureMetadata(
  toolName: IntexAgentToolName,
  errorMessage: string
): {
  errorCategory: string;
  isRetryable: boolean;
  attemptedAction: string;
} {
  if (toolName === 'save_external' && errorMessage === 'External save is not configured') {
    return {
      errorCategory: 'configuration',
      isRetryable: false,
      attemptedAction: toolName,
    };
  }

  if (isPreferenceToolName(toolName) && isPreferenceVersionConflictMessage(errorMessage)) {
    return {
      errorCategory: 'version_conflict',
      isRetryable: true,
      attemptedAction: toolName,
    };
  }

  if (/HTTP 401|HTTP 403|Forbidden|Unauthorized/iu.test(errorMessage)) {
    return {
      errorCategory: 'permission',
      isRetryable: false,
      attemptedAction: toolName,
    };
  }

  if (/validation|invalid|required|must\b/iu.test(errorMessage)) {
    return {
      errorCategory: 'validation',
      isRetryable: false,
      attemptedAction: toolName,
    };
  }

  if (/timeout|rate limit|temporar|unavailable|try again/iu.test(errorMessage)) {
    return {
      errorCategory: 'transient',
      isRetryable: true,
      attemptedAction: toolName,
    };
  }

  return {
    errorCategory: 'unknown',
    isRetryable: false,
    attemptedAction: toolName,
  };
}

function detectReplyLanguage(
  events: IntexAgentSessionEvent[],
  currentMessage?: {
    text: string;
    sourceType?: string;
    hasSourceUrl?: boolean;
  }
): IntexAgentReplyLanguage {
  const priorMessages = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'user_message') {
      continue;
    }
    const priorMessage = event.payload['text'];
    if (typeof priorMessage === 'string') {
      priorMessages.push({
        text: priorMessage,
        ...(typeof event.payload['sourceType'] === 'string'
          ? { sourceType: event.payload['sourceType'] }
          : {}),
        ...(event.payload['hasSourceUrl'] === true ? { hasSourceUrl: true } : {}),
      });
    }
  }

  return selectIntexAgentReplyLanguage({
    ...(currentMessage !== undefined ? { currentMessage } : {}),
    priorMessages,
  });
}

function replyLanguageForIntent(
  intent: IntexAgentIntentClassification | IntexAgentIntentDecision,
  fallback: IntexAgentReplyLanguage
): IntexAgentReplyLanguage {
  const override =
    'languageOverride' in intent ? intent.languageOverride.trim().toLowerCase() : undefined;
  if (override === undefined) {
    return fallback;
  }
  if (['en', 'english', 'angielski', 'po angielsku'].includes(override)) {
    return 'en';
  }
  if (['pl', 'polish', 'polski', 'po polsku'].includes(override)) {
    return 'pl';
  }
  return fallback;
}

interface IntexAgentToolExecution {
  toolName: IntexAgentToolName;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  errorCategory?: string;
  selectionMetadata?: IntexAgentToolSelectionMetadata;
  selectionRejection?: Readonly<{
    category: 'behavioral_failure' | 'safety_stop';
    code: string;
  }>;
}

interface CompletedReply {
  reply: string;
  ctaUrl?: {
    displayText: string;
    url: string;
  };
}

function buildMessages(
  events: IntexAgentSessionEvent[],
  currentMessage: string,
  currentReplyContext?: IntexIncomingMessageReplyContext
): ToolCallingMessage[] {
  const messages: ToolCallingMessage[] = [];

  for (const event of events) {
    const message = messageFromEvent(event);
    if (message !== null) {
      const previousMessage = messages[messages.length - 1];
      if (
        previousMessage?.role === 'assistant' &&
        message.role === 'assistant' &&
        previousMessage.content === message.content
      ) {
        continue;
      }
      messages.push(message);
    }
  }

  messages.push({
    role: 'user',
    content: formatUserMessageWithReplyContext(currentMessage, currentReplyContext),
  });
  return messages;
}

function messageFromEvent(event: IntexAgentSessionEvent): ToolCallingMessage | null {
  if (event.type === 'user_message') {
    const text = event.payload['text'];
    const replyContext = parseIncomingReplyContext(event.payload['replyContext']);
    return typeof text === 'string'
      ? { role: 'user', content: formatUserMessageWithReplyContext(text, replyContext) }
      : null;
  }

  if (event.type === 'clarification_requested') {
    const message = event.payload['message'];
    return typeof message === 'string' ? { role: 'assistant', content: message } : null;
  }

  if (event.type === 'assistant_message') {
    const text = event.payload['text'];
    return typeof text === 'string' ? { role: 'assistant', content: text } : null;
  }

  if (event.type === 'tool_call_completed') {
    const toolName = event.payload['toolName'];
    const result = event.payload['result'];
    if (typeof toolName !== 'string') {
      return null;
    }
    return {
      role: 'assistant',
      content: `Tool ${toolName} completed: ${JSON.stringify(result ?? {})}`,
    };
  }

  return null;
}

interface RunnerOutputValidationInput {
  content: string;
  repairClient: StructuredClient | undefined;
  systemPrompt: string;
  messages: ToolCallingMessage[];
  intent: IntexAgentIntentClassification | IntexAgentIntentDecision;
  exposedToolNames: IntexAgentToolName[];
  currentMessage: string;
  matrixCorpusLlm?: MatrixCorpusLlmRecorder;
}

async function parseRunnerContent(
  input: RunnerOutputValidationInput,
  toolExecutions: IntexAgentToolExecution[],
  webAppUrl: string,
  userPreferences: string | null,
  replyLanguage: IntexAgentReplyLanguage,
  runtimeTimeZone: string
): Promise<IntexAgentRunnerResult> {
  const rejectedSelection = toolExecutions.find(
    (execution) => execution.selectionRejection !== undefined
  );
  if (
    rejectedSelection?.selectionRejection !== undefined &&
    rejectedSelection.selectionMetadata !== undefined
  ) {
    return {
      outcome: 'tool_selection_rejected',
      toolName: rejectedSelection.toolName,
      category: rejectedSelection.selectionRejection.category,
      code: rejectedSelection.selectionRejection.code,
      toolSelection: rejectedSelection.selectionMetadata,
      reply: TOOL_SELECTION_REJECTED_REPLIES[replyLanguage],
    };
  }
  const toolExecution = getCompletedToolExecution(toolExecutions);
  if (
    toolExecution?.toolName === 'get_user_preferences' &&
    toolExecution.error === undefined &&
    toolExecution.result !== undefined &&
    input.content.trim() === ''
  ) {
    return buildCompletedToolExecutionResult(
      toolExecution.toolName,
      toolExecution.result,
      '',
      undefined,
      webAppUrl,
      replyLanguage,
      toolExecution.selectionMetadata
    );
  }
  const parsed = await validateRunnerOutput(
    toolExecution !== undefined && isMutatingToolName(toolExecution.toolName)
      ? { ...input, repairClient: undefined }
      : input
  );
  if (toolExecution?.error !== undefined) {
    const failureMetadata = toolFailureMetadata(toolExecution.toolName, toolExecution.error);
    return {
      outcome: 'tool_failed',
      reply:
        parsed?.reply ??
        `${GENERIC_EXECUTION_FAILURE_PREFIX[replyLanguage]}${toolExecution.error}${GENERIC_EXECUTION_FAILURE_SUFFIX[replyLanguage]}`,
      toolName: toolExecution.toolName,
      error: toolExecution.error,
      errorCategory: toolExecution.errorCategory ?? failureMetadata.errorCategory,
      isRetryable: failureMetadata.isRetryable,
      attemptedAction: toolExecution.toolName,
      ...(toolExecution.selectionMetadata !== undefined
        ? { toolSelection: toolExecution.selectionMetadata }
        : {}),
    };
  }
  if (toolExecution !== undefined && isMutatingToolName(toolExecution.toolName)) {
    const confirmationArgs = preserveCurrentTurnOpaqueReferences(
      toolExecution.toolName,
      toolExecution.args,
      input.currentMessage
    );
    return {
      outcome: 'needs_confirmation',
      reply: buildConfirmationReply(
        toolExecution.toolName,
        confirmationArgs,
        userPreferences,
        replyLanguage,
        runtimeTimeZone
      ),
      toolName: toolExecution.toolName,
      toolArgs: confirmationArgs,
      ...(toolExecution.selectionMetadata !== undefined
        ? { toolSelection: toolExecution.selectionMetadata }
        : {}),
      ...(parsed?.summary !== undefined ? { summary: parsed.summary } : {}),
    };
  }

  if (parsed === null) {
    return fallbackClarificationResult(
      replyLanguage,
      fallbackReasonForInvalidRunnerContent(input.content)
    );
  }

  if (
    toolExecution !== undefined &&
    parsed.outcome !== 'completed'
  ) {
    return buildCompletedToolExecutionResult(
      toolExecution.toolName,
      toolExecution.result,
      parsed.reply,
      parsed.summary,
      webAppUrl,
      replyLanguage,
      toolExecution.selectionMetadata
    );
  }

  switch (parsed.outcome) {
    case 'needs_clarification': {
      const candidateIntents =
        input.intent.kind === 'tool' ? input.intent.allowedToolNames : parsed.candidateIntents;
      return {
        outcome: parsed.outcome,
        reply: parsed.reply,
        ...(parsed.blockerReason !== undefined ? { blockerReason: parsed.blockerReason } : {}),
        ...(parsed.missingFields !== undefined ? { missingFields: parsed.missingFields } : {}),
        ...(candidateIntents !== undefined ? { candidateIntents } : {}),
        ...(parsed.suggestedNextStep !== undefined
          ? { suggestedNextStep: parsed.suggestedNextStep }
          : {}),
        ...(parsed.clarification !== undefined ? { clarification: parsed.clarification } : {}),
      };
    }
    case 'no_action':
      return { outcome: parsed.outcome, reply: parsed.reply };
    case 'unsupported':
      return {
        outcome: parsed.outcome,
        reply: parsed.reply,
        blockerReason: parsed.blockerReason,
        suggestedNextStep: parsed.suggestedNextStep,
        fallbackReason: 'runner_declared_unsupported',
        fallbackSourceOutcome: 'unsupported',
        ...(parsed.missingFields !== undefined ? { missingFields: parsed.missingFields } : {}),
        ...(parsed.candidateIntents !== undefined
          ? { candidateIntents: parsed.candidateIntents }
          : {}),
      };
    case 'completed': {
      if (
        toolExecution === undefined &&
        input.exposedToolNames.length === 0 &&
        isConversationIntent(input.intent)
      ) {
        return {
          outcome: 'no_action',
          reply: parsed.reply,
          ...(parsed.summary !== undefined ? { summary: parsed.summary } : {}),
        };
      }
      if (toolExecution?.toolName !== parsed.toolName) {
        return fallbackClarificationResult(replyLanguage, 'tool_result_mismatch');
      }
      return buildCompletedToolExecutionResult(
        toolExecution.toolName,
        toolExecution.result,
        parsed.reply,
        parsed.summary,
        webAppUrl,
        replyLanguage,
        toolExecution.selectionMetadata
      );
    }
  }
}

function preserveCurrentTurnOpaqueReferences(
  toolName: MutatingIntexAgentToolName,
  args: Record<string, unknown>,
  currentMessage: string
): Record<string, unknown> {
  if (toolName !== 'create_note') return args;
  const currentReferences = extractRestorableOpaqueReferences(currentMessage);
  if (currentReferences.length === 0) return args;

  const argumentReferences = new Set(extractOpaqueReferences(JSON.stringify(args)));
  const missingReferences = currentReferences.filter(
    (reference) => !argumentReferences.has(reference)
  );
  if (missingReferences.length === 0) return args;

  const noteArgs = args as unknown as CreateNoteToolArgs;
  return {
    ...args,
    content: [noteArgs.content, ...missingReferences].join(' '),
  };
}

function extractOpaqueReferences(value: string): string[] {
  return [...new Set(Array.from(value.matchAll(OPAQUE_REFERENCE_PATTERN), (match) => match[0]))];
}

function extractRestorableOpaqueReferences(value: string): string[] {
  const lastIndexByReference = new Map<string, number>();
  for (const match of value.matchAll(OPAQUE_REFERENCE_PATTERN)) {
    lastIndexByReference.set(match[0], match.index);
  }

  return [...lastIndexByReference.entries()]
    .filter(([, index]) => {
      const prefix = value.slice(Math.max(0, index - 160), index);
      return !EXPLICIT_REFERENCE_EXCLUSION_PREFIX_PATTERN.test(prefix);
    })
    .map(([reference]) => reference);
}

function buildCompletedToolExecutionResult(
  toolName: IntexAgentToolName,
  result: Record<string, unknown> | undefined,
  fallbackReply: string,
  summary: string | undefined,
  webAppUrl: string,
  replyLanguage: IntexAgentReplyLanguage,
  toolSelection?: IntexAgentToolSelectionMetadata
): IntexAgentRunnerResult {
  const completedReply = buildCompletedReply(
    toolName,
    result,
    fallbackReply,
    webAppUrl,
    replyLanguage
  );
  return {
    outcome: 'completed',
    reply: completedReply.reply,
    ...(summary !== undefined ? { summary } : {}),
    toolName,
    ...(result !== undefined ? { toolResult: result } : {}),
    ...(toolSelection !== undefined ? { toolSelection } : {}),
    /* v8 ignore start -- schema: read-only tool results cannot produce CTA URLs because CTA-capable tools require confirmation @preserve */
    ...(completedReply.ctaUrl !== undefined ? { ctaUrl: completedReply.ctaUrl } : {}),
    /* v8 ignore stop @preserve */
  };
}

function isConversationIntent(
  intent: IntexAgentIntentClassification | IntexAgentIntentDecision
): boolean {
  return intent.kind === 'no_action' && intent.reason === 'conversation';
}

async function validateRunnerOutput(
  input: RunnerOutputValidationInput
): Promise<IntexAgentRunnerOutput | null> {
  const originalResult = await generateStructured<IntexAgentRunnerOutput>({
    client: createStructuredContentClient(input.content),
    prompt: 'Validate the Intex Agent runner response.',
    schema: IntexAgentRunnerOutputSchema,
    promptType: INTEX_AGENT_RUNNER_PROMPT_TYPE,
    maxRepairAttempts: 0,
  });
  if (originalResult.ok) return originalResult.value.data;
  if (input.repairClient === undefined || originalResult.error.kind !== 'validation') return null;

  const repairResult = await generateStructured<IntexAgentRunnerOutput>({
    client: input.repairClient,
    prompt: intexAgentRunnerOutputRepairPrompt.build({
      systemPrompt: input.systemPrompt,
      messages: input.messages,
      invalidResponse: originalResult.error.raw,
      errorMessage: formatZodErrors(originalResult.error.zodError),
    }),
    schema: IntexAgentRunnerProviderOutputSchema,
    promptType: INTEX_AGENT_RUNNER_PROMPT_TYPE,
    options: {
      responseFormat: INTEX_AGENT_RUNNER_RESPONSE_FORMAT,
      ...(input.matrixCorpusLlm === undefined
        ? {}
        : {
            matrixCorpusContext:
              input.matrixCorpusLlm.nextContext('response_schema_repair'),
          }),
    },
    maxRepairAttempts: 0,
    ...(input.matrixCorpusLlm === undefined
      ? {}
      : {
          onProviderCall: async (call: MatrixCorpusProviderCallUsageV1): Promise<void> => {
            await input.matrixCorpusLlm?.recordProviderCall(call);
          },
        }),
  });

  return repairResult.ok ? repairResult.value.data : null;
}

function createStructuredContentClient(content: string): StructuredClient {
  return {
    generate(): ReturnType<StructuredClient['generate']> {
      return Promise.resolve({
        ok: true,
        value: {
          content,
          usage: emptyStructuredUsage(),
        },
      });
    },
  };
}

function emptyStructuredUsage(): StructuredGenerateResult['usage'] {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
}

function createConfirmationPreviewExecutor(executor: IntexAgentToolExecutor): IntexAgentToolExecutor {
  return {
    createNote(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    createCalendarEvent(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    async queryCalendarEvents(args: QueryCalendarEventsToolArgs): Promise<string> {
      return await executor.queryCalendarEvents(args);
    },
    createResearch(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    createLink(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    createCodeTask(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    saveExternal(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    async getUserPreferences(): Promise<string> {
      return await executor.getUserPreferences();
    },
    addUserPreference(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    updateUserPreference(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
    deleteUserPreference(): Promise<string> {
      return Promise.resolve(previewToolResult());
    },
  };
}

function previewToolResult(): string {
  return JSON.stringify({ status: 'needs_confirmation' });
}

function isMutatingToolName(toolName: IntexAgentToolName): toolName is MutatingIntexAgentToolName {
  return MUTATING_TOOL_NAMES.has(toolName as MutatingIntexAgentToolName);
}

function createTrackingToolExecutor(
  executor: IntexAgentToolExecutor,
  toolExecutions: IntexAgentToolExecution[],
  toolSelectionGate?: IntexAgentRunnerConfig['toolSelectionGate']
): IntexAgentToolExecutor {
  async function track(
    toolName: IntexAgentToolName,
    args: Record<string, unknown>,
    run: () => Promise<string>
  ): Promise<string> {
    let selection:
      | Awaited<ReturnType<NonNullable<IntexAgentRunnerConfig['toolSelectionGate']>>>
      | undefined;
    try {
      selection = await toolSelectionGate?.({ toolName, args });
      if (selection?.decision === 'reject') {
        toolExecutions.push({
          toolName,
          args,
          selectionMetadata: selection.metadata,
          selectionRejection: {
            category: selection.category,
            code: selection.code,
          },
        });
        return JSON.stringify({ error: 'Tool selection rejected by execution policy' });
      }
      const rawResult = await run();
      const parsedResult = parseToolResult(rawResult);
      toolExecutions.push({
        toolName,
        args,
        ...(selection?.metadata !== undefined
          ? { selectionMetadata: selection.metadata }
          : {}),
        ...(parsedResult !== undefined ? { result: parsedResult } : {}),
      });
      return rawResult;
    } catch (error) {
      const typedCategory = errorCategory(error);
      toolExecutions.push({
        toolName,
        args,
        error: getErrorMessage(error, 'Unknown external save error'),
        ...(typedCategory !== undefined ? { errorCategory: typedCategory } : {}),
        ...(selection?.metadata !== undefined
          ? { selectionMetadata: selection.metadata }
          : {}),
      });
      throw error;
    }
  }

  return {
    async createNote(args: CreateNoteToolArgs): Promise<string> {
      return await track('create_note', toRecord(args), async () => await executor.createNote(args));
    },
    async createCalendarEvent(args: CreateCalendarEventToolArgs): Promise<string> {
      return await track(
        'create_calendar_event',
        toRecord(args),
        async () => await executor.createCalendarEvent(args)
      );
    },
    async queryCalendarEvents(args: QueryCalendarEventsToolArgs): Promise<string> {
      return await track(
        'query_calendar_events',
        toRecord(args),
        async () => await executor.queryCalendarEvents(args)
      );
    },
    async createResearch(args: CreateResearchToolArgs): Promise<string> {
      return await track('create_research', toRecord(args), async () => await executor.createResearch(args));
    },
    async createLink(args: CreateLinkToolArgs): Promise<string> {
      return await track('create_link', toRecord(args), async () => await executor.createLink(args));
    },
    async createCodeTask(args: CreateCodeTaskToolArgs): Promise<string> {
      return await track('create_code_task', toRecord(args), async () => await executor.createCodeTask(args));
    },
    async saveExternal(args: SaveExternalToolArgs): Promise<string> {
      return await track('save_external', toRecord(args), async () => await executor.saveExternal(args));
    },
    async getUserPreferences(): Promise<string> {
      return await track('get_user_preferences', {}, async () => await executor.getUserPreferences());
    },
    async addUserPreference(args: AddUserPreferenceToolArgs): Promise<string> {
      return await track(
        'add_user_preference',
        toRecord(args),
        async () => await executor.addUserPreference(args)
      );
    },
    async updateUserPreference(args: UpdateUserPreferenceToolArgs): Promise<string> {
      return await track(
        'update_user_preference',
        toRecord(args),
        async () => await executor.updateUserPreference(args)
      );
    },
    async deleteUserPreference(args: DeleteUserPreferenceToolArgs): Promise<string> {
      return await track(
        'delete_user_preference',
        toRecord(args),
        async () => await executor.deleteUserPreference(args)
      );
    },
  };
}

function errorCategory(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('category' in error)) return undefined;
  return typeof error.category === 'string' ? error.category : undefined;
}

function buildExternalSaveFailureReply(
  errorMessage: string,
  replyLanguage: IntexAgentReplyLanguage
): string {
  if (isExternalSaveNotConfiguredError(errorMessage)) {
    return EXTERNAL_SAVE_NOT_CONFIGURED_REPLIES[replyLanguage];
  }

  const detail = normalizeExternalSaveFailureDetail(errorMessage);
  return `${EXTERNAL_SAVE_FAILURE_PREFIX[replyLanguage]}${detail}${EXTERNAL_SAVE_FAILURE_SUFFIX[replyLanguage]}`;
}

function buildConfirmedExecutionFailureReply(
  toolName: IntexAgentToolName,
  errorMessage: string,
  replyLanguage: IntexAgentReplyLanguage
): string {
  if (toolName === 'save_external') {
    return buildExternalSaveFailureReply(errorMessage, replyLanguage);
  }

  if (isPreferenceToolName(toolName) && isPreferenceVersionConflictMessage(errorMessage)) {
    return PREFERENCE_VERSION_CONFLICT_REPLIES[replyLanguage];
  }

  const detail = normalizeExternalSaveFailureDetail(errorMessage);
  return `${GENERIC_EXECUTION_FAILURE_PREFIX[replyLanguage]}${detail}${GENERIC_EXECUTION_FAILURE_SUFFIX[replyLanguage]}`;
}

function isExternalSaveNotConfiguredError(errorMessage: string): boolean {
  return errorMessage.trim() === 'External save is not configured';
}

function normalizeExternalSaveFailureDetail(errorMessage: string): string {
  const normalized = errorMessage.trim().replace(/^Failed to save externally:\s*/i, '');
  const withoutTrailingPeriod = normalized.replace(/\.+$/u, '').trim();
  return withoutTrailingPeriod === '' ? 'Unknown external save error' : withoutTrailingPeriod;
}

function toRecord(args: object): Record<string, unknown> {
  return { ...args };
}

function getCompletedToolExecution(
  toolExecutions: IntexAgentToolExecution[]
): IntexAgentToolExecution | undefined {
  const uniqueExecutedToolNames = [...new Set(toolExecutions.map((execution) => execution.toolName))];
  if (uniqueExecutedToolNames.length === 1 && toolExecutions.length === 1) {
    return toolExecutions[0];
  }

  /* v8 ignore start -- schema: impossible after intent gating exposes at most one tool per turn @preserve */
  if (uniqueExecutedToolNames.length > 1) {
    return undefined;
  }
  /* v8 ignore stop @preserve */

  return undefined;
}

function parseToolResult(rawResult: string): Record<string, unknown> | undefined {
  return parseJsonObject(rawResult) ?? undefined;
}

function buildConfirmationReply(
  toolName: MutatingIntexAgentToolName,
  args: Record<string, unknown>,
  userPreferences: string | null,
  replyLanguage: IntexAgentReplyLanguage,
  runtimeTimeZone: string
): string {
  if (toolName === 'create_note') {
    const lines = [CONFIRMATION_INTROS.create_note[replyLanguage]];
    const title = readRawString(args, 'title');
    const content = readRawString(args, 'content');
    if (title !== undefined) lines.push('', `${CONFIRMATION_LABELS.title[replyLanguage]}: ${title}`);
    /* v8 ignore start -- schema: create_note preview args cannot omit content because validation runs before confirmation text is built @preserve */
    if (content !== undefined) {
      lines.push(`${CONFIRMATION_LABELS.content[replyLanguage]}: ${content}`);
    }
    /* v8 ignore stop @preserve */
    return lines.join('\n');
  }

  if (toolName === 'create_calendar_event') {
    const lines = [CONFIRMATION_INTROS.create_calendar_event[replyLanguage]];
    const timeZone = readRawString(args, 'timeZone');
    const start = readRawString(args, 'start');
    const end = readRawString(args, 'end');
    appendConfirmationLine(lines, CONFIRMATION_LABELS.title[replyLanguage], readRawString(args, 'summary'));
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.start[replyLanguage],
      /* v8 ignore start -- schema: validated calendar tool args always include start @preserve */
      start === undefined
        ? undefined
        : formatCalendarConfirmationDateTime(start, timeZone, runtimeTimeZone, replyLanguage)
      /* v8 ignore stop @preserve */
    );
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.end[replyLanguage],
      /* v8 ignore start -- schema: validated calendar tool args always include end @preserve */
      end === undefined
        ? undefined
        : formatCalendarConfirmationDateTime(end, timeZone, runtimeTimeZone, replyLanguage)
      /* v8 ignore stop @preserve */
    );
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.location[replyLanguage],
      readRawString(args, 'location')
    );
    appendConfirmationListLine(
      lines,
      CONFIRMATION_LABELS.attendees[replyLanguage],
      readStringArray(args, 'attendees')
    );
    return lines.join('\n');
  }

  if (toolName === 'create_research') {
    const lines = [CONFIRMATION_INTROS.create_research[replyLanguage]];
    appendConfirmationLine(lines, CONFIRMATION_LABELS.title[replyLanguage], readRawString(args, 'title'));
    appendConfirmationLine(lines, CONFIRMATION_LABELS.prompt[replyLanguage], readRawString(args, 'prompt'));
    return lines.join('\n');
  }

  if (toolName === 'create_link') {
    const lines = [
      CONFIRMATION_INTROS.create_link[replyLanguage],
      LINK_CONFIRMATION_ACTION_HINT[replyLanguage],
      '',
    ];
    appendConfirmationLine(lines, 'URL', readRawString(args, 'url'));
    appendConfirmationLine(lines, CONFIRMATION_LABELS.title[replyLanguage], readRawString(args, 'title'));
    return lines.join('\n');
  }

  if (toolName === 'create_code_task') {
    const lines = [CONFIRMATION_INTROS.create_code_task[replyLanguage]];
    appendConfirmationLine(lines, CONFIRMATION_LABELS.prompt[replyLanguage], readRawString(args, 'prompt'));
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.mode[replyLanguage],
      readRawString(args, 'taskMode')
    );
    appendConfirmationLine(lines, CONFIRMATION_LABELS.worker[replyLanguage], readRawString(args, 'workerType'));
    appendConfirmationLine(lines, 'Linear', readRawString(args, 'linearIssueId'));
    return lines.join('\n');
  }

  if (toolName === 'save_external') {
    const lines = [CONFIRMATION_INTROS.save_external[replyLanguage]];
    appendConfirmationLine(lines, CONFIRMATION_LABELS.content[replyLanguage], readRawString(args, 'message'));
    appendConfirmationLine(lines, CONFIRMATION_LABELS.source[replyLanguage], readRawString(args, 'sourceUrl'));
    return lines.join('\n');
  }

  if (toolName === 'add_user_preference') {
    const lines = [CONFIRMATION_INTROS.add_user_preference[replyLanguage]];
    appendConfirmationLine(lines, CONFIRMATION_LABELS.newEntry[replyLanguage], readRawString(args, 'text'));
    return lines.join('\n');
  }

  if (toolName === 'update_user_preference') {
    const lines = [CONFIRMATION_INTROS.update_user_preference[replyLanguage]];
    const itemId = readRawString(args, 'itemId');
    appendConfirmationLine(lines, CONFIRMATION_LABELS.entry[replyLanguage], itemId);
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.before[replyLanguage],
      findPreferenceText(userPreferences, itemId)
    );
    appendConfirmationLine(lines, CONFIRMATION_LABELS.after[replyLanguage], readRawString(args, 'text'));
    return lines.join('\n');
  }

  const lines = [CONFIRMATION_INTROS.delete_user_preference[replyLanguage]];
  const itemId = readRawString(args, 'itemId');
  appendConfirmationLine(lines, CONFIRMATION_LABELS.entry[replyLanguage], itemId);
  appendConfirmationLine(
    lines,
    CONFIRMATION_LABELS.content[replyLanguage],
    findPreferenceText(userPreferences, itemId)
  );
  return lines.join('\n');
}

function appendConfirmationLine(lines: string[], label: string, value: string | undefined): void {
  if (value === undefined || value.trim() === '') {
    return;
  }
  if (lines.length === 1) {
    lines.push('');
  }
  lines.push(`${label}: ${value}`);
}

function formatCalendarConfirmationDateTime(
  value: string,
  toolTimeZone: string | undefined,
  runtimeTimeZone: string,
  replyLanguage: IntexAgentReplyLanguage
): string {
  const instant = new Date(value);
  const preferredTimeZone = toolTimeZone ?? runtimeTimeZone;
  const hasExplicitOffset = /(?:Z|[+-]\d{2}:\d{2})$/u.test(value);
  const displayTimeZone = hasExplicitOffset ? preferredTimeZone : 'UTC';
  const displayInstant = hasExplicitOffset ? instant : dateFromIsoWallClock(value);
  const locale = replyLanguage === 'pl' ? 'pl-PL' : 'en-GB';
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: displayTimeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(displayInstant);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: displayTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(displayInstant);
  return `${date}, ${time}`;
}

function formatReplyDateRecords(
  reply: string,
  runtimeTimeZone: string,
  replyLanguage: IntexAgentReplyLanguage
): string {
  return reply.replace(REPLY_RAW_DATE_PATTERN, (_match, prefix: string, value: string) => {
    if (RAW_REPLY_DATE_TIME_PATTERN.test(value)) {
      if (!isValidReplyDateTime(value)) {
        return `${prefix}${replyLanguage === 'pl' ? 'nieprawidłowa data' : 'invalid date'}`;
      }
      return `${prefix}${formatCalendarConfirmationDateTime(
        value,
        undefined,
        runtimeTimeZone,
        replyLanguage
      )}`;
    }

    const instant = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== value) {
      return `${prefix}${replyLanguage === 'pl' ? 'nieprawidłowa data' : 'invalid date'}`;
    }
    const formatted = new Intl.DateTimeFormat(replyLanguage === 'pl' ? 'pl-PL' : 'en-GB', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(instant);
    return `${prefix}${formatted}`;
  });
}

function isValidReplyDateTime(value: string): boolean {
  const match = STRICT_REPLY_DATE_TIME_PATTERN.exec(value) as RegExpExecArray;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  const civil = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    civil.getUTCFullYear() !== year ||
    civil.getUTCMonth() !== month - 1 ||
    civil.getUTCDate() !== day ||
    civil.getUTCHours() !== hour ||
    civil.getUTCMinutes() !== minute ||
    civil.getUTCSeconds() !== second
  ) {
    return false;
  }
  const offset = match[7];
  if (offset === undefined || offset === 'Z') return true;
  return Number(offset.slice(1, 3)) <= 23 && Number(offset.slice(4, 6)) <= 59;
}

function dateFromIsoWallClock(value: string): Date {
  return new Date(
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(5, 7)) - 1,
      Number(value.slice(8, 10)),
      Number(value.slice(11, 13)),
      Number(value.slice(14, 16))
    )
  );
}

function appendConfirmationListLine(
  lines: string[],
  label: string,
  value: string[] | undefined
): void {
  if (value === undefined || value.length === 0) {
    return;
  }
  appendConfirmationLine(lines, label, value.join(', '));
}

function readStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return undefined;
  }
  return value;
}

function findPreferenceText(userPreferences: string | null, itemId: string | undefined): string | undefined {
  if (userPreferences === null || itemId === undefined) {
    return undefined;
  }
  const line = userPreferences.split('\n').find((candidate) => candidate.includes(`(id: ${itemId}) `));
  if (line === undefined) {
    return undefined;
  }
  const quotedText = line.slice(line.indexOf(') ') + 2).trim();
  try {
    const parsed: unknown = JSON.parse(quotedText);
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return quotedText;
  }
}

function buildCompletedReply(
  toolName: IntexAgentToolName,
  result: Record<string, unknown> | undefined,
  fallbackReply: string,
  webAppUrl: string,
  replyLanguage: IntexAgentReplyLanguage
): CompletedReply {
  if (result === undefined) {
    return { reply: fallbackReply };
  }

  if (isPreferenceToolName(toolName)) {
    const promptBlock = readRawString(result, 'promptBlock');
    const renderedPromptBlock =
      promptBlock !== undefined && promptBlock.trim() !== '' ? promptBlock : undefined;
    const overlayBlock =
      toolName === 'get_user_preferences' ? renderPreferenceOverlayItems(result) : undefined;
    return {
      reply:
        renderedPromptBlock ?? overlayBlock ?? COMPLETED_REPLIES.preferencesEmpty[replyLanguage],
    };
  }

  const resourceUrl = readString(result, 'resourceUrl');
  const absoluteResourceUrl = toObjectCtaUrl(resourceUrl, webAppUrl);
  if (absoluteResourceUrl !== undefined) {
    if (toolName === 'create_note') {
      return {
        reply: COMPLETED_REPLIES.create_note[replyLanguage],
        ctaUrl: { displayText: CTA_LABELS.openNote[replyLanguage], url: absoluteResourceUrl },
      };
    }
    if (toolName === 'create_research') {
      return {
        reply: COMPLETED_REPLIES.create_research[replyLanguage],
        ctaUrl: { displayText: CTA_LABELS.openResearch[replyLanguage], url: absoluteResourceUrl },
      };
    }
    if (toolName === 'create_code_task') {
      return {
        reply: COMPLETED_REPLIES.create_code_task[replyLanguage],
        ctaUrl: { displayText: CTA_LABELS.viewProgress[replyLanguage], url: absoluteResourceUrl },
      };
    }
    if (toolName === 'create_link') {
      return {
        reply: COMPLETED_REPLIES.create_link[replyLanguage],
        ctaUrl: { displayText: CTA_LABELS.openBookmark[replyLanguage], url: absoluteResourceUrl },
      };
    }
  }
  if (resourceUrl !== undefined) {
    if (toolName === 'create_research') {
      return {
        reply: `${COMPLETED_REPLIES.create_research[replyLanguage].replace(/\.$/u, '')}: ${resourceUrl}`,
      };
    }
    if (toolName === 'create_code_task') {
      return {
        reply: `${COMPLETED_REPLIES.create_code_task[replyLanguage].replace(/\.$/u, '')}: ${resourceUrl}`,
      };
    }
    return { reply: `${fallbackReply.trim()} ${resourceUrl}`.trim() };
  }

  const htmlLink = readString(result, 'htmlLink');
  const absoluteHtmlLink = toAbsoluteUrl(htmlLink);
  if (toolName === 'create_calendar_event' && absoluteHtmlLink !== undefined) {
    return {
      reply: COMPLETED_REPLIES.create_calendar_event[replyLanguage],
      ctaUrl: { displayText: CTA_LABELS.openCalendar[replyLanguage], url: absoluteHtmlLink },
    };
  }
  if (htmlLink !== undefined && toolName === 'create_calendar_event') {
    return {
      reply: `${COMPLETED_REPLIES.create_calendar_event[replyLanguage].replace(/\.$/u, '')}: ${htmlLink}`,
    };
  }

  const url = readString(result, 'url');
  const absoluteUrl = toAbsoluteUrl(url);
  if (toolName === 'create_link' && absoluteUrl !== undefined) {
    return {
      reply: COMPLETED_REPLIES.linkUrl[replyLanguage],
      ctaUrl: { displayText: CTA_LABELS.openLink[replyLanguage], url: absoluteUrl },
    };
  }
  if (url !== undefined && toolName === 'create_link') {
    return {
      reply: `${COMPLETED_REPLIES.linkUrl[replyLanguage].replace(/\.$/u, '')}: ${url}`,
    };
  }

  const message = readString(result, 'message');
  if (toolName === 'save_external' && message !== undefined) {
    return { reply: COMPLETED_REPLIES.save_external[replyLanguage] };
  }
  return { reply: fallbackReply };
}

function defaultCompletedReply(
  toolName: MutatingIntexAgentToolName,
  replyLanguage: IntexAgentReplyLanguage
): string {
  if (toolName === 'create_note') {
    return COMPLETED_REPLIES.create_note[replyLanguage];
  }
  if (toolName === 'create_calendar_event') {
    return COMPLETED_REPLIES.create_calendar_event[replyLanguage];
  }
  if (toolName === 'create_research') {
    return COMPLETED_REPLIES.create_research[replyLanguage];
  }
  if (toolName === 'create_link') {
    return COMPLETED_REPLIES.create_link[replyLanguage];
  }
  if (toolName === 'create_code_task') {
    return COMPLETED_REPLIES.create_code_task[replyLanguage];
  }
  if (toolName === 'save_external') {
    return COMPLETED_REPLIES.save_external[replyLanguage];
  }
  return COMPLETED_REPLIES.preference[replyLanguage];
}

function isPreferenceToolName(toolName: IntexAgentToolName): boolean {
  return (
    toolName === 'get_user_preferences' ||
    toolName === 'add_user_preference' ||
    toolName === 'update_user_preference' ||
    toolName === 'delete_user_preference'
  );
}

function isPreferenceVersionConflictMessage(errorMessage: string): boolean {
  return /^Expected preference version \d+, but current version is \d+$/u.test(errorMessage.trim());
}

function readRawString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function renderPreferenceOverlayItems(result: Record<string, unknown>): string | undefined {
  const currentVersion = result['currentVersion'];
  const items = result['items'];
  if (
    !Number.isSafeInteger(currentVersion) ||
    (currentVersion as number) < 0 ||
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return undefined;
  }

  const renderedItems: string[] = [];
  for (const [index, item] of items.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined;
    const record = item as Record<string, unknown>;
    const id = readString(record, 'id');
    const text = readString(record, 'text');
    if (id === undefined || text === undefined) return undefined;
    renderedItems.push(`${String(index + 1)}. (id: ${id}) ${JSON.stringify(text)}`);
  }
  return [`User Preferences v${String(currentVersion)}:`, ...renderedItems].join('\n');
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function toObjectCtaUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const url = new URL(value, normalizeBaseUrl(baseUrl));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function toAbsoluteUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function fallbackReasonForInvalidRunnerContent(content: string): Extract<
  IntexAgentFallbackReason,
  'runner_output_malformed' | 'tool_result_mismatch'
> {
  const parsed = parseJsonObject(content);
  if (parsed?.['outcome'] === 'completed' && typeof parsed['toolName'] !== 'string') {
    return 'tool_result_mismatch';
  }
  return 'runner_output_malformed';
}

function fallbackClarificationResult(
  replyLanguage: IntexAgentReplyLanguage,
  fallbackReason: Extract<
    IntexAgentFallbackReason,
    'runner_output_malformed' | 'tool_result_mismatch' | 'llm_call_failed'
  >,
  fallbackSourceOutcome?: string
): IntexAgentRunnerResult {
  return {
    outcome: 'needs_clarification',
    reply:
      fallbackReason === 'llm_call_failed'
        ? LLM_FAILURE_CLARIFICATION_REPLIES[replyLanguage]
        : FALLBACK_CLARIFICATION_REPLIES[replyLanguage],
    blockerReason: 'not_enough_context',
    suggestedNextStep: FALLBACK_CLARIFICATION_NEXT_STEPS[replyLanguage],
    fallbackReason,
    fallbackSourceOutcome:
      fallbackSourceOutcome ?? defaultFallbackSourceOutcome(fallbackReason),
  };
}

function defaultFallbackSourceOutcome(
  fallbackReason: Extract<
    IntexAgentFallbackReason,
    'runner_output_malformed' | 'tool_result_mismatch' | 'llm_call_failed'
  >
): string {
  if (fallbackReason === 'tool_result_mismatch') {
    return 'completed';
  }
  if (fallbackReason === 'runner_output_malformed') {
    return 'raw_response';
  }
  return 'llm_call_failed';
}

const FALLBACK_CLARIFICATION_REPLIES: Record<IntexAgentReplyLanguage, string> = {
  en: 'What would you like me to do with this?',
  pl: 'Co mam z tym zrobić?',
};

const LLM_FAILURE_CLARIFICATION_REPLIES: Record<IntexAgentReplyLanguage, string> = {
  en: 'I could not process that request right now. Please restate what you want me to do.',
  pl: 'Nie mogłem teraz przetworzyć tej prośby. Napisz proszę jeszcze raz, co mam zrobić.',
};

const FALLBACK_CLARIFICATION_NEXT_STEPS: Record<IntexAgentReplyLanguage, string> = {
  en: 'Ask the user to restate the action.',
  pl: 'Poproś użytkownika o doprecyzowanie akcji.',
};

function normalizeClassifierUnsupportedIntent(
  intent: Extract<IntexAgentIntentClassification, { kind: 'unsupported' }>,
  replyLanguage: IntexAgentReplyLanguage
): IntexAgentRunnerResult {
  const suggestedNextStep =
    readNonBlankString(intent.suggestedNextStep) ?? fallbackUnsupportedNextStep(replyLanguage);

  if (CLARIFICATION_ONLY_BLOCKER_REASONS.has(intent.blockerReason)) {
    return {
      outcome: 'needs_clarification',
      reply: FALLBACK_CLARIFICATION_REPLIES[replyLanguage],
      blockerReason: intent.blockerReason,
      suggestedNextStep:
        readNonBlankString(intent.suggestedNextStep) ??
        FALLBACK_CLARIFICATION_NEXT_STEPS[replyLanguage],
      fallbackReason: 'classifier_unsupported',
      fallbackSourceOutcome: 'unsupported',
    };
  }

  return {
    outcome: 'unsupported',
    reply: unsupportedIntentReply(intent.blockerReason, suggestedNextStep, replyLanguage),
    blockerReason: intent.blockerReason,
    suggestedNextStep,
    fallbackReason: 'classifier_unsupported',
    fallbackSourceOutcome: 'unsupported',
  };
}

function unsupportedIntentReply(
  blockerReason: string,
  suggestedNextStep: string,
  replyLanguage: IntexAgentReplyLanguage
): string {
  const languageReplies = CLASSIFIER_UNSUPPORTED_REPLIES[replyLanguage];
  const base = languageReplies[blockerReason] ?? languageReplies.unsupported_capability;
  const nextStep = userFacingSuggestedNextStep(suggestedNextStep, replyLanguage);
  return `${base} ${nextStep}`;
}

function fallbackUnsupportedNextStep(replyLanguage: IntexAgentReplyLanguage): string {
  return replyLanguage === 'pl'
    ? 'Poproś użytkownika o opisanie obsługiwanej akcji.'
    : 'Ask the user to describe a supported action.';
}

function readNonBlankString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function userFacingSuggestedNextStep(
  suggestedNextStep: string,
  replyLanguage: IntexAgentReplyLanguage
): string {
  const trimmed = suggestedNextStep.trim();
  if (replyLanguage === 'en') {
    const offerMatch = /^offer to\s+(.+)$/iu.exec(trimmed);
    if (offerMatch?.[1] !== undefined) {
      return ensureSentence(`I can ${offerMatch[1].replace(/\.+$/u, '').trim()}`);
    }
  }
  return ensureSentence(trimmed);
}

function ensureSentence(value: string): string {
  return /[.!?]\s*$/u.test(value) ? value : `${value}.`;
}
