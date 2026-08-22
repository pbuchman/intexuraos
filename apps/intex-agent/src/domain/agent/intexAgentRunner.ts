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
  IntexAgentCalendarUpdatePlanningProviderOutputSchema,
  IntexAgentRunnerProviderOutputSchema,
  IntexAgentRunnerOutputSchema,
  INTEX_AGENT_RUNNER_RESPONSE_FORMAT,
  intexAgentCalendarUpdatePlanningPrompt,
  intexAgentRunnerOutputRepairPrompt,
  type IntexAgentCalendarUpdatePlanningOutput,
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
  IntexAgentConfirmedOperation,
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
import {
  buildIntexAgentLocalCalendarContext,
  buildIntexAgentSystemPrompt,
  INTEX_AGENT_RUNNER_PROMPT_TYPE,
  type IntexAgentLocalDayBounds,
} from './systemPrompt.js';
import { classifyIntexAgentIntent, type IntexAgentIntentDecision } from './intentGate.js';
import {
  buildGreetingReply,
  selectIntexAgentReplyLanguage,
  type IntexAgentReplyLanguage,
} from './capabilities.js';
import {
  assessCalendarEventReadiness,
  parseCalendarEventDraft,
  type CalendarEventDraftV1,
} from './calendarEventReadiness.js';
import type {
  IntexAgentIntentClassification,
  IntexAgentIntentClassifier,
  MatrixCorpusLlmRecorder,
} from './intentClassifier.js';

const DEFAULT_WEB_APP_URL = 'https://intexuraos.cloud';
const INTEX_AGENT_CALENDAR_UPDATE_PLANNING_PROMPT_TYPE = 'intex-agent-calendar-update-planning';
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
  noEvents: string;
  noEventsInPartialList: string;
  incompleteList: string;
  moreEventsOmitted: string;
  displayLimited: string;
  untitled: string;
  today: string;
  tomorrow: string;
  matching: string;
  requestedPeriod: string;
  atLeast: string;
  location: string;
  locale: string;
}

interface TodayAndTomorrowCalendarQueryScope {
  today: IntexAgentLocalDayBounds;
  tomorrow: IntexAgentLocalDayBounds;
}

interface CalendarUpdateReferentialQueryScope {
  timeMin: string;
  timeMax: string;
}

