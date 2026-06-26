export type SessionCommandResult =
  | { kind: 'none' }
  | { kind: 'start_new'; requestText: string | null };

const START_NEW_PATTERNS = [
  '/new',
  'new session',
  'start new session',
  'start over',
  'forget this and start over',
];

export function detectSessionCommand(text: string): SessionCommandResult {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  for (const command of START_NEW_PATTERNS) {
    if (lower === command) {
      return { kind: 'start_new', requestText: null };
    }

    const prefix = `${command}:`;
    if (lower.startsWith(prefix)) {
      const requestText = trimmed.slice(prefix.length).trim();
      return {
        kind: 'start_new',
        requestText: requestText === '' ? null : requestText,
      };
    }
  }

  return { kind: 'none' };
}
