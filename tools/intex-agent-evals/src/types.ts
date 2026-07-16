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

export const TOOL_ARGUMENT_PATHS = {
  create_note: ['contentLength', 'titleLength', 'tagsCount', 'sourceMessageIdsCount'],
  create_calendar_event: [
    'summaryLength',
    'start',
    'end',
    'timeZone',
    'locationLength',
    'descriptionLength',
    'attendeesCount',
  ],
  query_calendar_events: [
    'mode',
    'timeMin',
    'timeMax',
    'maxResults',
    'queryLength',
    'hasCalendarId',
  ],
  create_research: [
    'titleLength',
    'promptLength',
    'originalMessageLength',
    'sourceMessageIdsCount',
  ],
  create_link: ['hasUrl', 'titleLength', 'descriptionLength', 'tagsCount', 'sourceMessageIdsCount'],
  create_code_task: ['promptLength', 'workerType', 'taskMode', 'hasLinearIssueId'],
  save_external: ['messageLength', 'hasSourceUrl'],
  get_user_preferences: [],
  add_user_preference: ['textLength', 'expectedVersion'],
  update_user_preference: ['hasItemId', 'textLength', 'expectedVersion'],
  delete_user_preference: ['hasItemId', 'expectedVersion'],
} as const satisfies Record<IntexAgentToolName, readonly string[]>;

export const TIMELINE_PAYLOAD_PATHS = [
  'toolName',
  'resolution',
  'reason',
  'status',
  'fallbackReason',
  'sourceOutcome',
  'sourceType',
  'textPreview',
] as const;