const TODAY_AND_TOMORROW_CALENDAR_QUERY_MAX_RESULTS = 100;
const TODAY_AND_TOMORROW_VISIBLE_EVENTS_PER_DAY = 10;
const CALENDAR_EVENT_REPLY_LINE_MAX_LENGTH = 180;
const CALENDAR_UPDATE_BATCH_EVENT_SUMMARY_MAX_LENGTH = 180;

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
    noEvents: 'No events.',
    noEventsInPartialList: 'No events in the returned portion of the list.',
    incompleteList: 'Note: the calendar returned only some events; this list may be incomplete.',
    moreEventsOmitted: '- … More events omitted.',
    displayLimited: 'More events were omitted to keep the reply readable.',
    untitled: '(untitled)',
    today: 'Today',
    tomorrow: 'Tomorrow',
    matching: 'matching',
    requestedPeriod: 'in the requested period',
    atLeast: 'at least',
    location: 'location',
    locale: 'en-GB',
  },
  pl: {
    calendarEvents: 'Wydarzenia w kalendarzu',
    empty: 'Brak wydarzeń w kalendarzu w podanym okresie.',
    noEvents: 'Brak wydarzeń.',
    noEventsInPartialList: 'Brak wydarzeń w zwróconej części listy.',
    incompleteList: 'Uwaga: kalendarz zwrócił tylko część wydarzeń; ta lista może być niepełna.',
    moreEventsOmitted: '- … Pominięto dalsze wydarzenia.',
    displayLimited: 'Dalsze wydarzenia pominięto, aby zachować czytelność odpowiedzi.',
    untitled: '(bez tytułu)',
    today: 'Dzisiaj',
    tomorrow: 'Jutro',
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

const CALENDAR_QUERY_INVALID_RESULT_REPLIES: LocalizedText = {
  en: 'I could not reliably read the calendar results. Please try again.',
  pl: 'Nie udało się wiarygodnie odczytać wyników kalendarza. Spróbuj ponownie.',
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

const CALENDAR_TODAY_SIGNAL_PATTERN =
  /(?<![\p{L}\p{N}])(?:today|dzisiaj|dziś|dzis)(?![\p{L}\p{N}])/iu;
const CALENDAR_TOMORROW_SIGNAL_PATTERN = /(?<![\p{L}\p{N}])(?:tomorrow|jutro)(?![\p{L}\p{N}])/iu;
const CALENDAR_DAY_AFTER_TOMORROW_SIGNAL_PATTERN =
  /(?<![\p{L}\p{N}])(?:day(?:\s+|-)after(?:\s+|-)tomorrow|pojutrze)(?![\p{L}\p{N}])/iu;
const CALENDAR_SIMPLE_WHOLE_DAY_LIST_REQUEST_PATTERN =
  /(?:\bwhat(?:['’]s|\s+is)\s+on\s+(?:(?:my|our|the)\s+)?calendar\b|\b(?:what|which)\s+(?:events?|meetings?|appointments?)\s+do\s+(?:i|we)\s+have\b|\bwhat\s+do\s+(?:i|we)\s+have[\s\S]{0,50}\b(?:on|in)\s+(?:(?:my|our|the)\s+)?calendar\b|\b(?:show|list)\b[\s\S]{0,50}\b(?:calendars?|events?|meetings?|appointments?)\b|(?<![\p{L}\p{N}])co\s+(?:mam|mamy)[\s\S]{0,50}(?<![\p{L}\p{N}])w\s+kalendarz\p{L}*(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])jakie\s+(?:(?:mam|mamy|masz|są|sa)\s+[\s\S]{0,40}(?:wydarzeni\p{L}*|spotkani\p{L}*|termin\p{L}*)|(?:wydarzeni\p{L}*|spotkani\p{L}*|termin\p{L}*)\s+(?:mam|mamy|masz|są|sa))(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:pokaż|pokaz|podaj|wymień|wymien)(?![\p{L}\p{N}])[\s\S]{0,50}(?<![\p{L}\p{N}])(?:kalendarz\p{L}*|wydarzeni\p{L}*|spotkani\p{L}*|termin\p{L}*)(?![\p{L}\p{N}]))/iu;
const CALENDAR_NEGATED_RELATIVE_DAY_PATTERN =
  /(?<![\p{L}\p{N}])(?:(?:not|except|without)\s+(?!only\b)(?:today|tomorrow)|(?:nie|bez)\s+(?!tylko\b)(?:dzisiaj|dziś|dzis|jutro))(?![\p{L}\p{N}])/iu;
const CALENDAR_AVAILABILITY_REQUEST_PATTERN =
  /(?<![\p{L}\p{N}])(?:free|available|availability|slots?|windows?|woln\p{L}*|dostępn\p{L}*|dostepn\p{L}*|okienk\p{L}*)(?![\p{L}\p{N}])/iu;
const CALENDAR_COUNT_REQUEST_PATTERN =
  /(?<![\p{L}\p{N}])(?:how\s+many|number\s+of|count|ile|policz|liczb\p{L}*)(?![\p{L}\p{N}])/iu;
const CALENDAR_PARTIAL_DAY_REQUEST_PATTERN =
  /(?<![\p{L}\p{N}])(?:morning|afternoon|evening|night|tonight|noon|midday|rano|poranek|południ\p{L}*|poludni\p{L}*|popołudni\p{L}*|popoludni\p{L}*|wiecz\p{L}*|noc\p{L}*)(?![\p{L}\p{N}])/iu;
const CALENDAR_RELATIVE_TIME_RANGE_PATTERN =
  /(?<![\p{L}\p{N}])(?:before|after|from|until|przed|po|od|do)\s+(?:noon|midnight|\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)(?![\p{L}\p{N}])/iu;

const CALENDAR_ORDINAL_DATE_SIGNAL_PATTERN =
  /(?<![\p{L}\p{N}])on\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)(?=\s*(?:$|[,.;!?]|(?:at|from|between|until|for)\b))/iu;

const CALENDAR_CONTEXTUAL_MONTH_SIGNAL_PATTERN =
  /(?<![\p{L}\p{N}])(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?)(?=$|[^\p{L}\p{N}])/iu;
const CALENDAR_COLON_CLOCK_PATTERN =
  /(?<![\p{L}\p{N}])(\d{1,2}):(\d{2})(?:\s*(am|pm))?(?![\p{L}\p{N}])/iu;
const CALENDAR_MERIDIEM_CLOCK_PATTERN = /(?<![\p{L}\p{N}])(\d{1,2})\s*(am|pm)(?![\p{L}\p{N}])/iu;
const CALENDAR_CONTEXTUAL_HOUR_PATTERN = /(?<![\p{L}\p{N}])(?:at|o)\s+(\d{1,2})(?![\p{L}\p{N}:])/iu;
const CALENDAR_ENGLISH_DURATION_PATTERN =
  /(?<![\p{L}\p{N}])(?:for|lasting|will\s+last)\s+(?:(\d+(?:[.,]\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half(?:\s+an?)?)\s*)?(hours?|hrs?|h|minutes?|mins?|min)(?![\p{L}\p{N}])/iu;
const CALENDAR_POLISH_DURATION_PATTERN =
  /(?<![\p{L}\p{N}])(?:(?:na|przez)\s+|(?:będzie|bedzie)\s+trwa(?:ć|c|ł|l|ła|la|ło|lo)\s+|potrwa(?:ć|c)?\s+|ma\s+trwa(?:ć|c)\s+)(?:(\d+(?:[.,]\d+)?|pół|pol|jeden|jedna|jedną|dwa|dwie|trzy|cztery|pięć|piec|sześć|szesc|siedem|osiem|dziewięć|dziewiec|dziesięć|dziesiec|jedenaście|jedenascie|dwanaście|dwanascie)\s*)?(godzin(?:ę|e|y|a)?|godz\.?|h|minut(?:ę|e|y|a)?|min\.?)(?![\p{L}\p{N}])/iu;
const CALENDAR_COMPACT_DURATION_PATTERN =
  /(?<![\p{L}\p{N}])(\d+(?:[.,]\d+)?)\s*(h|hrs?|godz\.?|mins?|min\.?)(?![\p{L}\p{N}])/iu;
const CALENDAR_DURATION_WORD_QUANTITIES: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  jeden: 1,
  jedna: 1,
  dwa: 2,
  dwie: 2,
  trzy: 3,
  cztery: 4,
  piec: 5,
  szesc: 6,
  siedem: 7,
  osiem: 8,
  dziewiec: 9,
  dziesiec: 10,
  jedenascie: 11,
  dwanascie: 12,
  pol: 0.5,
  half: 0.5,
  'half a': 0.5,
  'half an': 0.5,
};
const CALENDAR_UNTIL_CLOCK_PATTERN =
  /(?<![\p{L}\p{N}])(?:until|do)\s+(noon|midnight|\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)(?![\p{L}\p{N}])/iu;
const CALENDAR_CLOCK_RANGE_PATTERN =
  /(?<![\p{L}\p{N}])(?:(?:from|od)\s+)?(noon|midnight|\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)\s*(?:-|–|to|do)\s*(noon|midnight|\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)(?![\p{L}\p{N}])/iu;
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

const CALENDAR_UPDATE_CONFIRMATION_INTRO: LocalizedText = {
  en: 'Update this existing calendar event?',
  pl: 'Czy zaktualizować istniejące wydarzenie w kalendarzu?',
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
  en: 'I could not reliably identify the requested calendar event or event set to update. Please clarify which event or events you mean.',
  pl: 'Nie udało mi się wiarygodnie wskazać wydarzenia lub zestawu wydarzeń do zmiany. Doprecyzuj, o które wydarzenie lub wydarzenia chodzi.',
};

const CALENDAR_UPDATE_LOOKUP_NEXT_STEPS: LocalizedText = {
  en: 'Identify one or more existing calendar events.',
  pl: 'Wskaż jedno lub więcej istniejących wydarzeń.',
};

const CALENDAR_UPDATE_BATCH_PREVIEW_TOO_LARGE_REPLIES: LocalizedText = {
  en: 'This calendar update plan is too large to show completely in one confirmation. Please narrow the event set or requested fields.',
  pl: 'Ten plan zmian w kalendarzu jest zbyt duży, aby pokazać go w całości w jednym potwierdzeniu. Ogranicz zestaw wydarzeń lub zakres zmian.',
};

const CALENDAR_UPDATE_BATCH_PREVIEW_TOO_LARGE_NEXT_STEPS: LocalizedText = {
  en: 'Request a smaller calendar update plan that can be shown completely.',
  pl: 'Poproś o mniejszy plan zmian, który można pokazać w całości.',
};

const CALENDAR_UPDATE_EMAIL_CLARIFICATION_REPLIES: LocalizedText = {
  en: "What is the attendee's email address?",
  pl: 'Jaki jest adres e-mail uczestnika?',
};

const CALENDAR_UPDATE_EMAIL_CLARIFICATION_NEXT_STEPS: LocalizedText = {
  en: 'Provide the attendee email address.',
  pl: 'Podaj adres e-mail uczestnika.',
};

const CALENDAR_NON_ATTENDEE_UPDATE_SIGNAL_PATTERN =
  /(?<![\p{L}\p{N}])(?:mov\p{L}*|reschedul\p{L}*|postpon\p{L}*|push|renam\p{L}*|chang\p{L}*|updat\p{L}*|shift\p{L}*|all[- ]day|przeni\p{L}*|przesu\p{L}*|przeł\p{L}*|przeloz\p{L}*|zmie(?:ń|n)\p{L}*|zaktualiz\p{L}*|ustaw\p{L}*|tytu\p{L}*|title\p{L}*|dat\p{L}*|time\p{L}*|godzin\p{L}*|location\p{L}*|lokalizacj\p{L}*|miejsce\p{L}*|description\p{L}*|opis\p{L}*)(?![\p{L}\p{N}])/iu;

const CALENDAR_UPDATE_TARGET_SET_PATTERN =
  /(?<![\p{L}\p{N}])(?:all(?![- ]day\b)|both|every(?! day\b)|wszystk\p{L}*|oba|obie|każd\p{L}*(?!\s+dzień\b)|kazd\p{L}*(?!\s+dzien\b))(?![\p{L}\p{N}])/iu;
const CALENDAR_UPDATE_COMPLETE_TARGET_SET_PATTERN =
  /(?<![\p{L}\p{N}])(?:all(?![- ]day\b)|every(?! day\b)|wszystk\p{L}*|każd\p{L}*(?!\s+dzień\b)|kazd\p{L}*(?!\s+dzien\b))(?![\p{L}\p{N}])/iu;
const CALENDAR_UPDATE_PLURAL_TARGET_PATTERN =
  /(?<![\p{L}\p{N}])(?:events|meetings|appointments|wydarzeni\p{L}*|spotkani\p{L}*)(?![\p{L}\p{N}])/iu;
const CALENDAR_UPDATE_PRIOR_PROPOSAL_REFERENCE_PATTERN =
  /(?:\b(?:apply|use|execute)\s+(?:exactly\s+)?(?:it|that|this|those\s+dates|the\s+(?:proposal|plan|mapping))\b|\b(?:zastosuj|wykonaj|uzyj)\s+(?:dokladnie\s+)?(?:to|tego|te\s+daty|ten\s+plan|ta\s+propozycj\w*|to\s+mapowani\w*)\b)/u;
const CALENDAR_UPDATE_PROPOSAL_AFFIRMATIVE_PATTERN =
  /^(?:tak|yes|ok|okay|jasne|zgoda|potwierdzam|zrob to|do it|please do)$/u;
const CALENDAR_UPDATE_PROPOSAL_CTA_PATTERN =
  /(?:\bczy\s+(?:zastos\w*|wykon\w*)\b|\b(?:czy chcesz|czy mam|do you want me to|should i|shall i)\b.{0,100}\b(?:zaktualiz\w*|zmien\w*|przenies\w*|zastos\w*|wykon\w*|apply|update|change|move|execute)\b|\b(?:zaktualiz\w*|zmien\w*|przenies\w*|zastos\w*|wykon\w*|apply|update|change|move|execute)\b.{0,100}\b(?:czy chcesz|czy mam|do you want me to|should i|shall i)\b)/u;

const CONFIRMATION_LABELS = {
  title: { en: 'Title', pl: 'Tytuł' },
  content: { en: 'Content', pl: 'Treść' },
  start: { en: 'Start', pl: 'Początek' },
  end: { en: 'End', pl: 'Koniec' },
  location: { en: 'Location', pl: 'Miejsce' },
  description: { en: 'Description', pl: 'Opis' },
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
  toolSelectionGate?: (
    input: Readonly<{
      toolName: IntexAgentToolName;
      args: Record<string, unknown>;
    }>
  ) => Promise<
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

async function executeConfirmedOperation(
  config: IntexAgentRunnerConfig,
  toolName: IntexAgentToolName,
  toolArgs: Record<string, unknown>,
  replyLanguage: IntexAgentReplyLanguage
): Promise<IntexAgentRunnerResult> {
  if (!isMutatingToolName(toolName)) {
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
  const tool = tools.find((candidate) => candidate.name === toolName);
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
    const rawResult = await tool.run(toolArgs);
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
      toolName,
      parsedResult,
      defaultCompletedReply(toolName, replyLanguage),
      config.webAppUrl ?? DEFAULT_WEB_APP_URL,
      replyLanguage
    );
    return {
      outcome: 'completed',
      reply: completedReply.reply,
      toolName,
      ...(parsedResult !== undefined ? { toolResult: parsedResult } : {}),
      ...(completedReply.ctaUrl !== undefined ? { ctaUrl: completedReply.ctaUrl } : {}),
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown tool execution error');
    const failureMetadata = toolFailureMetadata(toolName, errorMessage);
    return {
      outcome: 'tool_failed',
      reply: buildConfirmedExecutionFailureReply(toolName, errorMessage, replyLanguage),
      toolName,
      error: errorMessage,
      ...failureMetadata,
    };
  }
}

export function createIntexAgentRunner(config: IntexAgentRunnerConfig): IntexAgentRunner {
  return {
    async executeConfirmed(input): Promise<IntexAgentRunnerResult> {
      const replyLanguage = detectReplyLanguage(input.events ?? []);
      if ('operations' in input) {
        const operationResults = [];
        for (const operation of input.operations) {
          const result = await executeConfirmedOperation(
            config,
            operation.toolName,
            operation.toolArgs,
            replyLanguage
          );
          operationResults.push(
            result.outcome === 'completed'
              ? {
                  toolName: operation.toolName,
                  status: 'completed' as const,
                  ...(operation.toolSelection === undefined
                    ? {}
                    : { toolSelection: operation.toolSelection }),
                  ...(result.toolResult !== undefined ? { toolResult: result.toolResult } : {}),
                }
              : {
                  toolName: operation.toolName,
                  status: 'failed' as const,
                  ...(operation.toolSelection === undefined
                    ? {}
                    : { toolSelection: operation.toolSelection }),
                  error:
                    result.outcome === 'tool_failed'
                      ? result.error
                      : 'Confirmed calendar operation could not be executed',
                }
          );
        }
        const completedCount = operationResults.filter(
          (operation) => operation.status === 'completed'
        ).length;
        return {
          outcome: 'completed',
          reply:
            replyLanguage === 'pl'
              ? `Zaktualizowano ${String(completedCount)} z ${String(operationResults.length)} wydarzeń w kalendarzu.`
              : `Updated ${String(completedCount)} of ${String(operationResults.length)} calendar events.`,
          operationResults,
        };
      }
      return await executeConfirmedOperation(config, input.toolName, input.toolArgs, replyLanguage);
    },
    async run(input): Promise<IntexAgentRunnerResult> {
      const detectedReplyLanguage = detectReplyLanguage(input.events, {
        text: input.message,
        ...(input.sourceType !== undefined ? { sourceType: input.sourceType } : {}),
        ...(input.sourceUrl !== undefined ? { hasSourceUrl: true } : {}),
      });

      if (input.sourceType === 'whatsapp_image' && input.sourceUrl !== undefined) {
        const args = {
          message:
            input.message.trim() === '' ? 'Image shared via WhatsApp.' : input.message.trim(),
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

      const activeCalendarDraft = findActiveCalendarDraft(input.events);

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
      const calendarDefaultIntent = applyCalendarEndDefaultIntent(dateNormalizedIntent, {
        message: input.message,
        events: input.events,
        replyContext: input.replyContext,
      });
      const calendarUpdateTargetIntent = applyCalendarUpdateTargetSetClarification(
        calendarDefaultIntent,
        {
          message: input.message,
          events: input.events,
        }
      );
      const intent = applyMissingCalendarAttendeeEmailClarification(calendarUpdateTargetIntent, {
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
      const calendarUpdateExplicitAttendeeEmails = isCalendarUpdateIntent(intent)
        ? resolveActiveCalendarExplicitAttendeeEmails(calendarUpdateContext)
        : undefined;
      const todayAndTomorrowCalendarQueryScope =
        intent.kind === 'tool' &&
        intent.allowedToolNames.length === 1 &&
        intent.allowedToolNames[0] === 'query_calendar_events'
          ? resolveTodayAndTomorrowCalendarQueryScope(
              input.message,
              input.currentDateTime,
              input.timeZone
            )
          : undefined;
      const calendarUpdateReferentialQueryScope = isCalendarUpdateIntent(intent)
        ? resolveCalendarUpdateReferentialQueryScope(input.events, input.message)
        : undefined;
      const toolExecutions: IntexAgentToolExecution[] = [];
      const useStructuredCalendarUpdatePlanning =
        isCalendarUpdateIntent(intent) && config.responseRepairClient !== undefined;
      const allowedToolNames = resolveRunnerToolNames(intent, useStructuredCalendarUpdatePlanning);
      const trackingToolExecutor = createTrackingToolExecutor(
        createConfirmationPreviewExecutor(config.toolExecutor),
        toolExecutions,
        config.toolSelectionGate,
        resolveCurrentPreferenceVersion(config.userPreferences),
        calendarUpdateAttendeeEmails,
        todayAndTomorrowCalendarQueryScope,
        calendarUpdateReferentialQueryScope
      );
      const allTools = createIntexAgentToolDefinitions(trackingToolExecutor);
      const tools = allTools
        .filter((tool) => allowedToolNames.includes(tool.name as IntexAgentToolName))
        .map((tool) =>
          (isMutatingToolName(tool.name as IntexAgentToolName) &&
            tool.name !== 'update_calendar_event') ||
          tool.name === 'get_user_preferences' ||
          (tool.name === 'query_calendar_events' &&
            todayAndTomorrowCalendarQueryScope !== undefined)
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

      const deterministicCalendarAttendeePreview = await appendDeterministicCalendarUpdatePreview({
        intent,
        toolExecutions,
        tools: allTools,
        attendeesToAdd: calendarUpdateAttendeeEmails,
        activeUserTexts: calendarUpdateRelevantTexts,
      });
      const structuredCalendarUpdatePlan = deterministicCalendarAttendeePreview
        ? { outcome: 'not_applicable' as const }
        : useStructuredCalendarUpdatePlanning && config.responseRepairClient !== undefined
          ? await appendStructuredCalendarUpdatePreview({
              client: config.responseRepairClient,
              intent,
              toolExecutions,
              tools: allTools,
              currentDateTime: input.currentDateTime,
              timeZone: input.timeZone,
              messages,
              events: input.events,
              currentMessage: input.message,
              ...(matrixCorpusLlm === undefined
                ? {}
                : {
                    matrixCorpusLlm,
                    recordProviderCall: async (providerCall): Promise<void> => {
                      await recordProviderCallOnce(matrixCorpusLlm, providerCall);
                    },
                  }),
            })
          : { outcome: 'not_applicable' as const };
      const synthesizedCalendarUpdatePreview =
        deterministicCalendarAttendeePreview || structuredCalendarUpdatePlan.outcome === 'updates';
      const currentCalendarEvidence = currentCalendarEvidenceTexts(
        input.message,
        input.replyContext
      );
      const explicitDurationMinutes = resolveCalendarDurationMinutes(
        input.message,
        input.events,
        input.replyContext
      );

      const runnerResult =
        structuredCalendarUpdatePlan.outcome === 'proposal_only'
          ? ({
              outcome: 'no_action',
              reply: structuredCalendarUpdatePlan.reply,
            } satisfies IntexAgentRunnerResult)
          : structuredCalendarUpdatePlan.outcome === 'invalid_scope'
            ? calendarUpdateLookupResult(replyLanguage)
            : structuredCalendarUpdatePlan.outcome === 'needs_clarification'
              ? ({
                  outcome: 'needs_clarification',
                  reply: structuredCalendarUpdatePlan.question,
                  clarification: structuredCalendarUpdatePlan.question,
                  blockerReason: 'missing_required_details',
                  candidateIntents: ['update_calendar_event'],
                  suggestedNextStep:
                    replyLanguage === 'pl'
                      ? 'Doprecyzuj zakres wydarzeń albo zmianę do zastosowania.'
                      : 'Clarify the event scope or the change to apply.',
                } satisfies IntexAgentRunnerResult)
              : await parseRunnerContent(
                  {
                    content: result.value.content,
                    repairClient: config.responseRepairClient,
                    systemPrompt,
                    messages,
                    intent,
                    exposedToolNames,
                    currentMessage: input.message,
                    ...(intent.kind === 'tool' &&
                    intent.allowedToolNames.includes('create_calendar_event')
                      ? {
                          calendarCreateReadiness: {
                            evidenceTexts: calendarCreateEvidenceTexts(
                              input.message,
                              input.events,
                              input.replyContext
                            ),
                            hasExplicitStart: hasCalendarStartSignal(
                              input.message,
                              input.events,
                              input.replyContext
                            ),
                            hasExplicitEnd: hasCalendarExplicitEndTimeSignal(
                              input.message,
                              input.events,
                              input.replyContext
                            ),
                            ...(explicitDurationMinutes === undefined
                              ? {}
                              : { explicitDurationMinutes }),
                            hasCurrentExplicitSummary: currentCalendarEvidence.some(
                              containsExplicitCalendarSummarySignal
                            ),
                            hasCurrentExplicitStart: currentCalendarEvidence.some(
                              containsCalendarClockTimeSignal
                            ),
                            hasCurrentExplicitEnd: currentCalendarEvidence.some(
                              containsCalendarEndTimeSignal
                            ),
                            ...(activeCalendarDraft === null
                              ? {}
                              : { activeDraft: activeCalendarDraft }),
                          },
                        }
                      : {}),
                    ...(todayAndTomorrowCalendarQueryScope !== undefined
                      ? { todayAndTomorrowCalendarQueryScope }
                      : {}),
                    ...(calendarUpdateAttendeeEmails !== undefined
                      ? { calendarUpdateAttendeeEmails }
                      : {}),
                    ...(calendarUpdateExplicitAttendeeEmails !== undefined
                      ? { calendarUpdateExplicitAttendeeEmails }
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

function resolveTodayAndTomorrowCalendarQueryScope(
  message: string,
  currentDateTime: string,
  timeZone: string
): TodayAndTomorrowCalendarQueryScope | undefined {
  if (
    CALENDAR_DAY_AFTER_TOMORROW_SIGNAL_PATTERN.test(message) ||
    CALENDAR_NEGATED_RELATIVE_DAY_PATTERN.test(message) ||
    CALENDAR_AVAILABILITY_REQUEST_PATTERN.test(message) ||
    CALENDAR_COUNT_REQUEST_PATTERN.test(message) ||
    CALENDAR_PARTIAL_DAY_REQUEST_PATTERN.test(message) ||
    CALENDAR_RELATIVE_TIME_RANGE_PATTERN.test(message) ||
    containsCalendarClockTimeSignal(message) ||
    !CALENDAR_TODAY_SIGNAL_PATTERN.test(message) ||
    !CALENDAR_TOMORROW_SIGNAL_PATTERN.test(message) ||
    !CALENDAR_SIMPLE_WHOLE_DAY_LIST_REQUEST_PATTERN.test(message)
  ) {
    return undefined;
  }

  const calendarContext = buildIntexAgentLocalCalendarContext(currentDateTime, timeZone);
  return {
    today: calendarContext.today,
    tomorrow: calendarContext.tomorrow,
  };
}

function resolveCalendarUpdateReferentialQueryScope(
  events: readonly IntexAgentSessionEvent[],
  message: string
): CalendarUpdateReferentialQueryScope | undefined {
  if (!hasStrongCalendarUpdateSetReference(message, events)) return undefined;

  for (const event of [...events].reverse()) {
    if (
      event.type !== 'tool_call_completed' ||
      event.payload['toolName'] !== 'query_calendar_events'
    ) {
      continue;
    }
    const result = event.payload['result'];
    if (result === null || typeof result !== 'object' || Array.isArray(result)) continue;
    const record = result as Record<string, unknown>;
    const rawEvents = record['events'];
    const timeMin = readNonEmptyString(record, 'timeMin');
    const timeMax = readNonEmptyString(record, 'timeMax');
    if (
      record['status'] !== 'completed' ||
      record['mode'] !== 'list' ||
      record['truncated'] !== false ||
      !Array.isArray(rawEvents) ||
      rawEvents.length === 0 ||
      record['count'] !== rawEvents.length ||
      timeMin === undefined ||
      timeMax === undefined ||
      !Number.isFinite(Date.parse(timeMin)) ||
      !Number.isFinite(Date.parse(timeMax)) ||
      Date.parse(timeMin) >= Date.parse(timeMax)
    ) {
      continue;
    }
    return { timeMin, timeMax };
  }
  return undefined;
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

function applyCalendarEndDefaultIntent(
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
    intent.candidateIntents[0] !== 'create_calendar_event' ||
    intent.missingFields === undefined ||
    !intent.missingFields.some(isCalendarEndField) ||
    !intent.missingFields.every(
      (field) => isCalendarEndField(field) || isOmittableCalendarCreateField(field)
    ) ||
    !hasCalendarDateSignal(context.message, context.events, context.replyContext) ||
    !hasCalendarStartSignal(context.message, context.events, context.replyContext)
  ) {
    return intent;
  }

  return clarificationToToolIntent(intent, 'create_calendar_event');
}

function applyCalendarUpdateTargetSetClarification(
  intent: IntexAgentIntentClassification,
  context: Readonly<{
    message: string;
    events: readonly IntexAgentSessionEvent[];
  }>
): IntexAgentIntentClassification {
  if (
    intent.kind !== 'needs_clarification' ||
    intent.blockerReason !== 'missing_required_details' ||
    intent.candidateIntents?.length !== 1 ||
    intent.candidateIntents[0] !== 'update_calendar_event' ||
    intent.missingFields?.some((field) => field.trim().toLocaleLowerCase('en-US') === 'event') !==
      true ||
    !CALENDAR_UPDATE_TARGET_SET_PATTERN.test(context.message)
  ) {
    return intent;
  }

  const activeClarification = findActiveClarificationEvent(context.events);
  if (activeClarification === undefined) return intent;
  const activeCandidateIntents = activeClarification.event.payload['candidateIntents'];
  const activeMissingFields = activeClarification.event.payload['missingFields'];
  if (
    activeClarification.event.payload['blockerReason'] !== 'missing_required_details' ||
    !Array.isArray(activeCandidateIntents) ||
    activeCandidateIntents.length !== 1 ||
    activeCandidateIntents[0] !== 'update_calendar_event' ||
    !Array.isArray(activeMissingFields) ||
    !activeMissingFields.some(
      (field) => typeof field === 'string' && field.trim().toLocaleLowerCase('en-US') === 'event'
    )
  ) {
    return intent;
  }

  return clarificationToToolIntent(intent, 'update_calendar_event');
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
  const canonical = field
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s_-]+/gu, '');
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
    return hasCalendarSignal(context, activeClarificationIndex, containsCalendarClockTimeSignal);
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

function findActiveCalendarDraft(
  events: readonly IntexAgentSessionEvent[]
): CalendarEventDraftV1 | null {
  const activeClarification = findActiveClarificationEvent(events);
  if (activeClarification === undefined || !isCalendarClarification(activeClarification.event)) {
    return null;
  }
  const draft = parseCalendarEventDraft(activeClarification.event.payload['calendarEventDraft']);
  return draft;
}

function hasCalendarStartSignal(
  message: string,
  events: readonly IntexAgentSessionEvent[],
  replyContext: IntexIncomingMessageReplyContext | undefined
): boolean {
  return hasActiveCalendarSignal(message, events, replyContext, containsCalendarClockTimeSignal);
}

function hasCalendarExplicitEndTimeSignal(
  message: string,
  events: readonly IntexAgentSessionEvent[],
  replyContext: IntexIncomingMessageReplyContext | undefined
): boolean {
  return hasActiveCalendarSignal(
    message,
    events,
    replyContext,
    containsCalendarExplicitEndTimeSignal
  );
}

function hasActiveCalendarSignal(
  message: string,
  events: readonly IntexAgentSessionEvent[],
  replyContext: IntexIncomingMessageReplyContext | undefined,
  containsSignal: (message: string) => boolean
): boolean {
  if (containsCalendarTimeWithdrawalSignal(message)) return false;
  if (containsSignal(message)) return true;
  if (replyContext?.source === 'inbound_user_message') {
    if (containsCalendarTimeWithdrawalSignal(replyContext.text)) return false;
    if (containsSignal(replyContext.text)) return true;
  }
  const activeClarification = findActiveClarificationEvent(events);
  return (
    activeClarification !== undefined &&
    isCalendarClarification(activeClarification.event) &&
    activeCalendarClarificationChainContainsSignal(
      events,
      activeClarification.index,
      containsSignal
    )
  );
}

function calendarCreateEvidenceTexts(
  message: string,
  events: readonly IntexAgentSessionEvent[],
  replyContext: IntexIncomingMessageReplyContext | undefined
): string[] {
  const texts = [message];
  if (replyContext?.source === 'inbound_user_message') texts.push(replyContext.text);
  const activeClarification = findActiveClarificationEvent(events);
  if (activeClarification === undefined || !isCalendarClarification(activeClarification.event)) {
    return texts;
  }

  let expectsUserMessage = true;
  for (let index = activeClarification.index - 1; index >= 0; index -= 1) {
    const event = events[index];
    /* v8 ignore start -- ts-type: bounded index still includes undefined with noUncheckedIndexedAccess @preserve */
    if (event === undefined) continue;
    /* v8 ignore stop @preserve */
    if (expectsUserMessage) {
      if (event.type === 'clarification_requested') break;
      if (event.type !== 'user_message') continue;
      const priorMessage = event.payload['text'];
      if (typeof priorMessage === 'string') texts.push(priorMessage);
      const priorReplyContext = parseIncomingReplyContext(event.payload['replyContext']);
      if (priorReplyContext?.source === 'inbound_user_message') texts.push(priorReplyContext.text);
      expectsUserMessage = false;
      continue;
    }
    if (event.type === 'user_message') break;
    if (event.type !== 'clarification_requested') continue;
    if (!isCalendarClarification(event)) break;
    expectsUserMessage = true;
  }
  return texts;
}

function currentCalendarEvidenceTexts(
  message: string,
  replyContext: IntexIncomingMessageReplyContext | undefined
): string[] {
  return [message, ...(replyContext?.source === 'inbound_user_message' ? [replyContext.text] : [])];
}

function resolveCalendarDurationMinutes(
  message: string,
  events: readonly IntexAgentSessionEvent[],
  replyContext: IntexIncomingMessageReplyContext | undefined
): number | undefined {
  const currentEvidence = currentCalendarEvidenceTexts(message, replyContext);
  if (currentEvidence.some(containsCalendarTimeWithdrawalSignal)) return undefined;
  for (const evidence of calendarCreateEvidenceTexts(message, events, replyContext)) {
    const durationMinutes = extractCalendarDurationMinutes(evidence);
    if (durationMinutes !== undefined) return durationMinutes;
  }
  return undefined;
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

  const activeUserTexts = activeCalendarAttendeeUserTurns(context).flat();
  const hasExplicitAttendeeRequest = activeUserTexts.some(
    (text) => extractCalendarAttendeeSegments(text).length > 0
  );
  if (!hasExplicitAttendeeRequest) return intent;

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

function resolveActiveCalendarExplicitAttendeeEmails(
  context: Readonly<{
    message: string;
    events: readonly IntexAgentSessionEvent[];
    replyContext: IntexIncomingMessageReplyContext | undefined;
  }>
): string[] | undefined {
  const emailsByIdentity = new Map<string, string>();
  for (const text of activeCalendarAttendeeUserTurns(context).flat()) {
    for (const email of uniqueValidAttendeeEmails(text)) {
      emailsByIdentity.set(normalizeAttendeeEmail(email), email);
    }
  }
  return emailsByIdentity.size === 0 ? undefined : [...emailsByIdentity.values()];
}

function extractAssociatedAttendeeEmails(message: string): string[] {
  const attendeeSegmentEmails = extractCalendarAttendeeSegments(message)
    .map(uniqueValidAttendeeEmails)
    .filter((emails) => emails.length > 0);
  if (attendeeSegmentEmails.length > 0) {
    return attendeeSegmentEmails.flat();
  }
  return containsStandaloneAttendeeEmailSignal(message) ? uniqueValidAttendeeEmails(message) : [];
}

function uniqueValidAttendeeEmails(message: string): string[] {
  const byNormalizedEmail = new Map<string, string>();
  for (const email of extractAttendeeEmailCandidates(message).filter(
    isValidCalendarAttendeeEmail
  )) {
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
    if (
      !attendeeObjects.some((attendee) => isExactPersonLabelMatch(attendee, parsedMapping.person))
    ) {
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
  if (personLabelTokens.length === 0 || personLabelTokens.length > attendeeTokens.length)
    return false;

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
  return (
    value
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLocaleLowerCase('en-US')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
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
  const candidateIntents =
    intent.kind === 'needs_clarification' ? intent.candidateIntents : undefined;
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
  const canonical = field
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s_-]+/gu, '');
  return canonical === 'title' || canonical === 'tags' || canonical === 'sourcemessageids';
}

function isCalendarSummaryField(field: string): boolean {
  const canonical = field
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s_-]+/gu, '');
  return canonical === 'summary' || canonical === 'title' || canonical === 'eventtitle';
}

function isCalendarEndField(field: string): boolean {
  const canonical = field
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s_-]+/gu, '');
  return (
    canonical === 'end' ||
    canonical === 'endtime' ||
    canonical === 'enddatetime' ||
    canonical === 'duration'
  );
}

function isOmittableCalendarCreateField(field: string): boolean {
  const canonical = field
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s_-]+/gu, '');
  return canonical === 'location' || canonical === 'description';
}

function isOptionalCodeTaskField(field: string): boolean {
  const canonical = field
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s_-]+/gu, '');
  return canonical === 'title' || canonical === 'name' || canonical === 'tasktitle';
}

function isOptionalPreferenceReadField(field: string): boolean {
  const canonical = field
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s_-]+/gu, '');
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

  const compactRange =
    /(?<![\p{L}\p{N}-])(\d{1,2})(?::(\d{2}))?\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(am|pm)?(?![\p{L}\p{N}-])/iu.exec(
      normalized
    );
  if (
    compactRange !== null &&
    isValidCalendarClock(Number(compactRange[1]), Number(compactRange[2] ?? 0), compactRange[3])
  ) {
    return true;
  }

  const colonClock = CALENDAR_COLON_CLOCK_PATTERN.exec(normalized);
  if (colonClock !== null) {
    return isValidCalendarClock(Number(colonClock[1]), Number(colonClock[2]), colonClock[3]);
  }

  const meridiemClock = CALENDAR_MERIDIEM_CLOCK_PATTERN.exec(normalized);
  if (meridiemClock !== null) {
    return isValidCalendarClock(Number(meridiemClock[1]), 0, meridiemClock[2]);
  }

  const contextualHour = CALENDAR_CONTEXTUAL_HOUR_PATTERN.exec(normalized);
  return contextualHour !== null && isValidCalendarClock(Number(contextualHour[1]), 0, undefined);
}

function containsCalendarEndTimeSignal(message: string): boolean {
  return (
    extractCalendarDurationMinutes(message) !== undefined ||
    containsCalendarExplicitEndTimeSignal(message)
  );
}

function extractCalendarDurationMinutes(message: string): number | undefined {
  const normalized = message.normalize('NFKC');
  const englishDuration = CALENDAR_ENGLISH_DURATION_PATTERN.exec(normalized);
  if (englishDuration !== null) {
    return durationMinutes(englishDuration[1], englishDuration[2] as string);
  }

  const polishDuration = CALENDAR_POLISH_DURATION_PATTERN.exec(normalized);
  if (polishDuration !== null) {
    return durationMinutes(polishDuration[1], polishDuration[2] as string);
  }

  const compactDuration = CALENDAR_COMPACT_DURATION_PATTERN.exec(normalized);
  if (compactDuration !== null) {
    return durationMinutes(compactDuration[1], compactDuration[2] as string);
  }

  return undefined;
}

function durationMinutes(quantityValue: string | undefined, unitValue: string): number | undefined {
  const normalizedQuantity = quantityValue
    ?.normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replaceAll('ł', 'l')
    .toLocaleLowerCase('en-US')
    .trim();
  const quantity =
    normalizedQuantity === undefined || normalizedQuantity === ''
      ? 1
      : (CALENDAR_DURATION_WORD_QUANTITIES[normalizedQuantity] ??
        Number(normalizedQuantity.replace(',', '.')));
  if (!Number.isFinite(quantity) || quantity <= 0) return undefined;
  const normalizedUnit = unitValue
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replaceAll('ł', 'l')
    .toLocaleLowerCase('en-US');
  const multiplier = /^(?:h|hr|hrs|hour|hours|godz|godzin)/u.test(normalizedUnit) ? 60 : 1;
  const minutes = quantity * multiplier;
  return Number.isInteger(minutes) ? minutes : undefined;
}

function containsCalendarExplicitEndTimeSignal(message: string): boolean {
  const normalized = message.normalize('NFKC');

  const untilClock = CALENDAR_UNTIL_CLOCK_PATTERN.exec(normalized);
  if (untilClock?.[1] !== undefined) {
    return containsCalendarClockTimeSignal(untilClock[1]);
  }

  const range = CALENDAR_CLOCK_RANGE_PATTERN.exec(normalized);
  if (
    range?.[1] !== undefined &&
    range[2] !== undefined &&
    containsCalendarClockTimeSignal(range[1]) &&
    containsCalendarClockTimeSignal(range[2])
  ) {
    return true;
  }

  const compactRange =
    /(?<![\p{L}\p{N}-])(\d{1,2})(?::(\d{2}))?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?![\p{L}\p{N}-])/iu.exec(
      normalized
    );
  return (
    compactRange !== null &&
    isValidCalendarClock(Number(compactRange[1]), Number(compactRange[2] ?? 0), compactRange[5]) &&
    isValidCalendarClock(Number(compactRange[3]), Number(compactRange[4] ?? 0), compactRange[5])
  );
}

function isValidCalendarClock(hour: number, minute: number, meridiem: string | undefined): boolean {
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
  const canonical = field
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s_-]+/gu, '');
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
  const canonical = field
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s_-]+/gu, '');
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
  while (words.length > 0 && NATURAL_TIME_ZONE_QUALIFIERS.has(words[words.length - 1] as string)) {
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
  const englishNoSaveMatch = /\b(?:do not|don['’]?t)\s+(?:save|store|persist)\b/u.exec(normalized);
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
  calendarCreateReadiness?: Readonly<{
    evidenceTexts: readonly string[];
    hasExplicitStart: boolean;
    hasExplicitEnd: boolean;
    explicitDurationMinutes?: number;
    hasCurrentExplicitSummary: boolean;
    hasCurrentExplicitStart: boolean;
    hasCurrentExplicitEnd: boolean;
    activeDraft?: CalendarEventDraftV1;
  }>;
  todayAndTomorrowCalendarQueryScope?: TodayAndTomorrowCalendarQueryScope;
  calendarUpdateAttendeeEmails?: string[];
  calendarUpdateExplicitAttendeeEmails?: string[];
  synthesizedCalendarUpdatePreview?: true;
  matrixCorpusLlm?: MatrixCorpusLlmRecorder;
}

function mergeCalendarEventDraftArgs(
  toolArgs: Record<string, unknown>,
  readiness: NonNullable<RunnerOutputValidationInput['calendarCreateReadiness']>
): Record<string, unknown> {
  const draft = readiness.activeDraft;
  if (draft === undefined) return toolArgs;

  const merged = { ...draft.toolArgs, ...toolArgs };
  preserveCalendarDraftField(merged, draft, 'summary', readiness.hasCurrentExplicitSummary);
  preserveCalendarDraftField(merged, draft, 'start', readiness.hasCurrentExplicitStart);
  preserveCalendarDraftField(merged, draft, 'end', readiness.hasCurrentExplicitEnd);
  preserveCalendarDraftField(merged, draft, 'timeZone', false);
  return merged;
}

function preserveCalendarDraftField(
  merged: Record<string, unknown>,
  draft: CalendarEventDraftV1,
  fieldName: keyof CalendarEventDraftV1['fields'],
  hasCurrentValue: boolean
): void {
  if (hasCurrentValue) return;
  const value = draft.fields[fieldName].value;
  if (value !== undefined) merged[fieldName] = value;
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
  const calendarUpdateExecutions = toolExecutions.filter(
    (execution) => execution.toolName === 'update_calendar_event'
  );
  const toolExecution =
    calendarUpdateExecutions.length > 1
      ? calendarUpdateExecutions.at(-1)
      : getCompletedToolExecution(toolExecutions);
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
  const hasDeterministicTodayAndTomorrowCalendarReply =
    toolExecution?.toolName === 'query_calendar_events' &&
    toolExecution.error === undefined &&
    toolExecution.result !== undefined &&
    input.todayAndTomorrowCalendarQueryScope !== undefined &&
    !isCalendarUpdateIntent(input.intent);
  const parsed = hasDeterministicTodayAndTomorrowCalendarReply
    ? null
    : await validateRunnerOutput(
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
          input.calendarUpdateAttendeeEmails,
          input.calendarUpdateExplicitAttendeeEmails
        )
      : undefined;
  const calendarUpdateOperations =
    calendarUpdateExecutions.length > 1
      ? calendarUpdateExecutions.map((execution) => {
          const args = buildCalendarUpdateConfirmationArgs(
            toolExecutions,
            execution,
            input.calendarUpdateAttendeeEmails,
            input.calendarUpdateExplicitAttendeeEmails
          );
          return args === undefined
            ? undefined
            : {
                toolName: 'update_calendar_event' as const,
                toolArgs: args,
                ...(execution.selectionMetadata === undefined
                  ? {}
                  : { toolSelection: execution.selectionMetadata }),
              };
        })
      : undefined;
  if (calendarUpdateOperations?.some((operation) => operation === undefined) === true) {
    return calendarUpdateLookupResult(replyLanguage);
  }
  if (toolExecution?.toolName === 'update_calendar_event' && calendarUpdateArgs === undefined) {
    return calendarUpdateLookupResult(replyLanguage);
  }
  let calendarCreateArgs: Record<string, unknown> | undefined;
  if (
    toolExecution?.toolName === 'create_calendar_event' &&
    input.calendarCreateReadiness !== undefined
  ) {
    const readinessToolArgs = mergeCalendarEventDraftArgs(
      toolExecution.args,
      input.calendarCreateReadiness
    );
    const readiness = assessCalendarEventReadiness({
      toolArgs: readinessToolArgs,
      evidenceTexts: input.calendarCreateReadiness.evidenceTexts,
      hasExplicitStart: input.calendarCreateReadiness.hasExplicitStart,
      hasExplicitEnd: input.calendarCreateReadiness.hasExplicitEnd,
      ...(input.calendarCreateReadiness.explicitDurationMinutes === undefined
        ? {}
        : { explicitDurationMinutes: input.calendarCreateReadiness.explicitDurationMinutes }),
      runtimeTimeZone,
      replyLanguage,
    });
    if (readiness.status === 'needs_clarification') {
      return {
        outcome: 'needs_clarification',
        reply: readiness.reply,
        clarification: readiness.reply,
        blockerReason: 'missing_required_details',
        missingFields: readiness.missingFields,
        candidateIntents: ['create_calendar_event'],
        suggestedNextStep:
          replyLanguage === 'pl'
            ? 'Podaj brakujące albo poprawione szczegóły wydarzenia.'
            : 'Provide the missing or corrected event details.',
        ...(readiness.draft === undefined ? {} : { calendarEventDraft: readiness.draft }),
        ...(toolExecution.selectionMetadata === undefined
          ? {}
          : { toolSelection: toolExecution.selectionMetadata }),
      };
    }
    calendarCreateArgs = readiness.toolArgs;
  }
  if (
    toolExecution?.toolName === 'update_calendar_event' &&
    calendarUpdateOperations !== undefined &&
    calendarUpdateOperations.length > 1
  ) {
    const operations = calendarUpdateOperations.filter(
      (operation): operation is NonNullable<typeof operation> => operation !== undefined
    );
    const firstOperation = operations[0];
    /* v8 ignore start -- schema: firstOperation cannot be undefined because this branch requires at least two calendar update operations @preserve */
    if (firstOperation === undefined) return calendarUpdateLookupResult(replyLanguage);
    /* v8 ignore stop @preserve */
    const supportingToolCompletions = collectSupportingToolCompletions(
      toolExecutions,
      toolExecution
    );
    const confirmationReply = buildCalendarUpdateOperationsConfirmationReply(
      operations,
      replyLanguage,
      runtimeTimeZone
    );
    if (confirmationReply === undefined) {
      return calendarUpdateBatchPreviewTooLargeResult(replyLanguage);
    }
    return {
      outcome: 'needs_confirmation',
      reply: confirmationReply,
      toolName: 'update_calendar_event',
      toolArgs: firstOperation.toolArgs,
      ...(firstOperation.toolSelection === undefined
        ? {}
        : { toolSelection: firstOperation.toolSelection }),
      operations,
      supportingToolCompletions,
    };
  }
  if (
    toolExecution !== undefined &&
    isMutatingToolName(toolExecution.toolName) &&
    parsed?.outcome === 'needs_clarification' &&
    !(toolExecution.toolName === 'create_calendar_event' && calendarCreateArgs !== undefined) &&
    input.synthesizedCalendarUpdatePreview !== true
  ) {
    return {
      outcome: 'needs_clarification',
      reply: parsed.reply,
      ...(parsed.blockerReason !== undefined ? { blockerReason: parsed.blockerReason } : {}),
      ...(parsed.missingFields !== undefined ? { missingFields: parsed.missingFields } : {}),
      candidateIntents: input.exposedToolNames,
      ...(parsed.suggestedNextStep !== undefined
        ? { suggestedNextStep: parsed.suggestedNextStep }
        : {}),
      ...(parsed.clarification !== undefined ? { clarification: parsed.clarification } : {}),
    };
  }
  if (toolExecution !== undefined && isMutatingToolName(toolExecution.toolName)) {
    const confirmationArgs = preserveCurrentTurnOpaqueReferences(
      toolExecution.toolName,
      calendarUpdateArgs ?? calendarCreateArgs ?? toolExecution.args,
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

  if (
    hasDeterministicTodayAndTomorrowCalendarReply &&
    toolExecution.toolName === 'query_calendar_events' &&
    input.todayAndTomorrowCalendarQueryScope !== undefined
  ) {
    const deterministicReply = renderCalendarQueryFallbackReply(
      toolExecution.result,
      replyLanguage,
      runtimeTimeZone,
      input.todayAndTomorrowCalendarQueryScope
    );
    if (deterministicReply === undefined) {
      return {
        outcome: 'tool_failed',
        reply: CALENDAR_QUERY_INVALID_RESULT_REPLIES[replyLanguage],
        toolName: toolExecution.toolName,
        error: 'Calendar query returned an invalid result',
        errorCategory: 'validation',
        isRetryable: true,
        attemptedAction: 'query_calendar_events',
      };
    }
    return buildCompletedToolExecutionResult(
      toolExecution.toolName,
      toolExecution.result,
      deterministicReply,
      undefined,
      webAppUrl,
      replyLanguage,
      toolExecution.selectionMetadata
    );
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
  /* v8 ignore start -- schema: extracted calendar attendee changes cannot be paired with a non-tool intent @preserve */
  if (intent.kind !== 'tool') return false;
  /* v8 ignore stop @preserve */
  const toolNames = new Set(intent.allowedToolNames);
  return (
    toolNames.size === intent.allowedToolNames.length &&
    toolNames.has('update_calendar_event') &&
    [...toolNames].every(
      (toolName) => toolName === 'query_calendar_events' || toolName === 'update_calendar_event'
    )
  );
}

type StructuredCalendarUpdatePreviewResult =
  | Readonly<{ outcome: 'not_applicable' }>
  | Readonly<{ outcome: 'invalid_scope' }>
  | Readonly<{ outcome: 'proposal_only'; reply: string }>
  | Readonly<{ outcome: 'needs_clarification'; question: string }>
  | Readonly<{ outcome: 'updates' }>;

type CalendarUpdatePlanningOperation = Extract<
  IntexAgentCalendarUpdatePlanningOutput,
  Readonly<{ outcome: 'updates' }>
>['operations'][number];

type CompleteCalendarUpdateLookupSnapshot = Required<
  Pick<
    UpdateCalendarEventToolArgs,
    'eventId' | 'eventSummary' | 'calendarId' | 'expectedEtag' | 'eventStart' | 'eventEnd'
  >
>;

async function appendStructuredCalendarUpdatePreview(
  input: Readonly<{
    client: StructuredClient;
    intent: IntexAgentIntentClassification | IntexAgentIntentDecision;
    toolExecutions: IntexAgentToolExecution[];
    tools: readonly ToolDefinition[];
    currentDateTime: string;
    timeZone: string;
    messages: ToolCallingMessage[];
    events: readonly IntexAgentSessionEvent[];
    currentMessage: string;
    matrixCorpusLlm?: MatrixCorpusLlmRecorder;
    recordProviderCall?: (call: MatrixCorpusProviderCallUsageV1) => Promise<void>;
  }>
): Promise<StructuredCalendarUpdatePreviewResult> {
  /* v8 ignore start -- upstream: the prior check in the sole caller guarantees a calendar-update intent and cannot expose the hidden update tool during structured planning @preserve */
  if (
    !isCalendarUpdateIntent(input.intent) ||
    input.toolExecutions.some((execution) => execution.toolName === 'update_calendar_event')
  ) {
    return { outcome: 'not_applicable' };
  }
  /* v8 ignore stop @preserve */

  const queryExecutions = input.toolExecutions.filter(
    (execution) => execution.toolName === 'query_calendar_events'
  );
  if (queryExecutions.length === 0) return { outcome: 'not_applicable' };
  const queryExecution = queryExecutions.at(-1);
  /* v8 ignore start -- ts-type: the non-empty guard above guarantees a final query execution @preserve */
  if (queryExecution === undefined) return { outcome: 'not_applicable' };
  /* v8 ignore stop @preserve */
  const lookupSnapshots = readCompleteCalendarUpdateLookupSnapshots(queryExecution);
  if (lookupSnapshots === undefined) return { outcome: 'not_applicable' };
  const supersededQueryExecutions = queryExecutions.slice(0, -1);
  if (
    supersededQueryExecutions.some(
      (execution) => !isSafelySupersededCalendarUpdateLookup(execution)
    )
  ) {
    return { outcome: 'invalid_scope' };
  }

  const prompt = intexAgentCalendarUpdatePlanningPrompt.build({
    currentDateTime: input.currentDateTime,
    timeZone: input.timeZone,
    messages: input.messages,
    lookup: {
      query: queryExecution.args,
      /* v8 ignore start -- schema: complete lookup validation above requires a parsed result @preserve */
      result: queryExecution.result as Record<string, unknown>,
      /* v8 ignore stop @preserve */
    },
  });
  const planResult = await generateStructured<IntexAgentCalendarUpdatePlanningOutput>({
    client: input.client,
    prompt,
    schema: IntexAgentCalendarUpdatePlanningProviderOutputSchema,
    promptType: INTEX_AGENT_CALENDAR_UPDATE_PLANNING_PROMPT_TYPE,
    options: {
      ...(input.matrixCorpusLlm === undefined
        ? {}
        : {
            matrixCorpusContext: input.matrixCorpusLlm.nextContext('calendar_update_planning'),
          }),
    },
    maxRepairAttempts: 0,
    ...(input.matrixCorpusLlm === undefined
      ? {}
      : {
          onProviderCall: async (call: MatrixCorpusProviderCallUsageV1): Promise<void> => {
            await input.recordProviderCall?.(call);
          },
        }),
  });
  if (!planResult.ok) return { outcome: 'not_applicable' };

  const plan = planResult.value.data;
  if (plan.outcome === 'proposal_only') {
    return { outcome: plan.outcome, reply: plan.reply };
  }
  if (plan.outcome === 'needs_clarification') {
    return { outcome: plan.outcome, question: plan.question };
  }

  if (
    !isGroundedCalendarUpdatePlan({
      operations: plan.operations,
      lookupSnapshots,
      queryExecution,
      events: input.events,
      currentMessage: input.currentMessage,
      runtimeTimeZone: input.timeZone,
      hadSupersededTruncatedLookup: supersededQueryExecutions.some(
        (execution) => execution.result?.['truncated'] === true
      ),
    })
  ) {
    return { outcome: 'invalid_scope' };
  }

  const updateTool = input.tools.find((tool) => tool.name === 'update_calendar_event');
  /* v8 ignore start -- schema: tool-registry validation guarantees update intent always has the private update tool @preserve */
  if (updateTool === undefined) return { outcome: 'not_applicable' };
  /* v8 ignore stop @preserve */
  const updateExecutionCountBefore = input.toolExecutions.length;
  try {
    for (const operation of plan.operations) {
      await updateTool.run({
        eventId: operation.eventId,
        eventSummary: operation.eventSummary,
        changes: operation.changes,
      });
    }
  } catch {
    input.toolExecutions.splice(updateExecutionCountBefore);
    return { outcome: 'invalid_scope' };
  }
  const plannedExecutions = input.toolExecutions
    .slice(updateExecutionCountBefore)
    .filter((execution) => execution.toolName === 'update_calendar_event');
  /* v8 ignore start -- upstream: prior validated operation iteration guarantees one tracked invocation per item, while a thrown invocation cannot pass the catch above @preserve */
  if (plannedExecutions.length !== plan.operations.length) {
    input.toolExecutions.splice(updateExecutionCountBefore);
    return { outcome: 'invalid_scope' };
  }
  /* v8 ignore stop @preserve */
  return { outcome: 'updates' };
}

function isSafelySupersededCalendarUpdateLookup(execution: IntexAgentToolExecution): boolean {
  if (execution.error !== undefined || execution.result === undefined) return false;
  const result = execution.result;
  return (
    result['status'] === 'completed' &&
    result['mode'] === 'list' &&
    (result['truncated'] === true ||
      (result['truncated'] === false &&
        result['count'] === 0 &&
        Array.isArray(result['events']) &&
        result['events'].length === 0))
  );
}

function isGroundedCalendarUpdatePlan(
  input: Readonly<{
    operations: readonly CalendarUpdatePlanningOperation[];
    lookupSnapshots: readonly CompleteCalendarUpdateLookupSnapshot[];
    queryExecution: IntexAgentToolExecution;
    events: readonly IntexAgentSessionEvent[];
    currentMessage: string;
    runtimeTimeZone: string;
    hadSupersededTruncatedLookup: boolean;
  }>
): boolean {
  const lookupByEventId = new Map(
    input.lookupSnapshots.map((snapshot) => [snapshot.eventId, snapshot] as const)
  );
  const operationIds = input.operations.map((operation) => operation.eventId);
  const lookupIds = input.lookupSnapshots.map((snapshot) => snapshot.eventId);
  const activeInstruction = readCalendarUpdateActiveInstruction(input.events, input.currentMessage);

  if (
    input.operations.some((operation) => {
      const snapshot = lookupByEventId.get(operation.eventId);
      return (
        snapshot?.eventSummary !== operation.eventSummary ||
        !isGroundedCalendarUpdateChanges(
          operation.changes,
          snapshot,
          activeInstruction.text,
          input.runtimeTimeZone,
          activeInstruction.isProposalContinuation
        )
      );
    })
  ) {
    return false;
  }

  const explicitCount = readExplicitCalendarUpdateTargetCount(input.currentMessage);
  if (!explicitCount.valid) return false;
  const priorTargetIds = readPriorCalendarUpdateTargetIds({
    events: input.events,
    queryExecution: input.queryExecution,
    currentMessage: input.currentMessage,
    currentLookupSnapshots: input.lookupSnapshots,
    explicitCount: explicitCount.count,
  });
  if (priorTargetIds === null) return false;
  if (priorTargetIds !== undefined) {
    return (
      priorTargetIds.every((eventId) => lookupByEventId.has(eventId)) &&
      sameEventIdSet(operationIds, priorTargetIds)
    );
  }

  const requestsCompleteLookup =
    CALENDAR_UPDATE_COMPLETE_TARGET_SET_PATTERN.test(input.currentMessage) ||
    CALENDAR_UPDATE_PLURAL_TARGET_PATTERN.test(input.currentMessage);
  if (
    input.hadSupersededTruncatedLookup &&
    explicitCount.count === undefined &&
    requestsCompleteLookup
  ) {
    return false;
  }

  if (explicitCount.count !== undefined) {
    if (
      input.lookupSnapshots.length < explicitCount.count ||
      input.operations.length !== explicitCount.count
    ) {
      return false;
    }
    if (input.lookupSnapshots.length === explicitCount.count) {
      return sameEventIdSet(operationIds, lookupIds);
    }
    const selectedSubset = readExplicitCalendarUpdateSubsetIds(
      input.currentMessage,
      explicitCount.count,
      lookupIds
    );
    return selectedSubset !== undefined && sameOrderedEventIds(operationIds, selectedSubset);
  }

  if (requestsCompleteLookup) return sameEventIdSet(operationIds, lookupIds);
  if (input.operations.length !== 1) return false;
  if (input.lookupSnapshots.length === 1) return true;
  const normalizedMessage = normalizeCalendarTargetText(input.currentMessage);
  const namedLookupTargets = input.lookupSnapshots.filter((snapshot) =>
    normalizedMessage.includes(normalizeCalendarTargetText(snapshot.eventSummary))
  );
  const longestMatchLength = Math.max(
    ...namedLookupTargets.map(
      (snapshot) => normalizeCalendarTargetText(snapshot.eventSummary).length
    )
  );
  const mostSpecificTargets = namedLookupTargets.filter(
    (snapshot) => normalizeCalendarTargetText(snapshot.eventSummary).length === longestMatchLength
  );
  return (
    mostSpecificTargets.length === 1 &&
    mostSpecificTargets[0]?.eventId === input.operations[0]?.eventId
  );
}

function readCalendarUpdateActiveInstruction(
  events: readonly IntexAgentSessionEvent[],
  currentMessage: string
): Readonly<{ text: string; isProposalContinuation: boolean }> {
  const isProposalReference =
    CALENDAR_UPDATE_PRIOR_PROPOSAL_REFERENCE_PATTERN.test(
      normalizeCalendarTargetText(currentMessage)
    ) || isAffirmativeCalendarUpdateProposalContinuation(events, currentMessage);
  const isTargetClarificationContinuation = hasActiveCalendarUpdateTargetClarification(
    events,
    currentMessage
  );
  if (!isProposalReference && !isTargetClarificationContinuation) {
    return { text: currentMessage, isProposalContinuation: false };
  }
  for (const event of [...events].reverse()) {
    if (event.type !== 'user_message') continue;
    const text = event.payload['text'];
    if (typeof text === 'string' && text.trim() !== '') {
      return { text: `${text}\n${currentMessage}`, isProposalContinuation: true };
    }
  }
  return {
    text: currentMessage,
    isProposalContinuation:
      isTargetClarificationContinuation || readLatestAssistantText(events) !== undefined,
  };
}

function hasActiveCalendarUpdateTargetClarification(
  events: readonly IntexAgentSessionEvent[],
  currentMessage: string
): boolean {
  if (!CALENDAR_UPDATE_TARGET_SET_PATTERN.test(currentMessage)) return false;
  const active = findActiveClarificationEvent(events);
  if (active === undefined) return false;
  const candidates = active.event.payload['candidateIntents'];
  const missingFields = active.event.payload['missingFields'];
  return (
    active.event.payload['blockerReason'] === 'missing_required_details' &&
    Array.isArray(candidates) &&
    candidates.length === 1 &&
    candidates[0] === 'update_calendar_event' &&
    Array.isArray(missingFields) &&
    missingFields.some(
      (field) => typeof field === 'string' && field.trim().toLowerCase() === 'event'
    )
  );
}

function isGroundedCalendarUpdateChanges(
  changes: CalendarUpdatePlanningOperation['changes'],
  snapshot: CompleteCalendarUpdateLookupSnapshot | undefined,
  activeUserText: string,
  runtimeTimeZone: string,
  isProposalContinuation: boolean
): boolean {
  /* v8 ignore start -- upstream: the preceding optional-chain identity guard guarantees a defined snapshot before this helper is called @preserve */
  if (snapshot === undefined) return false;
  /* v8 ignore stop @preserve */
  if (
    changes.summary !== undefined &&
    !hasExplicitCalendarTextFieldChange(activeUserText, 'summary', changes.summary)
  ) {
    return false;
  }
  if (
    changes.description !== undefined &&
    !hasExplicitCalendarTextFieldChange(activeUserText, 'description', changes.description)
  ) {
    return false;
  }
  if (
    changes.location !== undefined &&
    !hasExplicitCalendarTextFieldChange(activeUserText, 'location', changes.location)
  ) {
    return false;
  }
  if (
    changes.attendeesToAdd !== undefined &&
    !hasExplicitCalendarAttendeeDirection(activeUserText, 'add')
  ) {
    return false;
  }
  if (
    changes.attendeesToRemove !== undefined &&
    !hasExplicitCalendarAttendeeDirection(activeUserText, 'remove')
  ) {
    return false;
  }

  const hasStart = changes.start !== undefined;
  const hasEnd = changes.end !== undefined;
  /* v8 ignore start -- schema: calendar update planning schema validation guarantees start and end are either both present or both absent @preserve */
  if (hasStart !== hasEnd) return false;
  /* v8 ignore stop @preserve */
  if (!hasStart) return true;
  if (!isProposalContinuation && !hasExplicitCalendarTemporalChange(activeUserText)) return false;

  const changesRecord = changes as Record<string, unknown>;
  const start = readCalendarEventDateTimeSnapshot(changesRecord, 'start');
  const end = readCalendarEventDateTimeSnapshot(changesRecord, 'end');
  if (start === undefined || end === undefined || !isOrderedCalendarRange(start, end)) {
    return false;
  }
  if (
    (start.timeZone ?? '') !== (end.timeZone ?? '') ||
    (start.dateTime !== undefined && !hasExplicitDateTimeOffset(start.dateTime)) ||
    (end.dateTime !== undefined && !hasExplicitDateTimeOffset(end.dateTime)) ||
    !doesDateTimeOffsetMatchTimeZone(start) ||
    !doesDateTimeOffsetMatchTimeZone(end) ||
    !isGroundedCalendarUpdateTimeZoneChange(
      start,
      snapshot.eventStart,
      activeUserText,
      runtimeTimeZone
    ) ||
    !isGroundedCalendarUpdateTimeZoneChange(end, snapshot.eventEnd, activeUserText, runtimeTimeZone)
  ) {
    return false;
  }

  if (hasExplicitCalendarDurationChange(activeUserText)) return true;
  const originalDuration = calendarRangeDuration(snapshot.eventStart, snapshot.eventEnd);
  const plannedDuration = calendarRangeDuration(start, end);
  return (
    originalDuration !== undefined &&
    plannedDuration?.kind === originalDuration.kind &&
    plannedDuration.milliseconds === originalDuration.milliseconds
  );
}

function hasExplicitCalendarTextFieldChange(
  value: string,
  field: 'summary' | 'description' | 'location',
  plannedValue: string | null
): boolean {
  const normalized = normalizeCalendarTargetText(value);
  const fieldSignal =
    field === 'summary'
      ? /\b(?:title|name|summary|tytul|nazw\w*)\b/u
      : field === 'description'
        ? /\b(?:description|details|opis\w*|szczegol\w*)\b/u
        : /\b(?:location|place|address|miejsce|lokalizacj\w*|adres\w*)\b/u;
  const actionSignal =
    field === 'summary'
      ? /\b(?:rename|retitle|name|change|set|update|nazwij\w*|zmien\w*|ustaw\w*|aktualizuj\w*)\b/u
      : /\b(?:add|change|set|update|clear|remove|delete|dodaj\w*|zmien\w*|ustaw\w*|aktualizuj\w*|wyczysc\w*|usun\w*)\b/u;
  if (!actionSignal.test(normalized)) return false;
  if (field === 'summary' && /\b(?:rename|retitle|nazwij\w*)\b/u.test(normalized)) {
    // Rename verbs already identify the mutable field.
  } else if (!fieldSignal.test(normalized)) {
    return false;
  }
  if (plannedValue === null) {
    return /\b(?:clear|remove|delete|wyczysc\w*|usun\w*)\b/u.test(normalized);
  }
  return normalized.includes(normalizeCalendarTargetText(plannedValue));
}

function hasExplicitCalendarTemporalChange(value: string): boolean {
  const normalized = normalizeCalendarTargetText(value);
  const hasUpdateAction = /\b(?:change|set|update|zmien\w*|ustaw\w*|aktualizuj\w*)\b/u.test(
    normalized
  );
  return (
    /\b(?:move|reschedul\w*|postpon\w*|push|shift|delay|advance|przenies\w*|przesun\w*|przeloz\w*|odloz\w*)\b/u.test(
      normalized
    ) ||
    (hasUpdateAction &&
      (containsCalendarDateSignal(value) || containsCalendarClockTimeSignal(value))) ||
    /\b(?:change|set|update|zmien\w*|ustaw\w*|aktualizuj\w*)\b.{0,32}\b(?:date|day|time|start|end|data|dzien|godzin\w*|poczatek|koniec|calodni\w*)\b/u.test(
      normalized
    ) ||
    /\b(?:make|set|change|ustaw\w*|zmien\w*)\b.{0,24}\b(?:all day|all-day|calodni\w*)\b/u.test(
      normalized
    )
  );
}

function isOrderedCalendarRange(
  start: CalendarEventDateTimeSnapshot,
  end: CalendarEventDateTimeSnapshot
): boolean {
  const range = calendarRangeDuration(start, end);
  return range !== undefined && range.milliseconds > 0;
}

function calendarRangeDuration(
  start: CalendarEventDateTimeSnapshot,
  end: CalendarEventDateTimeSnapshot
): Readonly<{ kind: 'date' | 'dateTime'; milliseconds: number }> | undefined {
  if (start.date !== undefined && end.date !== undefined) {
    const startInstant = Date.parse(`${start.date}T00:00:00.000Z`);
    const endInstant = Date.parse(`${end.date}T00:00:00.000Z`);
    /* v8 ignore start -- schema: lookup and planning schema validation guarantees both calendar dates parse to finite instants @preserve */
    return Number.isFinite(startInstant) && Number.isFinite(endInstant)
      ? { kind: 'date', milliseconds: endInstant - startInstant }
      : undefined;
    /* v8 ignore stop @preserve */
  }
  if (start.dateTime !== undefined && end.dateTime !== undefined) {
    const startInstant = Date.parse(start.dateTime);
    const endInstant = Date.parse(end.dateTime);
    /* v8 ignore start -- schema: lookup and planning schema validation guarantees both offset date-times parse to finite instants @preserve */
    return Number.isFinite(startInstant) && Number.isFinite(endInstant)
      ? { kind: 'dateTime', milliseconds: endInstant - startInstant }
      : undefined;
    /* v8 ignore stop @preserve */
  }
  return undefined;
}

function hasExplicitDateTimeOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/u.test(value);
}

function doesDateTimeOffsetMatchTimeZone(value: CalendarEventDateTimeSnapshot): boolean {
  if (value.dateTime === undefined || value.timeZone === undefined) return true;
  const explicitOffset = readIsoDateTimeOffsetMinutes(value.dateTime);
  const timeZoneOffset = readIanaTimeZoneOffsetMinutes(value.dateTime, value.timeZone);
  return (
    explicitOffset !== undefined &&
    timeZoneOffset !== undefined &&
    explicitOffset === timeZoneOffset
  );
}

function readIsoDateTimeOffsetMinutes(value: string): number | undefined {
  if (value.endsWith('Z')) return 0;
  const match = /([+-])(\d{2}):(\d{2})$/u.exec(value);
  /* v8 ignore start -- schema: planning schema validation plus the prior explicit-offset guard guarantees this regex and all captures match @preserve */
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return undefined;
  }
  /* v8 ignore stop @preserve */
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

function readIanaTimeZoneOffsetMinutes(dateTime: string, timeZone: string): number | undefined {
  const instant = new Date(dateTime);
  /* v8 ignore start -- schema: planning schema validation guarantees the supplied offset date-time is a valid instant @preserve */
  if (Number.isNaN(instant.getTime())) return undefined;
  /* v8 ignore stop @preserve */
  try {
    const offsetPart = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(instant)
      .find((part) => part.type === 'timeZoneName')?.value;
    /* v8 ignore start -- upstream: Intl longOffset with a schema-validated IANA zone always returns a timeZoneName part @preserve */
    const match = /^GMT([+-])(\d{2}):(\d{2})$/u.exec(offsetPart ?? '');
    /* v8 ignore stop @preserve */
    /* v8 ignore start -- upstream: Intl longOffset for a validated IANA zone guarantees the numeric GMT format and regex captures @preserve */
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
      return undefined;
    }
    /* v8 ignore stop @preserve */
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === '-' ? -minutes : minutes;
  } catch {
    return undefined;
  }
}

function isGroundedCalendarUpdateTimeZoneChange(
  planned: CalendarEventDateTimeSnapshot,
  original: CalendarEventDateTimeSnapshot,
  activeUserText: string,
  runtimeTimeZone: string
): boolean {
  if (planned.timeZone === original.timeZone) return true;
  if (
    planned.date !== undefined &&
    original.date !== undefined &&
    original.timeZone === undefined &&
    planned.timeZone === runtimeTimeZone
  ) {
    return true;
  }
  return (
    planned.timeZone !== undefined &&
    hasExactCalendarUpdateTimeZoneRequest(activeUserText, planned.timeZone)
  );
}

function hasExactCalendarUpdateTimeZoneRequest(value: string, timeZone: string): boolean {
  const normalizedValue = value.normalize('NFKC').toLocaleLowerCase('en-US');
  const normalizedTimeZone = timeZone.normalize('NFKC').toLocaleLowerCase('en-US');
  let startIndex = normalizedValue.indexOf(normalizedTimeZone);
  while (startIndex >= 0) {
    const before = normalizedValue[startIndex - 1];
    const after = normalizedValue[startIndex + normalizedTimeZone.length];
    if (
      !isTimeZoneIdentityCharacter(before) &&
      !isTimeZoneIdentityCharacter(after) &&
      !isNegatedCalendarUpdateTimeZoneRequest(normalizedValue, startIndex)
    ) {
      return true;
    }
    startIndex = normalizedValue.indexOf(normalizedTimeZone, startIndex + 1);
  }
  return false;
}

function isNegatedCalendarUpdateTimeZoneRequest(value: string, startIndex: number): boolean {
  const prefix = value.slice(0, startIndex);
  const clauseStart = Math.max(
    prefix.lastIndexOf('.'),
    prefix.lastIndexOf('!'),
    prefix.lastIndexOf('?'),
    prefix.lastIndexOf(';'),
    prefix.lastIndexOf(','),
    prefix.lastIndexOf('\n')
  );
  const clause = prefix.slice(clauseStart + 1);
  return /(?:\bdo\s+not\b|\bdon['’]?t\b|\bnot\b|\bwithout\b|\bavoid\b|\bnie\b|\bbez\b|\bunikaj\b)[^.!?;,\n]{0,80}$/u.test(
    clause
  );
}

function isTimeZoneIdentityCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}_/+-]/u.test(value);
}

function hasExplicitCalendarDurationChange(value: string): boolean {
  const normalized = normalizeCalendarTargetText(value);
  if (
    /\b(?:preserv\w*|keep|same|unchanged|zachow\w*|bez zmian|nie zmien\w*)\b.{0,40}\b(?:duration|length|all day|all-day|czas trwania|dlugosc|calodni\w*)\b/u.test(
      normalized
    ) ||
    /\b(?:duration|length|all day|all-day|czas trwania|dlugosc|calodni\w*)\b.{0,24}\b(?:same|unchanged|bez zmian)\b/u.test(
      normalized
    )
  ) {
    return false;
  }
  return (
    (containsCalendarEndTimeSignal(value) && !containsCalendarTimeWithdrawalSignal(value)) ||
    /\b(?:from|od)\b.{1,80}\b(?:to|until|do)\b/u.test(normalized) ||
    /\b(?:wydluz\w*|skroc\w*|extend\w*|shorten\w*|resize\w*)\b/u.test(normalized) ||
    /\b(?:make|set|change|ustaw\w*|zmien\w*)\b.{0,24}\b(?:all day|all-day|calodni\w*)\b/u.test(
      normalized
    ) ||
    /\b(?:for|lasting|przez|na okres|czas trwania(?: to)?|duration(?: of)?)\s+\d+\s*(?:minut\w*|minutes?|godzin\w*|hours?|dni|dzien|days?)\b/u.test(
      normalized
    ) ||
    /\b(?:make|set|change|ustaw\w*|zmien\w*)\b.{0,24}\b\d+\s*(?:minut\w*|minutes?|godzin\w*|hours?|dni|dzien|days?)\b/u.test(
      normalized
    )
  );
}

function hasExplicitCalendarAttendeeDirection(value: string, direction: 'add' | 'remove'): boolean {
  const normalized = normalizeCalendarTargetText(value);
  const signal =
    direction === 'add'
      ? /\b(?:add|invite|include|dodaj\w*|zapros\w*|dolacz\w*)\b/u
      : /\b(?:remove|uninvite|exclude|usun\w*|wypros\w*|odwolaj zaproszenie)\b/u;
  const negated =
    direction === 'add'
      ? /\b(?:do not|dont|nie)\s+(?:\w+\s+){0,2}(?:add|invite|include|dodaj\w*|zapros\w*|dolacz\w*)\b/u
      : /\b(?:do not|dont|nie)\s+(?:\w+\s+){0,2}(?:remove|uninvite|exclude|usun\w*|wypros\w*)\b/u;
  return signal.test(normalized) && !negated.test(normalized);
}

function readExplicitCalendarUpdateTargetCount(
  value: string
): Readonly<{ valid: boolean; count?: number }> {
  const countWords = new Map<string, number>([
    ['two', 2],
    ['both', 2],
    ['dwa', 2],
    ['dwie', 2],
    ['oba', 2],
    ['obie', 2],
    ['three', 3],
    ['trzy', 3],
    ['four', 4],
    ['cztery', 4],
    ['five', 5],
    ['piec', 5],
    ['six', 6],
    ['szesc', 6],
    ['seven', 7],
    ['siedem', 7],
    ['eight', 8],
    ['osiem', 8],
    ['nine', 9],
    ['dziewiec', 9],
    ['ten', 10],
    ['dziesiec', 10],
    ['eleven', 11],
    ['jedenascie', 11],
    ['twelve', 12],
    ['dwanascie', 12],
    ['thirteen', 13],
    ['trzynascie', 13],
    ['fourteen', 14],
    ['czternascie', 14],
    ['fifteen', 15],
    ['pietnascie', 15],
    ['sixteen', 16],
    ['szesnascie', 16],
    ['seventeen', 17],
    ['siedemnascie', 17],
    ['eighteen', 18],
    ['osiemnascie', 18],
    ['nineteen', 19],
    ['dziewietnascie', 19],
    ['twenty', 20],
    ['dwadziescia', 20],
  ]);
  const words = calendarTargetWords(
    value
      .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/gu, ' ')
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/gu, ' ')
  );
  const counts = new Set<number>();
  words.forEach((word, index) => {
    const numeric = /^\d{1,2}$/u.test(word) ? Number(word) : countWords.get(word);
    if (numeric === undefined || numeric < 2 || numeric > 20) return;
    if (['both', 'oba', 'obie'].includes(word)) {
      counts.add(numeric);
      return;
    }
    const isNumeric = /^\d{1,2}$/u.test(word);
    if (isNumeric && isCalendarDateContextWord(words[index - 1])) return;
    if (!isNumeric) {
      const nearbyTarget = words.slice(index + 1, index + 6).find(isCalendarEventTargetWord);
      if (nearbyTarget !== undefined) counts.add(numeric);
      return;
    }
    const nextWord = words[index + 1];
    const targetWord =
      nextWord === 'calendar' || nextWord?.startsWith('kalendar') === true
        ? words[index + 2]
        : nextWord;
    if (targetWord !== undefined && isCalendarEventTargetWord(targetWord)) {
      counts.add(numeric);
    }
  });
  if (counts.size > 1) return { valid: false };
  const count = [...counts][0];
  return count === undefined ? { valid: true } : { valid: true, count };
}

function isCalendarEventTargetWord(value: string): boolean {
  return (
    value.startsWith('event') ||
    value.startsWith('meeting') ||
    value.startsWith('appointment') ||
    value.startsWith('wydarzen') ||
    value.startsWith('spotkan')
  );
}

function isCalendarDateContextWord(value: string | undefined): boolean {
  return (
    value !== undefined &&
    /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|stycz\w*|lut\w*|marzec|marca|kwiec\w*|maj\w*|czerw\w*|lip\w*|sierp\w*|wrzes\w*|pazdz\w*|listopad\w*|grud\w*)$/u.test(
      value
    )
  );
}

function sameOrderedEventIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((eventId, index) => eventId === right[index]);
}

function sameEventIdSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((id) => right.includes(id))
  );
}

function readExplicitCalendarUpdateSubsetIds(
  message: string,
  count: number,
  lookupIds: readonly string[]
): string[] | undefined {
  const normalized = normalizeCalendarTargetText(message);
  if (/\b(?:first|pierwsz\w*)\b/u.test(normalized)) return lookupIds.slice(0, count);
  if (/\b(?:last|ostatn\w*)\b/u.test(normalized)) return lookupIds.slice(-count);
  return undefined;
}

function readPriorCalendarUpdateTargetIds(
  input: Readonly<{
    events: readonly IntexAgentSessionEvent[];
    queryExecution: IntexAgentToolExecution;
    currentMessage: string;
    currentLookupSnapshots: readonly CompleteCalendarUpdateLookupSnapshot[];
    explicitCount: number | undefined;
  }>
): string[] | null | undefined {
  const priorEvents = readLatestCompletePriorCalendarLookupIdentities(input.events);
  if (priorEvents === undefined || priorEvents.length < 2) return undefined;

  const hasStrongSetReference = hasStrongCalendarUpdateSetReference(
    input.currentMessage,
    input.events
  );
  const hasGenericSetReference = CALENDAR_UPDATE_TARGET_SET_PATTERN.test(input.currentMessage);
  if (!hasStrongSetReference && !hasGenericSetReference) return undefined;
  const currentLookupIds = new Set(
    input.currentLookupSnapshots.map((snapshot) => snapshot.eventId)
  );

  const query = readNonEmptyString(input.queryExecution.args, 'query') ?? '';
  const currentLookupWords = new Set(
    input.currentLookupSnapshots.flatMap((snapshot) => calendarTargetWords(snapshot.eventSummary))
  );
  const candidates = new Set(
    calendarTargetWords(`${query} ${input.currentMessage}`).filter(
      (word) =>
        word.length >= 4 &&
        currentLookupWords.has(word) &&
        !CALENDAR_TARGET_SCOPE_STOP_WORDS.has(word)
    )
  );
  let selectedIds: string[] | undefined;
  let selectedCount = 0;
  for (const candidate of candidates) {
    const matchingIds = priorEvents
      .filter((event) => calendarTargetWords(event.eventSummary).includes(candidate))
      .map((event) => event.eventId);
    if (
      matchingIds.length < 2 ||
      matchingIds.length === priorEvents.length ||
      matchingIds.length < selectedCount
    ) {
      continue;
    }
    if (matchingIds.length > selectedCount) {
      selectedIds = matchingIds;
      selectedCount = matchingIds.length;
      continue;
    }
    if (selectedIds !== undefined && !sameOrderedEventIds(selectedIds, matchingIds)) return null;
  }
  if (selectedIds !== undefined) {
    if (!hasStrongSetReference && !selectedIds.some((eventId) => currentLookupIds.has(eventId))) {
      return undefined;
    }
    return selectedIds;
  }

  const latestAssistantText = readLatestAssistantText(input.events);
  if (latestAssistantText === undefined) return undefined;
  const normalizedAssistantText = normalizeCalendarTargetText(latestAssistantText);
  const referencedIds = priorEvents
    .filter((event) =>
      normalizedAssistantText.includes(normalizeCalendarTargetText(event.eventSummary))
    )
    .map((event) => event.eventId);
  if (referencedIds.length < 2) return undefined;
  if (!hasStrongSetReference && !referencedIds.some((eventId) => currentLookupIds.has(eventId))) {
    return undefined;
  }
  if (input.explicitCount !== undefined && referencedIds.length !== input.explicitCount)
    return null;
  return referencedIds;
}

