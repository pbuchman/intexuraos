export type IntexAgentChannel = 'whatsapp';

export type IntexAgentSessionStatus =
  | 'active'
  | 'waiting_for_user'
  | 'executing_tool'
  | 'completed'
  | 'unsupported'
  | 'expired'
  | 'cancelled'
  | 'superseded';

export type IntexAgentSessionStartReason =
  | 'no_active_session'
  | 'previous_completed'
  | 'previous_expired'
  | 'user_requested_new_session'
  | 'previous_superseded';

export type IntexAgentSessionEndReason =
  | 'tool_completed'
  | 'tool_failed'
  | 'unsupported_request'
  | 'timeout'
  | 'cancelled_by_user'
  | 'superseded_by_user';

export type IntexAgentToolName =
  | 'create_note'
  | 'create_calendar_event'
  | 'query_calendar_events'
  | 'create_research'
  | 'create_link'
  | 'create_code_task'
  | 'save_external'
  | 'get_user_preferences'
  | 'add_user_preference'
  | 'update_user_preference'
  | 'delete_user_preference';

export interface IntexAgentSession {
  id: string;
  userId: string;
  channel: IntexAgentChannel;
  status: IntexAgentSessionStatus;
  startedAt: string;
  endedAt?: string;
  lastUserMessageAt: string;
  lastAssistantMessageAt?: string;
  startReason: IntexAgentSessionStartReason;
  endReason?: IntexAgentSessionEndReason;
  activeTool?: IntexAgentToolName;
  summary?: string;
  matrixCorpusProfile?: IntexAgentMatrixCorpusProfileV1;
  lastEventSequence?: number;
}

export interface IntexAgentMatrixCorpusProfileV1 {
  version: 1;
  kind: 'matrix_corpus';
  runtimeAudience: 'hetzner-prod';
  leaseFence: string;
  runId: string;
  scenarioId: string;
  scenarioNumber: number;
  scenarioLabel: string;
  executionMode: 'strict_mock_tools';
  agentModel: MatrixCorpusAgentModel;
  evaluatorModel: MatrixCorpusEvaluatorModel;
  promptPreferencesVersion: number;
  promptPreferencesDigest: string;
  userTimeZone: string;
  mockProfile: StrictToolMockProfileV1;
  mockProfileDigest: string;
  expectedToolSchedule: MatrixCorpusExpectedToolScheduleV1;
}

export type IntexAgentSessionEventType =
  | 'session_started'
  | 'session_closed'
  | 'user_message'
  | 'assistant_message'
  | 'agent_fallback'
  | 'clarification_requested'
  | 'confirmation_requested'
  | 'confirmation_resolved'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'tool_call_failed'
  | 'matrix_corpus_execution_boundary'
  | 'llm_call_usage'
  | 'llm_usage_summary'
  | 'turn_processing_completed'
  | 'turn_processing_failed'
  | 'unsupported_request';

export interface IntexAgentSessionEvent {
  id: string;
  sessionId: string;
  userId: string;
  type: IntexAgentSessionEventType;
  payload: Record<string, unknown>;
  createdAt: string;
  eventSequence?: number;
}
import type {
  MatrixCorpusAgentModel,
  MatrixCorpusEvaluatorModel,
  MatrixCorpusExpectedToolScheduleV1,
  StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';
