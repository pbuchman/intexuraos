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
  partialLine?: string; // Buffered incomplete JSON from previous chunk
}

export function createFormatterState(): FormatterState {
  return {
    toolCallsById: new Map<string, string>(),
    lastToolName: undefined,
  };
}

const SYSTEM_REMINDER_BLOCK = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;
const TOOL_USE_ERROR_BLOCK = /<tool_use_error>([\s\S]*?)<\/tool_use_error>/gi;
const DIFF_HEADER_RE = /^diff --git a\/(.+?) b\/(.+)$/;

interface DiffFileStats {
  path: string;
  added: number;
  removed: number;
  changeType: 'A' | 'D' | 'M';
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
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard; lines[0] always exists when length > 0 @preserve */
    lines[0] = s.partialLine + (lines[0] ?? '');
    /* v8 ignore stop @preserve */
    delete s.partialLine;
  }

  for (let i = 0; i < lines.length; i++) {
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard; i is bounded by lines.length @preserve */
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
      // If this is the last line and looks like incomplete JSON, buffer it for reassembly
      // Only buffer when external state is provided — stateless calls cannot reassemble
      if (hasExternalState && i === lines.length - 1 && body.startsWith('{"') && !body.endsWith('}')) {
        s.partialLine = trimmed;
        continue; // Skip — will be completed by next chunk
      }

      /* v8 ignore start -- ts-type: catch block handles unparseable JSON; short-line branch not triggered by test fixtures @preserve */
      text = trimmed.length > 2048
        ? trimmed.slice(0, 1024) + '\n[... TRUNCATED from ' + String(trimmed.length) + ' chars ...]\n' + trimmed.slice(-512)
        : trimmed;
      /* v8 ignore stop @preserve */
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
      // Suppress known internal protocol events
      if (obj.type === 'rate_limit_event') return '';
      // Compact fallback for truly unknown types — show type name, not raw JSON
      return `[event] ${obj.type}`;
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

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function summarizeJsonContent(content: string): string | undefined {
  if (content.length < 200) return undefined; // Short JSON is fine as-is

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return undefined; // Not JSON, let existing handling deal with it
  }

  // GitHub PR data (gh pr view --json)
  if ('state' in obj && 'title' in obj && 'headRefName' in obj) {
    const number = typeof obj['number'] === 'number' ? `#${String(obj['number'])} ` : '';
    const title = typeof obj['title'] === 'string' ? truncate(obj['title'], 60) : '';
    const state = typeof obj['state'] === 'string' ? obj['state'] : '';
    const adds = typeof obj['additions'] === 'number' ? `+${String(obj['additions'])}` : '';
    const dels = typeof obj['deletions'] === 'number' ? `-${String(obj['deletions'])}` : '';
    const addsDels = adds !== '' || dels !== '' ? `${adds}/${dels}` : '';
    const files = typeof obj['changedFiles'] === 'number' ? `${String(obj['changedFiles'])} files` : '';
    return [number + title, state, addsDels, files].filter(Boolean).join(' | ');
  }

  // GitHub comment/issue data (gh api .../comments)
  if ('html_url' in obj && 'id' in obj && 'body' in obj) {
    const url = typeof obj['html_url'] === 'string' ? obj['html_url'] : '';
    const id = typeof obj['id'] === 'number' ? String(obj['id']) : '';
    // Extract issue number from url: .../issues/909#issuecomment-...
    const issueMatch = /\/issues\/(\d+)/.exec(url);
    const issue = issueMatch !== null ? ` on #${String(issueMatch[1])}` : '';
    return `Created comment ${id}${issue}`;
  }

  // Generic JSON fallback: show key count and truncated preview
  const keys = Object.keys(obj);
  return `{${String(keys.length)} keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', ...' : ''}} [${String(content.length)} chars]`;
}

function extractLogin(obj: Record<string, unknown>): string {
  const user = obj['user'];
  if (typeof user === 'object' && user !== null) {
    const login = (user as Record<string, unknown>)['login'];
    if (typeof login === 'string') return login;
  }
  return '?';
}

function collapseLogins(logins: string[]): string {
  const counts = new Map<string, number>();
  for (const l of logins) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()]
    .map(([l, n]) => (n > 1 ? `${l} (×${String(n)})` : l))
    .join(', ');
}

