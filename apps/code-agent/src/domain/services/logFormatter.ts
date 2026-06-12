import type { Timestamp } from '@google-cloud/firestore';
import type { FormattedLogLine } from '../models/logLine.js';
import { stripSystemReminders } from './logFormatter/errorFormatter.js';
import {
  createFormatterState,
  formatAssistant,
  formatToolResult,
  formatToolUse,
  formatUser,
  registerToolContext,
  type FormatterState,
  type StreamJsonMessage,
} from './logFormatter/markdownFormatter.js';
import {
  flushCodexPartial,
  formatRawCodexLogChunk,
  formatResult,
  formatSystem,
} from './logFormatter/progressFormatter.js';

export { createFormatterState };
export type { FormatterState };

export type LogRuntime = 'claude' | 'codex';

function formatJsonMessage(obj: StreamJsonMessage, state: FormatterState): string {
  switch (obj.type) {
    case 'system': return formatSystem(obj);
    case 'assistant': return formatAssistant(obj);
    case 'tool_use': return formatToolUse(obj, state);
    case 'tool_result':
      return formatToolResult(typeof obj.content === 'string' ? obj.content : '', obj.is_error === true, state.lastToolName);
    case 'user': return formatUser(obj, state);
    case 'result': return formatResult(obj);
    default:
      // Suppress rate_limit_event; unknown types show compact [event] label
      if (obj.type === 'rate_limit_event') return '';
      return `[event] ${obj.type}`;
  }
}

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
  const hasExternalState = state !== undefined;
  const s = state ?? createFormatterState();

  // Prepend buffered partial line from previous chunk
  if (s.partialLine !== undefined && lines.length > 0) {
    /* v8 ignore start -- ts-type: String.split always returns dense array — cannot produce sparse result @preserve */
    lines[0] = s.partialLine + (lines[0] ?? '');
    /* v8 ignore stop @preserve */
    delete s.partialLine;
  }

  for (let i = 0; i < lines.length; i++) {
    /* v8 ignore start -- ts-type: Array indexing within bounds always returns defined for dense arrays @preserve */
    const line = lines[i] ?? '';
    /* v8 ignore stop @preserve */
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let text: string;
    const tsRegex = /^(\d{2}:\d{2}:\d{2}\.\d{3}) ([\s\S]*)$/;
    const tsMatch = tsRegex.exec(trimmed);
    let prefix = '';
    let body = trimmed;
    if (tsMatch !== null) {
      prefix = `${String(tsMatch[1])} `;
      /* v8 ignore start -- ts-type: regex capture group ?? fallback unreachable — exec always populates groups on match @preserve */
      body = tsMatch[2] ?? trimmed;
      /* v8 ignore stop @preserve */
    }

    try {
      const obj = JSON.parse(body) as StreamJsonMessage;
      registerToolContext(obj, s);
      const formatted = formatJsonMessage(obj, s);
      text = formatted !== '' && prefix !== '' ? `${prefix}${formatted}` : formatted;
    } catch {
      // If this is the last line and looks like incomplete JSON, buffer it for reassembly
      // Only buffer when external state is provided — stateless calls cannot reassemble
      if (hasExternalState && i === lines.length - 1 && body.startsWith('{"') && !body.endsWith('}')) {
        s.partialLine = trimmed;
        continue; // Skip — will be completed by next chunk
      }

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

export function formatLogChunkForRuntime(
  runtime: LogRuntime,
  raw: string,
  startSequence: number,
  timestamp: Timestamp,
  state?: FormatterState,
): FormattedLogLine[] {
  if (runtime === 'codex') {
    return formatRawCodexLogChunk(raw, startSequence, timestamp, state);
  }
  return formatLogChunk(raw, startSequence, timestamp, state);
}

export function flushLogChunkFormatterForRuntime(
  runtime: LogRuntime,
  startSequence: number,
  timestamp: Timestamp,
  state: FormatterState,
): FormattedLogLine[] {
  if (runtime !== 'codex') {
    return [];
  }
  return flushCodexPartial(startSequence, timestamp, state);
}
