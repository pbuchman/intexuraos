import type { WhatsAppInteractiveButton } from '@intexuraos/whatsapp-pubsub-client';
import type { IntexIncomingMessageReplyContext } from '../ports/incomingMessageHandler.js';
import type { IntexAgentSession, IntexAgentSessionEvent, IntexAgentToolName } from '../sessions/types.js';

export const TEST_CONVERSATION_CONTRACT_VERSION = '2026-07-01';
export const TEST_CONVERSATION_SIDE_EFFECT_BOUNDARY = 'mocked_tools_no_downstream_writes';
export const TEST_CONVERSATION_TOOL_FAILURE_CODE = 'tool_execution_failed';
export const TEST_CONVERSATION_AGENT_MODEL = 'or:deepseek/deepseek-v4-flash' as const;

export type TestConversationMode = 'live_llm_mock_tools';

export interface MessageTurnInput {
  kind: 'message';
  messageId?: string;
  text: string;
  timestamp?: string;
  sourceType?: string;
  sourceUrl?: string;
  whatsappSender?: string;
  replyContext?: IntexIncomingMessageReplyContext;
}

export interface ConfirmationButtonTurnInput {
  kind: 'confirmation_button';
  previousTurnIndex: number;
  decision: 'accept' | 'reject';
  messageId?: string;
  timestamp?: string;
}

export type TestConversationTurnInput = MessageTurnInput | ConfirmationButtonTurnInput;

export type TestToolMock =
  | { mode: 'success'; result: Record<string, unknown> }
  | { mode: 'failure'; message: string };

export type TestToolMocks = Partial<Record<IntexAgentToolName, TestToolMock>>;

export interface TestConversationHttpRequest {
  contractVersion: typeof TEST_CONVERSATION_CONTRACT_VERSION;
  mode: TestConversationMode;
  /** Runtime boundary accepts a required string so the service can fail closed on model drift. */
  agentModel: string;
  userId: string;
  runId: string;
  scenarioId?: string;
  currentDateTime: string;
  timeZone?: string;
  turns: TestConversationTurnInput[];
  toolMocks?: TestToolMocks;
}

export type RunTestConversationInput = TestConversationHttpRequest;

export interface CapturedAssistantReply {
  userId: string;
  message: string;
  replyToMessageId: string;
  correlationId: string;
  ctaUrl?: {
    displayText: string;
    url: string;
  };
  buttons?: WhatsAppInteractiveButton[];
}

export interface SanitizedAssistantReply {
  userId: string;
  message: string;
  replyToMessageId: string;
  correlationId: string;
  ctaUrl?: {
    displayText: string;
    url: string;
  };
  buttons?: WhatsAppInteractiveButton[];
}

export interface CapturedToolCall {
  toolName: IntexAgentToolName;
  status: 'completed' | 'failed';
  argsSummary?: object;
  resultSummary?: object;
  error?: string;
}

export interface SanitizedToolArgsSummary {
  mode?: 'list' | 'count';
  start?: string;
  end?: string;
  timeMin?: string;
  timeMax?: string;
  timeZone?: string;
  workerType?: 'codex' | 'codex-xhigh' | 'minimax';
  taskMode?: 'planning' | 'execution';
  maxResults?: number;
  queryLength?: number;
  summaryLength?: number;
  locationLength?: number;
  descriptionLength?: number;
  attendeesCount?: number;
  eventSummaryLength?: number;
  attendeesToAddCount?: number;
  contentLength?: number;
  titleLength?: number;
  tagsCount?: number;
  sourceMessageIdsCount?: number;
  promptLength?: number;
  originalMessageLength?: number;
  messageLength?: number;
  textLength?: number;
  expectedVersion?: number;
  syntheticMarkerCount?: number;
  syntheticMarkerDigest?: string;
  hasCalendarId?: boolean;
  hasExpectedEtag?: boolean;
  hasEventStart?: boolean;
  hasEventEnd?: boolean;
  hasEventId?: boolean;
  hasUrl?: boolean;
  hasLinearIssueId?: boolean;
  hasSourceUrl?: boolean;
  hasItemId?: boolean;
}

