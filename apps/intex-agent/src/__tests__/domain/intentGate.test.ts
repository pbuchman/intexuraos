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
    'https://example.com',
  ])('does not allow implicit resource creation: %s', (text) => {
    const decision = classifyIntexAgentIntent(text);

    expect(decision.kind).not.toBe('tool');
  });

  it.each([
    'Ciekawy jestem, co jutro jest w kalendarzu',
    'Nie możesz dla mnie sprawdzić, co jest jutro w kalendarzu?',
    'Show me tomorrow calendar events',
  ])('blocks read-only calendar requests before tool calling: %s', (text) => {
    expect(classifyIntexAgentIntent(text)).toEqual({
      kind: 'unsupported',
      reason: 'read_only_personal_data',
    });
  });
});
