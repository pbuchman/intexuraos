export const INTEX_AGENT_CAPABILITIES = [
  'summarize and reason over the current session',
  'create notes',
  'create and look up calendar events',
  'create research drafts',
  'save bookmarks',
  'create code tasks for planning or execution',
  'manage Intex Agent prompt preferences',
] as const;

export type IntexAgentReplyLanguage = 'en' | 'pl';

export interface IntexAgentLanguageMessage {
  text: string;
  sourceType?: string;
  hasSourceUrl?: boolean;
  languageHint?: IntexAgentReplyLanguage;
}

const POLISH_INTEX_AGENT_CAPABILITIES = [
  'podsumowywaniem i analizowaniem bieżącej sesji',
  'tworzeniem notatek',
  'tworzeniem i sprawdzaniem wydarzeń w kalendarzu',
  'tworzeniem szkiców researchu',
  'zapisywaniem bookmarków',
  'tworzeniem zadań programistycznych do planowania lub wykonania',
  'zarządzaniem preferencjami promptu agenta Intex',
] as const;

const CAPABILITIES_BY_LANGUAGE: Record<IntexAgentReplyLanguage, readonly string[]> = {
  en: INTEX_AGENT_CAPABILITIES,
  pl: POLISH_INTEX_AGENT_CAPABILITIES,
};

const UNSUPPORTED_REPLY_INTROS: Record<IntexAgentReplyLanguage, string> = {
  en: 'I could not safely handle that request. I can help with:',
  pl: 'Nie mogłem bezpiecznie obsłużyć tej prośby. Mogę pomóc z:',
};

const COMPLETION_FAILURE_REPLY_INTROS: Record<IntexAgentReplyLanguage, string> = {
  en: 'I could not complete that request right now. I can help with:',
  pl: 'Nie mogłem teraz dokończyć tej prośby. Mogę pomóc z:',
};

const NEW_SESSION_REPLY_INTROS: Record<IntexAgentReplyLanguage, string> = {
  en: 'What would you like me to help with? I can help with:',
  pl: 'W czym mogę pomóc? Mogę pomóc z:',
};

const GREETING_REPLIES: Record<IntexAgentReplyLanguage, string> = {
  en: 'Hi! I am doing well. How can I help?',
  pl: 'Cześć! U mnie wszystko w porządku. W czym mogę pomóc?',
};

