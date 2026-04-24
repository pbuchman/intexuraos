import type { Timestamp } from '@google-cloud/firestore';
import type { FormattedLogLine } from '../../models/logLine.js';
import { stripSystemReminders } from './errorFormatter.js';
import {
  createFormatterState,
  formatObjectKeysSummary,
  type FormatterState,
  type StreamJsonMessage,
} from './markdownFormatter.js';

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
    result.push({ sequence: seq++, text: line, timestamp });
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

  return [{ sequence: startSequence * 1000, text: line, timestamp }];
}

