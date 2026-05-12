import type { Timestamp } from '@google-cloud/firestore';
import type { FormattedLogLine } from '../../models/logLine.js';
import { stripSystemReminders } from './errorFormatter.js';
import {
  createFormatterState,
  formatObjectKeysSummary,
  type FormatterState,
  type StreamJsonMessage,
} from './markdownFormatter.js';

interface CodexFileChange {
  path?: string;
  kind?: string;
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
    text?: string;
    message?: string;
    command?: string;
    aggregated_output?: string;
    exit_code?: number | null;
    changes?: CodexFileChange[];
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

function formatRepoRelativePath(path: string): string {
  return path.startsWith('/repo/') ? path.slice('/repo/'.length) : path;
}

function formatCodexTurnCompleted(obj: CodexLogObject): string {
  const usage = obj.usage ?? {};
  const input = usage.input_tokens;
  const cached = usage.cached_input_tokens ?? 0;
  const output = usage.output_tokens;
  const cachePercent = input !== undefined && input > 0 ? Math.round((cached / input) * 100) : 0;
  const inputStr = input !== undefined ? String(input) : '?';
  const outputStr = output !== undefined ? String(output) : '?';
  return `[codex] Turn completed | input: ${inputStr} tokens (${String(cachePercent)}% cached) | output: ${outputStr} tokens`;
}

function formatCodexItemCompleted(obj: CodexLogObject): string[] | null {
  const item = obj.item;
  if (item === undefined) return null;

  if (item.type === 'agent_message' && typeof item.text === 'string') {
    return [`[msg] ${item.text}`];
  }

  if (item.type === 'error' && typeof item.message === 'string') {
    return [`[error] ${item.message}`];
  }

  if (item.type === 'command_execution' && typeof item.command === 'string') {
    const cmd = truncateLine(stripShellWrapper(item.command), MAX_CMD_LENGTH);
    const exitLabel = item.exit_code === 0 ? 'ok' : `EXIT ${String(item.exit_code ?? '?')}`;
    const trimmedOutput = (item.aggregated_output ?? '').trimEnd();
    const lineCount = trimmedOutput === '' ? 0 : trimmedOutput.split('\n').length;

    let result = `[cmd] $ ${cmd}  -> ${exitLabel} (${String(lineCount)} lines)`;
    const formattedOutput = formatCommandOutput(trimmedOutput);
    if (formattedOutput !== '') {
      result += '\n' + formattedOutput.slice(0, -1);
    }
    return [result];
  }

  if (item.type === 'file_change' && Array.isArray(item.changes)) {
    return item.changes.flatMap((change) => {
      if (typeof change.path !== 'string') return [];
      return [`[file] ${change.kind ?? 'change'} ${formatRepoRelativePath(change.path)}`];
    });
  }

  return null;
}

function formatCodexJsonLine(jsonLine: string): string[] | null {
  try {
    const obj = JSON.parse(jsonLine) as CodexLogObject;

    if (obj.type === 'thread.started' && typeof obj.thread_id === 'string') {
      return [`[codex] Session started: thread=${obj.thread_id}`];
    }
    if (obj.type === 'turn.started') return ['[codex] Turn started'];
    if (obj.type === 'turn.completed') return [formatCodexTurnCompleted(obj)];
    if (obj.type === 'turn.failed') return [`[error] ${obj.error?.message ?? 'Codex turn failed'}`];
    if (obj.type === 'error' && typeof obj.message === 'string') return [`[error] ${obj.message}`];
    if (obj.type === 'item.started') return null;
    if (obj.type === 'item.completed') return formatCodexItemCompleted(obj) ?? ['[event] item.completed'];
    if (typeof obj.type === 'string') return [`[event] ${obj.type}`];
    return [jsonLine];
  } catch {
    return [jsonLine];
  }
}

export function formatSystem(obj: StreamJsonMessage): string {
  const sub = obj.subtype;

  if (sub === 'hook_started') {
    return `[hook] ${obj.hook_name ?? 'unknown'} started`;
  }

  if (sub === 'hook_response') {
    const status = obj.exit_code === 0 ? '✓' : '✗';
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
        .map((s) => `${s.name} ${s.status === 'connected' ? '✓' : '✗'}`)
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

export function formatResult(obj: StreamJsonMessage): string {
  if (obj.is_error === true) {
    return `[error] ${obj.result ?? 'Task failed'}`;
  }

  const parts: string[] = [];
  const duration = obj.duration_ms ?? obj.duration_api_ms;
  if (typeof duration === 'number') parts.push(`${(duration / 1000).toFixed(1)}s`);
  if (typeof obj.num_turns === 'number') parts.push(`${String(obj.num_turns)} turns`);
  if (typeof obj.total_cost_usd === 'number') parts.push(`$${obj.total_cost_usd.toFixed(3)}`);

  const summary = parts.length > 0 ? parts.join(', ') : 'Completed';
  return `[done] ${summary}`;
}

export function collapseOutput(output: string): string {
  const cleaned = stripSystemReminders(output);
  const trimmed = cleaned.trim();

  // Summarize large JSON hook output into a compact one-liner
  if (trimmed.length >= 200) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return `  hook output: [${String(parsed.length)} items] [${String(trimmed.length)} chars]`;
      }
      if (typeof parsed === 'object' && parsed !== null) {
        return `  hook output: ${formatObjectKeysSummary(Object.keys(parsed), trimmed.length)}`;
      }
    } catch {
      // Not JSON — fall through to line-by-line indenting
    }
  }

  const lines = cleaned
    .split('\n')
    .filter((l) => l.trim() !== '');
  return lines.map((l) => `  ${l}`).join('\n');
}

export function formatRawCodexLogChunk(
  raw: string,
  startSequence: number,
  timestamp: Timestamp,
  state?: FormatterState,
): FormattedLogLine[] {
  if (raw === '') return [];

  const lines = raw.split('\n');
  const result: FormattedLogLine[] = [];
  let seq = startSequence * 1000;
  const hasExternalState = state !== undefined;
  const s: FormatterState = state ?? createFormatterState();

  if (s.partialLine !== undefined && lines.length > 0) {
    /* v8 ignore start -- ts-type: String.split always returns a dense array, so lines[0] is defined when length > 0 @preserve */
    lines[0] = s.partialLine + (lines[0] ?? '');
    /* v8 ignore stop @preserve */
    delete s.partialLine;
  }

  const endsWithNewline = raw.endsWith('\n');
  for (let i = 0; i < lines.length; i++) {
    /* v8 ignore start -- ts-type: Array indexing within bounds on split output is always defined for dense arrays @preserve */
    const line = lines[i] ?? '';
    /* v8 ignore stop @preserve */
    const isLastLine = i === lines.length - 1;

    if (hasExternalState && isLastLine && !endsWithNewline) {
      s.partialLine = line;
      continue;
    }

    if (line.trim() === '') continue;
    const formattedLines = formatCodexJsonLine(line);
    if (formattedLines === null) continue;
    for (const formatted of formattedLines) {
      result.push({ sequence: seq++, text: formatted, timestamp });
    }
  }

  return result;
}

export function flushCodexPartial(
  startSequence: number,
  timestamp: Timestamp,
  state: FormatterState,
): FormattedLogLine[] {
  if (state.partialLine === undefined) {
    return [];
  }

  const line = state.partialLine;
  delete state.partialLine;

  if (line.trim() === '') {
    return [];
  }

  const formattedLines = formatCodexJsonLine(line);
  if (formattedLines === null) return [];
  let seq = startSequence * 1000;
  return formattedLines.map((formatted) => ({ sequence: seq++, text: formatted, timestamp }));
}
