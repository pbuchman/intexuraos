import type { IntexAgentToolName } from '../sessions/types.js';

export type IntexAgentIntentDecision =
  | { kind: 'tool'; allowedToolNames: IntexAgentToolName[] }
  | { kind: 'no_action'; reason: 'greeting' | 'conversation' }
  | { kind: 'unsupported'; reason: 'multiple_resource_intents' };

export function classifyIntexAgentIntent(text: string): IntexAgentIntentDecision {
  const normalized = normalizeIntentText(text);
  const normalizedWithoutUrls = normalizeIntentText(stripUrls(text));
  const containsUrl = hasUrl(text);

  if (!containsUrl && isGreeting(normalized)) {
    return { kind: 'no_action', reason: 'greeting' };
  }

  const toolNames = explicitToolNames(normalizedWithoutUrls);
  const isCalendarQuery = isReadOnlyCalendarQueryRequest(normalizedWithoutUrls);
  if (toolNames.length > 0 && isCalendarQuery) {
    return { kind: 'unsupported', reason: 'multiple_resource_intents' };
  }

  if (toolNames.length === 1) {
    return { kind: 'tool', allowedToolNames: toolNames };
  }

  if (toolNames.length > 1) {
    return { kind: 'unsupported', reason: 'multiple_resource_intents' };
  }

  if (containsUrl && isCalendarQuery) {
    return { kind: 'unsupported', reason: 'multiple_resource_intents' };
  }

  if (toolNames.length === 0 && isCalendarQuery) {
    return { kind: 'tool', allowedToolNames: ['query_calendar_events'] };
  }

  if (containsUrl) {
    return { kind: 'tool', allowedToolNames: ['create_link'] };
  }

  return { kind: 'no_action', reason: 'conversation' };
}

function explicitToolNames(text: string): IntexAgentToolName[] {
  const toolNames: IntexAgentToolName[] = [];
  if (isExplicitNoteRequest(text)) toolNames.push('create_note');
  if (isExplicitCalendarCreateRequest(text)) toolNames.push('create_calendar_event');
  if (isExplicitResearchRequest(text)) toolNames.push('create_research');
  if (isExplicitLinkRequest(text)) toolNames.push('create_link');
  if (isExplicitCodeTaskRequest(text)) toolNames.push('create_code_task');
  return toolNames;
}

function isReadOnlyCalendarQueryRequest(text: string): boolean {
  const mentionsCalendar =
    /\b(calendar|kalendarz\w*|wydarzen\w*|event|events|appointment|appointments|meeting|meetings)\b/u.test(
      text
    );
  const listIntent =
    /\b(show|list|check|inspect|see|find|search|what|when|pokaz\w*|sprawdz\w*|zobac\w*|znajdz\w*|szukaj|co jest)\b/u.test(
      text
    ) || /\bco\b.*\bjest\b/u.test(text);
  const countIntent = /\b(how many times|how many|count|ile razy|ile)\b/u.test(text);

  if (mentionsCalendar && (listIntent || countIntent)) {
    return true;
  }

  return countIntent && mentionsCalendarTimeRange(text) && !mentionsNonCalendarResource(text);
}

function isExplicitNoteRequest(text: string): boolean {
  return (
    /\b(create|add|save|write down)\b.*\b(note|notat\w*)/u.test(text) ||
    /\b(note this|write this down)\b/u.test(text) ||
    /\bremember (that|this)\b/u.test(text) ||
    /\bremember the\b.*\b(code|password|pin|gate|door|parking|spot)\b/u.test(text) ||
    /\b(zapisz|stworz|utworz|dodaj)\b.*\b(notat\w*|note)\b/u.test(text)
  );
}

function isExplicitCalendarCreateRequest(text: string): boolean {
  if (/\bresearch\b/u.test(text)) {
    return false;
  }

  return (
    /\b(create|add|schedule|plan)\b.*\b(calendar|event|appointment|meeting)\b/u.test(text) ||
    /\b(dodaj|stworz|utworz|zaplanuj)\b.*\b(kalendarz|wydarzenie|spotkanie|wizyta)\b/u.test(text)
  );
}

function isExplicitResearchRequest(text: string): boolean {
  return (
    /\b(create|prepare|start|do)\b.*\b(research|research draft|report)\b/u.test(text) ||
    /^\s*research\b/u.test(text) ||
    /\b(stworz|utworz|przygotuj|zrob)\b.*\b(research|szkic badawczy|badanie)\b/u.test(text)
  );
}

function isExplicitLinkRequest(text: string): boolean {
  return (
    /\b(save|bookmark|add)\b.*\b(link|url|bookmark|zakladk\w*)\b/u.test(text) ||
    /\b(zapisz|dodaj)\b.*\b(link|url|zakladk\w*)\b/u.test(text)
  );
}

function isExplicitCodeTaskRequest(text: string): boolean {
  return (
    /\b(create|add|start)\b.*\b(code task|coding task|programming task)\b/u.test(text) ||
    /\b(stworz|utworz|dodaj)\b.*\b(zadanie programistyczne|code task)\b/u.test(text)
  );
}

function mentionsCalendarTimeRange(text: string): boolean {
  return /\b(today|tomorrow|yesterday|week|month|year|dzis|jutro|wczoraj|tydzien|tygodniu|miesiac|miesiacu|rok|zeszlym|zeszly|nastepny|next|last|this)\b/u.test(
    text
  );
}

function mentionsNonCalendarResource(text: string): boolean {
  return /\b(note|notes|notat\w*|bookmark|bookmarks|zakladk\w*|link|links|url|urls|research|report|reports|code task|code tasks|coding task|coding tasks|programming task|programming tasks|zadanie programistyczne|zadania programistyczne|message|messages|wiadomosc\w*)\b/u.test(
    text
  );
}

function isGreeting(text: string): boolean {
  return /^(hej|czesc|cześć|hello|hi|hey|so how are you|how are you)\b/u.test(text);
}

function hasUrl(text: string): boolean {
  return /\bhttps?:\/\/\S+/iu.test(text);
}

function stripUrls(text: string): string {
  return text.replace(/\bhttps?:\/\/\S+/giu, ' ');
}

function normalizeIntentText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[?!.,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
