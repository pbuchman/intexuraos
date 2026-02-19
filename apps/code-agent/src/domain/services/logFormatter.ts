import type { Timestamp } from '@google-cloud/firestore';
import type { FormattedLogLine } from '../models/logLine.js';

interface StreamJsonMessage {
  type: string;
  subtype?: string;
  id?: string;
  message?: {
    role?: string;
    content?: {
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: string;
      is_error?: boolean;
    }[];
  };
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  content?: string;
  result?: string;
  duration_ms?: number;
  duration_api_ms?: number;
  total_cost_usd?: number;
  num_turns?: number;
  is_error?: boolean;
  hook_name?: string;
  hook_id?: string;
  exit_code?: number;
  output?: string;
  model?: string;
  tools?: string[];
  mcp_servers?: { name: string; status: string }[];
}

export interface FormatterState {
  toolCallsById: Map<string, string>;
  lastToolName: string | undefined; // @allow-undefined-type -- mutable state field, always present but nullable
}

export function createFormatterState(): FormatterState {
  return {
    toolCallsById: new Map<string, string>(),
    lastToolName: undefined,
  };
}

const SYSTEM_REMINDER_BLOCK = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;

export function formatLogChunk(
  raw: string,
  startSequence: number,
  timestamp: Timestamp,
  state?: FormatterState,
): FormattedLogLine[] {
  if (raw === '') return [];

  const lines = raw.split('\n');
  const result: FormattedLogLine[] = [];
  let seq = startSequence * 1000;
  const s = state ?? createFormatterState();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let text: string;
    const tsRegex = /^(\d{2}:\d{2}:\d{2}\.\d{3}) ([\s\S]*)$/;
    const tsMatch = tsRegex.exec(trimmed);
    let prefix = '';
    let body = trimmed;
    if (tsMatch !== null) {
      prefix = `${String(tsMatch[1])} `;
      /* v8 ignore start -- regex: capture group 2 always exists when regex matches @preserve */
      body = tsMatch[2] ?? trimmed;
      /* v8 ignore stop @preserve */
    }

    try {
      const obj = JSON.parse(body) as StreamJsonMessage;
      registerToolContext(obj, s);
      const formatted = formatJsonMessage(obj, s);
      text = formatted !== '' && prefix !== '' ? `${prefix}${formatted}` : formatted;
    } catch {
      text = trimmed.length > 2048
        ? trimmed.slice(0, 1024) + '\n[... TRUNCATED from ' + String(trimmed.length) + ' chars ...]\n' + trimmed.slice(-512)
        : trimmed;
    }

    text = stripSystemReminders(text);
    if (text === '') continue;

    result.push({ sequence: seq++, text, timestamp });
  }

  return result;
}

function formatJsonMessage(obj: StreamJsonMessage, state: FormatterState): string {
  switch (obj.type) {
    case 'system':
      return formatSystem(obj);
    case 'assistant':
      return formatAssistant(obj);
    case 'tool_use':
      return formatToolUse(obj, state);
    case 'tool_result':
      return formatToolResult(
        typeof obj.content === 'string' ? obj.content : '',
        obj.is_error === true,
        state.lastToolName
      );
    case 'user':
      return formatUser(obj, state);
    case 'result':
      return formatResult(obj);
    default:
      return JSON.stringify(obj);
  }
}

function formatSystem(obj: StreamJsonMessage): string {
  const sub = obj.subtype;

  if (sub === 'hook_started') {
    return `[hook] ${obj.hook_name ?? 'unknown'} started`;
  }

  if (sub === 'hook_response') {
    const status = obj.exit_code === 0 ? '\u2713' : '\u2717';
    let line = `[hook] ${obj.hook_name ?? 'unknown'} ${status} (exit ${String(obj.exit_code ?? '?')})`;

    if (typeof obj.output === 'string' && obj.output.trim() !== '') {
      line += '\n' + collapseOutput(obj.output);
    }

    return line;
  }

  if (sub === 'init') {
    const parts: string[] = [];
    if (typeof obj.model === 'string') parts.push(`Model: ${obj.model}`);
    if (Array.isArray(obj.tools)) parts.push(`Tools: ${String(obj.tools.length)}`);
    if (Array.isArray(obj.mcp_servers) && obj.mcp_servers.length > 0) {
      const servers = obj.mcp_servers
        .map((s) => `${s.name} ${s.status === 'connected' ? '\u2713' : '\u2717'}`)
        .join(', ');
      parts.push(`MCP: ${servers}`);
    }
    return `[init] ${parts.join(' | ')}`;
  }

  if (typeof sub === 'string') {
    return `[system] ${sub}`;
  }

  return '[system]';
}

function formatAssistant(obj: StreamJsonMessage): string {
  const content = obj.message?.content;
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];

  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      parts.push(`[claude] ${block.text}`);
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      const ctx = extractToolContext(block.input);
      parts.push(`[tool] ${block.name}${ctx !== undefined ? `: ${ctx}` : ''}`);
    }
  }

  return parts.join('\n');
}

