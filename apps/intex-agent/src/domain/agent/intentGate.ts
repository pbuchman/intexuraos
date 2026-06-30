import type { IntexAgentToolName } from '../sessions/types.js';

export type IntexAgentIntentDecision =
  | { kind: 'tool'; allowedToolNames: IntexAgentToolName[] }
  | { kind: 'no_action'; reason: 'greeting' | 'conversation' };

export function classifyIntexAgentIntent(text: string): IntexAgentIntentDecision {
  const normalized = normalizeIntentText(text);

  if (isGreeting(normalized)) {
    return { kind: 'no_action', reason: 'greeting' };
  }

  if (isBareUrl(text)) {
    return { kind: 'tool', allowedToolNames: ['create_link'] };
  }

  return { kind: 'no_action', reason: 'conversation' };
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

function normalizeIntentText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[?!.,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