export interface SanitizedToolResultSummary {
  status?: 'completed';
  mode?: 'list' | 'count';
  count?: number;
  currentVersion?: number;
  hasEventId?: boolean;
  hasBookmarkId?: boolean;
  hasCodeTaskId?: boolean;
  hasChangedItemId?: boolean;
  hasResourceUrl?: boolean;
  hasHtmlLink?: boolean;
  hasUrl?: boolean;
  hasSourceUrl?: boolean;
}

export interface SanitizedToolCall {
  toolName: IntexAgentToolName;
  status: 'completed' | 'failed';
  argsSummary?: SanitizedToolArgsSummary;
  resultSummary?: SanitizedToolResultSummary;
  error?: typeof TEST_CONVERSATION_TOOL_FAILURE_CODE;
}

export interface TestConversationSessionAfterTurn {
  id: string;
  status: IntexAgentSession['status'];
  startReason: IntexAgentSession['startReason'];
  endReason?: IntexAgentSession['endReason'];
  activeTool?: IntexAgentToolName;
}

export interface SanitizedTurnTimelineEvent extends SanitizedSessionEvent {
  sessionId: string;
}

export interface TestConversationTurnResult {
  turnIndex: number;
  kind: TestConversationTurnInput['kind'];
  messageId: string;
  sessionId: string;
  submittedTextPreview?: string;
  assistantReplies: SanitizedAssistantReply[];
  toolCalls: SanitizedToolCall[];
  sessionAfterTurn: TestConversationSessionAfterTurn;
  timelineEvents: SanitizedTurnTimelineEvent[];
}

export interface TestConversationSessionTransition {
  turnIndex: number;
  action: 'started' | 'continued' | 'superseded_previous' | 'expired_previous';
  sessionId: string;
  previousSessionId?: string;
  previousEndReason?: string;
}

export interface SanitizedSessionEvent {
  id: string;
  type: IntexAgentSessionEvent['type'];
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface SanitizedTestConversationSession {
  id: string;
  userId: string;
  channel: IntexAgentSession['channel'];
  status: IntexAgentSession['status'];
  startedAt: string;
  endedAt?: string;
  lastUserMessageAt: string;
  lastAssistantMessageAt?: string;
  startReason: IntexAgentSession['startReason'];
  endReason?: IntexAgentSession['endReason'];
  activeTool?: IntexAgentToolName;
}

export interface BehavioralTranscript {
  turns: {
    turnIndex: number;
    submittedTextPreview?: string;
    assistantReplyPreviews: string[];
    sessionAction: string;
    confirmationAction?: 'accepted' | 'rejected' | 'stale';
    toolOutcome?: { toolName: IntexAgentToolName; status: 'completed' | 'failed' };
  }[];
}

export interface TestConversationResponse {
  contractVersion: typeof TEST_CONVERSATION_CONTRACT_VERSION;
  mode: TestConversationMode;
  agentModel: typeof TEST_CONVERSATION_AGENT_MODEL;
  runId: string;
  scenarioId?: string;
  userId: string;
  finalSessionId: string | null;
  stoppedBeforeTurn?: {
    turnIndex: number;
    reason: 'confirmation_button_unavailable';
  };
  turns: TestConversationTurnResult[];
  toolCalls: SanitizedToolCall[];
  sessions: SanitizedTestConversationSession[];
  sessionTransitions: TestConversationSessionTransition[];
  eventsBySessionId: Record<string, SanitizedSessionEvent[]>;
  behavioralTranscript: BehavioralTranscript;
  sideEffectBoundary: typeof TEST_CONVERSATION_SIDE_EFFECT_BOUNDARY;
  warnings: string[];
}