function hasStrongCalendarUpdateSetReference(
  message: string,
  events: readonly IntexAgentSessionEvent[] = []
): boolean {
  const normalizedMessage = normalizeCalendarTargetText(message);
  return (
    /\b(?:those|these|them|te|tych|nimi|je|im)\b/u.test(normalizedMessage) ||
    CALENDAR_UPDATE_PRIOR_PROPOSAL_REFERENCE_PATTERN.test(normalizedMessage) ||
    isAffirmativeCalendarUpdateProposalContinuation(events, message)
  );
}

function isAffirmativeCalendarUpdateProposalContinuation(
  events: readonly IntexAgentSessionEvent[],
  message: string
): boolean {
  if (
    !CALENDAR_UPDATE_PROPOSAL_AFFIRMATIVE_PATTERN.test(
      normalizeCalendarTargetText(message)
    )
  ) {
    return false;
  }

  let latestAssistantText: string | undefined;
  for (const event of [...events].reverse()) {
    if (event.type === 'user_message') return false;
    if (event.type !== 'assistant_message') continue;
    const text = event.payload['text'];
    if (typeof text !== 'string' || text.trim() === '') return false;
    latestAssistantText = text;
    break;
  }
  if (latestAssistantText === undefined) return false;
  const normalizedAssistantText = normalizeCalendarTargetText(latestAssistantText);
  if (!CALENDAR_UPDATE_PROPOSAL_CTA_PATTERN.test(normalizedAssistantText)) return false;

  const priorEvents = readLatestCompletePriorCalendarLookupIdentities(events);
  if (priorEvents === undefined) return false;
  return (
    priorEvents.filter((event) =>
      normalizedAssistantText.includes(normalizeCalendarTargetText(event.eventSummary))
    ).length >= 2
  );
}

