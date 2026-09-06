import { INTEX_AGENT_TOOL_NAMES, IntexAgentToolNameSchema } from '@intexuraos/llm-prompts';
import { z } from 'zod';

export { INTEX_AGENT_TOOL_NAMES, IntexAgentToolNameSchema };

export type IntexAgentToolName = z.infer<typeof IntexAgentToolNameSchema>;

export const INTEX_AGENT_SESSION_STATUSES = [
  'active',
  'waiting_for_user',
  'executing_tool',
  'completed',
  'unsupported',
  'expired',
  'cancelled',
  'superseded',
] as const;

export const IntexAgentSessionStatusSchema = z.enum(INTEX_AGENT_SESSION_STATUSES);
export type IntexAgentSessionStatus = z.infer<typeof IntexAgentSessionStatusSchema>;

export const INTEX_AGENT_SESSION_START_REASONS = [
  'no_active_session',
  'previous_completed',
  'previous_expired',
  'user_requested_new_session',
  'previous_superseded',
] as const;

export const IntexAgentSessionStartReasonSchema = z.enum(INTEX_AGENT_SESSION_START_REASONS);
export type IntexAgentSessionStartReason = z.infer<typeof IntexAgentSessionStartReasonSchema>;

export const INTEX_AGENT_SESSION_END_REASONS = [
  'tool_completed',
  'tool_failed',
  'unsupported_request',
  'timeout',
  'cancelled_by_user',
  'superseded_by_user',
] as const;

export const IntexAgentSessionEndReasonSchema = z.enum(INTEX_AGENT_SESSION_END_REASONS);
export type IntexAgentSessionEndReason = z.infer<typeof IntexAgentSessionEndReasonSchema>;

export const INTEX_AGENT_SESSION_EVENT_TYPES = [
  'session_started',
  'session_closed',
  'user_message',
  'assistant_message',
  'agent_fallback',
  'clarification_requested',
  'confirmation_requested',
  'confirmation_resolved',
  'tool_call_started',
  'tool_call_completed',
  'tool_call_failed',
  'unsupported_request',
] as const;

export const IntexAgentSessionEventTypeSchema = z.enum(INTEX_AGENT_SESSION_EVENT_TYPES);
export type IntexAgentSessionEventType = z.infer<typeof IntexAgentSessionEventTypeSchema>;

export const INTEX_AGENT_TRANSITION_ACTIONS = [
  'started',
  'continued',
  'superseded_previous',
  'expired_previous',
] as const;

export const IntexAgentTransitionActionSchema = z.enum(INTEX_AGENT_TRANSITION_ACTIONS);
export type IntexAgentTransitionAction = z.infer<typeof IntexAgentTransitionActionSchema>;

export const SCENARIO_SOURCE_TYPES = ['whatsapp_text', 'whatsapp_audio_transcript'] as const;

export const ScenarioSourceTypeSchema = z.enum(SCENARIO_SOURCE_TYPES);
export type ScenarioSourceType = z.infer<typeof ScenarioSourceTypeSchema>;

export type AssertionPathValueType = 'boolean' | 'number' | 'string';

type AssertionPathMetadata = Readonly<Record<string, AssertionPathValueType>>;

export const TOOL_ARGUMENT_PATH_METADATA = {
  create_note: {
    contentLength: 'number',
    titleLength: 'number',
    tagsCount: 'number',
    sourceMessageIdsCount: 'number',
    syntheticMarkerCount: 'number',
    syntheticMarkerDigest: 'string',
  },
  create_calendar_event: {
    summaryLength: 'number',
    start: 'string',
    end: 'string',
    timeZone: 'string',
    locationLength: 'number',
    descriptionLength: 'number',
    attendeesCount: 'number',
    syntheticMarkerCount: 'number',
    syntheticMarkerDigest: 'string',
  },
  query_calendar_events: {
    mode: 'string',
    timeMin: 'string',
    timeMax: 'string',
    maxResults: 'number',
    queryLength: 'number',
    hasCalendarId: 'boolean',
    startMatchesCatalog: 'boolean',
    endMatchesCatalog: 'boolean',
    queryMatchesCatalog: 'boolean',
  },
  update_calendar_event: {
    eventSummaryLength: 'number',
    attendeesToAddCount: 'number',
    hasEventId: 'boolean',
    hasCalendarId: 'boolean',
    hasExpectedEtag: 'boolean',
    hasEventStart: 'boolean',
    hasEventEnd: 'boolean',
    eventIdMatchesCatalog: 'boolean',
    startMatchesCatalog: 'boolean',
    endMatchesCatalog: 'boolean',
    durationMatchesCatalog: 'boolean',
    changesMatchCatalog: 'boolean',
    syntheticMarkerCount: 'number',
    syntheticMarkerDigest: 'string',
  },
  create_research: {
    titleLength: 'number',
    promptLength: 'number',
    originalMessageLength: 'number',
    sourceMessageIdsCount: 'number',
    syntheticMarkerCount: 'number',
    syntheticMarkerDigest: 'string',
  },
  create_link: {
    hasUrl: 'boolean',
    titleLength: 'number',
    descriptionLength: 'number',
    tagsCount: 'number',
    sourceMessageIdsCount: 'number',
    syntheticMarkerCount: 'number',
    syntheticMarkerDigest: 'string',
  },
  create_code_task: {
    promptLength: 'number',
    workerType: 'string',
    taskMode: 'string',
    hasLinearIssueId: 'boolean',
    syntheticMarkerCount: 'number',
    syntheticMarkerDigest: 'string',
  },
  save_external: {
    messageLength: 'number',
    hasSourceUrl: 'boolean',
    syntheticMarkerCount: 'number',
    syntheticMarkerDigest: 'string',
  },
  get_user_preferences: {},
  add_user_preference: {
    textLength: 'number',
    expectedVersion: 'number',
    syntheticMarkerCount: 'number',
    syntheticMarkerDigest: 'string',
  },
  update_user_preference: {
    hasItemId: 'boolean',
    textLength: 'number',
    expectedVersion: 'number',
    syntheticMarkerCount: 'number',
    syntheticMarkerDigest: 'string',
  },
  delete_user_preference: {
    hasItemId: 'boolean',
    expectedVersion: 'number',
    syntheticMarkerCount: 'number',
    syntheticMarkerDigest: 'string',
  },
} as const satisfies Record<IntexAgentToolName, AssertionPathMetadata>;

