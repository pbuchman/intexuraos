import type { Timestamp } from '@google-cloud/firestore';
import type { FormattedLogLine } from '../models/logLine.js';

interface StreamJsonMessage {
  type: string;
  subtype?: string;
  message?: {
    role?: string;
    content?: {
      type: string;
      text?: string;
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

export function formatLogChunk(raw: string, startSequence: number, timestamp: Timestamp): FormattedLogLine[] {
  if (raw === '') return [];

  const lines = raw.split('\n');
  const result: FormattedLogLine[] = [];
  let seq = startSequence * 1000;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let text: string;
    try {
      const obj = JSON.parse(trimmed) as StreamJsonMessage;
      text = formatJsonMessage(obj);
    } catch {
      text = trimmed;
    }

    if (text === '') continue;

    result.push({ sequence: seq++, text, timestamp });
  }

  return result;
}

function formatJsonMessage(obj: StreamJsonMessage): string {
  switch (obj.type) {
    case 'system':
      return formatSystem(obj);
    case 'assistant':
      return formatAssistant(obj);
    case 'tool_use':
      return formatToolUse(obj);
    case 'tool_result':
      return formatToolResult(typeof obj.content === 'string' ? obj.content : '', obj.is_error === true);
    case 'user':
      return formatUser(obj);
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
      parts.push(block.text);
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      const ctx = extractToolContext(block.input);
      parts.push(`[tool] ${block.name}${ctx !== undefined ? `: ${ctx}` : ''}`);
    }
  }

  return parts.join('\n');
}

function formatToolUse(obj: StreamJsonMessage): string {
  const name = obj.tool_name ?? 'unknown';
  const ctx = extractToolContext(obj.tool_input);
  return `[tool] ${name}${ctx !== undefined ? `: ${ctx}` : ''}`;
}

function formatUser(obj: StreamJsonMessage): string {
  const content = obj.message?.content;
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];

  for (const block of content) {
    if (block.type === 'tool_result') {
      const text = formatToolResult(typeof block.content === 'string' ? block.content : '', block.is_error === true);
      if (text !== '') parts.push(text);
    }
  }

  return parts.join('\n');
}

function formatToolResult(content: string, isError: boolean): string {
  const trimmed = content.trim();
  if (trimmed === '') return '';

  const prefix = isError ? '  \u2717 ' : '  \u2192 ';
  const lines = trimmed.split('\n');
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

  if (parts.length === 0) return '[done] Completed';
  return `[done] ${parts.join(', ')}`;
}

function collapseOutput(output: string): string {
  const lines = output.split('\n').filter((l) => l.trim() !== '');
  return lines.map((l) => `  ${l}`).join('\n');
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
  return undefined;
}
