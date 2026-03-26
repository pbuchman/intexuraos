import type { RuntimeAdapter, RuntimeAttemptState, RuntimeEvent } from './types.js';

interface ClaudeAttemptState extends RuntimeAttemptState {
  logBuffer: string;
  completionSignaled: boolean;
  sessionId?: string;
}

interface ClaudeLogObject {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  error?: { message?: string };
  session_id?: string;
}

function formatRateLimitEvent(obj: Record<string, unknown>): string {
  const info = (obj['rate_limit_info'] as Record<string, unknown> | undefined) ?? {};
  const status = (info['status'] as string | undefined) ?? 'unknown';
  const rateLimitType = (info['rateLimitType'] as string | undefined) ?? '';
  const resetsAt = info['resetsAt'] as number | undefined;
  const overageStatus = info['overageStatus'] as string | undefined;
  const overageDisabledReason = info['overageDisabledReason'] as string | undefined;

  const parts = [`[rate-limit] status=${status}`];
  if (rateLimitType !== '') parts.push(`type=${rateLimitType}`);
  if (resetsAt !== undefined) parts.push(`resets=${new Date(resetsAt * 1000).toISOString()}`);
  if (overageStatus !== undefined) parts.push(`overage=${overageStatus}`);
  if (overageDisabledReason !== undefined) parts.push(`reason=${overageDisabledReason}`);

  return parts.join(' ');
}

function formatInitMessage(obj: Record<string, unknown>): string {
  const model = (obj['model'] as string | undefined) ?? 'unknown';
  const tools = Array.isArray(obj['tools']) ? obj['tools'].length : 0;
  const mode = (obj['permissionMode'] as string | undefined) ?? 'unknown';
  const version = (obj['version'] as string | undefined) ?? '?';

  const mcpServers = Array.isArray(obj['mcp_servers'])
    ? (obj['mcp_servers'] as Record<string, unknown>[])
        .map((server) => {
          const name = (server['name'] as string | undefined) ?? '?';
          const status = (server['status'] as string | undefined) === 'connected' ? 'ok' : 'fail';
          return `${name}:${status}`;
        })
        .join(', ')
    : '';

  const mcpPart = mcpServers !== '' ? ` mcp=[${mcpServers}]` : '';
  return `[claude] Session init: model=${model} tools=${String(tools)}${mcpPart} mode=${mode} v${version}`;
}

function formatClaudeSystemMessages(text: string): string {
  return text.replace(/^(\{.+\})$/gm, (jsonLine) => {
    try {
      const obj = JSON.parse(jsonLine) as Record<string, unknown>;
      const type = obj['type'] as string | undefined;

      if (type === 'system') {
        const subtype = obj['subtype'] as string | undefined;
        if (subtype === 'hook_started') {
          return `[hook] ${(obj['hook_name'] as string | undefined) ?? 'unknown'} started`;
        }
        if (subtype === 'hook_response') {
          const output = (obj['output'] as string | undefined) ?? '';
          const lineCount = output.split('\n').filter((line) => line.trim() !== '').length;
          return `[hook] ${(obj['hook_name'] as string | undefined) ?? 'unknown'} completed (${String(lineCount)} lines)`;
        }
        if (subtype === 'init') {
          return formatInitMessage(obj);
        }
        return jsonLine;
      }

      if (type === 'user' && 'tool_use_result' in obj) {
        delete obj['tool_use_result'];
        return JSON.stringify(obj);
      }

      if (type === 'rate_limit_event') {
        return formatRateLimitEvent(obj);
      }

      return jsonLine;
    } catch {
      return jsonLine;
    }
  });
}

function parseClaudeLogLine(state: ClaudeAttemptState, line: string): RuntimeEvent[] {
  const trimmed = line.trim();
  if (trimmed === '') return [];

  if (trimmed.includes('<tool_use_error>')) {
    state.logger.warn(
      { taskId: state.taskId },
      'Claude tool_use_error in stream (non-fatal sibling call failure)'
    );
    return [];
  }

  const jsonStart = trimmed.indexOf('{');
  if (jsonStart === -1) return [];

  try {
    const obj = JSON.parse(trimmed.slice(jsonStart)) as ClaudeLogObject;
    const events: RuntimeEvent[] = [];

    if (
      obj.type === 'system' &&
      obj.subtype === 'init' &&
      typeof obj.session_id === 'string' &&
      obj.session_id !== '' &&
      state.sessionId !== obj.session_id
    ) {
      state.sessionId = obj.session_id;
      events.push({ type: 'runtime_session_started', sessionId: obj.session_id });
    }

    if (obj.type === 'result' && !state.completionSignaled) {
      state.completionSignaled = true;
      if (obj.is_error === true) {
        events.push({
          type: 'attempt_failed',
          exitCode: 1,
          errorMessage: obj.result ?? obj.error?.message ?? 'Task failed',
        });
      } else {
        events.push({ type: 'attempt_completed', exitCode: 0 });
      }
    }

    return events;
  } catch {
    return [];
  }
}

function processBufferedLines(state: ClaudeAttemptState, chunk: string): RuntimeEvent[] {
  const buffered = `${state.logBuffer}${chunk}`;
  const lines = buffered.split('\n');
  /* v8 ignore start -- ts-type: split() always returns at least one element, but pop() remains nullable in types @preserve */
  const remainder = lines.pop() ?? '';
  /* v8 ignore stop @preserve */
  state.logBuffer = remainder;

  const events: RuntimeEvent[] = [];
  for (const line of lines) {
    events.push(...parseClaudeLogLine(state, line));
  }

  if (remainder.includes('"type":"result"')) {
    try {
      const jsonStart = remainder.indexOf('{');
      if (jsonStart !== -1) {
        JSON.parse(remainder.slice(jsonStart));
        events.push(...parseClaudeLogLine(state, remainder));
        state.logBuffer = '';
      }
    } catch {
      // Incomplete JSON — keep buffering.
    }
  }

  return events;
}

export const claudeRuntime: RuntimeAdapter<ClaudeAttemptState> = {
  runtime: 'claude',
  createAttemptState(taskId, logger) {
    return {
      taskId,
      logger,
      logBuffer: '',
      completionSignaled: false,
    };
  },
  processLogChunk(state, chunk) {
    const events: RuntimeEvent[] = [];
    if (chunk !== '') {
      events.push({ type: 'log', text: formatClaudeSystemMessages(chunk) });
    }
    events.push(...processBufferedLines(state, chunk));
    return events;
  },
  flushAttemptState(state) {
    if (state.logBuffer.trim() === '') {
      state.logBuffer = '';
      return [];
    }

    const events = parseClaudeLogLine(state, state.logBuffer);
    state.logBuffer = '';
    return events;
  },
};
