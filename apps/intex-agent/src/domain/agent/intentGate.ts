import type { IntexAgentToolName } from '../sessions/types.js';

export type IntexAgentIntentDecision =
  | { kind: 'tool'; allowedToolNames: IntexAgentToolName[] }
  | { kind: 'no_action'; reason: 'greeting' | 'conversation' | 'retain_context' };

export function classifyIntexAgentIntent(text: string): IntexAgentIntentDecision {
  const normalized = normalizeIntentText(text);

  if (isGreeting(normalized)) {
    return { kind: 'no_action', reason: 'greeting' };
  }

  if (isExplicitRetainOnlyRequest(text)) {
    return { kind: 'no_action', reason: 'retain_context' };
  }

  if (isBareUrl(text)) {
    return { kind: 'tool', allowedToolNames: ['create_link'] };
  }

  if (isExplicitFactMemoryRequest(normalized)) {
    return { kind: 'tool', allowedToolNames: ['create_note'] };
  }

  return { kind: 'no_action', reason: 'conversation' };
}

function isExplicitRetainOnlyRequest(text: string): boolean {
  const normalized = text.normalize('NFKC').toLowerCase();
  if (/https?:\/\//u.test(normalized)) return false;
  const englishRetainOnly =
    /\b(?:do not|don['’]?t)\s+(?:save|store|persist)\b[\s\S]*\b(?:only|just)\s+(?:retain|hold|keep)\s+(?:(?:this|the|provided)\s+)?context\s*[.!?]*\s*$/u.exec(
      normalized
    );
  const polishRetainOnly =
    /\bnie\s+(?:zapisuj|utrwalaj)(?:\s+\S+){0,3}\b[\s\S]*\btylko\s+(?:zachowaj|zapamiętaj|przechowaj)\s+(?:(?:ten|podany)\s+)?kontekst\s*[.!?]*\s*$/u.exec(
      normalized
    );
  const retainClause = englishRetainOnly ?? polishRetainOnly;
  if (retainClause === null) return false;

  const prefix = normalized.slice(0, retainClause.index);
  return !(
    /\b(?:translate|rewrite|quote|explain|analy[sz]e|summari[sz]e)\b/u.test(prefix) ||
    /\b(?:przetłumacz(?:yć)?|przetlumacz(?:yc)?|przeformułuj|zacytuj|wyjaśnij|wyjasnij|przeanalizuj|streść|stresc)(?!\p{L})/u.test(
      prefix
    )
  );
}

function isGreeting(text: string): boolean {
  return new Set([
    'hej',
    'hej co u ciebie',
    'czesc',
    'czesc co u ciebie',
    'hello',
    'hi',
    'hey',
    'how are you',
    'so how are you',
  ]).has(text);
}

function isBareUrl(text: string): boolean {
  return /^\s*https?:\/\/\S+\s*$/iu.test(text);
}

function isExplicitFactMemoryRequest(text: string): boolean {
  const temporaryOnly =
    /\b(?:do not|don['’]?t|dont)\s+(?:save|store|persist)\b/u.test(text) ||
    /\b(?:temporarily|for now)\b/u.test(text) ||
    /\bonly\s+(?:retain|hold|keep)\s+(?:this\s+)?context\b/u.test(text) ||
    /\b(?:(?:only|just|temporarily)\s+for\s+(?:this|the current)\s+session|for\s+(?:this|the current)\s+session\s+(?:only|just))\b/u.test(
      text
    ) ||
    /\bnie\s+(?:zapisuj|utrwalaj)\b/u.test(text) ||
    /\b(?:tymczasowo|na razie)\b/u.test(text) ||
    /\btylko\s+(?:zachowaj|zapamietaj|przechowaj)\s+(?:ten\s+)?kontekst\b/u.test(text) ||
    /\b(?:(?:tylko|wylacznie|tymczasowo)\s+(?:w|na)\s+(?:tej|te)\s+sesji|(?:w|na)\s+(?:tej|te)\s+sesji\s+(?:tylko|wylacznie))\b/u.test(
      text
    );
  const englishAssistantDirective =
    /\bi\s+(?:want|need|prefer|would like)\s+you\s+to\b/u.test(text) ||
    /\bi\s+like\s+when\s+you\b/u.test(text) ||
    /\b(?:bullet points?|citations?|cite|sources?|headings?|markdown|format(?:ting)?|tone|style|language)\b/u.test(
      text
    );
  const englishResponseTarget =
    /\b(?:reply|replies|respond|response|responses|answer|answers)\b/u.test(text) ||
    /\b(?:i\s+(?:want|prefer|would like)\s+you\s+to|when\s+you\s+are|you\s+(?:should|must)|your)\b/u.test(
      text
    );
  const englishResponseBehavior =
    englishAssistantDirective ||
    (englishResponseTarget &&
      /\b(?:brief|briefly|concise|concisely|short|shorter|formal|formally|informal|informally|polish|english|always|should|must|keep|style)\b/u.test(
        text
      ));
  const polishResponseBehavior =
    /\b(?:list\w*\s+punktowan\w*|punkt\w*|cytow\w*|zrodl\w*|naglowk\w*|markdown|format\w*|ton\w*|styl\w*|jezyk\w*)\b/u.test(
      text
    ) ||
    ((/\b(?:odpowiedz\w*|odpowiada\w*|pisz|mow|uzywaj)\b/u.test(text) ||
      /\b(?:zebys|ty|twoj\w*)\b/u.test(text)) &&
      /\b(?:krotk\w*|zwiezl\w*|formaln\w*|nieformaln\w*|polsk\w*|angielsk\w*|zawsze|powin\w*|mus\w*|twoj\w*|zebys)\b/u.test(
        text
      ));
  const competingAction =
    /\b(?:create|add|put|schedule|show|list|check|query|find|research|bookmark|delete|update)\b/u.test(
      text
    ) ||
    /\b(?:calendar|calendars|appointment|appointments|event|events)\b/u.test(text) ||
    /\b(?:utworz|dodaj|wpisz|zaplanuj|pokaz|wyswietl|sprawdz|znajdz|usun|zaktualizuj)\b/u.test(
      text
    ) ||
    /\b(?:kalendarz\w*|wizyt\w*|wydarzen\w*)\b/u.test(text);
  const factualPayload =
    /\b(?:is|are|was|were|equals?|expires?|lives?|works?|starts?|ends?|happens?)\b/u.test(
      text
    ) ||
    /\bi\s+(?:like|prefer|have|need|want)\b/u.test(text) ||
    /\b(?:jest|sa|byl\w*|to|wygas\w*|mieszka\w*|pracuje\w*|zaczyna\w*|konczy\w*)\b/u.test(
      text
    ) ||
    /\b(?:lubie|wole|mam|potrzebuje|chce)\b/u.test(text) ||
    /\b(?:code|pin|password|key|keys|remote|address|number|birthday|anniversary|parking|location|passport)\b/u.test(
      text
    ) ||
    /\b(?:kod|pin|haslo|klucz\w*|pilot|adres|numer|urodzin\w*|rocznic\w*|parking|lokalizacj\w*|paszport)\b/u.test(
      text
    );
  if (temporaryOnly || englishResponseBehavior || polishResponseBehavior || competingAction)
    return false;
  if (!factualPayload) return false;

  return (
    /(?:^|\b(?:also|please|and|new session|can you|could you|would you)\s+)remember\s+(?!to\b).+/u.test(
      text
    ) ||
    /(?:^|\b(?:prosze|i|rowniez|dodatkowo|nowa sesja)\s+)(?:zapamietaj|pamietaj)\s+.+/u.test(
      text
    ) ||
    /^(?:(?:new session)\s+)?(?:please\s+)?keep\s+this\s+for\s+later\b.+/u.test(text)
  );
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
