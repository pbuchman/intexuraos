import type { IntexAgentSessionEvent, IntexAgentToolName } from '../sessions/types.js';
import type {
  BehavioralTranscript,
  CapturedAssistantReply,
  CapturedToolCall,
  SanitizedAssistantReply,
  SanitizedSessionEvent,
  SanitizedTestConversationSession,
  TestConversationSessionTransition,
  TestConversationTurnResult,
} from './testConversationTypes.js';
import type { IntexAgentSession } from '../sessions/types.js';

const SECRET_FIELD_PATTERN =
  /token|secret|password|key|authorization|auth|credential|toolargs|promptblock|replycontext|sourceurl|whatsappsender/iu;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+|\/#\/[^\s<>"')]+/giu;
const SENSITIVE_REPLY_LINE_PATTERN =
  /^\s*(url|source|zrodlo|źródło|content|treść|tresc|prompt|new entry|nowy wpis|entry|wpis|before|przed|after|po)\s*:/iu;
const PREFERENCE_BLOCK_HEADER_PATTERN =
  /^\s*(user preferences|prompt preferences|current preferences|rendered prompt block|preferencje|preferencje użytkownika)\b/iu;
const PREFERENCE_BLOCK_ITEM_PATTERN = /^\s*(?:[-*]|\d+[).])\s+\S/u;
const TEXT_PREVIEW_LIMIT = 220;
const REPLY_MESSAGE_LIMIT = 4000;

type TranscriptEvent = IntexAgentSessionEvent | SanitizedSessionEvent;

export function sanitizeToolCalls(calls: readonly CapturedToolCall[]): CapturedToolCall[] {
  return calls.map((call) => ({
    toolName: call.toolName,
    status: call.status,
    ...(call.argsSummary !== undefined ? { argsSummary: sanitizeRecord(call.argsSummary) } : {}),
    ...(call.resultSummary !== undefined
      ? { resultSummary: sanitizeRecord(call.resultSummary) }
      : {}),
    ...(call.error !== undefined ? { error: truncate(call.error) } : {}),
  }));
}

export function sanitizeAssistantReplies(
  replies: readonly CapturedAssistantReply[]
): SanitizedAssistantReply[] {
  return replies.map((reply) => ({
    userId: reply.userId,
    message: truncateTo(redactSensitiveText(reply.message), REPLY_MESSAGE_LIMIT),
    replyToMessageId: reply.replyToMessageId,
    correlationId: reply.correlationId,
    ...(reply.ctaUrl !== undefined
      ? {
          ctaUrl: {
            displayText: previewText(reply.ctaUrl.displayText),
            url: '[redacted-url]',
          },
        }
      : {}),
    ...(reply.buttons !== undefined ? { buttons: reply.buttons } : {}),
  }));
}

export function sanitizeEventsBySessionId(
  eventsBySessionId: Record<string, readonly IntexAgentSessionEvent[]>
): Record<string, SanitizedSessionEvent[]> {
  return Object.fromEntries(
    Object.entries(eventsBySessionId).map(([sessionId, events]) => [
      sessionId,
      events.map((event) => ({
        id: event.id,
        type: event.type,
        createdAt: event.createdAt,
        payload: sanitizeEventPayload(event),
      })),
    ])
  );
}

export function sanitizeSessions(
  sessions: readonly IntexAgentSession[]
): SanitizedTestConversationSession[] {
  return sessions.map((session) => ({
    id: session.id,
    userId: session.userId,
    channel: session.channel,
    status: session.status,
    startedAt: session.startedAt,
    ...(session.endedAt !== undefined ? { endedAt: session.endedAt } : {}),
    lastUserMessageAt: session.lastUserMessageAt,
    ...(session.lastAssistantMessageAt !== undefined
      ? { lastAssistantMessageAt: session.lastAssistantMessageAt }
      : {}),
    startReason: session.startReason,
    ...(session.endReason !== undefined ? { endReason: session.endReason } : {}),
    ...(session.activeTool !== undefined ? { activeTool: session.activeTool } : {}),
  }));
}

export function buildBehavioralTranscript(input: {
  turns: readonly TestConversationTurnResult[];
  sessionTransitions: readonly TestConversationSessionTransition[];
  eventsBySessionId: Record<string, readonly IntexAgentSessionEvent[] | readonly SanitizedSessionEvent[]>;
  toolCalls: readonly CapturedToolCall[];
  turnEventsByTurnIndex?: Record<number, readonly TranscriptEvent[]>;
  toolCallsByTurnIndex?: Record<number, readonly CapturedToolCall[]>;
}): BehavioralTranscript {
  return {
    turns: input.turns.map((turn) => {
      const transition = input.sessionTransitions.find((candidate) => candidate.turnIndex === turn.turnIndex);
      const sessionEvents =
        input.turnEventsByTurnIndex?.[turn.turnIndex] ?? input.eventsBySessionId[turn.sessionId] ?? [];
      const confirmationAction = confirmationActionFromEvents(sessionEvents);
      const toolCalls = input.toolCallsByTurnIndex?.[turn.turnIndex] ?? input.toolCalls;
      const toolOutcome = toolOutcomeForTurn(sessionEvents, toolCalls);
      return {
        turnIndex: turn.turnIndex,
        ...(turn.submittedTextPreview !== undefined
          ? { submittedTextPreview: turn.submittedTextPreview }
          : {}),
        assistantReplyPreviews: turn.assistantReplies.map((reply) => truncate(reply.message)),
        sessionAction: transition?.action ?? 'continued',
        ...(confirmationAction !== undefined ? { confirmationAction } : {}),
        ...(toolOutcome !== undefined ? { toolOutcome } : {}),
      };
    }),
  };
}