function readLatestCompletePriorCalendarLookupIdentities(
  events: readonly IntexAgentSessionEvent[]
): readonly Readonly<{ eventId: string; eventSummary: string }>[] | undefined {
  for (const event of [...events].reverse()) {
    if (
      event.type !== 'tool_call_completed' ||
      event.payload['toolName'] !== 'query_calendar_events'
    ) {
      continue;
    }
    const result = event.payload['result'];
    if (result === null || typeof result !== 'object' || Array.isArray(result)) continue;
    const record = result as Record<string, unknown>;
    const rawEvents = record['events'];
    if (
      record['status'] !== 'completed' ||
      record['mode'] !== 'list' ||
      record['truncated'] !== false ||
      !Array.isArray(rawEvents) ||
      record['count'] !== rawEvents.length
    ) {
      continue;
    }
    const identities = rawEvents.map((rawEvent) => {
      if (rawEvent === null || typeof rawEvent !== 'object' || Array.isArray(rawEvent))
        return undefined;
      const eventRecord = rawEvent as Record<string, unknown>;
      const eventId =
        readNonEmptyString(eventRecord, 'id') ?? readNonEmptyString(eventRecord, 'eventId');
      const eventSummary = readNonEmptyString(eventRecord, 'summary');
      return eventId === undefined || eventSummary === undefined
        ? undefined
        : { eventId, eventSummary };
    });
    if (
      identities.length === 0 ||
      identities.some((identity) => identity === undefined) ||
      new Set(identities.map((identity) => identity?.eventId)).size !== identities.length
    ) {
      return undefined;
    }
    return identities as readonly Readonly<{ eventId: string; eventSummary: string }>[];
  }
  return undefined;
}

