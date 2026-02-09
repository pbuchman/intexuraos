const DOCKER_HEADER_SIZE = 8;

interface StreamJsonMessage {
  type: string;
  subtype?: string;
  message?: {
    content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[];
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
}

/**
 * Strip Docker multiplexed stream headers from raw log content.
 * Docker attach/logs streams prefix each frame with 8 bytes:
 *   [stream_type, 0, 0, 0, size_b3, size_b2, size_b1, size_b0]
 *
 * Headers can appear both at line starts AND mid-content when a long
 * message (e.g. hook_response JSON) spans multiple Docker frames.
 * We scan the entire string for the binary pattern and remove all matches.
 */
function stripDockerHeaders(raw: string): string {
  let result = '';
  let i = 0;
  while (i < raw.length) {
    if (i + DOCKER_HEADER_SIZE <= raw.length && isDockerHeaderAt(raw, i)) {
      i += DOCKER_HEADER_SIZE;
    } else {
      result += raw.charAt(i);
      i++;
    }
  }
  return result;
}

function isDockerHeaderAt(str: string, pos: number): boolean {
  const streamType = str.charCodeAt(pos);
  if (streamType > 2) return false;
  return (
    str.charCodeAt(pos + 1) === 0 && str.charCodeAt(pos + 2) === 0 && str.charCodeAt(pos + 3) === 0
  );
}

function formatJsonLine(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;

  let obj: StreamJsonMessage;
  try {
    obj = JSON.parse(trimmed) as StreamJsonMessage;
  } catch {
    return line;
  }

  switch (obj.type) {
    case 'system':
      return formatSystem(obj);
    case 'assistant':
      return formatAssistant(obj);
    case 'result':
      return formatResult(obj);
    case 'tool_use':
      return formatToolUse(obj);
    case 'tool_result':
      return formatToolResult(obj);
    default:
      return null;
  }
}

function formatSystem(obj: StreamJsonMessage): string | null {
  if (obj.subtype === 'hook_started' || obj.subtype === 'hook_response' || obj.subtype === 'init') {
    return null;
  }
  return `[system] ${obj.subtype ?? ''}`;
}

function formatAssistant(obj: StreamJsonMessage): string | null {
  const contents = obj.message?.content;
  if (!Array.isArray(contents)) return null;

  const texts: string[] = [];
  for (const block of contents) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      texts.push(block.text);
    }
    if (block.type === 'tool_use' && typeof block.name === 'string') {
      texts.push(`[tool] ${block.name}${extractToolContext(block.input)}`);
    }
  }

  if (texts.length === 0) return null;
  return texts.join('\n');
}

function formatResult(obj: StreamJsonMessage): string | null {
  if (obj.subtype === 'success' || obj.is_error !== true) {
    const duration =
      typeof obj.duration_ms === 'number'
        ? (obj.duration_ms / 1000).toFixed(1) + 's'
        : typeof obj.duration_api_ms === 'number'
          ? (obj.duration_api_ms / 1000).toFixed(1) + 's'
          : '?';
    const turns =
      typeof obj.num_turns === 'number'
        ? String(obj.num_turns) + ' turn' + (obj.num_turns !== 1 ? 's' : '')
        : '';

    const parts = [duration, turns].filter(Boolean);
    return `[done] Completed in ${parts.join(', ')}`;
  }

  const errorMsg = obj.result ?? 'Unknown error';
  return `[error] Task failed: ${errorMsg}`;
}

function extractToolContext(input: Record<string, unknown> | undefined): string {
  if (input === undefined) return '';

  if (typeof input['file_path'] === 'string') {
    return `: ${input['file_path']}`;
  }
  if (typeof input['command'] === 'string') {
    const cmd = input['command'];
    return `: ${cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd}`;
  }
  if (typeof input['pattern'] === 'string') {
    return `: ${input['pattern']}`;
  }
  if (typeof input['query'] === 'string') {
    const q = input['query'];
    return `: ${q.length > 60 ? q.slice(0, 57) + '...' : q}`;
  }
  return '';
}

function formatToolUse(obj: StreamJsonMessage): string | null {
  const toolName = obj.tool_name ?? 'unknown';
  return `[tool] ${toolName}${extractToolContext(obj.tool_input)}`;
}

function formatToolResult(obj: StreamJsonMessage): string | null {
  const content = obj.content ?? '';
  if (content.trim() === '') return null;

  const maxLen = 200;
  const abbreviated = content.length > maxLen ? content.slice(0, maxLen) + '...' : content;

  const singleLine = abbreviated.replace(/\n/g, ' ').trim();
  return `  \u2192 ${singleLine}`;
}

/**
 * Format raw Docker log content for human-readable display.
 * Strips Docker stream headers, parses Claude JSON stream lines,
 * and returns clean formatted text.
 */
export function formatLogChunk(raw: string): string {
  const stripped = stripDockerHeaders(raw);
  const lines = stripped.split('\n');

  const formatted = lines
    .map((line) => formatJsonLine(line))
    .filter((l): l is string => l !== null);

  if (formatted.length === 0) return '';
  return formatted.join('\n') + '\n';
}
