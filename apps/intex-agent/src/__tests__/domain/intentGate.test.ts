import { describe, expect, it } from 'vitest';
import { classifyIntexAgentIntent } from '../../domain/agent/intentGate.js';

describe('classifyIntexAgentIntent', () => {
  it.each([
    ['Create a note: gate code is 4938', ['create_note']],
    ['Zapisz notatke: kod do bramy to 4938', ['create_note']],
    ['Add calendar event for dentist tomorrow at 9', ['create_calendar_event']],
    ['Dodaj wydarzenie w kalendarzu jutro o 9', ['create_calendar_event']],
    ['Create research draft about OpenRouter HTTP requests', ['create_research']],
    ['Przygotuj research draft o cenach GPU', ['create_research']],
    ['Save link https://example.com', ['create_link']],
    ['Save https://example.com/article', ['create_link']],
    ['https://example.com', ['create_link']],
    ['https://example.com New launch page with pricing details', ['create_link']],
    ['check this out https://example.com/case-study nice writeup', ['create_link']],
    ['https://research-world.com/notes-and-calendar-tasks', ['create_link']],
    ['Create a note including https://example.com', ['create_note']],
    ['Save note including https://example.com', ['create_note']],
    ['Create research draft from https://example.com', ['create_research']],
    ['Add calendar event with https://example.com tomorrow at 9', ['create_calendar_event']],
    ['Create code task for https://example.com webhook bug', ['create_code_task']],
    ['Dodaj zakladke https://example.com', ['create_link']],
    ['Create code task to implement explicit intent gating', ['create_code_task']],
    ['Stworz zadanie programistyczne dla intent gating', ['create_code_task']],
  ] as const)('allows explicit creation intent: %s', (text, expectedToolNames) => {
    expect(classifyIntexAgentIntent(text)).toEqual({
      kind: 'tool',
      allowedToolNames: expectedToolNames,
    });
  });

  it.each([
    'Hej! Co u Ciebie?',
    'So how are you?',
    'A jakie musisz mieć parametry, żebym mógł stworzyć zadanie programistyczne?',
    'A jak wygląda taki schemat request o HTTP, który wykonujesz?',
    'Nie dostałam żadnego linku',
    'Remember the old days',
  ])('does not allow implicit resource creation: %s', (text) => {
    const decision = classifyIntexAgentIntent(text);

    expect(decision.kind).not.toBe('tool');
  });

  it.each([
    'https://research-world.com',
    'https://todo-app.io/notes',
    'https://calendar-task.example/research-notes',
  ])('ignores command-like keywords inside URLs: %s', (text) => {
    expect(classifyIntexAgentIntent(text)).toEqual({
      kind: 'tool',
      allowedToolNames: ['create_link'],
    });
  });

  it.each([
    'What are my events scheduled for next week?',
    'Show me tomorrow calendar events',
    'How many times last month did I have Dentist?',
    'Ile razy w zeszlym miesiacu mialem dentyste?',
    'Ciekawy jestem, co jutro jest w kalendarzu',
    'Nie możesz dla mnie sprawdzić, co jest jutro w kalendarzu?',
  ])('allows read-only calendar queries: %s', (text) => {
    expect(classifyIntexAgentIntent(text)).toEqual({
      kind: 'tool',
      allowedToolNames: ['query_calendar_events'],
    });
  });

  it.each([
    'How many notes did I create last month?',
    'How many bookmarks did I save this week?',
    'How many code tasks did I create last month?',
    'Ile notatek zapisalem w zeszlym miesiacu?',
  ])('does not route non-calendar count questions to calendar queries: %s', (text) => {
    expect(classifyIntexAgentIntent(text)).toEqual({
      kind: 'no_action',
      reason: 'conversation',
    });
  });

  it('rejects mixed creation and calendar query intents', () => {
    expect(classifyIntexAgentIntent('Create a note and show me next week calendar events')).toEqual({
      kind: 'unsupported',
      reason: 'multiple_resource_intents',
    });
  });

  it('rejects mixed implicit link and calendar query intents', () => {
    expect(classifyIntexAgentIntent('https://example.com and show me tomorrow calendar events')).toEqual({
      kind: 'unsupported',
      reason: 'multiple_resource_intents',
    });
  });
});
