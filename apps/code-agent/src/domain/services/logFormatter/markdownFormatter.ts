import {
  formatErrorToolResult,
  renderIndentedToolResult,
  stripSystemReminders,
  TOOL_USE_ERROR_BLOCK,
} from './errorFormatter.js';

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

export interface StreamJsonMessage {
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

const DIFF_HEADER_RE = /^diff --git a\/(.+?) b\/(.+)$/;

interface DiffFileStats {
  path: string;
  added: number;
  removed: number;
  changeType: 'A' | 'D' | 'M';
}

export function formatAssistant(obj: StreamJsonMessage): string {
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

export function formatToolUse(obj: StreamJsonMessage, state: FormatterState): string {
  const name = obj.tool_name ?? 'unknown';
  state.lastToolName = name;
  if (typeof obj.id === 'string') {
    state.toolCallsById.set(obj.id, name);
  }
  const ctx = extractToolContext(obj.tool_input);
  return `[tool] ${name}${ctx !== undefined ? `: ${ctx}` : ''}`;
}

export function formatUser(obj: StreamJsonMessage, state: FormatterState): string {
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

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

export function formatObjectKeysSummary(keys: string[], charCount: number): string {
  return `{${String(keys.length)} keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', ...' : ''}} [${String(charCount)} chars]`;
}

export function summarizeJsonContent(content: string): string | undefined {
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
  return formatObjectKeysSummary(Object.keys(obj), content.length);
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

export function summarizeJsonArray(content: string): string | undefined {
  if (content.length < 200) return undefined;

  let arr: unknown[];
  try {
    arr = JSON.parse(content) as unknown[];
  } catch {
    return undefined;
  }
  if (!Array.isArray(arr) || arr.length === 0) return undefined;

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
    /* v8 ignore start -- ts-type: String.split always returns ≥1 element — cannot produce empty split result @preserve */
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

export function summarizeDiff(text: string): string | undefined {
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
  /* v8 ignore start -- ts-type: String.split always returns dense array — cannot produce sparse result @preserve */
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

export function formatToolResult(content: string, isError: boolean, toolName?: string): string {
  if (isError) {
    return formatErrorToolResult(content);
  }

  const trimmed = stripSystemReminders(content).replace(TOOL_USE_ERROR_BLOCK, '$1').trim();
  if (trimmed === '') return '';
  if (toolName === 'Read') return '';

  const prefix = '  → ';

  // Summarize JSON tool results (gh pr view, gh api, etc.)
  if (trimmed.startsWith('{')) {
    const summary = summarizeJsonContent(trimmed);
    if (summary !== undefined) return `${prefix}${summary}`;
  }

  if (trimmed.startsWith('[')) {
    const summary = summarizeJsonArray(trimmed);
    if (summary !== undefined) return `${prefix}${summary}`;
  }

  if (trimmed.startsWith('diff --git ')) {
    const summary = summarizeDiff(trimmed);
    if (summary !== undefined) return `${prefix}${summary}`;
  }

  return renderIndentedToolResult(trimmed, prefix);
}

export function registerToolContext(obj: StreamJsonMessage, state: FormatterState): void {
  if (obj.type === 'tool_use') {
    const name = obj.tool_name;
    if (typeof name === 'string') {
      state.lastToolName = name;
      if (typeof obj.id === 'string') {
        state.toolCallsById.set(obj.id, name);
      }
    }
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

export function extractToolContext(input: Record<string, unknown> | undefined): string | undefined {
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
