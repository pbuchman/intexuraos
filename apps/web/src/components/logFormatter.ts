interface StreamJsonMessage {
  type: string;
  subtype?: string;
  message?: {
    content?: { type: string; text?: string; tool_name?: string; name?: string }[];
  };
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  content?: string;
  content_block?: { type: string; text?: string };
  result?: string;
  duration_ms?: number;
  duration_api_ms?: number;
  cost_usd?: number;
  total_cost_usd?: number;
  num_turns?: number;
  is_error?: boolean;
  session_id?: string;
}

const XTERM_DIM = '\x1b[2m';
const XTERM_CYAN = '\x1b[36m';
const XTERM_GREEN = '\x1b[32m';
const XTERM_RED = '\x1b[31m';
const XTERM_YELLOW = '\x1b[33m';
const XTERM_RESET = '\x1b[0m';

export class LogFormatter {
  private buffer = '';

  processChunk(raw: string): string {
    this.buffer += raw;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    const formatted = lines
      .map((line) => this.formatLine(line))
      .filter((l): l is string => l !== null);

    if (formatted.length === 0) return '';
    return formatted.join('\r\n') + '\r\n';
  }

  private formatLine(line: string): string | null {
    const trimmed = line.trim();
    if (trimmed === '') return null;

    try {
      const obj = JSON.parse(trimmed) as StreamJsonMessage;
      return this.formatJson(obj);
    } catch {
      return line;
    }
  }

  private formatJson(obj: StreamJsonMessage): string | null {
    switch (obj.type) {
      case 'system':
        return this.formatSystem(obj);
      case 'assistant':
        return this.formatAssistant(obj);
      case 'result':
        return this.formatResult(obj);
      case 'tool_use':
        return this.formatToolUse(obj);
      case 'tool_result':
        return this.formatToolResult(obj);
      default:
        return null;
    }
  }

  private formatSystem(obj: StreamJsonMessage): string | null {
    if (
      obj.subtype === 'hook_started' ||
      obj.subtype === 'hook_response' ||
      obj.subtype === 'init'
    ) {
      return null;
    }
    return `${XTERM_DIM}[system] ${obj.subtype ?? ''}${XTERM_RESET}`;
  }

  private formatAssistant(obj: StreamJsonMessage): string | null {
    const contents = obj.message?.content;
    if (!Array.isArray(contents)) return null;

    const texts: string[] = [];
    for (const block of contents) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        texts.push(block.text);
      }
    }

    if (texts.length === 0) return null;
    return texts.join('\n');
  }

  private formatResult(obj: StreamJsonMessage): string | null {
    if (obj.subtype === 'success' || !obj.is_error) {
      const duration = typeof obj.duration_ms === 'number'
        ? `${(obj.duration_ms / 1000).toFixed(1)}s`
        : typeof obj.duration_api_ms === 'number'
          ? `${(obj.duration_api_ms / 1000).toFixed(1)}s`
          : '?';
      const turns = typeof obj.num_turns === 'number' ? String(obj.num_turns) + ' turn' + (obj.num_turns !== 1 ? 's' : '') : '';
      const costValue = obj.total_cost_usd ?? obj.cost_usd;
      const cost = typeof costValue === 'number' ? `$${costValue.toFixed(2)}` : '';

      const parts = [duration, turns, cost].filter(Boolean);
      return `${XTERM_GREEN}[done]${XTERM_RESET} Completed in ${parts.join(', ')}`;
    }

    const errorMsg = obj.result ?? 'Unknown error';
    return `${XTERM_RED}[error]${XTERM_RESET} Task failed: ${errorMsg}`;
  }

  private formatToolUse(obj: StreamJsonMessage): string | null {
    const toolName = obj.tool_name ?? 'unknown';
    const input = obj.tool_input;

    let context = '';
    if (input !== undefined) {
      if (typeof input['file_path'] === 'string') {
        context = `: ${input['file_path']}`;
      } else if (typeof input['command'] === 'string') {
        const cmd = input['command'];
        context = `: ${cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd}`;
      } else if (typeof input['pattern'] === 'string') {
        context = `: ${input['pattern']}`;
      } else if (typeof input['query'] === 'string') {
        const q = input['query'];
        context = `: ${q.length > 60 ? q.slice(0, 57) + '...' : q}`;
      } else if (typeof input['url'] === 'string') {
        context = `: ${input['url']}`;
      }
    }

    return `${XTERM_CYAN}[tool]${XTERM_RESET} ${XTERM_YELLOW}${toolName}${XTERM_RESET}${context}`;
  }

  private formatToolResult(obj: StreamJsonMessage): string | null {
    const content = obj.content ?? '';
    if (content.trim() === '') return null;

    const maxLen = 200;
    const abbreviated = content.length > maxLen
      ? content.slice(0, maxLen) + '...'
      : content;

    const singleLine = abbreviated.replace(/\n/g, ' ').trim();
    return `${XTERM_DIM}  \u2192 ${singleLine}${XTERM_RESET}`;
  }
}
