import { describe, expect, it } from 'vitest';
import {
  buildCompletionFailureCapabilitiesReply,
  buildNewSessionReadyText,
  buildUnsupportedCapabilitiesReply,
  detectIntexAgentReplyLanguage,
} from '../../domain/agent/capabilities.js';

const ENGLISH_UNSUPPORTED_REPLY = [
  'I could not safely handle that request. I can help with:',
  '- summarize and reason over the current session',
  '- create notes',
  '- create and look up calendar events',
  '- create research drafts',
  '- save bookmarks',
  '- create code tasks for planning or execution',
  '- manage INTEX Agent prompt preferences',
].join('\n');

const POLISH_UNSUPPORTED_REPLY = [
  'Nie mogłem bezpiecznie obsłużyć tej prośby. Mogę pomóc z:',
  '- podsumowywaniem i analizowaniem bieżącej sesji',
  '- tworzeniem notatek',
  '- tworzeniem i sprawdzaniem wydarzeń w kalendarzu',
  '- tworzeniem szkiców researchu',
  '- zapisywaniem bookmarków',
  '- tworzeniem zadań programistycznych do planowania lub wykonania',
  '- zarządzaniem preferencjami promptu agenta INTEX',
].join('\n');

const POLISH_NEW_SESSION_REPLY = [
  'W czym mogę pomóc? Mogę pomóc z:',
  '- podsumowywaniem i analizowaniem bieżącej sesji',
  '- tworzeniem notatek',
  '- tworzeniem i sprawdzaniem wydarzeń w kalendarzu',
  '- tworzeniem szkiców researchu',
  '- zapisywaniem bookmarków',
  '- tworzeniem zadań programistycznych do planowania lub wykonania',
  '- zarządzaniem preferencjami promptu agenta INTEX',
].join('\n');

describe('Intex Agent capabilities replies', () => {
  it('builds unsupported and completion-failure replies in the requested language', () => {
    expect(buildUnsupportedCapabilitiesReply()).toBe(ENGLISH_UNSUPPORTED_REPLY);
    expect(buildUnsupportedCapabilitiesReply('pl')).toBe(POLISH_UNSUPPORTED_REPLY);
    expect(buildCompletionFailureCapabilitiesReply('pl')).toContain(
      'Nie mogłem teraz dokończyć tej prośby.'
    );
  });

  it('builds new-session ready text in Polish when requested', () => {
    expect(buildNewSessionReadyText('pl')).toBe(POLISH_NEW_SESSION_REPLY);
  });

  it.each([
    ['', 'en'],
    ['Hello, what can you do?', 'en'],
    ['Jak can be an English name in this sentence.', 'en'],
    ['Czy mozesz zapisać notatkę?', 'pl'],
    ['Jakie terminy mam wolne jutro?', 'pl'],
    ['please zapamietaj this preference', 'pl'],
  ] as const)('detects %s as %s', (text, expectedLanguage) => {
    expect(detectIntexAgentReplyLanguage(text)).toBe(expectedLanguage);
  });
});