export function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SECRET_FIELD_PATTERN.test(key)) {
      continue;
    }
    const sanitizedValue = sanitizeValue(value);
    if (sanitizedValue !== undefined) {
      sanitized[key] = sanitizedValue;
    }
  }
  return sanitized;
}

export function previewText(text: string): string {
  return truncate(redactSensitiveText(text).trim().replace(/\s+/gu, ' '));
}

function sanitizeEventPayload(event: IntexAgentSessionEvent): Record<string, unknown> {
  const payload = event.payload;
  const sanitized: Record<string, unknown> = {};
  copyString(payload, sanitized, 'confirmationId');
  copyString(payload, sanitized, 'toolName');
  copyString(payload, sanitized, 'resolution');
  copyString(payload, sanitized, 'reason');
  copyString(payload, sanitized, 'status');
  copyString(payload, sanitized, 'fallbackReason');
  copyString(payload, sanitized, 'sourceOutcome');

  const text = readFirstString(payload, ['text', 'message']);
  if (text !== undefined) {
    sanitized['textPreview'] = previewText(text);
  }

  if (event.type === 'tool_call_completed') {
    const result = payload['result'];
    if (isPlainRecord(result)) {
      sanitized['resultSummary'] = sanitizeRecord(summarizeResult(result));
    }
  }

  return sanitized;
}

function copyString(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string
): void {
  const value = source[key];
  if (typeof value === 'string' && !SECRET_FIELD_PATTERN.test(key)) {
    target[key] = truncate(value);
  }
}

function readFirstString(
  source: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return undefined;
}

function confirmationActionFromEvents(
  events: readonly IntexAgentSessionEvent[] | readonly SanitizedSessionEvent[]
): 'accepted' | 'rejected' | 'stale' | undefined {
  const resolved = [...events].reverse().find((event) => event.type === 'confirmation_resolved');
  if (resolved === undefined) {
    return undefined;
  }
  const resolution = resolved.payload['resolution'];
  if (resolution === 'accepted') return 'accepted';
  if (resolution === 'rejected') return 'rejected';
  return 'stale';
}

function toolOutcomeForTurn(
  events: readonly IntexAgentSessionEvent[] | readonly SanitizedSessionEvent[],
  calls: readonly CapturedToolCall[]
): { toolName: IntexAgentToolName; status: 'completed' | 'failed' } | undefined {
  const failedCall = calls.find((call) => call.status === 'failed');
  if (failedCall !== undefined) {
    return { toolName: failedCall.toolName, status: failedCall.status };
  }
  const completedCall = calls.find((call) => call.status === 'completed');
  if (completedCall !== undefined) {
    return { toolName: completedCall.toolName, status: completedCall.status };
  }

  const completedEvent = events.find((event) => event.type === 'tool_call_completed');
  const completedToolName = completedEvent?.payload['toolName'];
  if (isToolName(completedToolName)) {
    return { toolName: completedToolName, status: 'completed' };
  }
  const failedEvent = events.find((event) => event.type === 'tool_call_failed');
  const failedToolName = failedEvent?.payload['toolName'];
  if (isToolName(failedToolName)) {
    return { toolName: failedToolName, status: 'failed' };
  }
  return undefined;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return truncate(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return { count: value.length };
  }
  if (isPlainRecord(value)) {
    return sanitizeRecord(value);
  }
  return undefined;
}

function summarizeResult(result: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const key of ['status', 'mode', 'count', 'eventId', 'bookmarkId', 'codeTaskId', 'changedItemId']) {
    const value = result[key];
    if (value !== undefined) {
      summary[key] = value;
    }
  }
  return summary;
}

function truncate(text: string): string {
  return truncateTo(text, TEXT_PREVIEW_LIMIT);
}

function truncateTo(text: string, limit: number): string {
  const normalized = text.trim().replace(/\s+/gu, ' ');
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function redactSensitiveText(text: string): string {
  let inPreferenceBlock = false;
  return text
    .replace(URL_PATTERN, '[redacted-url]')
    .split(/\r?\n/u)
    .map((line) => {
      if (PREFERENCE_BLOCK_HEADER_PATTERN.test(line)) {
        inPreferenceBlock = true;
        return 'User Preferences: [redacted]';
      }
      if (inPreferenceBlock && PREFERENCE_BLOCK_ITEM_PATTERN.test(line)) {
        return '[redacted-preference-item]';
      }
      if (inPreferenceBlock && line.trim() === '') {
        inPreferenceBlock = false;
        return line;
      }
      inPreferenceBlock = false;
      if (!SENSITIVE_REPLY_LINE_PATTERN.test(line)) {
        return line;
      }
      return line.replace(/:\s*.*$/u, ': [redacted]');
    })
    .join('\n');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isToolName(value: unknown): value is IntexAgentToolName {
  return (
    value === 'create_note' ||
    value === 'create_calendar_event' ||
    value === 'query_calendar_events' ||
    value === 'create_research' ||
    value === 'create_link' ||
    value === 'create_code_task' ||
    value === 'save_external' ||
    value === 'get_user_preferences' ||
    value === 'add_user_preference' ||
    value === 'update_user_preference' ||
    value === 'delete_user_preference'
  );
}
