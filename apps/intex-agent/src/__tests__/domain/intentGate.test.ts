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
    'Remember that the garage code is 7241.',
    'Remember INTEX-EVAL-006 the garage remote is in the desk drawer.',
    'Also remember parking is on level P3.',
    'new session: remember that the backup code is 9988',
    'Zapamiętaj, że kod do bramy to 7241.',
    'Pamiętaj, że pilot do garażu jest w szufladzie.',
    'Remember that I like oat milk.',
    'Remember that I prefer aisle seats.',
    'Pamiętaj, że lubię mleko owsiane.',
    'Pamiętaj, że wolę miejsce przy przejściu.',
    'Keep this for later: my passport expires in November 2029.',
  ])('routes an explicit English fact-memory request to note creation: %s', (text) => {
    expect(classifyIntexAgentIntent(text)).toEqual({
      kind: 'tool',
      allowedToolNames: ['create_note'],
    });
  });

  it.each([
    "Remember this, but don't persist it; only retain this context.",
    'Context fragment: green folder. Do not save yet; only retain this context.',
    'Fragment kontekstu: zielony folder. Nie zapisuj jeszcze; tylko zachowaj ten kontekst.',
  ])('routes explicitly temporary memory to deterministic session retention: %s', (text) => {
    expect(classifyIntexAgentIntent(text)).toEqual({
      kind: 'no_action',
      reason: 'retain_context',
    });
  });

  it.each([
    'Bookmark https://example.com. Do not save it; only retain this context.',
    'Translate into Polish: Do not save yet; only retain this context.',
    'Przetłumacz to: Nie zapisuj jeszcze; tylko zachowaj ten kontekst.',
    'Do not save this; only retain this context and create a note.',
  ])('keeps mixed retain-only shapes on the classifier path: %s', (text) => {
    expect(classifyIntexAgentIntent(text)).toEqual({
      kind: 'no_action',
      reason: 'conversation',
    });
  });

  it.each([
    'Remember this for this session, but do not save it.',
    'Remember the garage code only for this session.',
    'Remember this just for this session.',
    'Remember this temporarily for this session.',
    'Remember the garage code temporarily.',
    'Remember the garage code for now.',
    'Zapamiętaj kod do bramy tylko w tej sesji.',
    'Zapamiętaj kod do bramy tymczasowo.',
    'Zapamiętaj kod do bramy na razie.',
  ])('keeps other temporary-memory wording on the classifier path: %s', (text) => {
    expect(classifyIntexAgentIntent(text)).toEqual({
      kind: 'no_action',
      reason: 'conversation',
    });
  });

  it.each([
    'Remember that I prefer concise replies.',
    'Remember that I like concise replies.',
    'Remember that I want you to answer briefly.',
    'Remember: keep your replies short.',
    'Remember that your answers should always be concise.',
    'Remember that you should keep replies concise.',
    'Remember that I want you to be concise.',
    'Remember that I prefer you to use Polish.',
    'Remember that I like when you are concise.',
    'Remember that I want you to use bullet points.',
    'Remember that I need you to cite sources.',
    'Remember that I prefer you to cite sources.',
    'Remember that I prefer bullet points.',
    'Remember that I want you to call me Pat.',
    'Remember to reply shorter.',
    'Zapamiętaj, że wolę krótkie odpowiedzi.',
    'Pamiętaj, że lubię krótkie odpowiedzi.',
    'Zapamiętaj, że chcę, żebyś odpowiadał krótko.',
    'Pamiętaj, aby twoje odpowiedzi były krótkie.',
    'Pamiętaj, że chcę, żebyś był zwięzły.',
    'Pamiętaj, że chcę, żebyś cytował źródła.',
    'Pamiętaj, że wolę, żebyś mówił do mnie Pat.',
    'Pamiętaj, że wolę listy punktowane.',
    'Pamiętaj, żeby zawsze odpowiadać po polsku.',
  ])('leaves durable assistant behavior on the preference-classification path: %s', (text) => {
    expect(classifyIntexAgentIntent(text)).toEqual({
      kind: 'no_action',
      reason: 'conversation',
    });
  });

  it.each([
    'Remember the PIN and create a calendar event tomorrow at 9.',
    'Remember the garage code and show me tomorrow calendar events.',
    'Remember the PIN and put a dentist appointment on my calendar tomorrow at 9.',
    'Zapamiętaj kod i utwórz wydarzenie w kalendarzu jutro o 9.',
    'Zapamiętaj PIN i wpisz wizytę do kalendarza jutro o 9.',
  ])('leaves competing memory and tool actions on the LLM classification path: %s', (text) => {
    expect(classifyIntexAgentIntent(text)).toEqual({
      kind: 'no_action',
      reason: 'conversation',
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