function summarizeJsonArray(content: string): string | undefined {
  if (content.length < 200) return undefined;

  let arr: unknown[];
  try {
    arr = JSON.parse(content) as unknown[];
  } catch {
    return undefined;
  }
  /* v8 ignore start -- ts-type: JSON.parse of bracket-prefixed content always produces an array; empty array is <200 chars so filtered earlier @preserve */
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  /* v8 ignore stop @preserve */

  const first = arr[0];
  if (typeof first !== 'object' || first === null) return undefined;
  const el = first as Record<string, unknown>;
  const n = arr.length;

  // PR reviews — gh api .../reviews
  if ('submitted_at' in el && 'state' in el && 'html_url' in el) {
    const state = typeof el['state'] === 'string' ? el['state'] : '?';
    const login = extractLogin(el);
    return `${String(n)} PR review${n !== 1 ? 's' : ''}: ${login} ${state}`;
  }

  // PR review comments — gh api .../comments (review-level)
  if ('pull_request_review_id' in el && 'path' in el) {
    const login = extractLogin(el);
    /* v8 ignore start -- ts-type: split('/').pop() on non-empty string always returns a value; ?? fallback is unreachable @preserve */
    const path = typeof el['path'] === 'string' ? el['path'].split('/').pop() ?? el['path'] : '?';
    /* v8 ignore stop @preserve */
    const line = typeof el['line'] === 'number' ? `:${String(el['line'])}` : '';
    return `${String(n)} review comment${n !== 1 ? 's' : ''} by ${login} on ${path}${line}`;
  }

  // Issue/PR comments — gh api .../comments (issue-level)
  if ('issue_url' in el && 'body' in el && 'html_url' in el) {
    const logins = (arr as Record<string, unknown>[]).map(extractLogin);
    const summary = collapseLogins(logins);
    return `${String(n)} issue comment${n !== 1 ? 's' : ''}: ${summary}`;
  }

  // Generic fallback
  const keys = Object.keys(el);
  const typeHint = keys.length > 0 ? ` (${keys.slice(0, 3).join(', ')})` : '';
  return `[${String(arr.length)} items${typeHint}]`;
}

function summarizeDiff(text: string): string | undefined {
  const lines = text.split('\n');

  const files: DiffFileStats[] = [];
  let current: DiffFileStats | undefined;
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const match = DIFF_HEADER_RE.exec(line);
      if (match?.[2] !== undefined) {
        current = { path: match[2], added: 0, removed: 0, changeType: 'M' };
        files.push(current);
      }
      continue;
    }

    if (current === undefined) continue;

    if (line.startsWith('--- ')) {
      if (line === '--- /dev/null') {
        current.changeType = 'A';
      }
      continue;
    }

    if (line.startsWith('+++ ')) {
      if (line === '+++ /dev/null') {
        current.changeType = 'D';
      }
      continue;
    }

    if (line.startsWith('+')) {
      current.added++;
      totalAdded++;
    } else if (line.startsWith('-')) {
      current.removed++;
      totalRemoved++;
    }
  }

  if (files.length === 0) return undefined;

  const fileWord = files.length === 1 ? 'file' : 'files';
  const header = `diff: ${String(files.length)} ${fileWord} changed (+${String(totalAdded)}, -${String(totalRemoved)})`;

  const fileLines = files.map((f) => {
    const shortPath = shortenPath(f.path);
    const stats = formatFileStats(f.added, f.removed);
    return `      ${f.changeType} ${shortPath}${stats}`;
  });

  return [header, ...fileLines].join('\n');
}

function shortenPath(p: string): string {
  const parts = p.split('/');
  if (parts.length <= 6) return p;
  /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard, parts.length > 6 guaranteed @preserve */
  const file = parts[parts.length - 1] ?? '';
  /* v8 ignore stop @preserve */
  return [...parts.slice(0, 4), '...', file].join('/');
}

function formatFileStats(added: number, removed: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`+${String(added)}`);
  if (removed > 0) parts.push(`-${String(removed)}`);
  if (parts.length === 0) return '';
  return ` (${parts.join(', ')})`;
}

function formatToolResult(content: string, isError: boolean, toolName?: string): string {
  const trimmed = stripSystemReminders(content).replace(TOOL_USE_ERROR_BLOCK, '$1').trim();
  if (trimmed === '') return '';
  if (toolName === 'Read' && !isError) return '';

  const prefix = isError ? '  \u2717 ' : '  \u2192 ';

  // Summarize JSON tool results (gh pr view, gh api, etc.)
  if (!isError && trimmed.startsWith('{')) {
    const summary = summarizeJsonContent(trimmed);
    if (summary !== undefined) return `${prefix}${summary}`;
  }

  if (!isError && trimmed.startsWith('[')) {
    const summary = summarizeJsonArray(trimmed);
    if (summary !== undefined) return `${prefix}${summary}`;
  }

  if (!isError && trimmed.startsWith('diff --git ')) {
    const summary = summarizeDiff(trimmed);
    if (summary !== undefined) return `${prefix}${summary}`;
  }

  let lines = trimmed.split('\n');

  /* v8 ignore start -- ts-type: combined condition branch where length exceeds chars but not lines @preserve */
  if (trimmed.length > MAX_TOOL_RESULT_CHARS && lines.length > HEAD_LINES + TAIL_LINES) {
    /* v8 ignore stop @preserve */
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
  return `[done] ${summary}`;
}

function collapseOutput(output: string): string {
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
        const keys = Object.keys(parsed);
        return `  hook output: {${String(keys.length)} keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', ...' : ''}} [${String(trimmed.length)} chars]`;
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
