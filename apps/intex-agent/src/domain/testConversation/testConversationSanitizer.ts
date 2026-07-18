import { createHash } from 'node:crypto';
import { calendarListEventsRequestSchema } from '@intexuraos/http-contracts';
import type { IntexAgentSessionEvent, IntexAgentToolName } from '../sessions/types.js';
import type {
  BehavioralTranscript,
  CapturedAssistantReply,
  CapturedToolCall,
  SanitizedAssistantReply,
  SanitizedSessionEvent,
  SanitizedTestConversationSession,
  SanitizedToolArgsSummary,
  SanitizedToolCall,
  SanitizedToolResultSummary,
  SanitizedTurnTimelineEvent,
  TestConversationSessionAfterTurn,
  TestConversationSessionTransition,
  TestConversationTurnResult,
} from './testConversationTypes.js';
import { TEST_CONVERSATION_TOOL_FAILURE_CODE } from './testConversationTypes.js';
import type { IntexAgentSession } from '../sessions/types.js';

const SECRET_FIELD_PATTERN =
  /token|secret|password|key|authorization|auth|credential|toolargs|promptblock|replycontext|sourceurl|whatsappsender/iu;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+|\/#\/[^\s<>"')]+/giu;
const SENSITIVE_REPLY_LINE_PATTERN =
  /^\s*(url|source|zrodlo|źródło|title|tytuł|content|treść|tresc|start|początek|end|koniec|location|miejsce|attendees|uczestnicy|prompt|mode|tryb|worker|typ workera|new entry|nowy wpis|entry|wpis|before|przed|after|po)\s*:/iu;
const PREFERENCE_BLOCK_HEADER_PATTERN =
  /^\s*(user preferences|prompt preferences|current preferences|rendered prompt block|preferencje|preferencje użytkownika)\b/iu;
const PREFERENCE_BLOCK_ITEM_PATTERN = /^\s*(?:[-*]|\d+[).])\s+\S/u;
const TEXT_PREVIEW_LIMIT = 220;
const REPLY_MESSAGE_LIMIT = 4000;
const SYNTHETIC_MARKER_PATTERN =
  /(?<![A-Z0-9-])INTEX-EVAL-[0-9]{3}(?:-F[0-9]{2})?(?![A-Z0-9-])/giu;
const SYNTHETIC_MARKER_DIGEST_PREFIX = 'intex-eval-marker-set:v1\0';
const SYNTHETIC_MARKER_DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const TOOL_ARG_DATE_TIME_KEYS = ['start', 'end', 'timeMin', 'timeMax'] as const;
const TOOL_ARG_SAFE_INTEGER_KEYS = [
  'maxResults',
  'queryLength',
  'summaryLength',
  'locationLength',
  'descriptionLength',
  'attendeesCount',
  'contentLength',
  'titleLength',
  'tagsCount',
  'sourceMessageIdsCount',
  'promptLength',
  'originalMessageLength',
  'messageLength',
  'textLength',
  'expectedVersion',
  'syntheticMarkerCount',
] as const;
const TOOL_ARG_BOOLEAN_KEYS = [
  'hasCalendarId',
  'hasUrl',
  'hasLinearIssueId',
  'hasSourceUrl',
  'hasItemId',
] as const;
const TOOL_RESULT_SAFE_INTEGER_KEYS = ['count', 'currentVersion'] as const;
const TOOL_RESULT_BOOLEAN_KEYS = [
  'hasEventId',
  'hasBookmarkId',
  'hasCodeTaskId',
  'hasChangedItemId',
  'hasResourceUrl',
  'hasHtmlLink',
  'hasUrl',
  'hasSourceUrl',
] as const;

type TranscriptEvent = IntexAgentSessionEvent | SanitizedSessionEvent;

export function sanitizeToolCalls(calls: readonly CapturedToolCall[]): SanitizedToolCall[] {
  return calls.map((call) => ({
    toolName: call.toolName,
    status: call.status,
    ...(call.argsSummary !== undefined
      ? { argsSummary: sanitizeToolArgsSummary(call.argsSummary) }
      : {}),
    ...(call.resultSummary !== undefined
      ? { resultSummary: sanitizeToolResultSummary(call.resultSummary) }
      : {}),
    ...(call.status === 'failed' ? { error: TEST_CONVERSATION_TOOL_FAILURE_CODE } : {}),
  }));
}

