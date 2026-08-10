import { getErrorMessage } from '@intexuraos/common-core';
import {
  calendarUpdateEventAttendeesRequestSchema,
  WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH,
} from '@intexuraos/http-contracts';
import type {
  MatrixCorpusProviderCallUsageV1,
  ToolDefinition,
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
  IntexAgentSupportingToolCompletion,
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
  type CalendarEventDateTimeSnapshot,
  type QueryCalendarEventsToolArgs,
  type UpdateCalendarEventToolArgs,
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
  'update_calendar_event',
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
  'timezoneconfirmation',
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

interface CalendarQueryFallbackText {
  calendarEvents: string;
  empty: string;
  matching: string;
  requestedPeriod: string;
  atLeast: string;
  location: string;
  locale: string;
}

const GENERIC_EXECUTION_FAILURE_PREFIX: LocalizedText = {
  en: 'I could not execute this action: ',
  pl: 'Nie udało się wykonać tej akcji: ',
};

const GENERIC_EXECUTION_FAILURE_SUFFIX: LocalizedText = {
  en: '. Please try again later.',
  pl: '. Spróbuj ponownie później.',
};

const CALENDAR_QUERY_FALLBACK_TEXT = {
  en: {
    calendarEvents: 'Calendar events',
    empty: 'There are no calendar events in the requested period.',
    matching: 'matching',
    requestedPeriod: 'in the requested period',
    atLeast: 'at least',
    location: 'location',
    locale: 'en-GB',
  },
  pl: {
    calendarEvents: 'Wydarzenia w kalendarzu',
    empty: 'Brak wydarzeń w kalendarzu w podanym okresie.',
    matching: 'pasujące do',
    requestedPeriod: 'w podanym okresie',
    atLeast: 'co najmniej',
    location: 'miejsce',
    locale: 'pl-PL',
  },
} satisfies Record<IntexAgentReplyLanguage, CalendarQueryFallbackText>;

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

const CALENDAR_EVENT_VERSION_CONFLICT_REPLIES: LocalizedText = {
  en: 'The calendar event changed after confirmation. Send the request again so I can use its latest version.',
  pl: 'Wydarzenie w kalendarzu zmieniło się po potwierdzeniu. Wyślij prośbę ponownie, żebym użył jego najnowszej wersji.',
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
const CALENDAR_COLON_CLOCK_PATTERN =
  /(?<![\p{L}\p{N}])(\d{1,2}):(\d{2})(?:\s*(am|pm))?(?![\p{L}\p{N}])/iu;
const CALENDAR_MERIDIEM_CLOCK_PATTERN =
  /(?<![\p{L}\p{N}])(\d{1,2})\s*(am|pm)(?![\p{L}\p{N}])/iu;
const CALENDAR_CONTEXTUAL_HOUR_PATTERN =
  /(?<![\p{L}\p{N}])(?:at|o)\s+(\d{1,2})(?![\p{L}\p{N}:])/iu;
const CALENDAR_ENGLISH_DURATION_PATTERN =
  /(?<![\p{L}\p{N}])for\s+(\d+|an?|one|two|three|half\s+an?)\s+(hours?|minutes?)(?![\p{L}\p{N}])/iu;
const CALENDAR_POLISH_DURATION_PATTERN =
  /(?<![\p{L}\p{N}])na\s+(?:(\d+)\s+)?(?:godzin(?:ę|y|a)|minut(?:ę|y)?)(?![\p{L}\p{N}])/iu;
const CALENDAR_UNTIL_CLOCK_PATTERN =
  /(?<![\p{L}\p{N}])until\s+(noon|midnight|\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)(?![\p{L}\p{N}])/iu;
const CALENDAR_CLOCK_RANGE_PATTERN =
  /(?<![\p{L}\p{N}])(?:from\s+)?(noon|midnight|\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)\s*(?:-|–|to)\s*(noon|midnight|\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)(?![\p{L}\p{N}])/iu;
const CALENDAR_NEGATED_CLOCK_PATTERN =
  /(?:\b(?:do\s+not|don['’]?t)\s+(?:use|schedule|book|set)\s+(?:at\s+)?(?:noon|midnight|\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)|\b(?:any\s+time\s+)?(?:except|other\s+than)\s+(?:noon|midnight|\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)|\bnot\s+at\s+(?:noon|midnight|\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)|\bnie\s+(?:używaj|uzywaj|ustawiaj|planuj)\s+(?:o\s+|na\s+)?(?:południe|poludnie|północ|polnoc|\d{1,2}(?::\d{2})?)|\b(?:dowolna\s+godzina|dowolnej\s+porze)\s+poza\s+(?:południem|poludniem|północą|polnoca|\d{1,2}(?::\d{2})?))(?![\p{L}\p{N}])/iu;
const CALENDAR_NEGATED_DURATION_PATTERN =
  /(?:\b(?:but\s+)?not\s+for\s+(?:\d+|an?|one|two|three|half\s+an?)\s+(?:hours?|minutes?)|\b(?:ale\s+)?nie\s+na\s+(?:\d+\s+)?(?:godzin(?:ę|y|a)|minut(?:ę|y)?))(?![\p{L}\p{N}])/iu;
const CALENDAR_PRIOR_TIME_WITHDRAWAL_PATTERN =
  /(?:\b(?:that|this|the)\s+time\s+(?:(?:no\s+longer|does(?:\s+not|n['’]?t)|will\s+not|won['’]?t)\s+(?:work|fit|suit)|is\s+no\s+longer\s+(?:valid|available))|\b(?:ta|ten)\s+(?:godzina|czas)\s+(?:już|juz)\s+(?:nie\s+)?(?:pasuje|działa|dziala)\b)/iu;
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
  update_calendar_event: {
    en: 'Add attendees to this existing calendar event?',
    pl: 'Czy dodać uczestników do istniejącego wydarzenia w kalendarzu?',
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
  en: 'Use the buttons below to confirm or cancel.',
  pl: 'Użyj przycisków poniżej, aby potwierdzić albo anulować.',
};

const CONFIRMATION_PREVIEW_TRUNCATION_NOTICE: LocalizedText = {
  en: 'Preview shortened. The full content will be used after confirmation.',
  pl: 'Podgląd został skrócony. Po potwierdzeniu zostanie użyta pełna treść.',
};

const CALENDAR_UPDATE_PRESERVATION_NOTICE: LocalizedText = {
  en: 'All other event details will remain unchanged.',
  pl: 'Pozostałe dane wydarzenia pozostaną bez zmian.',
};

const CALENDAR_UPDATE_MALFORMED_REPLIES: LocalizedText = {
  en: 'I could not prepare the existing calendar event update. Please send the request again.',
  pl: 'Nie udało mi się przygotować zmiany istniejącego wydarzenia w kalendarzu. Wyślij prośbę ponownie.',
};

const CALENDAR_UPDATE_MALFORMED_NEXT_STEPS: LocalizedText = {
  en: 'Repeat the request to update the existing calendar event.',
  pl: 'Ponów prośbę o zmianę istniejącego wydarzenia w kalendarzu.',
};

const CALENDAR_UPDATE_LOOKUP_REPLIES: LocalizedText = {
  en: 'I could not identify exactly one calendar event to update. Please clarify which event you mean.',
  pl: 'Nie udało mi się jednoznacznie wskazać jednego wydarzenia do zmiany. Doprecyzuj, o które wydarzenie chodzi.',
};

const CALENDAR_UPDATE_LOOKUP_NEXT_STEPS: LocalizedText = {
  en: 'Identify exactly one existing calendar event.',
  pl: 'Wskaż dokładnie jedno istniejące wydarzenie.',
};

const CALENDAR_UPDATE_EMAIL_CLARIFICATION_REPLIES: LocalizedText = {
  en: "What is the attendee's email address?",
  pl: 'Jaki jest adres e-mail uczestnika?',
};

const CALENDAR_UPDATE_EMAIL_CLARIFICATION_NEXT_STEPS: LocalizedText = {
  en: 'Provide the attendee email address.',
  pl: 'Podaj adres e-mail uczestnika.',
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
  update_calendar_event: {
    en: 'Updated the calendar event.',
    pl: 'Zaktualizowałem wydarzenie w kalendarzu.',
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
      const normalizedIntent = applyOptionalPreferenceReadFieldClarification(
        applyOptionalCodeTaskFieldClarification(
          applyCompleteCalendarClarificationContext(
            applyAvailableCalendarSummaryContext(
              applyOptionalNoteFieldClarification(
                applyRuntimeTimeZoneToCalendarIntent(classifiedIntent, {
                  timeZone: input.timeZone,
                  message: input.message,
                  events: input.events,
                  replyContext: input.replyContext,
                })
              ),
              input.events
            ),
            {
              timeZone: input.timeZone,
              message: input.message,
              events: input.events,
              replyContext: input.replyContext,
            }
          )
        ),
        input.message
      );
      const queryNormalizedIntent = applyDerivedCalendarQueryContext(normalizedIntent, {
        message: input.message,
        events: input.events,
        replyContext: input.replyContext,
      });
      const dateNormalizedIntent = applyMissingCalendarDateClarification(queryNormalizedIntent, {
        message: input.message,
        events: input.events,
        replyContext: input.replyContext,
        replyLanguage: replyLanguageForIntent(queryNormalizedIntent, detectedReplyLanguage),
      });
      const intent = applyMissingCalendarAttendeeEmailClarification(dateNormalizedIntent, {
        message: input.message,
        events: input.events,
        replyContext: input.replyContext,
        replyLanguage: replyLanguageForIntent(dateNormalizedIntent, detectedReplyLanguage),
        userPreferences: config.userPreferences ?? null,
      });
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

      const calendarUpdateContext = {
        message: input.message,
        events: input.events,
        replyContext: input.replyContext,
        userPreferences: config.userPreferences ?? null,
      };
      const calendarUpdateRelevantTexts = isCalendarUpdateIntent(intent)
        ? activeCalendarAttendeeRelevantTexts(calendarUpdateContext)
        : undefined;
      const calendarUpdateAttendeeEmails = isCalendarUpdateIntent(intent)
        ? resolveActiveCalendarAttendeeEmails(calendarUpdateContext)
        : undefined;
      const toolExecutions: IntexAgentToolExecution[] = [];
      const allowedToolNames = resolveRunnerToolNames(intent);
      const trackingToolExecutor = createTrackingToolExecutor(
        createConfirmationPreviewExecutor(config.toolExecutor),
        toolExecutions,
        config.toolSelectionGate,
        resolveCurrentPreferenceVersion(config.userPreferences),
        calendarUpdateAttendeeEmails
      );
      const tools = createIntexAgentToolDefinitions(
        trackingToolExecutor
      )
        .filter(
          (tool) =>
            allowedToolNames.includes(tool.name as IntexAgentToolName)
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

      const synthesizedCalendarUpdatePreview = await appendDeterministicCalendarUpdatePreview({
        intent,
        toolExecutions,
        tools,
        attendeesToAdd: calendarUpdateAttendeeEmails as string[],
        activeUserTexts: calendarUpdateRelevantTexts,
      });

      const runnerResult = await parseRunnerContent(
        {
          content: result.value.content,
          repairClient: config.responseRepairClient,
          systemPrompt,
          messages,
          intent,
          exposedToolNames,
          currentMessage: input.message,
          ...(calendarUpdateAttendeeEmails !== undefined
            ? { calendarUpdateAttendeeEmails }
            : {}),
          ...(synthesizedCalendarUpdatePreview
            ? { synthesizedCalendarUpdatePreview: true }
            : {}),
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

function applyAvailableCalendarSummaryContext(
  intent: IntexAgentIntentClassification,
  events: readonly IntexAgentSessionEvent[]
): IntexAgentIntentClassification {
  if (
    intent.kind !== 'needs_clarification' ||
    intent.blockerReason !== 'missing_required_details' ||
    intent.candidateIntents?.length !== 1 ||
    intent.candidateIntents[0] !== 'create_calendar_event' ||
    intent.missingFields === undefined ||
    intent.missingFields.length === 0 ||
    !intent.missingFields.every(isCalendarSummaryField)
  ) {
    return intent;
  }

  const activeClarification = findActiveClarificationEvent(events);
  const previouslyMissingFields = activeClarification?.event.payload['missingFields'];
  if (
    activeClarification === undefined ||
    !isCalendarClarification(activeClarification.event) ||
    !Array.isArray(previouslyMissingFields) ||
    previouslyMissingFields.length === 0 ||
    previouslyMissingFields.some(
      (field) => typeof field !== 'string' || isCalendarSummaryField(field)
    ) ||
    !activeCalendarClarificationChainContainsSummary(events, activeClarification.index)
  ) {
    return intent;
  }

  return clarificationToToolIntent(intent, 'create_calendar_event');
}

function applyCompleteCalendarClarificationContext(
  intent: IntexAgentIntentClassification,
  context: Readonly<{
    timeZone: string;
    message: string;
    events: readonly IntexAgentSessionEvent[];
    replyContext: IntexIncomingMessageReplyContext | undefined;
  }>
): IntexAgentIntentClassification {
  if (
    intent.kind !== 'needs_clarification' ||
    intent.blockerReason !== 'missing_required_details' ||
    intent.candidateIntents?.length !== 1 ||
    intent.candidateIntents[0] !== 'create_calendar_event' ||
    intent.missingFields === undefined ||
    intent.missingFields.length === 0
  ) {
    return intent;
  }

  const activeClarification = findActiveClarificationEvent(context.events);
  if (
    activeClarification === undefined ||
    !isCalendarClarification(activeClarification.event) ||
    !intent.missingFields.every((field) =>
      isSatisfiedCalendarClarificationField(field, context, activeClarification.index)
    )
  ) {
    return intent;
  }

  return clarificationToToolIntent(intent, 'create_calendar_event');
}

function isSatisfiedCalendarClarificationField(
  field: string,
  context: Readonly<{
    timeZone: string;
    message: string;
    events: readonly IntexAgentSessionEvent[];
    replyContext: IntexIncomingMessageReplyContext | undefined;
  }>,
  activeClarificationIndex: number
): boolean {
  const canonical = field.trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/gu, '');
  if (isCalendarSummaryField(field)) {
    return activeCalendarClarificationChainContainsSummary(
      context.events,
      activeClarificationIndex
    );
  }
  if (canonical === 'date' || canonical === 'eventdate' || canonical === 'startdate') {
    return hasCalendarDateSignal(context.message, context.events, context.replyContext);
  }
  if (
    canonical === 'start' ||
    canonical === 'starttime' ||
    canonical === 'starttimeclarification' ||
    canonical === 'startdatetime' ||
    canonical === 'time'
  ) {
    return hasCalendarSignal(
      context,
      activeClarificationIndex,
      containsCalendarClockTimeSignal
    );
  }
  if (
    canonical === 'end' ||
    canonical === 'endtime' ||
    canonical === 'enddatetime' ||
    canonical === 'duration'
  ) {
    return hasCalendarSignal(context, activeClarificationIndex, containsCalendarEndTimeSignal);
  }
  if (isRuntimeTimeZoneMissingField(field)) {
    return context.timeZone.trim() !== '' && !hasExplicitTimeZoneContext(context);
  }
  return false;
}

function hasCalendarSignal(
  context: Readonly<{
    message: string;
    events: readonly IntexAgentSessionEvent[];
    replyContext: IntexIncomingMessageReplyContext | undefined;
  }>,
  activeClarificationIndex: number,
  containsSignal: (message: string) => boolean
): boolean {
  if (containsCalendarTimeWithdrawalSignal(context.message)) return false;
  if (containsSignal(context.message)) return true;
  if (context.replyContext?.source === 'inbound_user_message') {
    if (containsCalendarTimeWithdrawalSignal(context.replyContext.text)) return false;
    if (containsSignal(context.replyContext.text)) return true;
  }
  return activeCalendarClarificationChainContainsSignal(
    context.events,
    activeClarificationIndex,
    containsSignal
  );
}

function activeCalendarClarificationChainContainsSignal(
  events: readonly IntexAgentSessionEvent[],
  latestClarificationIndex: number,
  containsSignal: (message: string) => boolean
): boolean {
  let expectsUserMessage = true;

  for (let index = latestClarificationIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess requires a fallback despite the bounded array index @preserve */
    if (event === undefined) continue;
    /* v8 ignore stop @preserve */

    if (expectsUserMessage) {
      if (event.type === 'clarification_requested') return false;
      if (event.type !== 'user_message') continue;

      const priorMessage = event.payload['text'];
      if (typeof priorMessage === 'string') {
        if (containsCalendarTimeWithdrawalSignal(priorMessage)) return false;
        if (containsSignal(priorMessage)) return true;
      }
      const priorReplyContext = parseIncomingReplyContext(event.payload['replyContext']);
      if (priorReplyContext?.source === 'inbound_user_message') {
        if (containsCalendarTimeWithdrawalSignal(priorReplyContext.text)) return false;
        if (containsSignal(priorReplyContext.text)) return true;
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

function applyOptionalCodeTaskFieldClarification(
  intent: IntexAgentIntentClassification
): IntexAgentIntentClassification {
  if (
    intent.kind !== 'needs_clarification' ||
    intent.blockerReason !== 'missing_required_details' ||
    intent.candidateIntents?.length !== 1 ||
    intent.candidateIntents[0] !== 'create_code_task' ||
    intent.missingFields === undefined ||
    intent.missingFields.length === 0 ||
    !intent.missingFields.every(isOptionalCodeTaskField)
  ) {
    return intent;
  }

  return clarificationToToolIntent(intent, 'create_code_task');
}

function applyOptionalPreferenceReadFieldClarification(
  intent: IntexAgentIntentClassification,
  message: string
): IntexAgentIntentClassification {
  if (
    intent.kind !== 'needs_clarification' ||
    intent.blockerReason !== 'missing_required_details' ||
    intent.candidateIntents?.length !== 1 ||
    intent.candidateIntents[0] !== 'get_user_preferences' ||
    intent.missingFields === undefined ||
    intent.missingFields.length === 0 ||
    !intent.missingFields.every(isOptionalPreferenceReadField) ||
    !isExplicitUnscopedPreferenceRead(message)
  ) {
    return intent;
  }

  return clarificationToToolIntent(intent, 'get_user_preferences');
}

function clarificationToToolIntent(
  intent: Extract<IntexAgentIntentClassification, { kind: 'needs_clarification' }>,
  toolName: IntexAgentToolName
): IntexAgentIntentClassification {
  return {
    kind: 'tool',
    allowedToolNames: [toolName],
    ...(intent.reason !== undefined ? { reason: intent.reason } : {}),
    ...(intent.stylePreferenceAction !== undefined
      ? { stylePreferenceAction: intent.stylePreferenceAction }
      : {}),
    ...(intent.languageOverride !== undefined ? { languageOverride: intent.languageOverride } : {}),
    ...(intent.decisionEvidence !== undefined ? { decisionEvidence: intent.decisionEvidence } : {}),
  };
}

function findActiveClarificationEvent(
  events: readonly IntexAgentSessionEvent[]
): Readonly<{ event: IntexAgentSessionEvent; index: number }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as IntexAgentSessionEvent;
    if (event.type === 'user_message') return undefined;
    if (event.type === 'clarification_requested') return { event, index };
  }
  return undefined;
}

function activeCalendarClarificationChainContainsSummary(
  events: readonly IntexAgentSessionEvent[],
  latestClarificationIndex: number
): boolean {
  let expectsUserMessage = true;

  for (let index = latestClarificationIndex - 1; index >= 0; index -= 1) {
    const event = events[index] as IntexAgentSessionEvent;

    if (expectsUserMessage) {
      if (event.type === 'clarification_requested') return false;
      if (event.type !== 'user_message') continue;

      const priorMessage = event.payload['text'];
      if (typeof priorMessage === 'string' && containsExplicitCalendarSummarySignal(priorMessage)) {
        return true;
      }
      const priorReplyContext = parseIncomingReplyContext(event.payload['replyContext']);
      if (
        priorReplyContext?.source === 'inbound_user_message' &&
        containsExplicitCalendarSummarySignal(priorReplyContext.text)
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

function applyDerivedCalendarQueryContext(
  intent: IntexAgentIntentClassification,
  context: Readonly<{
    message: string;
    events: readonly IntexAgentSessionEvent[];
    replyContext: IntexIncomingMessageReplyContext | undefined;
  }>
): IntexAgentIntentClassification {
  if (
    intent.kind !== 'needs_clarification' ||
    intent.blockerReason !== 'missing_required_details' ||
    intent.candidateIntents?.length !== 1 ||
    intent.candidateIntents[0] !== 'query_calendar_events' ||
    intent.missingFields === undefined ||
    intent.missingFields.length === 0 ||
    !intent.missingFields.every(isDerivedCalendarQueryField) ||
    !hasCalendarDateSignal(context.message, context.events, context.replyContext)
  ) {
    return intent;
  }

  return {
    kind: 'tool',
    allowedToolNames: ['query_calendar_events'],
    ...(intent.reason !== undefined ? { reason: intent.reason } : {}),
    ...(intent.stylePreferenceAction !== undefined
      ? { stylePreferenceAction: intent.stylePreferenceAction }
      : {}),
    ...(intent.languageOverride !== undefined ? { languageOverride: intent.languageOverride } : {}),
    ...(intent.decisionEvidence !== undefined ? { decisionEvidence: intent.decisionEvidence } : {}),
  };
}

function applyMissingCalendarAttendeeEmailClarification(
  intent: IntexAgentIntentClassification,
  context: Readonly<{
    message: string;
    events: readonly IntexAgentSessionEvent[];
    replyContext: IntexIncomingMessageReplyContext | undefined;
    replyLanguage: IntexAgentReplyLanguage;
    userPreferences: string | null;
  }>
): IntexAgentIntentClassification {
  const isUpdateToolIntent =
    intent.kind === 'tool' && intent.allowedToolNames.includes('update_calendar_event');
  const isSingleUpdateClarification =
    intent.kind === 'needs_clarification' &&
    intent.blockerReason === 'missing_required_details' &&
    intent.candidateIntents?.length === 1 &&
    intent.candidateIntents[0] === 'update_calendar_event';

  if (!isUpdateToolIntent && !isSingleUpdateClarification) {
    return intent;
  }

  if (hasCalendarAttendeeEmailContext(context)) {
    return isSingleUpdateClarification &&
      isAnsweringActiveCalendarAttendeeEmailClarification(context)
      ? clarificationToToolIntent(intent, 'update_calendar_event')
      : intent;
  }

  return {
    kind: 'needs_clarification',
    question: CALENDAR_UPDATE_EMAIL_CLARIFICATION_REPLIES[context.replyLanguage],
    blockerReason: 'missing_required_details',
    missingFields: ['attendeeEmail'],
    candidateIntents: ['update_calendar_event'],
    suggestedNextStep: CALENDAR_UPDATE_EMAIL_CLARIFICATION_NEXT_STEPS[context.replyLanguage],
    ...(intent.stylePreferenceAction !== undefined
      ? { stylePreferenceAction: intent.stylePreferenceAction }
      : {}),
    ...(intent.languageOverride !== undefined ? { languageOverride: intent.languageOverride } : {}),
    ...(intent.decisionEvidence !== undefined ? { decisionEvidence: intent.decisionEvidence } : {}),
  };
}

function hasCalendarAttendeeEmailContext(
  context: Readonly<{
    message: string;
    events: readonly IntexAgentSessionEvent[];
    replyContext: IntexIncomingMessageReplyContext | undefined;
    userPreferences: string | null;
  }>
): boolean {
  return resolveActiveCalendarAttendeeEmails(context) !== undefined;
}

function activeCalendarAttendeeRelevantTexts(
  context: Readonly<{
    message: string;
    events: readonly IntexAgentSessionEvent[];
    replyContext: IntexIncomingMessageReplyContext | undefined;
  }>
): string[] | undefined {
  const userTurns = activeCalendarAttendeeUserTurns(context);
  const attendeeTurnIndex = userTurns.findIndex((turn) =>
    turn.some((text) => extractCalendarAttendeeSegments(text).length > 0)
  );
  const relevantTurns =
    attendeeTurnIndex === -1 ? userTurns.slice(0, 1) : userTurns.slice(0, attendeeTurnIndex + 1);
  const relevantTexts = relevantTurns.flat();
  return relevantTexts
    .flatMap(extractCalendarAttendeeSegments)
    .some(isAmbiguousCalendarAttendeeSegment)
    ? undefined
    : relevantTexts;
}

function resolveActiveCalendarAttendeeEmails(
  context: Readonly<{
    message: string;
    events: readonly IntexAgentSessionEvent[];
    replyContext: IntexIncomingMessageReplyContext | undefined;
    userPreferences: string | null;
  }>
): string[] | undefined {
  const relevantTexts = activeCalendarAttendeeRelevantTexts(context);
  if (relevantTexts === undefined) return undefined;

  const allEmails = new Set(
    relevantTexts.flatMap(uniqueValidAttendeeEmails).map(normalizeAttendeeEmail)
  );
  if (allEmails.size > 1) return undefined;

  const associatedEmails = new Set(
    relevantTexts.flatMap(extractAssociatedAttendeeEmails).map(normalizeAttendeeEmail)
  );
  if (associatedEmails.size === 1) return [...associatedEmails];

  const preferenceEmail = resolveUnambiguousMatchingAttendeeEmailPreference(
    context.userPreferences,
    relevantTexts
  );
  return preferenceEmail === undefined ? undefined : [preferenceEmail];
}

function extractAssociatedAttendeeEmails(message: string): string[] {
  const attendeeSegmentEmails = extractCalendarAttendeeSegments(message)
    .map(uniqueValidAttendeeEmails)
    .filter((emails) => emails.length > 0);
  if (attendeeSegmentEmails.length > 0) {
    return attendeeSegmentEmails.flat();
  }
  return containsStandaloneAttendeeEmailSignal(message)
    ? uniqueValidAttendeeEmails(message)
    : [];
}

function uniqueValidAttendeeEmails(message: string): string[] {
  const byNormalizedEmail = new Map<string, string>();
  for (const email of extractAttendeeEmailCandidates(message).filter(isValidCalendarAttendeeEmail)) {
    byNormalizedEmail.set(normalizeAttendeeEmail(email), email);
  }
  return [...byNormalizedEmail.values()];
}

function normalizeAttendeeEmail(email: string): string {
  return email.toLocaleLowerCase('en-US');
}

function isAnsweringActiveCalendarAttendeeEmailClarification(
  context: Readonly<{
    message: string;
    events: readonly IntexAgentSessionEvent[];
    replyContext: IntexIncomingMessageReplyContext | undefined;
  }>
): boolean {
  const activeClarification = findActiveCalendarAttendeeClarification(context.events);
  const missingFields = activeClarification?.event.payload['missingFields'];
  if (!Array.isArray(missingFields) || !missingFields.includes('attendeeEmail')) return false;

  return [
    context.message,
    ...(context.replyContext?.source === 'inbound_user_message' ? [context.replyContext.text] : []),
  ].some((text) => extractAssociatedAttendeeEmails(text).length > 0);
}

function activeCalendarAttendeeUserTurns(
  context: Readonly<{
    message: string;
    events: readonly IntexAgentSessionEvent[];
    replyContext: IntexIncomingMessageReplyContext | undefined;
  }>
): string[][] {
  const currentTurn = [context.message];
  if (context.replyContext?.source === 'inbound_user_message') {
    currentTurn.push(context.replyContext.text);
  }
  const turns = [currentTurn];

  const activeClarification = findActiveCalendarAttendeeClarification(context.events);
  if (activeClarification === undefined) return turns;

  let expectsUserMessage = true;

  for (let index = activeClarification.index - 1; index >= 0; index -= 1) {
    const event = context.events[index];
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess requires a fallback despite the bounded array index @preserve */
    if (event === undefined) continue;
    /* v8 ignore stop @preserve */

    if (expectsUserMessage) {
      if (event.type === 'user_message') {
        const turn: string[] = [];
        const priorMessage = event.payload['text'];
        if (typeof priorMessage === 'string') turn.push(priorMessage);
        const priorReplyContext = parseIncomingReplyContext(event.payload['replyContext']);
        if (priorReplyContext?.source === 'inbound_user_message') {
          turn.push(priorReplyContext.text);
        }
        if (turn.length > 0) turns.push(turn);
        expectsUserMessage = false;
        continue;
      }
      if (isCalendarAttendeeClarificationBridgeEvent(event)) continue;
      break;
    }

    if (event.type === 'clarification_requested') {
      if (!isCalendarAttendeeUpdateClarification(event)) break;
      expectsUserMessage = true;
      continue;
    }
    if (isCalendarAttendeeClarificationBridgeEvent(event)) continue;
    break;
  }

  return turns;
}

function findActiveCalendarAttendeeClarification(
  events: readonly IntexAgentSessionEvent[]
): Readonly<{ event: IntexAgentSessionEvent; index: number }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess requires a fallback despite the bounded array index @preserve */
    if (event === undefined) continue;
    /* v8 ignore stop @preserve */
    if (event.type === 'clarification_requested') {
      return isCalendarAttendeeUpdateClarification(event) ? { event, index } : undefined;
    }
    if (event.type === 'user_message') return undefined;
    if (!isCalendarAttendeeClarificationTrailEvent(event)) return undefined;
  }

  return undefined;
}

function isCalendarAttendeeUpdateClarification(event: IntexAgentSessionEvent): boolean {
  const candidateIntents = event.payload['candidateIntents'];
  return (
    event.payload['blockerReason'] === 'missing_required_details' &&
    Array.isArray(candidateIntents) &&
    candidateIntents.length === 1 &&
    candidateIntents[0] === 'update_calendar_event'
  );
}

function isCalendarAttendeeClarificationTrailEvent(event: IntexAgentSessionEvent): boolean {
  return (
    event.type === 'assistant_message' ||
    event.type === 'agent_fallback' ||
    event.type === 'llm_call_usage' ||
    event.type === 'llm_usage_summary' ||
    event.type === 'turn_processing_completed' ||
    event.type === 'matrix_corpus_execution_boundary'
  );
}

function isCalendarAttendeeClarificationBridgeEvent(event: IntexAgentSessionEvent): boolean {
  return (
    isCalendarAttendeeClarificationTrailEvent(event) ||
    ((event.type === 'tool_call_started' || event.type === 'tool_call_completed') &&
      event.payload['toolName'] === 'query_calendar_events')
  );
}

function resolveUnambiguousMatchingAttendeeEmailPreference(
  userPreferences: string | null,
  userTexts: readonly string[]
): string | undefined {
  const attendeeObjects = userTexts.flatMap(extractCalendarAttendeeObjects);
  if (attendeeObjects.length === 0) return undefined;

  const matchingEmails = new Set<string>();
  for (const preferenceText of parseCanonicalPreferenceTexts(userPreferences)) {
    const parsedMapping = parseAttendeeEmailPreference(preferenceText);
    if (parsedMapping === undefined) {
      if (
        extractAttendeeEmailCandidates(preferenceText).length > 0 &&
        attendeeObjects.some((attendee) => sharesPersonToken(attendee, preferenceText))
      ) {
        return undefined;
      }
      continue;
    }
    if (!attendeeObjects.some((attendee) => isExactPersonLabelMatch(attendee, parsedMapping.person))) {
      continue;
    }
    if (parsedMapping.email === null) return undefined;
    matchingEmails.add(parsedMapping.email);
  }

  return matchingEmails.size === 1 ? [...matchingEmails][0] : undefined;
}

function parseCanonicalPreferenceTexts(userPreferences: string | null): string[] {
  const rendered = unwrapRenderedUserPreferences(userPreferences);
  if (rendered === null) return [];

  return rendered.split('\n').flatMap((line) => {
    const match = /^\d+\.\s+\(id:\s+[^)]+\)\s+(.+)$/u.exec(line);
    if (match?.[1] === undefined) return [];
    try {
      const decoded: unknown = JSON.parse(match[1]);
      return typeof decoded === 'string' ? [decoded] : [];
    } catch {
      return [];
    }
  });
}

function unwrapRenderedUserPreferences(userPreferences: string | null): string | null {
  if (userPreferences === null) return null;
  const normalized = userPreferences.trim();
  if (!normalized.startsWith('{')) return normalized;

  try {
    const envelope: unknown = JSON.parse(normalized);
    return isMatrixPromptContextEnvelope(envelope) ? envelope.userPreferences : null;
  } catch {
    return null;
  }
}

function parseAttendeeEmailPreference(
  preferenceText: string
): Readonly<{ person: string; email: string | null }> | undefined {
  const emailCandidates = extractAttendeeEmailCandidates(preferenceText);
  const validEmails = emailCandidates.filter(isValidCalendarAttendeeEmail);
  const normalized = normalizePreferenceMappingText(preferenceText, emailCandidates);
  const person =
    /^(?:when i ask to invite|when i invite)\s+(.+?)(?:\s+to an event)?\s*,\s*(?:invite|use)\s+__email__\.?$/u.exec(
      normalized
    )?.[1] ?? /^invite\s+(.+?)\s+via\s+__email__\.?$/u.exec(normalized)?.[1];
  if (person === undefined || !isSpecificPersonLabel(person)) return undefined;
  const soleValidEmail = validEmails.length === 1 ? validEmails[0] : undefined;
  return {
    person,
    email:
      emailCandidates.length === 1 && soleValidEmail !== undefined
        ? soleValidEmail.toLocaleLowerCase('en-US')
        : null,
  };
}

function normalizePreferenceMappingText(preferenceText: string, emails: readonly string[]): string {
  let normalized = preferenceText.normalize('NFKC').toLocaleLowerCase('en-US');
  for (const email of emails) {
    normalized = normalized.replace(email.toLocaleLowerCase('en-US'), '__email__');
  }
  return normalized.trim().replace(/\s+/gu, ' ');
}

function extractCalendarAttendeeObjects(message: string): string[] {
  return extractCalendarAttendeeSegments(message).flatMap((segment) => {
    let withoutEmails = segment;
    for (const email of extractAttendeeEmailCandidates(segment)) {
      withoutEmails = withoutEmails.replace(email, ' ');
    }
    return isSpecificPersonLabel(withoutEmails) ? [withoutEmails] : [];
  });
}

function extractCalendarAttendeeSegments(message: string): string[] {
  const patterns = [
    /\b(?:invite|add)\s+(.+?)\s+(?:to|into)\b/giu,
    /\b(?:zaproś|zapros|dodaj)\s+(.+?)\s+(?:do|na)\b/giu,
  ];
  return patterns.flatMap((pattern) =>
    [...message.matchAll(pattern)].map((match) => match[1] as string)
  );
}

function isSpecificPersonLabel(value: string): boolean {
  const tokens = personTokens(value);
  if (tokens.length === 0 || tokens.length > 6) return false;
  const genericTokens = new Set([
    'attendee',
    'a',
    'an',
    'guest',
    'her',
    'him',
    'my',
    'participant',
    'person',
    'someone',
    'the',
    'this',
    'them',
    'uczestnik',
    'uczestnika',
    'uczestniczke',
  ]);
  return tokens.every((token) => token.length >= 2 && !genericTokens.has(token));
}

function isExactPersonLabelMatch(attendeeObject: string, person: string): boolean {
  const attendeeTokens = personTokens(attendeeObject);
  const personLabelTokens = personTokens(person);
  if (personLabelTokens.length === 0 || personLabelTokens.length > attendeeTokens.length) return false;

  return attendeeTokens.some((_token, startIndex) =>
    personLabelTokens.every(
      (personToken, offset) => attendeeTokens[startIndex + offset] === personToken
    )
  );
}

function sharesPersonToken(attendeeObject: string, preferenceText: string): boolean {
  const attendeeTokens = personTokens(attendeeObject).filter((token) => token.length >= 3);
  const preferenceTokens = new Set(personTokens(preferenceText));
  return attendeeTokens.some((token) => preferenceTokens.has(token));
}

function personTokens(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function containsStandaloneAttendeeEmailSignal(message: string): boolean {
  const emails = uniqueValidAttendeeEmails(message);
  if (emails.length !== 1) return false;

  let withoutEmails = message;
  for (const email of extractAttendeeEmailCandidates(message)) {
    withoutEmails = withoutEmails.replace(email, ' ');
  }
  if (withoutEmails.replace(/[\s.,;:!?()[\]{}"'“”„-]+/gu, '') === '') return true;
  return /\b(?:adres(?:\s+e-?mail)?|e-?mail|uses?|używa|uzywa)\b/iu.test(message);
}

function isAmbiguousCalendarAttendeeSegment(segment: string): boolean {
  let withoutEmails = segment;
  for (const email of extractAttendeeEmailCandidates(segment)) {
    withoutEmails = withoutEmails.replace(email, ' ');
  }
  return /\b(?:and|or|i|lub|oraz)\b|[,&;/]/iu.test(withoutEmails);
}

function extractAttendeeEmailCandidates(message: string): string[] {
  return (
    message
      .normalize('NFKC')
      .match(
        /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,63}(?![\p{L}\p{N}_%+-]|\.[\p{L}\p{N}])/giu
      ) ?? []
  );
}

function isValidCalendarAttendeeEmail(email: string): boolean {
  return calendarUpdateEventAttendeesRequestSchema.safeParse({
    userId: 'intex-agent-email-precondition',
    calendarId: 'primary',
    expectedEtag: 'email-precondition',
    attendeesToAdd: [{ email }],
  }).success;
}

function applyMissingCalendarDateClarification(
  intent: IntexAgentIntentClassification,
  context: Readonly<{
    message: string;
    events: readonly IntexAgentSessionEvent[];
    replyContext: IntexIncomingMessageReplyContext | undefined;
    replyLanguage: IntexAgentReplyLanguage;
  }>
): IntexAgentIntentClassification {
  const candidateIntents = intent.kind === 'needs_clarification' ? intent.candidateIntents : undefined;
  const singleCalendarCandidate =
    candidateIntents?.length === 1 && candidateIntents[0] === 'create_calendar_event';
  const safelyNarrowedCalendarCandidate =
    intent.kind === 'needs_clarification' &&
    intent.blockerReason === 'missing_required_details' &&
    candidateIntents?.length === 2 &&
    candidateIntents.includes('create_calendar_event') &&
    candidateIntents.includes('create_note') &&
    containsExplicitCalendarSummarySignal(context.message) &&
    containsCalendarClockTimeSignal(context.message) &&
    !containsCalendarTimeWithdrawalSignal(context.message) &&
    !containsExplicitNoteActionSignal(context.message);
  if (
    intent.kind !== 'needs_clarification' ||
    (!singleCalendarCandidate && !safelyNarrowedCalendarCandidate) ||
    hasCalendarDateSignal(context.message, context.events, context.replyContext)
  ) {
    return intent;
  }

  const question = CALENDAR_DATE_CLARIFICATION_REPLIES[context.replyLanguage];
  return {
    kind: 'needs_clarification',
    question,
    blockerReason: 'missing_required_details',
    missingFields: ['date'],
    candidateIntents: ['create_calendar_event'],
    suggestedNextStep: CALENDAR_DATE_CLARIFICATION_NEXT_STEPS[context.replyLanguage],
    ...(intent.stylePreferenceAction !== undefined
      ? { stylePreferenceAction: intent.stylePreferenceAction }
      : {}),
    ...(intent.languageOverride !== undefined ? { languageOverride: intent.languageOverride } : {}),
    ...(intent.reason !== undefined ? { reason: intent.reason } : {}),
    ...(intent.decisionEvidence !== undefined ? { decisionEvidence: intent.decisionEvidence } : {}),
  };
}

function containsExplicitNoteActionSignal(message: string): boolean {
  return /(?<![\p{L}\p{N}])(?:remember|save|store|write\s+down|take\s+(?:a\s+)?note|notes?|memo|zapamiętaj|zapamietaj|zapisz|zanotuj|notatk[\p{L}]*)(?![\p{L}\p{N}])/iu.test(
    message.normalize('NFKC')
  );
}

function isOptionalNoteField(field: string): boolean {
  const canonical = field.trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/gu, '');
  return canonical === 'title' || canonical === 'tags' || canonical === 'sourcemessageids';
}

function isCalendarSummaryField(field: string): boolean {
  const canonical = field.trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/gu, '');
  return canonical === 'summary' || canonical === 'title' || canonical === 'eventtitle';
}

function isOptionalCodeTaskField(field: string): boolean {
  const canonical = field.trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/gu, '');
  return canonical === 'title' || canonical === 'name' || canonical === 'tasktitle';
}

function isOptionalPreferenceReadField(field: string): boolean {
  const canonical = field.trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/gu, '');
  return (
    canonical === 'preferencekeyortarget' ||
    canonical === 'preferencekey' ||
    canonical === 'key' ||
    canonical === 'target' ||
    canonical === 'scope' ||
    canonical === 'preferencescope'
  );
}

function containsExplicitCalendarSummarySignal(message: string): boolean {
  const normalized = message.normalize('NFKC');
  const match =
    /\b(?:put|add|place|schedule)\s+(.+?)\s+(?:on|in|to)\s+(?:(?:my|the)\s+)?calendar\b/iu.exec(
      normalized
    ) ??
    /\b(?:put|add|place|schedule|dodaj|zaplanuj)\s+(.+?)(?=\s+(?:at|for|on|next|tomorrow|today|o|na|w)\b|[.!?]|$)/iu.exec(
      normalized
    );
  if (match === null) return false;

  const summary = match[1]?.trim().toLocaleLowerCase('en-US').replace(/\s+/gu, ' ');
  return (
    summary !== undefined &&
    summary.length > 0 &&
    !new Set([
      'it',
      'this',
      'that',
      'something',
      'event',
      'an event',
      'calendar event',
      'a calendar event',
      'meeting',
      'a meeting',
      'appointment',
      'an appointment',
      'wydarzenie',
      'spotkanie',
      'coś',
      'cos',
    ]).has(summary)
  );
}

function containsCalendarTimeWithdrawalSignal(message: string): boolean {
  const normalized = message.normalize('NFKC');
  return (
    CALENDAR_NEGATED_CLOCK_PATTERN.test(normalized) ||
    CALENDAR_NEGATED_DURATION_PATTERN.test(normalized) ||
    CALENDAR_PRIOR_TIME_WITHDRAWAL_PATTERN.test(normalized)
  );
}

function containsCalendarClockTimeSignal(message: string): boolean {
  const normalized = message.normalize('NFKC');
  if (/(?<![\p{L}\p{N}])(?:noon|midnight)(?![\p{L}\p{N}])/iu.test(normalized)) {
    return true;
  }

  const colonClock = CALENDAR_COLON_CLOCK_PATTERN.exec(normalized);
  if (colonClock !== null) {
    return isValidCalendarClock(
      Number(colonClock[1]),
      Number(colonClock[2]),
      colonClock[3]
    );
  }

  const meridiemClock = CALENDAR_MERIDIEM_CLOCK_PATTERN.exec(normalized);
  if (meridiemClock !== null) {
    return isValidCalendarClock(Number(meridiemClock[1]), 0, meridiemClock[2]);
  }

  const contextualHour = CALENDAR_CONTEXTUAL_HOUR_PATTERN.exec(normalized);
  return (
    contextualHour !== null &&
    isValidCalendarClock(Number(contextualHour[1]), 0, undefined)
  );
}

function containsCalendarEndTimeSignal(message: string): boolean {
  const normalized = message.normalize('NFKC');
  const englishDuration = CALENDAR_ENGLISH_DURATION_PATTERN.exec(normalized);
  if (englishDuration !== null) {
    const quantity = englishDuration[1]?.toLocaleLowerCase('en-US');
    return quantity !== undefined && (Number.isNaN(Number(quantity)) || Number(quantity) > 0);
  }

  const polishDuration = CALENDAR_POLISH_DURATION_PATTERN.exec(normalized);
  if (polishDuration !== null) {
    const numericQuantity = polishDuration[1];
    return numericQuantity === undefined || Number(numericQuantity) > 0;
  }

  const untilClock = CALENDAR_UNTIL_CLOCK_PATTERN.exec(normalized);
  if (untilClock?.[1] !== undefined) {
    return containsCalendarClockTimeSignal(untilClock[1]);
  }

  const range = CALENDAR_CLOCK_RANGE_PATTERN.exec(normalized);
  return (
    range?.[1] !== undefined &&
    range[2] !== undefined &&
    containsCalendarClockTimeSignal(range[1]) &&
    containsCalendarClockTimeSignal(range[2])
  );
}

function isValidCalendarClock(
  hour: number,
  minute: number,
  meridiem: string | undefined
): boolean {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return false;
  }
  return meridiem === undefined ? hour >= 0 && hour <= 23 : hour >= 1 && hour <= 12;
}

function isExplicitUnscopedPreferenceRead(message: string): boolean {
  const withoutTrailingOpaqueQualifier = message.replace(
    /\s+\bfor\s+[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+(?=[.!?]?\s*$)/u,
    ''
  );
  const normalized = withoutTrailingOpaqueQualifier
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[.!?,:;]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return /^(?:new session\s+)?(?:show|list|display|read)\s+(?:me\s+)?(?:all\s+(?:of\s+)?)?my\s+(?:saved\s+)?intex agent preferences$/u.test(
    normalized
  );
}

function isDerivedCalendarQueryField(field: string): boolean {
  const canonical = field.trim().toLocaleLowerCase('en-US').replace(/[\s_-]+/gu, '');
  return (
    canonical === 'start' ||
    canonical === 'end' ||
    canonical === 'timemin' ||
    canonical === 'timemax' ||
    canonical === 'timezone' ||
    canonical === 'date' ||
    canonical === 'daterange' ||
    canonical === 'range'
  );
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

  if (toolName === 'update_calendar_event' && isCalendarEventVersionConflictMessage(errorMessage)) {
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
  calendarUpdateAttendeeEmails?: string[];
  synthesizedCalendarUpdatePreview?: true;
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
    const deterministicFailureReply = `${GENERIC_EXECUTION_FAILURE_PREFIX[replyLanguage]}${toolExecution.error}${GENERIC_EXECUTION_FAILURE_SUFFIX[replyLanguage]}`;
    return {
      outcome: 'tool_failed',
      reply: isMutatingToolName(toolExecution.toolName)
        ? deterministicFailureReply
        : (parsed?.reply ?? deterministicFailureReply),
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
  const calendarUpdateArgs =
    toolExecution?.toolName === 'update_calendar_event'
      ? buildCalendarUpdateConfirmationArgs(
          toolExecutions,
          toolExecution,
          input.calendarUpdateAttendeeEmails
        )
      : undefined;
  if (toolExecution?.toolName === 'update_calendar_event' && calendarUpdateArgs === undefined) {
    return calendarUpdateLookupResult(replyLanguage);
  }
  if (toolExecution !== undefined && isMutatingToolName(toolExecution.toolName)) {
    const confirmationArgs = preserveCurrentTurnOpaqueReferences(
      toolExecution.toolName,
      calendarUpdateArgs ?? toolExecution.args,
      input.currentMessage
    );
    const supportingToolCompletions = collectSupportingToolCompletions(
      toolExecutions,
      toolExecution
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
      ...(supportingToolCompletions.length > 0 ? { supportingToolCompletions } : {}),
      ...(parsed?.summary !== undefined && input.synthesizedCalendarUpdatePreview !== true
        ? { summary: parsed.summary }
        : {}),
    };
  }

  if (
    isCalendarUpdateIntent(input.intent) &&
    toolExecution?.toolName === 'query_calendar_events' &&
    parsed?.outcome !== 'needs_clarification'
  ) {
    return calendarUpdateLookupResult(replyLanguage);
  }

  if (parsed === null) {
    if (toolExecution?.toolName === 'query_calendar_events') {
      const fallbackReply = renderCalendarQueryFallbackReply(
        toolExecution.result,
        replyLanguage,
        runtimeTimeZone
      );
      if (fallbackReply !== undefined) {
        return buildCompletedToolExecutionResult(
          toolExecution.toolName,
          toolExecution.result,
          fallbackReply,
          undefined,
          webAppUrl,
          replyLanguage,
          toolExecution.selectionMetadata
        );
      }
    }
    const fallbackReason = fallbackReasonForInvalidRunnerContent(input.content);
    if (fallbackReason === 'runner_output_malformed' && isCalendarUpdateIntent(input.intent)) {
      return calendarUpdateMalformedResult(replyLanguage);
    }
    return fallbackClarificationResult(replyLanguage, fallbackReason);
  }

  if (
    toolExecution !== undefined &&
    parsed.outcome !== 'completed' &&
    !(
      parsed.outcome === 'needs_clarification' &&
      isCalendarUpdateIntent(input.intent) &&
      toolExecution.toolName === 'query_calendar_events'
    )
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
      if (
        isCalendarUpdateIntent(input.intent) &&
        toolExecution.toolName !== 'update_calendar_event'
      ) {
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

function collectSupportingToolCompletions(
  toolExecutions: readonly IntexAgentToolExecution[],
  terminalExecution: IntexAgentToolExecution
): IntexAgentSupportingToolCompletion[] {
  const terminalIndex = toolExecutions.indexOf(terminalExecution);
  if (terminalIndex <= 0) return [];
  return toolExecutions.slice(0, terminalIndex).flatMap((execution) => {
    if (
      isMutatingToolName(execution.toolName) ||
      execution.error !== undefined ||
      execution.result === undefined
    ) {
      return [];
    }
    return [
      {
        toolName: execution.toolName,
        result: execution.result,
        ...(execution.selectionMetadata !== undefined
          ? { toolSelection: execution.selectionMetadata }
          : {}),
      },
    ];
  });
}

function isCalendarUpdateIntent(
  intent: IntexAgentIntentClassification | IntexAgentIntentDecision
): boolean {
  return intent.kind === 'tool' && intent.allowedToolNames.includes('update_calendar_event');
}

function isSingleCalendarUpdateIntent(
  intent: IntexAgentIntentClassification | IntexAgentIntentDecision
): boolean {
  if (intent.kind !== 'tool') return false;
  const toolNames = new Set(intent.allowedToolNames);
  return (
    toolNames.size === intent.allowedToolNames.length &&
    toolNames.has('update_calendar_event') &&
    [...toolNames].every(
      (toolName) =>
        toolName === 'query_calendar_events' || toolName === 'update_calendar_event'
    )
  );
}

async function appendDeterministicCalendarUpdatePreview(input: Readonly<{
  intent: IntexAgentIntentClassification | IntexAgentIntentDecision;
  toolExecutions: IntexAgentToolExecution[];
  tools: readonly ToolDefinition[];
  attendeesToAdd: string[];
  activeUserTexts: string[] | undefined;
}>): Promise<boolean> {
  if (!isSingleCalendarUpdateIntent(input.intent) || input.toolExecutions.length !== 1) {
    return false;
  }
  const queryExecution = input.toolExecutions[0];
  if (queryExecution?.toolName !== 'query_calendar_events') return false;

  const updateArgs = buildCalendarUpdateArgsFromUniqueLookup(
    queryExecution,
    input.attendeesToAdd,
    input.activeUserTexts
  );
  if (updateArgs === undefined) return false;

  try {
    const updateTool = input.tools.find(
      (tool) => tool.name === 'update_calendar_event'
    ) as ToolDefinition;
    await updateTool.run({ ...updateArgs });
    return true;
  } catch {
    // Match the regular tool-calling path: the tracked failure is normalized downstream.
    return false;
  }
}

function calendarUpdateMalformedResult(
  replyLanguage: IntexAgentReplyLanguage
): IntexAgentRunnerResult {
  return {
    outcome: 'needs_clarification',
    reply: CALENDAR_UPDATE_MALFORMED_REPLIES[replyLanguage],
    blockerReason: 'not_enough_context',
    candidateIntents: ['update_calendar_event'],
    suggestedNextStep: CALENDAR_UPDATE_MALFORMED_NEXT_STEPS[replyLanguage],
    fallbackReason: 'runner_output_malformed',
    fallbackSourceOutcome: 'raw_response',
  };
}

function calendarUpdateLookupResult(
  replyLanguage: IntexAgentReplyLanguage
): IntexAgentRunnerResult {
  return {
    outcome: 'needs_clarification',
    reply: CALENDAR_UPDATE_LOOKUP_REPLIES[replyLanguage],
    blockerReason: 'missing_required_details',
    missingFields: ['event'],
    candidateIntents: ['update_calendar_event'],
    suggestedNextStep: CALENDAR_UPDATE_LOOKUP_NEXT_STEPS[replyLanguage],
  };
}

function buildCalendarUpdateConfirmationArgs(
  toolExecutions: IntexAgentToolExecution[],
  updateExecution: IntexAgentToolExecution,
  authoritativeAttendeeEmails: string[] | undefined
): Record<string, unknown> | undefined {
  const updateIndex = toolExecutions.indexOf(updateExecution);
  const precedingExecutions = toolExecutions.slice(0, updateIndex);
  const queryExecution = precedingExecutions
    .reverse()
    .find((execution) => execution.toolName === 'query_calendar_events');
  if (queryExecution === undefined) return undefined;

  const snapshot = readCalendarUpdateLookupSnapshot(queryExecution);
  if (snapshot === undefined) return undefined;

  const requestedCalendarId = readNonEmptyString(updateExecution.args, 'calendarId');
  if (
    authoritativeAttendeeEmails === undefined ||
    snapshot.eventId !== readNonEmptyString(updateExecution.args, 'eventId') ||
    snapshot.eventSummary !== readNonEmptyString(updateExecution.args, 'eventSummary') ||
    (requestedCalendarId !== undefined && requestedCalendarId !== snapshot.calendarId)
  ) {
    return undefined;
  }

  return {
    ...updateExecution.args,
    attendeesToAdd: authoritativeAttendeeEmails,
    ...snapshot,
  };
}

function buildCalendarUpdateArgsFromUniqueLookup(
  queryExecution: IntexAgentToolExecution,
  attendeesToAdd: string[],
  activeUserTexts: string[] | undefined
): UpdateCalendarEventToolArgs | undefined {
  const query = readNonEmptyString(queryExecution.args, 'query');
  if (query === undefined || activeUserTexts === undefined) return undefined;
  const snapshot = readCalendarUpdateLookupSnapshot(queryExecution);
  if (snapshot?.calendarId !== 'primary') return undefined;

  const normalizedQuery = normalizeCalendarLookupIdentity(query);
  if (
    normalizedQuery === '' ||
    normalizeCalendarLookupIdentity(snapshot.eventSummary) !== normalizedQuery ||
    !activeUserTexts.some((text) =>
      normalizeCalendarLookupIdentity(text).includes(normalizedQuery)
    )
  ) {
    return undefined;
  }
  return { ...snapshot, attendeesToAdd };
}

function normalizeCalendarLookupIdentity(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
}

function readCalendarUpdateLookupSnapshot(
  queryExecution: IntexAgentToolExecution
): Required<
  Pick<
    UpdateCalendarEventToolArgs,
    'eventId' | 'eventSummary' | 'calendarId' | 'expectedEtag' | 'eventStart' | 'eventEnd'
  >
> | undefined {

  if (
    queryExecution.error !== undefined ||
    queryExecution.args['mode'] !== 'list' ||
    queryExecution.result?.['status'] !== 'completed' ||
    queryExecution.result['mode'] !== 'list' ||
    queryExecution.result['count'] !== 1 ||
    queryExecution.result['truncated'] !== false
  ) {
    return undefined;
  }

  const eventsValue: unknown = queryExecution.result['events'];
  const events: unknown[] = Array.isArray(eventsValue) ? (eventsValue as unknown[]) : [];
  if (events.length !== 1) return undefined;
  const maxResults = queryExecution.args['maxResults'];
  if (typeof maxResults === 'number' && events.length >= maxResults) return undefined;

  const event: unknown = events[0];
  /* v8 ignore start -- upstream: the typed Calendar Agent response cannot emit a non-object calendar event @preserve */
  if (event === null || typeof event !== 'object' || Array.isArray(event)) return undefined;
  /* v8 ignore stop @preserve */
  const eventRecord = event as Record<string, unknown>;
  const eventId = readNonEmptyString(eventRecord, 'id') ?? readNonEmptyString(eventRecord, 'eventId');
  const eventSummary = readNonEmptyString(eventRecord, 'summary');
  const expectedEtag = readNonEmptyString(eventRecord, 'etag');
  const calendarId = readNonEmptyString(eventRecord, 'calendarId');
  const eventStart = readCalendarEventDateTimeSnapshot(eventRecord, 'start');
  const eventEnd = readCalendarEventDateTimeSnapshot(eventRecord, 'end');
  if (
    eventId === undefined ||
    eventSummary === undefined ||
    expectedEtag === undefined ||
    calendarId === undefined ||
    eventStart === undefined ||
    eventEnd === undefined
  ) {
    return undefined;
  }

  const queriedCalendarId = readNonEmptyString(queryExecution.args, 'calendarId') ?? 'primary';
  if (calendarId !== queriedCalendarId) return undefined;

  return {
    eventId,
    eventSummary,
    calendarId,
    expectedEtag,
    eventStart,
    eventEnd,
  };
}

function readNonEmptyString(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function readCalendarEventDateTimeSnapshot(
  record: Record<string, unknown>,
  key: string
): CalendarEventDateTimeSnapshot | undefined {
  const value = record[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const snapshot = value as Record<string, unknown>;
  const dateTime = readNonEmptyString(snapshot, 'dateTime');
  const date = readNonEmptyString(snapshot, 'date');
  const timeZone = readNonEmptyString(snapshot, 'timeZone');
  if ((dateTime === undefined) === (date === undefined)) return undefined;
  if (snapshot['timeZone'] !== undefined && timeZone === undefined) return undefined;
  if (timeZone !== undefined && !isValidExplicitTimeZone(timeZone)) return undefined;
  if (dateTime !== undefined && !isValidReplyDateTime(dateTime)) return undefined;
  if (date !== undefined && !isValidCalendarDate(date)) return undefined;
  return {
    ...(dateTime !== undefined ? { dateTime } : {}),
    ...(date !== undefined ? { date } : {}),
    ...(timeZone !== undefined ? { timeZone } : {}),
  };
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
    updateCalendarEvent(): Promise<string> {
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

function resolveRunnerToolNames(
  intent: IntexAgentIntentClassification | IntexAgentIntentDecision
): IntexAgentToolName[] {
  if (intent.kind !== 'tool') return [];
  if (!intent.allowedToolNames.includes('update_calendar_event')) {
    return intent.allowedToolNames;
  }
  return [
    'query_calendar_events',
    ...intent.allowedToolNames.filter((toolName) => toolName !== 'query_calendar_events'),
  ];
}

function isMutatingToolName(toolName: IntexAgentToolName): toolName is MutatingIntexAgentToolName {
  return MUTATING_TOOL_NAMES.has(toolName as MutatingIntexAgentToolName);
}

function createTrackingToolExecutor(
  executor: IntexAgentToolExecutor,
  toolExecutions: IntexAgentToolExecution[],
  toolSelectionGate?: IntexAgentRunnerConfig['toolSelectionGate'],
  currentPreferenceVersion?: number,
  authoritativeCalendarAttendeeEmails?: string[]
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
    async updateCalendarEvent(args: UpdateCalendarEventToolArgs): Promise<string> {
      const normalizedArgs =
        authoritativeCalendarAttendeeEmails === undefined
          ? args
          : { ...args, attendeesToAdd: authoritativeCalendarAttendeeEmails };
      return await track(
        'update_calendar_event',
        toRecord(normalizedArgs),
        async () => await executor.updateCalendarEvent(normalizedArgs)
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
      const normalizedArgs =
        currentPreferenceVersion === undefined
          ? args
          : { ...args, expectedVersion: currentPreferenceVersion };
      return await track(
        'add_user_preference',
        toRecord(normalizedArgs),
        async () => await executor.addUserPreference(normalizedArgs)
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

function resolveCurrentPreferenceVersion(userPreferences: string | null | undefined): number | undefined {
  if (userPreferences === undefined) return undefined;
  if (userPreferences === null) return 0;

  const normalized = userPreferences.trim();
  if (normalized === '') return undefined;
  if (normalized.startsWith('{')) {
    let envelope: unknown;
    try {
      envelope = JSON.parse(normalized);
    } catch {
      return undefined;
    }
    if (!isMatrixPromptContextEnvelope(envelope)) return undefined;
    return envelope.userPreferences === null
      ? 0
      : resolveRenderedPreferenceVersion(envelope.userPreferences);
  }
  return resolveRenderedPreferenceVersion(normalized);
}

function isMatrixPromptContextEnvelope(
  value: unknown
): value is Readonly<{ version: 1; userPreferences: string | null }> {
  /* v8 ignore start -- upstream: the leading object-token guard before JSON.parse guarantees a non-null, non-array object @preserve */
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  /* v8 ignore stop @preserve */
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes('version') ||
    !keys.includes('userPreferences')
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record['version'] === 1 &&
    (record['userPreferences'] === null || typeof record['userPreferences'] === 'string')
  );
}

function resolveRenderedPreferenceVersion(userPreferences: string): number | undefined {
  const explicitInstruction =
    /(?:^|\n)Use expectedVersion (\d+) for (?:add_user_preference|preference mutation tools)\.(?:\n|$)/u.exec(
      userPreferences
    );
  const header = /^User Preferences v(\d+):(?:\n|$)/u.exec(userPreferences);
  const rawVersion = explicitInstruction?.[1] ?? header?.[1];
  if (rawVersion === undefined) return undefined;

  const version = Number(rawVersion);
  return Number.isSafeInteger(version) && version >= 0 ? version : undefined;
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

  if (toolName === 'update_calendar_event' && isCalendarEventVersionConflictMessage(errorMessage)) {
    return CALENDAR_EVENT_VERSION_CONFLICT_REPLIES[replyLanguage];
  }

  const detail = normalizeExternalSaveFailureDetail(errorMessage);
  return `${GENERIC_EXECUTION_FAILURE_PREFIX[replyLanguage]}${detail}${GENERIC_EXECUTION_FAILURE_SUFFIX[replyLanguage]}`;
}

function isExternalSaveNotConfiguredError(errorMessage: string): boolean {
  return errorMessage.trim() === 'External save is not configured';
}

function isCalendarEventVersionConflictMessage(errorMessage: string): boolean {
  return /\bCONFLICT:\s*Calendar event changed after confirmation\b/iu.test(errorMessage);
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
  if (toolExecutions.length === 1) {
    return toolExecutions[0];
  }

  const terminalExecution = toolExecutions.at(-1);
  if (terminalExecution === undefined || !isMutatingToolName(terminalExecution.toolName)) {
    return undefined;
  }
  const precedingExecutions = toolExecutions.slice(0, -1);
  if (
    precedingExecutions.some(
      (execution) =>
        isMutatingToolName(execution.toolName) ||
        execution.error !== undefined ||
        execution.selectionRejection !== undefined
    )
  ) {
    return undefined;
  }
  return terminalExecution;
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
  return limitConfirmationReply(
    buildUnboundedConfirmationReply(
      toolName,
      args,
      userPreferences,
      replyLanguage,
      runtimeTimeZone
    ),
    replyLanguage
  );
}

function buildUnboundedConfirmationReply(
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

  if (toolName === 'update_calendar_event') {
    const lines = [CONFIRMATION_INTROS.update_calendar_event[replyLanguage]];
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.title[replyLanguage],
      limitConfirmationField(readRawString(args, 'eventSummary'), 240)
    );
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.start[replyLanguage],
      formatCalendarEventDateTimeSnapshot(
        args['eventStart'],
        runtimeTimeZone,
        replyLanguage
      )
    );
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.end[replyLanguage],
      formatCalendarEventDateTimeSnapshot(args['eventEnd'], runtimeTimeZone, replyLanguage)
    );
    appendConfirmationListLine(
      lines,
      CONFIRMATION_LABELS.attendees[replyLanguage],
      readStringArray(args, 'attendeesToAdd')
    );
    lines.push(CALENDAR_UPDATE_PRESERVATION_NOTICE[replyLanguage]);
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

function limitConfirmationReply(
  reply: string,
  replyLanguage: IntexAgentReplyLanguage
): string {
  if (reply.length <= WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH) return reply;
  const suffix = `\n\n…\n${CONFIRMATION_PREVIEW_TRUNCATION_NOTICE[replyLanguage]}`;
  const headLimit = WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH - suffix.length;
  const candidate = reply.slice(0, headLimit).trimEnd();
  const wordBoundary = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
  const head =
    wordBoundary >= Math.floor(headLimit * 0.75)
      ? candidate.slice(0, wordBoundary).trimEnd()
      : candidate;
  return `${head}${suffix}`;
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

function limitConfirmationField(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
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

function formatCalendarEventDateTimeSnapshot(
  value: unknown,
  runtimeTimeZone: string,
  replyLanguage: IntexAgentReplyLanguage
): string | undefined {
  /* v8 ignore start -- upstream: readCalendarEventDateTimeSnapshot guarantees a non-null, non-array snapshot object before confirmation formatting @preserve */
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  /* v8 ignore stop @preserve */
  const snapshot = value as Record<string, unknown>;
  const dateTime = readNonEmptyString(snapshot, 'dateTime');
  if (dateTime !== undefined) {
    return formatCalendarConfirmationDateTime(
      dateTime,
      readNonEmptyString(snapshot, 'timeZone'),
      runtimeTimeZone,
      replyLanguage
    );
  }
  const date = readNonEmptyString(snapshot, 'date');
  /* v8 ignore start -- upstream: prior snapshot validation guarantees a valid date whenever dateTime is absent @preserve */
  if (date === undefined || !isValidCalendarDate(date)) return undefined;
  /* v8 ignore stop @preserve */
  const instant = new Date(`${date}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(replyLanguage === 'pl' ? 'pl-PL' : 'en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(instant);
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
  const match = STRICT_REPLY_DATE_TIME_PATTERN.exec(value);
  if (match === null) return false;
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

function renderCalendarQueryFallbackReply(
  result: Record<string, unknown> | undefined,
  replyLanguage: IntexAgentReplyLanguage,
  runtimeTimeZone: string
): string | undefined {
  if (result?.['status'] !== 'completed') return undefined;
  const count = result['count'];
  if (!Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > 2500) {
    return undefined;
  }

  if (result['mode'] === 'count') {
    return renderCalendarCountFallback(
      count as number,
      readString(result, 'query'),
      result['truncated'] === true,
      replyLanguage
    );
  }
  if (result['mode'] !== 'list') return undefined;

  const events = result['events'];
  if (!Array.isArray(events) || events.length !== count) return undefined;
  const text = CALENDAR_QUERY_FALLBACK_TEXT[replyLanguage];
  if (events.length === 0) return text.empty;

  const renderedEvents = events.map((event) =>
    renderCalendarEventFallback(event, replyLanguage, runtimeTimeZone)
  );
  if (renderedEvents.some((event) => event === undefined)) return undefined;
  const header = `${text.calendarEvents} (${String(count)}):`;
  return [header, ...(renderedEvents as string[])].join('\n');
}

function renderCalendarCountFallback(
  count: number,
  query: string | undefined,
  truncated: boolean,
  replyLanguage: IntexAgentReplyLanguage
): string {
  const text = CALENDAR_QUERY_FALLBACK_TEXT[replyLanguage];
  const value = truncated ? `${text.atLeast} ${String(count)}` : String(count);
  const queryPhrase = query === undefined ? '' : ` ${text.matching} “${query}”`;
  return `${text.calendarEvents}${queryPhrase} ${text.requestedPeriod}: ${value}.`;
}

function renderCalendarEventFallback(
  value: unknown,
  replyLanguage: IntexAgentReplyLanguage,
  runtimeTimeZone: string
): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const event = value as Record<string, unknown>;
  const summary = readString(event, 'summary');
  const start = readRecord(event, 'start');
  if (summary === undefined || start === undefined) return undefined;
  const renderedStart = renderCalendarEventStart(start, replyLanguage, runtimeTimeZone);
  if (renderedStart === undefined) return undefined;
  const location = readString(event, 'location');
  const renderedLocation =
    location === undefined
      ? ''
      : ` (${CALENDAR_QUERY_FALLBACK_TEXT[replyLanguage].location}: ${location})`;
  return `- ${renderedStart} — ${summary}${renderedLocation}`;
}

function renderCalendarEventStart(
  start: Record<string, unknown>,
  replyLanguage: IntexAgentReplyLanguage,
  runtimeTimeZone: string
): string | undefined {
  const dateTime = readString(start, 'dateTime');
  if (dateTime !== undefined) {
    if (Number.isNaN(new Date(dateTime).getTime())) return undefined;
    return formatCalendarConfirmationDateTime(
      dateTime,
      readString(start, 'timeZone'),
      runtimeTimeZone,
      replyLanguage
    );
  }

  const date = readString(start, 'date');
  if (date === undefined || !isValidCalendarDate(date)) return undefined;
  return new Intl.DateTimeFormat(CALENDAR_QUERY_FALLBACK_TEXT[replyLanguage].locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function readRecord(
  record: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const value = record[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
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
    if (toolName !== 'get_user_preferences') {
      return { reply: COMPLETED_REPLIES.preference[replyLanguage] };
    }
    const promptBlock = readRawString(result, 'promptBlock');
    const renderedPromptBlock =
      promptBlock !== undefined && promptBlock.trim() !== '' ? promptBlock : undefined;
    const overlayBlock = renderPreferenceOverlayItems(result);
    return {
      reply:
        renderedPromptBlock ??
        overlayBlock ??
        COMPLETED_REPLIES.preferencesEmpty[replyLanguage],
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
  if (
    (toolName === 'create_calendar_event' || toolName === 'update_calendar_event') &&
    absoluteHtmlLink !== undefined
  ) {
    return {
      reply: COMPLETED_REPLIES[toolName][replyLanguage],
      ctaUrl: { displayText: CTA_LABELS.openCalendar[replyLanguage], url: absoluteHtmlLink },
    };
  }
  if (
    htmlLink !== undefined &&
    (toolName === 'create_calendar_event' || toolName === 'update_calendar_event')
  ) {
    return {
      reply: `${COMPLETED_REPLIES[toolName][replyLanguage].replace(/\.$/u, '')}: ${htmlLink}`,
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
  if (toolName === 'update_calendar_event') {
    return COMPLETED_REPLIES.update_calendar_event[replyLanguage];
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