const EMAIL_ADDRESS_PATTERN =
  /(?<![\p{Letter}\p{Number}._%+-])[\p{Letter}\p{Number}.!#$%&'*+/=?^_`{|}~-]+@[\p{Letter}\p{Number}](?:[\p{Letter}\p{Number}-]*[\p{Letter}\p{Number}])?(?:\.[\p{Letter}\p{Number}](?:[\p{Letter}\p{Number}-]*[\p{Letter}\p{Number}])?)+(?![\p{Letter}\p{Number}_%+-]|\.+[\p{Letter}\p{Number}])/giu;

export function detectIntexAgentReplyLanguage(text: string): IntexAgentReplyLanguage {
  return isLikelyPolish(text) ? 'pl' : 'en';
}

export function selectIntexAgentReplyLanguage(input: {
  currentMessage?: IntexAgentLanguageMessage;
  /** Prior user messages ordered newest first. */
  priorMessages?: readonly IntexAgentLanguageMessage[];
}): IntexAgentReplyLanguage {
  const currentLanguage =
    input.currentMessage === undefined
      ? null
      : classifyReasonableIntexAgentReplyLanguage(input.currentMessage);
  if (currentLanguage !== null) {
    return currentLanguage;
  }

  for (const message of input.priorMessages ?? []) {
    const language = classifyReasonableIntexAgentReplyLanguage(message);
    if (language !== null) {
      return language;
    }
  }

  return 'en';
}

export function buildCapabilitiesReply(
  intro: string,
  language: IntexAgentReplyLanguage = 'en'
): string {
  return [intro, ...CAPABILITIES_BY_LANGUAGE[language].map((capability) => `- ${capability}`)].join(
    '\n'
  );
}

export function buildUnsupportedCapabilitiesReply(language: IntexAgentReplyLanguage = 'en'): string {
  return buildCapabilitiesReply(UNSUPPORTED_REPLY_INTROS[language], language);
}

export function buildCompletionFailureCapabilitiesReply(
  language: IntexAgentReplyLanguage = 'en'
): string {
  return buildCapabilitiesReply(COMPLETION_FAILURE_REPLY_INTROS[language], language);
}

export function buildNewSessionReadyText(language: IntexAgentReplyLanguage = 'en'): string {
  return buildCapabilitiesReply(NEW_SESSION_REPLY_INTROS[language], language);
}

export function buildGreetingReply(language: IntexAgentReplyLanguage = 'en'): string {
  return GREETING_REPLIES[language];
}

function isLikelyPolish(text: string): boolean {
  const normalized = text.toLocaleLowerCase('pl-PL');
  if (/[ąćęłńóśźż]/iu.test(normalized)) {
    return true;
  }

  return /\b(czy|jakie|jaki|jaka|mam|masz|mamy|mozesz|utworz|stworz|dodaj|zapisz|zapamietaj|wysl\w*|adres\w*|paragon\w*|firm\w*|rachun\w*|notatk\w*|kalendarz\w*|wydarzen\w*|spotkan\w*|termin\w*|woln\w*|dzisiaj|jutro|teraz|prosze|pomoc|preferencj\w*|brak|linku|dostal\w*|kup|bilet|koncert)\b/iu.test(
    normalized
  );
}

function classifyReasonableIntexAgentReplyLanguage(
  message: IntexAgentLanguageMessage
): IntexAgentReplyLanguage | null {
  if (message.languageHint !== undefined) {
    return message.languageHint;
  }

  const normalizedText = message.text.trim();
  if (normalizedText === '') {
    return null;
  }
  if (isBareLink(normalizedText) || isAttachmentOnlyMessage(message, normalizedText)) {
    return null;
  }
  const languageText = normalizedText.replace(EMAIL_ADDRESS_PATTERN, ' ').trim();
  if (languageText === '') {
    return null;
  }
  if (isTrivialGreeting(languageText) || isAmbiguousShortMessage(languageText)) {
    return null;
  }
  if (isLikelyPolish(languageText)) {
    return 'pl';
  }
  if (isLikelyEnglish(languageText)) {
    return 'en';
  }
  return null;
}

function isAttachmentOnlyMessage(
  message: IntexAgentLanguageMessage,
  normalizedText: string
): boolean {
  if (message.hasSourceUrl !== true) {
    return false;
  }
  return (
    normalizedText === '' ||
    normalizedText === 'Image shared via WhatsApp.' ||
    normalizedText === 'Attachment shared via WhatsApp.'
  );
}

function isBareLink(text: string): boolean {
  return /^(?:https?:\/\/)?(?:www\.)?[\p{Letter}\p{Number}-]+(?:\.[\p{Letter}\p{Number}-]+)+(?::\d{1,5})?(?:[/?#]\S*)?$/iu.test(
    text
  );
}

function isTrivialGreeting(text: string): boolean {
  const normalized = normalizePlainText(text);
  return /^(hello|hi|hey|czesc|siema|hej)$/iu.test(normalized);
}

function isAmbiguousShortMessage(text: string): boolean {
  const normalized = normalizePlainText(text);
  return /^(ok|okay|k|yes|no|yep|nope|tak|nie|dobra|jasne)$/iu.test(normalized);
}

function isLikelyEnglish(text: string): boolean {
  const normalized = text.toLocaleLowerCase('en-US');
  if (/\b(the|this|that|please|create|save|remember|note|calendar|event|events|research|link|bookmark|task|ticket|concert|what|can|you|do|buy|add|show|list|check|count|tomorrow|today|next|week|month|door|code)\b/iu.test(normalized)) {
    return true;
  }
  const letterWords = normalized.match(/\b[a-z]{3,}\b/giu) ?? [];
  return letterWords.length >= 3;
}

function normalizePlainText(text: string): string {
  return text
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}
