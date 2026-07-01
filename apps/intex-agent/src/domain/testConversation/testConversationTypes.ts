import type { WhatsAppInteractiveButton } from '@intexuraos/whatsapp-pubsub-client';
import type { IntexIncomingMessageReplyContext } from '../ports/incomingMessageHandler.js';
import type { IntexAgentSession, IntexAgentSessionEvent, IntexAgentToolName } from '../sessions/types.js';

export const TEST_CONVERSATION_CONTRACT_VERSION = '2026-07-01';
export const TEST_CONVERSATION_SIDE_EFFECT_BOUNDARY = 'mocked_tools_no_downstream_writes';

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
  argsSummary?: Record<string, unknown>;
  resultSummary?: Record<string, unknown>;
  error?: string;
}

export interface TestConversationTurnResult {
  turnIndex: number;
  kind: TestConversationTurnInput['kind'];
  messageId: string;
  sessionId: string;
  submittedTextPreview?: string;
  assistantReplies: SanitizedAssistantReply[];
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
  runId: string;
  scenarioId?: string;
  userId: string;
  finalSessionId: string | null;
  turns: TestConversationTurnResult[];
  toolCalls: CapturedToolCall[];
  sessions: SanitizedTestConversationSession[];
  sessionTransitions: TestConversationSessionTransition[];
  eventsBySessionId: Record<string, SanitizedSessionEvent[]>;
  behavioralTranscript: BehavioralTranscript;
  sideEffectBoundary: typeof TEST_CONVERSATION_SIDE_EFFECT_BOUNDARY;
  warnings: string[];
}
