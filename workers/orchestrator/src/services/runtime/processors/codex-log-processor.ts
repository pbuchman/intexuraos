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
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
  };
  item?: {
    type?: string;
    id?: string;
    text?: string;
    message?: string;
    command?: string;
    aggregated_output?: string;
    exit_code?: number | null;
    status?: string;
  };
}

const MAX_LINE_LENGTH = 200;
const MAX_CMD_LENGTH = 300;
const MAX_OUTPUT_LINES = 20;
const OUTPUT_HEAD_LINES = 12;
const OUTPUT_TAIL_LINES = 5;

function truncateLine(line: string, max = MAX_LINE_LENGTH): string {
  if (line.length <= max) return line;
  return line.slice(0, max) + ' [...]';
}

function stripShellWrapper(command: string): string {
  const match = /^\/bin\/sh -lc (?:"([\s\S]*)"|'([\s\S]*)')$/.exec(command);
  /* v8 ignore start -- ts-type: regex alternation guarantees one capture group is always defined, but TS types both as string | undefined @preserve */
  if (match !== null) return match[1] ?? match[2] ?? command;
  /* v8 ignore stop @preserve */
  return command;
}

function gutterLine(line: string): string {
  return `    | ${truncateLine(line)}`;
}

function formatCommandOutput(output: string): string {
  if (output === '') return '';

  const lines = output.split('\n');

  if (lines.length <= MAX_OUTPUT_LINES) {
    return lines.map(gutterLine).join('\n') + '\n';
  }

  const head = lines.slice(0, OUTPUT_HEAD_LINES).map(gutterLine);
  const tail = lines.slice(-OUTPUT_TAIL_LINES).map(gutterLine);
  const omitted = lines.length - OUTPUT_HEAD_LINES - OUTPUT_TAIL_LINES;
  return [...head, `    | [... ${String(omitted)} lines omitted ...]`, ...tail].join('\n') + '\n';
}

function formatTurnCompleted(obj: CodexLogObject): string {
  const u = obj.usage ?? {};
  const input = u.input_tokens;
  const cached = u.cached_input_tokens ?? 0;
  const output = u.output_tokens;
  const cachePercent = input !== undefined && input > 0 ? Math.round((cached / input) * 100) : 0;
  const inputStr = input !== undefined ? String(input) : '?';
  const outputStr = output !== undefined ? String(output) : '?';
  return `[codex] Turn completed | input: ${inputStr} tokens (${String(cachePercent)}% cached) | output: ${outputStr} tokens`;
}

function formatItemCompleted(obj: CodexLogObject): string | null {
  const item = obj.item;
  if (item === undefined) return null;

  if (item.type === 'agent_message' && typeof item.text === 'string') {
    return `[msg] ${item.text}`;
  }

  if (item.type === 'command_execution' && typeof item.command === 'string') {
    const cmd = truncateLine(stripShellWrapper(item.command), MAX_CMD_LENGTH);
    const exitLabel = item.exit_code === 0 ? 'ok' : `EXIT ${String(item.exit_code ?? '?')}`;
    const trimmedOutput = (item.aggregated_output ?? '').trimEnd();
    const lineCount = trimmedOutput === '' ? 0 : trimmedOutput.split('\n').length;

    let result = `[cmd] $ ${cmd}  → ${exitLabel} (${String(lineCount)} lines)`;
    const formattedOutput = formatCommandOutput(trimmedOutput);
    if (formattedOutput !== '') {
      result += '\n' + formattedOutput.slice(0, -1);
    }
    return result;
  }

  return null;
}

function formatJsonLine(jsonLine: string): string | null {
  try {
    const obj = JSON.parse(jsonLine) as CodexLogObject;
    const type = obj.type;

    if (type === 'thread.started' && typeof obj.thread_id === 'string') {
      return `[codex] Session started: thread=${obj.thread_id}`;
    }

    if (type === 'turn.started') {
      return '[codex] Turn started';
    }

    if (type === 'turn.completed') {
      return formatTurnCompleted(obj);
    }

    if (type === 'item.started') {
      return null; // signal removal
    }

    if (type === 'item.completed') {
      return formatItemCompleted(obj) ?? jsonLine;
    }

    if (type === 'error' && typeof obj.message === 'string') {
      return `[error] ${obj.message}`;
    }

    return jsonLine;
  } catch {
    return jsonLine;
  }
}

export function formatCodexMessages(text: string): string {
  const result = text.replace(/^(\{.+\})(\n?)$/gm, (_match, jsonLine: string, nl: string) => {
    const formatted = formatJsonLine(jsonLine);
    if (formatted === null) return ''; // remove entire line including newline
    return formatted + nl;
  });
  return result;
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

interface BufferResult {
  completeText: string;
  events: RuntimeEvent[];
}

function processBufferedLines(state: CodexAttemptState, chunk: string): BufferResult {
  const buffered = `${state.logBuffer}${chunk}`;
  const lines = buffered.split('\n');
  /* v8 ignore start -- ts-type: split() always returns at least one element, but pop() remains nullable in types @preserve */
  const remainder = lines.pop() ?? '';
  /* v8 ignore stop @preserve */
  state.logBuffer = remainder;

  const events: RuntimeEvent[] = [];
  const completedLines: string[] = [];

  for (const line of lines) {
    completedLines.push(line);
    events.push(...parseCodexLogLine(state, line));
  }

  if (remainder.includes('"type":"turn.completed"') || remainder.includes('"type":"turn.failed"')) {
    try {
      const jsonStart = remainder.indexOf('{');
      if (jsonStart !== -1) {
        JSON.parse(remainder.slice(jsonStart));
        completedLines.push(remainder);
        events.push(...parseCodexLogLine(state, remainder));
        state.logBuffer = '';
      }
    } catch {
      // Incomplete JSON — keep buffering.
    }
  }

  const completeText = completedLines.length > 0 ? completedLines.join('\n') + '\n' : '';

  return { completeText, events };
}

export const codexLogProcessor: RuntimeLogProcessor<CodexAttemptState> = {
  processChunk(state, chunk) {
    if (chunk === '') return [];

    const { completeText, events } = processBufferedLines(state, chunk);
    const result: RuntimeEvent[] = [];

    if (completeText !== '') {
      result.push({ type: 'log', text: formatCodexMessages(completeText) });
    }
    result.push(...events);

    return result;
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
