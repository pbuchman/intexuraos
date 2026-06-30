import { describe, expect, it } from 'vitest';
import { classifyIntexAgentIntent } from '../../domain/agent/intentGate.js';

describe('classifyIntexAgentIntent', () => {
  it.each([
    'Hej',
    'Hej! Co u Ciebie?',
    'Hello',
    'So how are you?',
  ])('keeps obvious greetings as the only local no-action shortcut: %s', (text) => {
    expect(classifyIntexAgentIntent(text)).toEqual({
      kind: 'no_action',
      reason: 'greeting',
    });
  });

  it.each([
    'https://example.com',
    'http://example.com/article?ref=agent',
    'https://research-world.com/notes-and-calendar-tasks',
  ])('routes bare URL shares to the link tool: %s', (text) => {
    expect(classifyIntexAgentIntent(text)).toEqual({
      kind: 'tool',
      allowedToolNames: ['create_link'],
    });
  });

  it.each([
    'Create a note: gate code is 4938',
    'Hi, create a note: gate code is 4938',
    'Zapisz notatke: kod do bramy to 4938',
    'Add calendar event for dentist tomorrow at 9',
    'Dodaj wydarzenie w kalendarzu jutro o 9',
    'Create research draft about OpenRouter HTTP requests',
    'Przygotuj research draft o cenach GPU',
    'Save link https://example.com',
    'Save https://example.com/article',
    'https://example.com New launch page with pricing details',
    'check this out https://example.com/case-study nice writeup',
    'Create a note including https://example.com',
    'Save note including https://example.com',
    'Create research draft from https://example.com',
    'Add calendar event with https://example.com tomorrow at 9',
    'Create code task for https://example.com webhook bug',
    'Dodaj zakladke https://example.com',
    'Create code task to implement explicit intent gating',
    'Stworz zadanie programistyczne dla intent gating',
    'Save externally https://example.com/article',
    'Upload externally this note from LinkedIn',
    'Save for processing this copied conversation detail',
    'Zapisz zewnętrznie ten paragon',
    'Prześlij zewnętrznie https://example.com/post',
    'Zapisz do przetworzenia: ważna informacja z LinkedIn',
    'What are my events scheduled for next week?',
    'Show me tomorrow calendar events',
    'How many times last month did I have Dentist?',
    'Ile razy w zeszlym miesiacu mialem dentyste?',
    'Ciekawy jestem, co jutro jest w kalendarzu',
    'Nie możesz dla mnie sprawdzić, co jest jutro w kalendarzu?',
    'Jakie wydarzenia mam zaplanowane na jutro?',
    'Podaj listę wszystkich wydarzeń, które mam jutro w kalendarzu',
    'Podaj mi liste wydarzen z kalendarza na jutro',
    'Wypisz wszystkie wydarzenia w kalendarzu na jutro',
    'Wyświetl moje wydarzenia w kalendarzu na jutro',
    'Czy mam w kalendarzu jakieś wydarzenie pomiędzy 14:00 a 16:00?',
    'Jakie terminy mam wolne jutro na godzinne spotkanie?',
    'Tell me my defined user preferences.',
    'Show my Intex instructions.',
    'Add a preference: when I invite Jakub, use jakub@gmail.com.',
    'Update the Jakub invitation preference to use jakub.nowak@gmail.com.',
    'Remove the row about mood preferences.',
    'Delete preference 2.',
    'Jakie mamy w tej chwili preferencje dla promptu agenta?',
    'Show my preferences and calendar events tomorrow',
    'Add a preference and create a note about it',
    'Create a note and show me next week calendar events',
    'https://example.com and show me tomorrow calendar events',
  ])('does not route non-bare tool intents through regex gates: %s', (text) => {
    expect(classifyIntexAgentIntent(text)).toEqual({
      kind: 'no_action',
      reason: 'conversation',
    });
  });
});