function formatToolUse(obj: StreamJsonMessage, state: FormatterState): string {
  const name = obj.tool_name ?? 'unknown';
  state.lastToolName = name;
  /* v8 ignore start -- test-infra: some stream-json tool_use events omit id field in fixture logs @preserve */
  if (typeof obj.id === 'string') {
    state.toolCallsById.set(obj.id, name);
  }
  /* v8 ignore stop @preserve */
  const ctx = extractToolContext(obj.tool_input);
  return `[tool] ${name}${ctx !== undefined ? `: ${ctx}` : ''}`;
}

function formatUser(obj: StreamJsonMessage, state: FormatterState): string {
  const content = obj.message?.content;
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];

  for (const block of content) {
    if (block.type === 'tool_result') {
      const toolName =
        typeof block.tool_use_id === 'string'
          ? state.toolCallsById.get(block.tool_use_id)
          : state.lastToolName;
      const text = formatToolResult(
        typeof block.content === 'string' ? block.content : '',
        block.is_error === true,
        toolName
      );
      if (text !== '') parts.push(text);
    }
  }

  return parts.join('\n');
}

const MAX_TOOL_RESULT_CHARS = 2048;
const HEAD_LINES = 10;
const TAIL_LINES = 40;

function formatToolResult(content: string, isError: boolean, toolName?: string): string {
  const trimmed = stripSystemReminders(content).trim();
  if (trimmed === '') return '';
  if (toolName === 'Read' && !isError) return '';

  const prefix = isError ? '  \u2717 ' : '  \u2192 ';
  let lines = trimmed.split('\n');

  if (trimmed.length > MAX_TOOL_RESULT_CHARS && lines.length > HEAD_LINES + TAIL_LINES) {
    const head = lines.slice(0, HEAD_LINES);
    const tail = lines.slice(-TAIL_LINES);
    const omitted = lines.length - HEAD_LINES - TAIL_LINES;
    lines = [...head, `[... ${String(omitted)} lines omitted ...]`, ...tail];
  }

  return lines
    .map((line, index) => (index === 0 ? `${prefix}${line}` : `    ${line}`))
    .join('\n');
}

function formatResult(obj: StreamJsonMessage): string {
  if (obj.is_error === true) {
    return `[error] ${obj.result ?? 'Task failed'}`;
  }

  const parts: string[] = [];
  const duration = obj.duration_ms ?? obj.duration_api_ms;
  if (typeof duration === 'number') parts.push(`${(duration / 1000).toFixed(1)}s`);
  if (typeof obj.num_turns === 'number') parts.push(`${String(obj.num_turns)} turns`);
  if (typeof obj.total_cost_usd === 'number') parts.push(`$${obj.total_cost_usd.toFixed(3)}`);

  const summary = parts.length > 0 ? parts.join(', ') : 'Completed';
  const resultText =
    typeof obj.result === 'string' && obj.result.trim() !== '' ? `\n${obj.result}` : '';
  return `[done] ${summary}${resultText}`;
}

function collapseOutput(output: string): string {
  const lines = stripSystemReminders(output)
    .split('\n')
    .filter((l) => l.trim() !== '');
  return lines.map((l) => `  ${l}`).join('\n');
}

function stripSystemReminders(input: string): string {
  if (!input.includes('<system-reminder>')) return input;
  const withoutReminder = input.replace(SYSTEM_REMINDER_BLOCK, '');
  return withoutReminder.replace(/\n{2,}/g, '\n').trimEnd();
}

function registerToolContext(obj: StreamJsonMessage, state: FormatterState): void {
  if (obj.type === 'tool_use') {
    const name = obj.tool_name;
    /* v8 ignore start -- test-infra: fixture coverage focuses tool_result correlation and not non-string tool names @preserve */
    if (typeof name === 'string') {
      state.lastToolName = name;
      /* v8 ignore start -- test-infra: some stream-json tool_use events omit id field in fixture logs @preserve */
      if (typeof obj.id === 'string') {
        state.toolCallsById.set(obj.id, name);
      }
      /* v8 ignore stop @preserve */
    }
    /* v8 ignore stop @preserve */
    return;
  }

  if (obj.type !== 'assistant') return;

  const content = obj.message?.content;
  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (block.type !== 'tool_use' || typeof block.name !== 'string') continue;
    state.lastToolName = block.name;
    if (typeof block.id === 'string') {
      state.toolCallsById.set(block.id, block.name);
    }
  }
}

function extractToolContext(input: Record<string, unknown> | undefined): string | undefined {
  if (input === undefined) return undefined;

  if (typeof input['file_path'] === 'string') {
    return input['file_path'];
  }
  if (typeof input['command'] === 'string') {
    const cmd = input['command'];
    return cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
  }
  if (typeof input['pattern'] === 'string') {
    return input['pattern'];
  }
  if (typeof input['query'] === 'string') {
    const q = input['query'];
    return q.length > 60 ? q.slice(0, 57) + '...' : q;
  }
  if (typeof input['description'] === 'string') {
    const d = input['description'];
    return d.length > 60 ? d.slice(0, 57) + '...' : d;
  }
  if (typeof input['url'] === 'string') {
    const u = input['url'];
    return u.length > 80 ? u.slice(0, 77) + '...' : u;
  }
  if (typeof input['skill'] === 'string') {
    return input['skill'];
  }
  return undefined;
}