export const TOOL_ARGUMENT_PATHS = {
  create_note: Object.keys(TOOL_ARGUMENT_PATH_METADATA.create_note),
  create_calendar_event: Object.keys(TOOL_ARGUMENT_PATH_METADATA.create_calendar_event),
  query_calendar_events: Object.keys(TOOL_ARGUMENT_PATH_METADATA.query_calendar_events),
  update_calendar_event: Object.keys(TOOL_ARGUMENT_PATH_METADATA.update_calendar_event),
  create_research: Object.keys(TOOL_ARGUMENT_PATH_METADATA.create_research),
  create_link: Object.keys(TOOL_ARGUMENT_PATH_METADATA.create_link),
  create_code_task: Object.keys(TOOL_ARGUMENT_PATH_METADATA.create_code_task),
  save_external: Object.keys(TOOL_ARGUMENT_PATH_METADATA.save_external),
  get_user_preferences: Object.keys(TOOL_ARGUMENT_PATH_METADATA.get_user_preferences),
  add_user_preference: Object.keys(TOOL_ARGUMENT_PATH_METADATA.add_user_preference),
  update_user_preference: Object.keys(TOOL_ARGUMENT_PATH_METADATA.update_user_preference),
  delete_user_preference: Object.keys(TOOL_ARGUMENT_PATH_METADATA.delete_user_preference),
} as const satisfies Record<IntexAgentToolName, readonly string[]>;

export const TIMELINE_PAYLOAD_PATH_METADATA = {
  toolName: 'string',
  resolution: 'string',
  reason: 'string',
  status: 'string',
  fallbackReason: 'string',
  sourceOutcome: 'string',
  sourceType: 'string',
  textPreview: 'string',
  'argsSummary.syntheticMarkerCount': 'number',
  'argsSummary.syntheticMarkerDigest': 'string',
  'argsSummary.eventSummaryLength': 'number',
  'argsSummary.attendeesToAddCount': 'number',
  'argsSummary.hasEventId': 'boolean',
  'argsSummary.hasCalendarId': 'boolean',
  'argsSummary.hasExpectedEtag': 'boolean',
  'argsSummary.hasEventStart': 'boolean',
  'argsSummary.hasEventEnd': 'boolean',
  'argsSummary.workerType': 'string',
  'argsSummary.taskMode': 'string',
  'argsSummary.hasLinearIssueId': 'boolean',
} as const satisfies AssertionPathMetadata;

type ToolArgumentPathByTool = {
  [ToolName in keyof typeof TOOL_ARGUMENT_PATH_METADATA]: keyof (typeof TOOL_ARGUMENT_PATH_METADATA)[ToolName];
};

export type ToolArgumentAssertionPath = Extract<
  ToolArgumentPathByTool[keyof ToolArgumentPathByTool],
  string
>;
export type TimelinePayloadAssertionPath = Extract<
  keyof typeof TIMELINE_PAYLOAD_PATH_METADATA,
  string
>;
export type ScenarioAssertionPath = ToolArgumentAssertionPath | TimelinePayloadAssertionPath;

function nonEmptyPathTuple<TPath extends string>(
  values: readonly TPath[],
  label: string
): [TPath, ...TPath[]] {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error(`${label} path whitelist cannot be empty`);
  return [first, ...rest];
}

export const TOOL_ARGUMENT_ASSERTION_PATHS = nonEmptyPathTuple(
  [...new Set(Object.values(TOOL_ARGUMENT_PATHS).flat())] as ToolArgumentAssertionPath[],
  'Tool argument assertion'
);
export const TIMELINE_PAYLOAD_PATHS = Object.keys(
  TIMELINE_PAYLOAD_PATH_METADATA
) as TimelinePayloadAssertionPath[];
export const TIMELINE_PAYLOAD_ASSERTION_PATHS = nonEmptyPathTuple(
  TIMELINE_PAYLOAD_PATHS,
  'Timeline payload assertion'
);

export const ToolArgumentAssertionPathSchema = z.enum(TOOL_ARGUMENT_ASSERTION_PATHS);
export const TimelinePayloadAssertionPathSchema = z.enum(TIMELINE_PAYLOAD_ASSERTION_PATHS);
export const ScenarioAssertionPathSchema = z.union([
  ToolArgumentAssertionPathSchema,
  TimelinePayloadAssertionPathSchema,
]);
