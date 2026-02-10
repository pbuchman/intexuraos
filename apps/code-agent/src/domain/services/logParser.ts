import type { Timestamp } from '@google-cloud/firestore';
import type { LogEntry } from '../models/logEntry.js';

interface StreamJsonMessage {
  type: string;
  subtype?: string;
  message?: {
    content?: {
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
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
  exit_code?: number;
  output?: string;
  model?: string;
  tools?: string[];
  mcp_servers?: { name: string; status: string }[];
}

export function parseLogChunk(raw: string, startSequence: number, timestamp: Timestamp): LogEntry[] {
  if (raw === '') return [];

  const lines = raw.split('\n');
  const entries: LogEntry[] = [];
  let seqCounter = startSequence * 1000;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let obj: StreamJsonMessage;
    try {
      obj = JSON.parse(trimmed) as StreamJsonMessage;
    } catch {
      entries.push({
        sequence: seqCounter++,
        type: 'raw',
        timestamp,
        rawText: trimmed,
      });
      continue;
    }

    const parsed = parseJsonMessage(obj, timestamp, seqCounter);
    for (const entry of parsed) {
      entries.push(entry);
      seqCounter++;
    }
  }

  return entries;
}

function parseJsonMessage(obj: StreamJsonMessage, timestamp: Timestamp, startSeq: number): LogEntry[] {
  switch (obj.type) {
    case 'system':
      return [parseSystemEvent(obj, timestamp, startSeq)];
    case 'assistant':
      return parseAssistantMessage(obj, timestamp, startSeq);
    case 'tool_use':
      return [parseToolUse(obj, timestamp, startSeq)];
    case 'tool_result':
      return parseToolResult(obj, timestamp, startSeq);
    case 'result':
      return [parseResult(obj, timestamp, startSeq)];
    default:
      return [{
        sequence: startSeq,
        type: 'raw',
        timestamp,
        rawText: JSON.stringify(obj),
      }];
  }
}

function parseSystemEvent(obj: StreamJsonMessage, timestamp: Timestamp, seq: number): LogEntry {
  const entry: LogEntry = {
    sequence: seq,
    type: 'system',
    timestamp,
  };

  if (obj.subtype !== undefined) {
    entry.systemSubtype = obj.subtype;
  }

  if (obj.subtype === 'hook_started' || obj.subtype === 'hook_response') {
    if (typeof obj.hook_name === 'string') entry.hookName = obj.hook_name;
    if (obj.subtype === 'hook_response') {
      if (typeof obj.exit_code === 'number') entry.hookExitCode = obj.exit_code;
      if (typeof obj.output === 'string') entry.hookOutput = obj.output;
    }
  }

  if (obj.subtype === 'init') {
    if (typeof obj.model === 'string') entry.model = obj.model;
    if (Array.isArray(obj.tools)) entry.toolCount = obj.tools.length;
    if (Array.isArray(obj.mcp_servers)) entry.mcpServers = obj.mcp_servers;
  }

  return entry;
}

function parseAssistantMessage(obj: StreamJsonMessage, timestamp: Timestamp, startSeq: number): LogEntry[] {
  const contents = obj.message?.content;
  if (!Array.isArray(contents)) return [];

  const entries: LogEntry[] = [];
  let seq = startSeq;

  for (const block of contents) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      entries.push({
        sequence: seq++,
        type: 'assistant_text',
        timestamp,
        text: block.text,
      });
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      const entry: LogEntry = {
        sequence: seq++,
        type: 'tool_call',
        timestamp,
        toolName: block.name,
      };
      const ctx = extractToolContext(block.input);
      if (ctx !== undefined) entry.toolContext = ctx;
      entries.push(entry);
    }
  }

  return entries;
}

function parseToolUse(obj: StreamJsonMessage, timestamp: Timestamp, seq: number): LogEntry {
  const entry: LogEntry = {
    sequence: seq,
    type: 'tool_call',
    timestamp,
    toolName: obj.tool_name ?? 'unknown',
  };
  const ctx = extractToolContext(obj.tool_input);
  if (ctx !== undefined) entry.toolContext = ctx;
  return entry;
}

function parseToolResult(obj: StreamJsonMessage, timestamp: Timestamp, seq: number): LogEntry[] {
  const content = obj.content ?? '';
  if (content.trim() === '') return [];

  return [{
    sequence: seq,
    type: 'tool_result',
    timestamp,
    content,
    ...(obj.is_error === true && { isError: true }),
  }];
}

function parseResult(obj: StreamJsonMessage, timestamp: Timestamp, seq: number): LogEntry {
  const isError = obj.is_error === true;

  const entry: LogEntry = {
    sequence: seq,
    type: 'result',
    timestamp,
    resultType: isError ? 'error' : 'success',
  };

  if (isError) {
    entry.errorMessage = obj.result ?? 'Unknown error';
  } else {
    const durationMs = obj.duration_ms ?? obj.duration_api_ms;
    if (typeof durationMs === 'number') entry.durationMs = durationMs;
    if (typeof obj.num_turns === 'number') entry.numTurns = obj.num_turns;
    if (typeof obj.total_cost_usd === 'number') entry.totalCostUsd = obj.total_cost_usd;
  }

  return entry;
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
