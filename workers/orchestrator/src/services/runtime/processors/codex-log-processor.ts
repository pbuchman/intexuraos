import type { RuntimeAttemptState, RuntimeEvent, RuntimeLogProcessor } from '../types.js';

export interface CodexAttemptState extends RuntimeAttemptState {
  logBuffer: string;
  completionSignaled: boolean;
  latestErrorMessage?: string;
  sessionId?: string;
}

interface CodexLogObject {
  type?: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string };
  item?: {
    type?: string;
    text?: string;
    message?: string;
  };
}

function parseCodexLogLine(state: CodexAttemptState, line: string): RuntimeEvent[] {
  const trimmed = line.trim();
  if (trimmed === '') return [];

  const jsonStart = trimmed.indexOf('{');
  if (jsonStart === -1) return [];

  try {
    const obj = JSON.parse(trimmed.slice(jsonStart)) as CodexLogObject;
    const events: RuntimeEvent[] = [];

    if (
      obj.type === 'thread.started' &&
      typeof obj.thread_id === 'string' &&
      obj.thread_id !== '' &&
      state.sessionId !== obj.thread_id
    ) {
      state.sessionId = obj.thread_id;
      events.push({ type: 'runtime_session_started', sessionId: obj.thread_id });
    }

    if (obj.type === 'error' && typeof obj.message === 'string' && obj.message !== '') {
      state.latestErrorMessage = obj.message;
    }

    if (
      obj.type === 'item.completed' &&
      obj.item?.type === 'error' &&
      typeof obj.item.message === 'string' &&
      obj.item.message !== ''
    ) {
      state.latestErrorMessage = obj.item.message;
    }

    if (obj.type === 'turn.completed' && !state.completionSignaled) {
      state.completionSignaled = true;
      events.push({ type: 'attempt_completed', exitCode: 0 });
    }

    if (obj.type === 'turn.failed' && !state.completionSignaled) {
      state.completionSignaled = true;
      events.push({
        type: 'attempt_failed',
        exitCode: 1,
        errorMessage: obj.error?.message ?? state.latestErrorMessage ?? 'Codex turn failed',
      });
    }

    return events;
  } catch {
    return [];
  }
}

function processBufferedLines(state: CodexAttemptState, chunk: string): RuntimeEvent[] {
  const buffered = `${state.logBuffer}${chunk}`;
  const lines = buffered.split('\n');
  /* v8 ignore start -- ts-type: split() always returns at least one element, but pop() remains nullable in types @preserve */
  const remainder = lines.pop() ?? '';
  /* v8 ignore stop @preserve */
  state.logBuffer = remainder;

  const events: RuntimeEvent[] = [];
  for (const line of lines) {
    events.push(...parseCodexLogLine(state, line));
  }

  if (remainder.includes('"type":"turn.completed"') || remainder.includes('"type":"turn.failed"')) {
    try {
      const jsonStart = remainder.indexOf('{');
      if (jsonStart !== -1) {
        JSON.parse(remainder.slice(jsonStart));
        events.push(...parseCodexLogLine(state, remainder));
        state.logBuffer = '';
      }
    } catch {
      // Incomplete JSON — keep buffering.
    }
  }

  return events;
}

export const codexLogProcessor: RuntimeLogProcessor<CodexAttemptState> = {
  processChunk(state, chunk) {
    const events: RuntimeEvent[] = [];
    if (chunk !== '') {
      events.push({ type: 'log', text: chunk });
    }
    events.push(...processBufferedLines(state, chunk));
    return events;
  },
  flushState(state) {
    if (state.logBuffer.trim() === '') {
      state.logBuffer = '';
      return [];
    }

    const events = parseCodexLogLine(state, state.logBuffer);
    state.logBuffer = '';
    return events;
  },
};
