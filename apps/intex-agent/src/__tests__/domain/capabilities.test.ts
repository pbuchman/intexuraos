import { describe, expect, it } from 'vitest';
import {
  buildCompletionFailureCapabilitiesReply,
  buildNewSessionReadyText,
  buildUnsupportedCapabilitiesReply,
  detectIntexAgentReplyLanguage,
  selectIntexAgentReplyLanguage,
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

  it('selects the current non-English message language when it is reasonable', () => {
    expect(
      selectIntexAgentReplyLanguage({
        currentMessage: { text: 'Czy możesz zapisać notatkę?' },
        priorMessages: [{ text: 'Please keep replies short.' }],
      })
    ).toBe('pl');
  });

  it('ignores bare links, image-only messages, and trivial greetings when selecting language', () => {
    expect(
      selectIntexAgentReplyLanguage({
        currentMessage: { text: 'Hello' },
        priorMessages: [
          { text: 'https://example.com' },
          { text: '', sourceType: 'whatsapp_image', hasSourceUrl: true },
          { text: 'Zapamiętaj, że wolę krótkie odpowiedzi.' },
        ],
      })
    ).toBe('pl');
  });

  it.each([
    'example.com',
    'www.example.com',
    'example.com/path',
    'example.com?utm=1',
    'https://example.com?utm=1',
    'https://example.com#section',
    'https://example.com:8080/path',
  ])(
    'ignores bare link %s when selecting language',
    (link) => {
      expect(
        selectIntexAgentReplyLanguage({
          currentMessage: { text: link },
          priorMessages: [{ text: 'Zapamiętaj, że wolę krótkie odpowiedzi.' }],
        })
      ).toBe('pl');
    }
  );

  it('ignores attachment-only source URL messages when selecting language', () => {
    expect(
      selectIntexAgentReplyLanguage({
        currentMessage: {
          text: 'Attachment shared via WhatsApp.',
          sourceType: 'whatsapp_document',
          hasSourceUrl: true,
        },
        priorMessages: [{ text: 'Zapamiętaj, że wolę krótkie odpowiedzi.' }],
      })
    ).toBe('pl');
  });

  it('uses captioned image text as a reasonable language signal', () => {
    expect(
      selectIntexAgentReplyLanguage({
        currentMessage: {
          text: 'Zapisz ten rachunek w systemie zewnętrznym.',
          sourceType: 'whatsapp_image',
          hasSourceUrl: true,
        },
      })
    ).toBe('pl');
  });

  it('uses wider context for ambiguous short messages and falls back to English when none is classified', () => {
    expect(
      selectIntexAgentReplyLanguage({
        currentMessage: { text: 'ok' },
        priorMessages: [{ text: 'Zapisz notatkę o spotkaniu.' }],
      })
    ).toBe('pl');
    expect(
      selectIntexAgentReplyLanguage({
        currentMessage: { text: 'ok' },
        priorMessages: [{ text: 'https://example.com' }, { text: 'Hello' }],
      })
    ).toBe('en');
  });

  it('uses deterministic button language hints without classifying plain short text', () => {
    expect(
      selectIntexAgentReplyLanguage({
        currentMessage: { text: 'Tak', languageHint: 'pl' },
      })
    ).toBe('pl');
    expect(
      selectIntexAgentReplyLanguage({
        currentMessage: { text: 'tak' },
      })
    ).toBe('en');
  });

  it('uses a substantive English current message instead of inheriting Polish context', () => {
    expect(
      selectIntexAgentReplyLanguage({
        currentMessage: { text: 'Please create a calendar event tomorrow at 9.' },
        priorMessages: [{ text: 'Zapisz notatkę o spotkaniu.' }],
      })
    ).toBe('en');
  });

  it('classifies common unaccented Polish as Polish instead of generic English text', () => {
    expect(
      selectIntexAgentReplyLanguage({
        currentMessage: { text: 'wyslij paragon do firmy' },
        priorMessages: [{ text: 'Please keep replies short.' }],
      })
    ).toBe('pl');
  });

  it('classifies substantive English without keyword matches by word count', () => {
    expect(
      selectIntexAgentReplyLanguage({
        currentMessage: { text: 'Lunch receipt details' },
        priorMessages: [{ text: 'Zapamiętaj, że wolę krótkie odpowiedzi.' }],
      })
    ).toBe('en');
    expect(
      selectIntexAgentReplyLanguage({
        currentMessage: { text: 'alpha beta' },
        priorMessages: [{ text: 'Zapamiętaj, że wolę krótkie odpowiedzi.' }],
      })
    ).toBe('pl');
    expect(
      selectIntexAgentReplyLanguage({
        currentMessage: { text: '12345' },
        priorMessages: [{ text: 'Zapamiętaj, że wolę krótkie odpowiedzi.' }],
      })
    ).toBe('pl');
  });
});
