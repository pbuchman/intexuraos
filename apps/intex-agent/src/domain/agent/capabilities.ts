export const INTEX_AGENT_CAPABILITIES = [
  'summarize and reason over the current session',
  'create notes',
  'create and look up calendar events',
  'create research drafts',
  'save bookmarks',
  'create code tasks for planning or execution',
  'manage INTEX Agent prompt preferences',
] as const;

export type IntexAgentReplyLanguage = 'en' | 'pl';

const POLISH_INTEX_AGENT_CAPABILITIES = [
  'podsumowywaniem i analizowaniem bieżącej sesji',
  'tworzeniem notatek',
  'tworzeniem i sprawdzaniem wydarzeń w kalendarzu',
  'tworzeniem szkiców researchu',
  'zapisywaniem bookmarków',
  'tworzeniem zadań programistycznych do planowania lub wykonania',
  'zarządzaniem preferencjami promptu agenta INTEX',
] as const;

const CAPABILITIES_BY_LANGUAGE: Record<IntexAgentReplyLanguage, readonly string[]> = {
  en: INTEX_AGENT_CAPABILITIES,
  pl: POLISH_INTEX_AGENT_CAPABILITIES,
};

export function detectIntexAgentReplyLanguage(text: string): IntexAgentReplyLanguage {
  return isLikelyPolish(text) ? 'pl' : 'en';
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
  if (language === 'pl') {
    return buildCapabilitiesReply('Nie mogłem bezpiecznie obsłużyć tej prośby. Mogę pomóc z:', 'pl');
  }

  return buildCapabilitiesReply('I could not safely handle that request. I can help with:', 'en');
}

export function buildCompletionFailureCapabilitiesReply(
  language: IntexAgentReplyLanguage = 'en'
): string {
  if (language === 'pl') {
    return buildCapabilitiesReply('Nie mogłem teraz dokończyć tej prośby. Mogę pomóc z:', 'pl');
  }

  return buildCapabilitiesReply(
    'I could not complete that request right now. I can help with:',
    'en'
  );
}

export function buildNewSessionReadyText(): string {
  return buildCapabilitiesReply('What would you like me to help with? I can help with:');
}

function isLikelyPolish(text: string): boolean {
  const normalized = text.toLocaleLowerCase('pl-PL');
  if (/[ąćęłńóśźż]/iu.test(normalized)) {
    return true;
  }

  return /\b(czy|jak|jakie|jaki|jaka|mam|masz|mamy|mozesz|utworz|stworz|dodaj|zapisz|zapamietaj|notatk\w*|kalendarz\w*|wydarzen\w*|spotkan\w*|termin\w*|woln\w*|dzisiaj|jutro|teraz|prosze|pomoc|preferencj\w*|kup|bilet|koncert)\b/iu.test(
    normalized
  );
}