function readLatestAssistantText(events: readonly IntexAgentSessionEvent[]): string | undefined {
  for (const event of [...events].reverse()) {
    if (event.type !== 'assistant_message') continue;
    const text = event.payload['text'];
    if (typeof text === 'string' && text.trim() !== '') return text;
  }
  return undefined;
}

const CALENDAR_TARGET_SCOPE_STOP_WORDS = new Set([
  'event',
  'events',
  'wydarzenia',
  'wydarzen',
  'spotkania',
  'spotkan',
  'move',
  'moved',
  'update',
  'change',
  'przenies',
  'przeniesc',
  'przesun',
  'zmien',
  'calendar',
  'kalendarzu',
  'dzien',
  'daily',
  'starting',
  'zaczynajac',
  'related',
  'zwiazane',
  'from',
  'with',
  'those',
  'these',
  'wszystkie',
  'cztery',
  'four',
]);

function calendarTargetWords(value: string): string[] {
  return normalizeCalendarTargetText(value).match(/[a-z0-9]+/gu) ?? [];
}

function normalizeCalendarTargetText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[’']/gu, '');
}

async function appendDeterministicCalendarUpdatePreview(
  input: Readonly<{
    intent: IntexAgentIntentClassification | IntexAgentIntentDecision;
    toolExecutions: IntexAgentToolExecution[];
    tools: readonly ToolDefinition[];
    attendeesToAdd: string[] | undefined;
    activeUserTexts: string[] | undefined;
  }>
): Promise<boolean> {
  if (
    input.attendeesToAdd === undefined ||
    input.activeUserTexts?.some((text) =>
      CALENDAR_NON_ATTENDEE_UPDATE_SIGNAL_PATTERN.test(text)
    ) === true ||
    !isSingleCalendarUpdateIntent(input.intent) ||
    input.toolExecutions.length !== 1
  ) {
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

function readCompleteCalendarUpdateLookupSnapshots(
  queryExecution: IntexAgentToolExecution
):
  | Required<
      Pick<
        UpdateCalendarEventToolArgs,
        'eventId' | 'eventSummary' | 'calendarId' | 'expectedEtag' | 'eventStart' | 'eventEnd'
      >
    >[]
  | undefined {
  if (
    queryExecution.error !== undefined ||
    queryExecution.args['mode'] !== 'list' ||
    queryExecution.result?.['status'] !== 'completed' ||
    queryExecution.result['mode'] !== 'list' ||
    queryExecution.result['truncated'] !== false
  ) {
    return undefined;
  }
  const events = queryExecution.result['events'];
  if (
    !Array.isArray(events) ||
    events.length === 0 ||
    queryExecution.result['count'] !== events.length
  ) {
    return undefined;
  }
  const snapshots = events.map((event) => {
    if (event === null || typeof event !== 'object' || Array.isArray(event)) return undefined;
    const record = event as Record<string, unknown>;
    const eventId = readNonEmptyString(record, 'id') ?? readNonEmptyString(record, 'eventId');
    const eventSummary = readNonEmptyString(record, 'summary');
    if (eventId === undefined || eventSummary === undefined) return undefined;
    return readCalendarUpdateLookupSnapshot(queryExecution, { eventId, eventSummary });
  });
  if (snapshots.some((snapshot) => snapshot === undefined)) return undefined;
  return snapshots as Required<
    Pick<
      UpdateCalendarEventToolArgs,
      'eventId' | 'eventSummary' | 'calendarId' | 'expectedEtag' | 'eventStart' | 'eventEnd'
    >
  >[];
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

function calendarUpdateBatchPreviewTooLargeResult(
  replyLanguage: IntexAgentReplyLanguage
): IntexAgentRunnerResult {
  const clarification = CALENDAR_UPDATE_BATCH_PREVIEW_TOO_LARGE_REPLIES[replyLanguage];
  return {
    outcome: 'needs_clarification',
    reply: clarification,
    clarification,
    blockerReason: 'missing_required_details',
    candidateIntents: ['update_calendar_event'],
    suggestedNextStep: CALENDAR_UPDATE_BATCH_PREVIEW_TOO_LARGE_NEXT_STEPS[replyLanguage],
  };
}

function buildCalendarUpdateConfirmationArgs(
  toolExecutions: IntexAgentToolExecution[],
  updateExecution: IntexAgentToolExecution,
  authoritativeAttendeeEmails: string[] | undefined,
  explicitAttendeeEmails: string[] | undefined
): Record<string, unknown> | undefined {
  const updateIndex = toolExecutions.indexOf(updateExecution);
  const precedingExecutions = toolExecutions.slice(0, updateIndex);
  const queryExecution = precedingExecutions
    .reverse()
    .find((execution) => execution.toolName === 'query_calendar_events');
  if (queryExecution === undefined) return undefined;

  const eventId = readNonEmptyString(updateExecution.args, 'eventId');
  const eventSummary = readNonEmptyString(updateExecution.args, 'eventSummary');
  /* v8 ignore start -- schema: a recorded update_calendar_event execution cannot omit its validated event identity @preserve */
  if (eventId === undefined || eventSummary === undefined) return undefined;
  /* v8 ignore stop @preserve */
  const snapshot = readCalendarUpdateLookupSnapshot(queryExecution, { eventId, eventSummary });
  if (snapshot === undefined) return undefined;

  const requestedCalendarId = readNonEmptyString(updateExecution.args, 'calendarId');
  if (requestedCalendarId !== undefined && requestedCalendarId !== snapshot.calendarId) {
    return undefined;
  }

  const rawChanges = updateExecution.args['changes'];
  if (rawChanges !== undefined) {
    /* v8 ignore start -- schema: validated update_calendar_event changes cannot be null, an array, or a primitive @preserve */
    if (rawChanges === null || typeof rawChanges !== 'object' || Array.isArray(rawChanges)) {
      return undefined;
    }
    /* v8 ignore stop @preserve */
    const changes = rawChanges as Record<string, unknown>;
    const attendeeChanges = [changes['attendeesToAdd'], changes['attendeesToRemove']].filter(
      (value) => value !== undefined
    );
    if (attendeeChanges.length > 0) {
      const allowedAttendeeEmails = [
        ...(explicitAttendeeEmails ?? []),
        ...(authoritativeAttendeeEmails ?? []),
      ];
      if (allowedAttendeeEmails.length === 0) return undefined;
      const allowedEmailIdentities = new Set(allowedAttendeeEmails.map(normalizeAttendeeEmail));
      for (const attendeeChange of attendeeChanges) {
        /* v8 ignore start -- schema: validated attendee changes cannot be a non-array value @preserve */
        if (!Array.isArray(attendeeChange)) return undefined;
        /* v8 ignore stop @preserve */
        const requestedEmails = attendeeChange as string[];
        if (
          !requestedEmails.every((email) =>
            allowedEmailIdentities.has(normalizeAttendeeEmail(email))
          )
        ) {
          return undefined;
        }
      }
    }
    return {
      ...updateExecution.args,
      changes,
      ...snapshot,
    };
  }
  /* v8 ignore start -- schema: the hidden legacy attendee update cannot be synthesized without authoritative attendee emails @preserve */
  if (authoritativeAttendeeEmails === undefined) return undefined;
  /* v8 ignore stop @preserve */

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
    !activeUserTexts.some((text) => normalizeCalendarLookupIdentity(text).includes(normalizedQuery))
  ) {
    return undefined;
  }
  return { ...snapshot, attendeesToAdd };
}

function normalizeCalendarLookupIdentity(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
}

function readCalendarUpdateLookupSnapshot(
  queryExecution: IntexAgentToolExecution,
  target?: Readonly<{ eventId: string; eventSummary: string }>
):
  | Required<
      Pick<
        UpdateCalendarEventToolArgs,
        'eventId' | 'eventSummary' | 'calendarId' | 'expectedEtag' | 'eventStart' | 'eventEnd'
      >
    >
  | undefined {
  if (
    queryExecution.error !== undefined ||
    queryExecution.args['mode'] !== 'list' ||
    queryExecution.result?.['status'] !== 'completed' ||
    queryExecution.result['mode'] !== 'list' ||
    queryExecution.result['truncated'] !== false
  ) {
    return undefined;
  }

  const eventsValue: unknown = queryExecution.result['events'];
  const events: unknown[] = Array.isArray(eventsValue) ? (eventsValue as unknown[]) : [];
  if (queryExecution.result['count'] !== events.length) return undefined;
  if (target === undefined && events.length !== 1) return undefined;
  const matchingEvents =
    target === undefined
      ? events
      : events.filter((candidate) => {
          /* v8 ignore start -- upstream: typed calendar query results cannot contain a non-object event candidate @preserve */
          if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
            return false;
          }
          /* v8 ignore stop @preserve */
          const record = candidate as Record<string, unknown>;
          return (
            (readNonEmptyString(record, 'id') ?? readNonEmptyString(record, 'eventId')) ===
              target.eventId && readNonEmptyString(record, 'summary') === target.eventSummary
          );
        });
  if (matchingEvents.length !== 1) return undefined;
  const event: unknown = matchingEvents[0];
  /* v8 ignore start -- upstream: the typed Calendar Agent response cannot emit a non-object calendar event @preserve */
  if (event === null || typeof event !== 'object' || Array.isArray(event)) return undefined;
  /* v8 ignore stop @preserve */
  const eventRecord = event as Record<string, unknown>;
  const eventId =
    readNonEmptyString(eventRecord, 'id') ?? readNonEmptyString(eventRecord, 'eventId');
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

function readNonEmptyString(record: Record<string, unknown>, key: string): string | undefined {
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
            matrixCorpusContext: input.matrixCorpusLlm.nextContext('response_schema_repair'),
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

function createConfirmationPreviewExecutor(
  executor: IntexAgentToolExecutor
): IntexAgentToolExecutor {
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
  intent: IntexAgentIntentClassification | IntexAgentIntentDecision,
  useStructuredCalendarUpdatePlanning = false
): IntexAgentToolName[] {
  if (intent.kind !== 'tool') return [];
  if (!intent.allowedToolNames.includes('update_calendar_event')) {
    return intent.allowedToolNames;
  }
  if (useStructuredCalendarUpdatePlanning) return ['query_calendar_events'];
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
  authoritativeCalendarAttendeeEmails?: string[],
  todayAndTomorrowCalendarQueryScope?: TodayAndTomorrowCalendarQueryScope,
  calendarUpdateReferentialQueryScope?: CalendarUpdateReferentialQueryScope
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
        ...(selection?.metadata !== undefined ? { selectionMetadata: selection.metadata } : {}),
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
        ...(selection?.metadata !== undefined ? { selectionMetadata: selection.metadata } : {}),
      });
      throw error;
    }
  }

  return {
    async createNote(args: CreateNoteToolArgs): Promise<string> {
      return await track(
        'create_note',
        toRecord(args),
        async () => await executor.createNote(args)
      );
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
          : args.changes === undefined
            ? { ...args, attendeesToAdd: authoritativeCalendarAttendeeEmails }
            : args;
      return await track(
        'update_calendar_event',
        toRecord(normalizedArgs),
        async () => await executor.updateCalendarEvent(normalizedArgs)
      );
    },
    async queryCalendarEvents(args: QueryCalendarEventsToolArgs): Promise<string> {
      const normalizedArgs =
        todayAndTomorrowCalendarQueryScope !== undefined
          ? {
              ...args,
              mode: 'list' as const,
              timeMin: todayAndTomorrowCalendarQueryScope.today.timeMin,
              timeMax: todayAndTomorrowCalendarQueryScope.tomorrow.timeMax,
              maxResults: TODAY_AND_TOMORROW_CALENDAR_QUERY_MAX_RESULTS,
            }
          : calendarUpdateReferentialQueryScope !== undefined
            ? {
                mode: 'list' as const,
                timeMin: calendarUpdateReferentialQueryScope.timeMin,
                timeMax: calendarUpdateReferentialQueryScope.timeMax,
              }
            : args;
      return await track(
        'query_calendar_events',
        toRecord(normalizedArgs),
        async () => await executor.queryCalendarEvents(normalizedArgs)
      );
    },
    async createResearch(args: CreateResearchToolArgs): Promise<string> {
      return await track(
        'create_research',
        toRecord(args),
        async () => await executor.createResearch(args)
      );
    },
    async createLink(args: CreateLinkToolArgs): Promise<string> {
      return await track(
        'create_link',
        toRecord(args),
        async () => await executor.createLink(args)
      );
    },
    async createCodeTask(args: CreateCodeTaskToolArgs): Promise<string> {
      return await track(
        'create_code_task',
        toRecord(args),
        async () => await executor.createCodeTask(args)
      );
    },
    async saveExternal(args: SaveExternalToolArgs): Promise<string> {
      return await track(
        'save_external',
        toRecord(args),
        async () => await executor.saveExternal(args)
      );
    },
    async getUserPreferences(): Promise<string> {
      return await track(
        'get_user_preferences',
        {},
        async () => await executor.getUserPreferences()
      );
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

function resolveCurrentPreferenceVersion(
  userPreferences: string | null | undefined
): number | undefined {
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
  if (keys.length !== 2 || !keys.includes('version') || !keys.includes('userPreferences')) {
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

function buildCalendarUpdateOperationsConfirmationReply(
  operations: readonly IntexAgentConfirmedOperation[],
  replyLanguage: IntexAgentReplyLanguage,
  runtimeTimeZone: string
): string | undefined {
  const lines = [
    replyLanguage === 'pl'
      ? `Czy wykonać ${String(operations.length)} zmiany wydarzeń w kalendarzu?`
      : `Apply ${String(operations.length)} calendar event updates?`,
  ];
  for (const [index, operation] of operations.entries()) {
    /* v8 ignore start -- schema: staged calendar update operations cannot omit their validated event summary @preserve */
    const summary = formatCalendarUpdateBatchEventSummary(
      readRawString(operation.toolArgs, 'eventSummary') ?? '(untitled)',
      runtimeTimeZone,
      replyLanguage
    );
    /* v8 ignore stop @preserve */
    lines.push('', `${String(index + 1)}. ${summary}`);
    const changes = readCalendarUpdateChanges(operation.toolArgs);
    /* v8 ignore start -- schema: staged calendar update operations cannot omit validated changes @preserve */
    if (changes === undefined) return undefined;
    /* v8 ignore stop @preserve */
    const currentStart = formatCalendarEventDateTimeSnapshot(
      operation.toolArgs['eventStart'],
      runtimeTimeZone,
      replyLanguage
    );
    /* v8 ignore start -- schema: staged calendar update operations always include a validated lookup start snapshot @preserve */
    if (currentStart === undefined) return undefined;
    /* v8 ignore stop @preserve */
    const newStart = formatCalendarEventDateTimeSnapshot(
      changes['start'],
      runtimeTimeZone,
      replyLanguage
    );
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.start[replyLanguage],
      formatCalendarUpdateOccurrenceTransition(currentStart, newStart)
    );
    const newEnd = formatCalendarEventDateTimeSnapshot(
      changes['end'],
      runtimeTimeZone,
      replyLanguage
    );
    if (newEnd !== undefined) {
      const currentEnd = formatCalendarEventDateTimeSnapshot(
        operation.toolArgs['eventEnd'],
        runtimeTimeZone,
        replyLanguage
      );
      /* v8 ignore start -- schema: staged calendar date updates always include a validated lookup end snapshot @preserve */
      if (currentEnd === undefined) return undefined;
      /* v8 ignore stop @preserve */
      appendConfirmationLine(
        lines,
        CONFIRMATION_LABELS.end[replyLanguage],
        formatCalendarUpdateOccurrenceTransition(currentEnd, newEnd)
      );
    }
    appendConfirmationLine(
      lines,
      replyLanguage === 'pl' ? 'Nowy tytuł' : 'New title',
      formatCalendarUpdateConfirmationScalar(readRawString(changes, 'summary'))
    );
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.description[replyLanguage],
      formatCalendarUpdateNullableField(changes, 'description', replyLanguage)
    );
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.location[replyLanguage],
      formatCalendarUpdateNullableField(changes, 'location', replyLanguage)
    );
    appendConfirmationListLine(
      lines,
      replyLanguage === 'pl' ? 'Uczestnicy do dodania' : 'Attendees to add',
      readStringArray(changes, 'attendeesToAdd')
    );
    appendConfirmationListLine(
      lines,
      replyLanguage === 'pl' ? 'Uczestnicy do usunięcia' : 'Attendees to remove',
      readStringArray(changes, 'attendeesToRemove')
    );
  }
  lines.push('', CALENDAR_UPDATE_PRESERVATION_NOTICE[replyLanguage]);
  const reply = lines.join('\n');
  return reply.length <= WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH ? reply : undefined;
}

function formatCalendarUpdateOccurrenceTransition(
  currentValue: string,
  newValue: string | undefined
): string {
  return newValue === undefined ? currentValue : `${currentValue} → ${newValue}`;
}

function formatCalendarUpdateBatchEventSummary(
  summary: string,
  runtimeTimeZone: string,
  replyLanguage: IntexAgentReplyLanguage
): string {
  const singleLineSummary = summary
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (singleLineSummary === '') return '(untitled)';
  const limitedSummary = limitConfirmationField(
    formatReplyDateRecords(singleLineSummary, runtimeTimeZone, replyLanguage),
    CALENDAR_UPDATE_BATCH_EVENT_SUMMARY_MAX_LENGTH
  );
  /* v8 ignore start -- ts-type: the nullish coalescing fallback cannot execute because the defined string input above always returns a defined limited string @preserve */
  return limitedSummary ?? '(untitled)';
  /* v8 ignore stop @preserve */
}

function readCalendarUpdateChanges(
  args: Record<string, unknown>
): Record<string, unknown> | undefined {
  const value = args['changes'];
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function formatCalendarUpdateNullableField(
  changes: Record<string, unknown>,
  field: 'description' | 'location',
  replyLanguage: IntexAgentReplyLanguage
): string | undefined {
  const value = changes[field];
  if (value === null)
    return replyLanguage === 'pl' ? '(usuń obecną wartość)' : '(clear current value)';
  if (typeof value !== 'string') return undefined;
  return value === ''
    ? replyLanguage === 'pl'
      ? '(pusta wartość)'
      : '(empty value)'
    : formatCalendarUpdateConfirmationScalar(value);
}

function formatCalendarUpdateConfirmationScalar(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let formatted = '';
  for (const character of value) {
    if (character === '\\') {
      formatted += '\\\\';
      continue;
    }
    if (character === '\n') {
      formatted += '\\n';
      continue;
    }
    if (character === '\r') {
      formatted += '\\r';
      continue;
    }
    if (character === '\t') {
      formatted += '\\t';
      continue;
    }
    if (/^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]$/u.test(character)) {
      const codePoint = character.codePointAt(0) as number;
      formatted += `\\u{${codePoint.toString(16).toUpperCase()}}`;
      continue;
    }
    formatted += character;
  }
  return formatted;
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
    if (title !== undefined)
      lines.push('', `${CONFIRMATION_LABELS.title[replyLanguage]}: ${title}`);
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
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.title[replyLanguage],
      readRawString(args, 'summary')
    );
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
    const changes = readCalendarUpdateChanges(args);
    const eventSummary = readRawString(args, 'eventSummary');
    const lines = [
      changes === undefined
        ? CONFIRMATION_INTROS.update_calendar_event[replyLanguage]
        : CALENDAR_UPDATE_CONFIRMATION_INTRO[replyLanguage],
    ];
    /* v8 ignore start -- schema: after validation an update_calendar_event confirmation cannot omit its required non-empty eventSummary @preserve */
    const formattedEventSummary =
      eventSummary === undefined
        ? undefined
        : formatCalendarUpdateBatchEventSummary(eventSummary, runtimeTimeZone, replyLanguage);
    /* v8 ignore stop @preserve */
    appendConfirmationLine(lines, CONFIRMATION_LABELS.title[replyLanguage], formattedEventSummary);
    if (changes === undefined) {
      appendConfirmationLine(
        lines,
        CONFIRMATION_LABELS.start[replyLanguage],
        formatCalendarEventDateTimeSnapshot(args['eventStart'], runtimeTimeZone, replyLanguage)
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
    } else {
      appendConfirmationLine(
        lines,
        replyLanguage === 'pl' ? 'Nowy tytuł' : 'New title',
        formatCalendarUpdateConfirmationScalar(readRawString(changes, 'summary'))
      );
      appendConfirmationLine(
        lines,
        replyLanguage === 'pl' ? 'Początek po zmianie' : 'New start',
        formatCalendarEventDateTimeSnapshot(changes['start'], runtimeTimeZone, replyLanguage)
      );
      appendConfirmationLine(
        lines,
        replyLanguage === 'pl' ? 'Koniec po zmianie' : 'New end',
        formatCalendarEventDateTimeSnapshot(changes['end'], runtimeTimeZone, replyLanguage)
      );
      appendConfirmationLine(
        lines,
        CONFIRMATION_LABELS.description[replyLanguage],
        formatCalendarUpdateNullableField(changes, 'description', replyLanguage)
      );
      appendConfirmationLine(
        lines,
        CONFIRMATION_LABELS.location[replyLanguage],
        formatCalendarUpdateNullableField(changes, 'location', replyLanguage)
      );
      appendConfirmationListLine(
        lines,
        replyLanguage === 'pl' ? 'Uczestnicy do dodania' : 'Attendees to add',
        readStringArray(changes, 'attendeesToAdd')
      );
      appendConfirmationListLine(
        lines,
        replyLanguage === 'pl' ? 'Uczestnicy do usunięcia' : 'Attendees to remove',
        readStringArray(changes, 'attendeesToRemove')
      );
    }
    lines.push(CALENDAR_UPDATE_PRESERVATION_NOTICE[replyLanguage]);
    return lines.join('\n');
  }

  if (toolName === 'create_research') {
    const lines = [CONFIRMATION_INTROS.create_research[replyLanguage]];
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.title[replyLanguage],
      readRawString(args, 'title')
    );
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.prompt[replyLanguage],
      readRawString(args, 'prompt')
    );
    return lines.join('\n');
  }

  if (toolName === 'create_link') {
    const lines = [
      CONFIRMATION_INTROS.create_link[replyLanguage],
      LINK_CONFIRMATION_ACTION_HINT[replyLanguage],
      '',
    ];
    appendConfirmationLine(lines, 'URL', readRawString(args, 'url'));
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.title[replyLanguage],
      readRawString(args, 'title')
    );
    return lines.join('\n');
  }

  if (toolName === 'create_code_task') {
    const lines = [CONFIRMATION_INTROS.create_code_task[replyLanguage]];
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.prompt[replyLanguage],
      readRawString(args, 'prompt')
    );
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.mode[replyLanguage],
      readRawString(args, 'taskMode')
    );
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.worker[replyLanguage],
      readRawString(args, 'workerType')
    );
    appendConfirmationLine(lines, 'Linear', readRawString(args, 'linearIssueId'));
    return lines.join('\n');
  }

  if (toolName === 'save_external') {
    const lines = [CONFIRMATION_INTROS.save_external[replyLanguage]];
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.content[replyLanguage],
      readRawString(args, 'message')
    );
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.source[replyLanguage],
      readRawString(args, 'sourceUrl')
    );
    return lines.join('\n');
  }

  if (toolName === 'add_user_preference') {
    const lines = [CONFIRMATION_INTROS.add_user_preference[replyLanguage]];
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.newEntry[replyLanguage],
      readRawString(args, 'text')
    );
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
    appendConfirmationLine(
      lines,
      CONFIRMATION_LABELS.after[replyLanguage],
      readRawString(args, 'text')
    );
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