export function sanitizeAssistantReplies(
  replies: readonly CapturedAssistantReply[]
): SanitizedAssistantReply[] {
  return replies.map((reply) => ({
    userId: reply.userId,
    message: truncateTo(
      redactSyntheticMarkers(redactSensitiveText(reply.message)),
      REPLY_MESSAGE_LIMIT
    ),
    replyToMessageId: reply.replyToMessageId,
    correlationId: reply.correlationId,
    ...(reply.ctaUrl !== undefined
      ? {
          ctaUrl: {
            displayText: previewText(redactSyntheticMarkers(reply.ctaUrl.displayText)),
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
      events.map(sanitizeSessionEvent),
    ])
  );
}

export function sanitizeTurnTimelineEvents(
  events: readonly IntexAgentSessionEvent[]
): SanitizedTurnTimelineEvent[] {
  return events.map((event) => ({
    sessionId: event.sessionId,
    ...sanitizeSessionEvent(event),
  }));
}

export function sanitizeSessionAfterTurn(
  session: IntexAgentSession
): TestConversationSessionAfterTurn {
  const activeTool = (session as { activeTool?: IntexAgentToolName | null }).activeTool;
  return {
    id: session.id,
    status: session.status,
    startReason: session.startReason,
    ...(session.endReason !== undefined ? { endReason: session.endReason } : {}),
    ...(activeTool !== undefined && activeTool !== null ? { activeTool } : {}),
  };
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

function sanitizeToolArgsSummary(
  summary: object
): SanitizedToolArgsSummary {
  const source = Object.fromEntries(Object.entries(summary)) as Readonly<Record<string, unknown>>;
  const sanitized: SanitizedToolArgsSummary = {};
  for (const key of TOOL_ARG_SAFE_INTEGER_KEYS) {
    const value = source[key];
    if (isNonNegativeSafeInteger(value)) {
      sanitized[key] = value;
    }
  }
  for (const key of TOOL_ARG_BOOLEAN_KEYS) {
    const value = source[key];
    if (typeof value === 'boolean') {
      sanitized[key] = value;
    }
  }
  for (const key of TOOL_ARG_DATE_TIME_KEYS) {
    const value = source[key];
    if (isRfc3339DateTime(value)) {
      sanitized[key] = value;
    }
  }

  const mode = source['mode'];
  if (isCalendarQueryMode(mode)) {
    sanitized.mode = mode;
  }
  const timeZone = source['timeZone'];
  if (isIanaTimeZone(timeZone)) {
    sanitized.timeZone = timeZone;
  }
  const workerType = source['workerType'];
  if (isCodeTaskWorkerType(workerType)) {
    sanitized.workerType = workerType;
  }
  const taskMode = source['taskMode'];
  if (taskMode === 'planning' || taskMode === 'execution') {
    sanitized.taskMode = taskMode;
  }
  const syntheticMarkerDigest = source['syntheticMarkerDigest'];
  if (
    typeof syntheticMarkerDigest === 'string' &&
    SYNTHETIC_MARKER_DIGEST_PATTERN.test(syntheticMarkerDigest)
  ) {
    sanitized.syntheticMarkerDigest = syntheticMarkerDigest;
  }
  return sanitized;
}

function sanitizeToolResultSummary(
  summary: object
): SanitizedToolResultSummary {
  const source = Object.fromEntries(Object.entries(summary)) as Readonly<Record<string, unknown>>;
  const sanitized: SanitizedToolResultSummary = {};
  for (const key of TOOL_RESULT_SAFE_INTEGER_KEYS) {
    const value = source[key];
    if (isNonNegativeSafeInteger(value)) {
      sanitized[key] = value;
    }
  }
  for (const key of TOOL_RESULT_BOOLEAN_KEYS) {
    const value = source[key];
    if (typeof value === 'boolean') {
      sanitized[key] = value;
    }
  }

  if (source['status'] === 'completed') {
    sanitized.status = 'completed';
  }
  const mode = source['mode'];
  if (isCalendarQueryMode(mode)) {
    sanitized.mode = mode;
  }
  return sanitized;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCalendarQueryMode(value: unknown): value is 'list' | 'count' {
  return value === 'list' || value === 'count';
}

function isRfc3339DateTime(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  return calendarListEventsRequestSchema.safeParse({
    userId: 'test-conversation-sanitizer',
    timeMin: value,
    timeMax: value,
  }).success;
}

function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function isCodeTaskWorkerType(
  value: unknown
): value is 'codex' | 'codex-xhigh' | 'minimax' {
  return value === 'codex' || value === 'codex-xhigh' || value === 'minimax';
}

export function summarizeArgs(
  toolName: IntexAgentToolName,
  args: Record<string, unknown>
): SanitizedToolArgsSummary {
  const summary: Record<string, unknown> = {};
  if (toolName === 'query_calendar_events') {
    copySummaryString(args, summary, 'mode');
    copySummaryString(args, summary, 'timeMin');
    copySummaryString(args, summary, 'timeMax');
    copySummaryNumber(args, summary, 'maxResults');
    copySummaryStringLength(args, summary, 'query');
    copySummaryPresence(args, summary, 'calendarId');
  } else if (toolName === 'create_calendar_event') {
    copySummaryStringLength(args, summary, 'summary');
    copySummaryString(args, summary, 'start');
    copySummaryString(args, summary, 'end');
    copySummaryString(args, summary, 'timeZone');
    copySummaryStringLength(args, summary, 'location');
    copySummaryStringLength(args, summary, 'description');
    copySummaryArrayCount(args, summary, 'attendees');
  } else if (toolName === 'create_note') {
    copySummaryStringLength(args, summary, 'content');
    copySummaryStringLength(args, summary, 'title');
    copySummaryArrayCount(args, summary, 'tags');
    copySummaryArrayCount(args, summary, 'sourceMessageIds');
  } else if (toolName === 'create_research') {
    copySummaryStringLength(args, summary, 'title');
    copySummaryStringLength(args, summary, 'prompt');
    copySummaryStringLength(args, summary, 'originalMessage');
    copySummaryArrayCount(args, summary, 'sourceMessageIds');
  } else if (toolName === 'create_link') {
    copySummaryPresence(args, summary, 'url');
    copySummaryStringLength(args, summary, 'title');
    copySummaryStringLength(args, summary, 'description');
    copySummaryArrayCount(args, summary, 'tags');
    copySummaryArrayCount(args, summary, 'sourceMessageIds');
  } else if (toolName === 'create_code_task') {
    copySummaryStringLength(args, summary, 'prompt');
    copySummaryString(args, summary, 'workerType');
    copySummaryString(args, summary, 'taskMode');
    copySummaryPresence(args, summary, 'linearIssueId');
  } else if (toolName === 'save_external') {
    copySummaryStringLength(args, summary, 'message');
    copySummaryPresence(args, summary, 'sourceUrl');
  } else if (toolName === 'get_user_preferences') {
    return {};
  } else if (toolName === 'add_user_preference') {
    copySummaryStringLength(args, summary, 'text');
    copySummaryNumber(args, summary, 'expectedVersion');
  } else {
    copySummaryPresence(args, summary, 'itemId');
    copySummaryStringLength(args, summary, 'text');
    copySummaryNumber(args, summary, 'expectedVersion');
  }

  const markers = collectSyntheticMarkers(args);
  summary['syntheticMarkerCount'] = markers.length;
  summary['syntheticMarkerDigest'] = createHash('sha256')
    .update(`${SYNTHETIC_MARKER_DIGEST_PREFIX}${markers.join('\n')}`, 'utf8')
    .digest('hex');
  return sanitizeToolArgsSummary(summary);
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
  if (event.type === 'user_message') {
    copyString(payload, sanitized, 'sourceType');
  }

  const text = readFirstString(payload, ['text', 'message']);
  if (text !== undefined) {
    const textPreview = previewText(redactSyntheticMarkers(text));
    if (textPreview !== '') {
      sanitized['textPreview'] = textPreview;
    }
  }

  if (event.type === 'tool_call_completed') {
    const result = payload['result'];
    if (isPlainRecord(result)) {
      sanitized['resultSummary'] = summarizeResult(result);
    }
  }

  if (event.type === 'confirmation_requested') {
    const toolName = payload['toolName'];
    const toolArgs = payload['toolArgs'];
    if (isToolName(toolName) && isPlainRecord(toolArgs)) {
      sanitized['argsSummary'] = summarizeArgs(toolName, toolArgs);
    }
  }

  return sanitized;
}

function sanitizeSessionEvent(event: IntexAgentSessionEvent): SanitizedSessionEvent {
  return {
    id: event.id,
    type: event.type,
    createdAt: event.createdAt,
    payload: sanitizeEventPayload(event),
  };
}

function copyString(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string
): void {
  const value = source[key];
  if (typeof value === 'string' && !SECRET_FIELD_PATTERN.test(key)) {
    const normalized = truncate(value);
    if (normalized !== '') {
      target[key] = normalized;
    }
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
    const normalized = truncate(value);
    return normalized === '' ? undefined : normalized;
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

function collectSyntheticMarkers(value: unknown): string[] {
  const markers = new Set<string>();
  visitArgumentValues(value, (text) => {
    for (const match of text.matchAll(SYNTHETIC_MARKER_PATTERN)) {
      markers.add(match[0].toUpperCase());
    }
  });
  return [...markers].sort();
}

function visitArgumentValues(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitArgumentValues(item, visit);
    return;
  }
  if (isPlainRecord(value)) {
    for (const item of Object.values(value)) visitArgumentValues(item, visit);
  }
}

function copySummaryString(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string
): void {
  const value = source[key];
  if (typeof value === 'string') target[key] = redactSyntheticMarkers(value);
}

function copySummaryNumber(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string
): void {
  const value = source[key];
  if (typeof value === 'number') target[key] = value;
}

function copySummaryStringLength(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string
): void {
  const value = source[key];
  if (typeof value === 'string') target[`${key}Length`] = value.length;
}

function copySummaryArrayCount(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string
): void {
  const value = source[key];
  if (Array.isArray(value)) target[`${key}Count`] = value.length;
}

function copySummaryPresence(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string
): void {
  if (source[key] !== undefined) {
    target[`has${key.charAt(0).toUpperCase()}${key.slice(1)}`] = true;
  }
}

function summarizeResult(result: Record<string, unknown>): SanitizedToolResultSummary {
  const summary: Record<string, unknown> = {};
  for (const key of ['status', 'mode', 'count', 'currentVersion']) {
    const value = result[key];
    if (value !== undefined) {
      summary[key] = value;
    }
  }
  for (const key of ['eventId', 'bookmarkId', 'codeTaskId', 'changedItemId']) {
    copySummaryPresence(result, summary, key);
  }
  for (const key of ['resourceUrl', 'htmlLink', 'url', 'sourceUrl']) {
    copySummaryPresence(result, summary, key);
  }
  return sanitizeToolResultSummary(summary);
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
  let inSensitiveReplyDetails = false;
  return text
    .replace(URL_PATTERN, '[redacted-url]')
    .split(/\r\n|[\n\v\f\r\u0085\u2028\u2029]/u)
    .map((line) => {
      if (inSensitiveReplyDetails) {
        return SENSITIVE_REPLY_LINE_PATTERN.test(line)
          ? line.replace(/:\s*.*$/u, ': [redacted]')
          : '[redacted]';
      }
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
      inSensitiveReplyDetails = true;
      return line.replace(/:\s*.*$/u, ': [redacted]');
    })
    .join('\n');
}

function redactSyntheticMarkers(text: string): string {
  return text.replace(SYNTHETIC_MARKER_PATTERN, '[synthetic-marker]');
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