function limitConfirmationReply(reply: string, replyLanguage: IntexAgentReplyLanguage): string {
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

function findPreferenceText(
  userPreferences: string | null,
  itemId: string | undefined
): string | undefined {
  if (userPreferences === null || itemId === undefined) {
    return undefined;
  }
  const line = userPreferences
    .split('\n')
    .find((candidate) => candidate.includes(`(id: ${itemId}) `));
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
  runtimeTimeZone: string,
  todayAndTomorrowScope?: TodayAndTomorrowCalendarQueryScope
): string | undefined {
  if (result?.['status'] !== 'completed') return undefined;
  const count = result['count'];
  if (!Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > 2500) {
    return undefined;
  }

  if (todayAndTomorrowScope !== undefined && result['mode'] !== 'list') return undefined;
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
  if (todayAndTomorrowScope !== undefined) {
    return renderTodayAndTomorrowCalendarList(
      result,
      events,
      todayAndTomorrowScope,
      replyLanguage,
      runtimeTimeZone
    );
  }
  const text = CALENDAR_QUERY_FALLBACK_TEXT[replyLanguage];
  if (events.length === 0) return text.empty;

  const renderedEvents = events.map((event) =>
    renderCalendarEventFallback(event, replyLanguage, runtimeTimeZone)
  );
  if (renderedEvents.some((event) => event === undefined)) return undefined;
  const header = `${text.calendarEvents} (${String(count)}):`;
  return [header, ...(renderedEvents as string[])].join('\n');
}

function renderTodayAndTomorrowCalendarList(
  result: Record<string, unknown>,
  events: unknown[],
  scope: TodayAndTomorrowCalendarQueryScope,
  replyLanguage: IntexAgentReplyLanguage,
  runtimeTimeZone: string
): string | undefined {
  if (
    readString(result, 'timeMin') !== scope.today.timeMin ||
    readString(result, 'timeMax') !== scope.tomorrow.timeMax ||
    typeof result['truncated'] !== 'boolean'
  ) {
    return undefined;
  }

  const todayEvents: string[] = [];
  const tomorrowEvents: string[] = [];
  for (const event of events) {
    const renderedEvent = renderCalendarEventFallback(event, replyLanguage, runtimeTimeZone, {
      allowUntitled: true,
      displayTimeZone: runtimeTimeZone,
    });
    const coveredDays = calendarEventCoveredDays(event, scope);
    if (renderedEvent === undefined || coveredDays === undefined || coveredDays.length === 0) {
      return undefined;
    }
    const boundedEvent = limitCalendarEventReplyLine(renderedEvent);
    if (coveredDays.includes('today')) {
      todayEvents.push(boundedEvent);
    }
    if (coveredDays.includes('tomorrow')) {
      tomorrowEvents.push(boundedEvent);
    }
  }

  const text = CALENDAR_QUERY_FALLBACK_TEXT[replyLanguage];
  const truncated = result['truncated'];
  const emptyDayText = truncated ? text.noEventsInPartialList : text.noEvents;
  const displayWasLimited =
    todayEvents.length > TODAY_AND_TOMORROW_VISIBLE_EVENTS_PER_DAY ||
    tomorrowEvents.length > TODAY_AND_TOMORROW_VISIBLE_EVENTS_PER_DAY;
  const renderDay = (label: string, dayEvents: string[]): string => {
    if (dayEvents.length === 0) return `${label}:\n- ${emptyDayText}`;
    const visibleEvents = dayEvents.slice(0, TODAY_AND_TOMORROW_VISIBLE_EVENTS_PER_DAY);
    if (visibleEvents.length < dayEvents.length) {
      visibleEvents.push(text.moreEventsOmitted);
    }
    return `${label}:\n${visibleEvents.join('\n')}`;
  };
  const renderedDays = [
    renderDay(text.today, todayEvents),
    renderDay(text.tomorrow, tomorrowEvents),
  ].join('\n\n');
  const notices = [
    ...(truncated ? [text.incompleteList] : []),
    ...(displayWasLimited ? [text.displayLimited] : []),
  ];
  return notices.length === 0 ? renderedDays : `${renderedDays}\n\n${notices.join('\n')}`;
}

function limitCalendarEventReplyLine(value: string): string {
  if (value.length <= CALENDAR_EVENT_REPLY_LINE_MAX_LENGTH) return value;
  return `${value.slice(0, CALENDAR_EVENT_REPLY_LINE_MAX_LENGTH - 1).trimEnd()}…`;
}

function calendarEventCoveredDays(
  value: unknown,
  scope: TodayAndTomorrowCalendarQueryScope
): ('today' | 'tomorrow')[] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const event = value as Record<string, unknown>;
  const start = readRecord(event, 'start');
  const end = readRecord(event, 'end');
  if (start === undefined || end === undefined) return undefined;

  const startDate = readString(start, 'date');
  const endDate = readString(end, 'date');
  if (startDate !== undefined || endDate !== undefined) {
    if (
      startDate === undefined ||
      endDate === undefined ||
      !isValidCalendarDate(startDate) ||
      !isValidCalendarDate(endDate) ||
      endDate <= startDate
    ) {
      return undefined;
    }
    const todayDate = scope.today.timeMin.slice(0, 10);
    const tomorrowDate = scope.tomorrow.timeMin.slice(0, 10);
    const dayAfterTomorrowDate = scope.tomorrow.timeMax.slice(0, 10);
    return [
      ...(startDate < tomorrowDate && endDate > todayDate ? (['today'] as const) : []),
      ...(startDate < dayAfterTomorrowDate && endDate > tomorrowDate
        ? (['tomorrow'] as const)
        : []),
    ];
  }

  const startDateTime = readString(start, 'dateTime');
  const endDateTime = readString(end, 'dateTime');
  if (startDateTime === undefined || endDateTime === undefined) return undefined;
  const startInstant = Date.parse(startDateTime);
  const endInstant = Date.parse(endDateTime);
  const todayStart = Date.parse(scope.today.timeMin);
  const tomorrowStart = Date.parse(scope.tomorrow.timeMin);
  const dayAfterTomorrowStart = Date.parse(scope.tomorrow.timeMax);
  if (
    !Number.isFinite(startInstant) ||
    !Number.isFinite(endInstant) ||
    endInstant <= startInstant
  ) {
    return undefined;
  }
  return [
    ...(startInstant < tomorrowStart && endInstant > todayStart ? (['today'] as const) : []),
    ...(startInstant < dayAfterTomorrowStart && endInstant > tomorrowStart
      ? (['tomorrow'] as const)
      : []),
  ];
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
  runtimeTimeZone: string,
  options?: Readonly<{ allowUntitled?: boolean; displayTimeZone?: string }>
): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const event = value as Record<string, unknown>;
  const rawSummary = event['summary'];
  const summary =
    typeof rawSummary === 'string' && rawSummary.trim() !== ''
      ? rawSummary
      : options?.allowUntitled === true && typeof rawSummary === 'string'
        ? CALENDAR_QUERY_FALLBACK_TEXT[replyLanguage].untitled
        : undefined;
  const start = readRecord(event, 'start');
  if (summary === undefined || start === undefined) return undefined;
  const renderedStart = renderCalendarEventStart(
    start,
    replyLanguage,
    runtimeTimeZone,
    options?.displayTimeZone
  );
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
  runtimeTimeZone: string,
  displayTimeZone?: string
): string | undefined {
  const dateTime = readString(start, 'dateTime');
  if (dateTime !== undefined) {
    if (Number.isNaN(new Date(dateTime).getTime())) return undefined;
    return formatCalendarConfirmationDateTime(
      dateTime,
      displayTimeZone ?? readString(start, 'timeZone'),
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

function fallbackReasonForInvalidRunnerContent(
  content: string
): Extract<IntexAgentFallbackReason, 'runner_output_malformed' | 'tool_result_mismatch'> {
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
    fallbackSourceOutcome: fallbackSourceOutcome ?? defaultFallbackSourceOutcome(fallbackReason),
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
