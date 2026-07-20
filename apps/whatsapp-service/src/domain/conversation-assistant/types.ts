import type { GenerateChatResult } from '@intexuraos/llm-factory';
import type { ConversationAssistantDateRange, ConversationAssistantModel } from '@intexuraos/llm-contract';
import type {
  PrivateConversationContextMessage,
  PrivateConversationContextOmittedMessage,
  PrivateConversationContextOmittedCounts,
  PrivateConversationContextResponse,
} from '../whatsapp/models/PrivateWhatsApp.js';
import { DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL } from './roleInference.js';

export { DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL };

export type ConversationAssistantSessionStatus =
  | 'preparing'
  | 'ready'
  | 'failed'
  | 'active';
export type ConversationAssistantPreparationStage =
  | 'queued'
  | 'loading_messages'
  | 'building_context'
  | 'ready'
  | 'failed';
export type ConversationAssistantTurnRole = 'user' | 'assistant';

export interface ConversationAssistantSession {
  id: string;
  userId: string;
  chatId: string;
  chatDisplayName?: string;
  status: ConversationAssistantSessionStatus;
  preparationStage?: ConversationAssistantPreparationStage;
  preparationAttempt?: number;
  preparationClaimId?: string;
  preparationLeaseExpiresAt?: string;
  preparationError?: { code: string; message: string };
  range: ConversationAssistantDateRange;
  effectiveRange: ConversationAssistantDateRange;
  model: string;
  transcriptSha256: string;
  contextSnapshotId?: string;
  transcriptMessageCount: number;
  transcriptText: string;
  assistantRoleLabel: string;
  omitted: PrivateConversationContextOmittedCounts;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastTurnAt?: string;
  creationRequestId?: string;
  maxMessages?: number;
}

export type PublicConversationAssistantSession = Omit<
  ConversationAssistantSession,
  | 'transcriptText'
  | 'creationRequestId'
  | 'maxMessages'
  | 'preparationClaimId'
  | 'preparationLeaseExpiresAt'
  | 'contextSnapshotId'
> & {
  modelDisplayName: string;
};

export interface ConversationAssistantTurn {
  id: string;
  sessionId: string;
  userId: string;
  role: ConversationAssistantTurnRole;
  text: string;
  createdAt: string;
  usage?: GenerateChatResult['usage'];
  error?: { code: string; message: string };
}

export interface CreateConversationAssistantSessionInput {
  userId: string;
  chatId: string;
  from: string;
  to: string;
  model?: ConversationAssistantModel;
  maxMessages?: number;
  requestId?: string;
}

export interface CheckConversationAssistantContextInput {
  userId: string;
  chatId: string;
  from: string;
  to: string;
}

export interface CheckConversationAssistantContextResult {
  messageCount: number;
  warningThreshold: number;
  requiresConfirmation: boolean;
}

export interface SendConversationAssistantTurnInput {
  userId: string;
  sessionId: string;
  question: string;
}

export interface ExportConversationAssistantPdfInput {
  userId: string;
  sessionId: string;
}

export interface CreateConversationAssistantSessionResult {
  session: ConversationAssistantSession;
}

export interface PrepareConversationAssistantSessionInput {
  userId: string;
  sessionId: string;
  attempt?: number;
  claimId?: string;
}

export interface GetConversationAssistantSessionByRequestInput {
  userId: string;
  requestId: string;
}

export interface GetConversationAssistantContextInput {
  userId: string;
  sessionId: string;
  messageCursor?: number;
  omittedCursor?: number;
}

export interface ConversationAssistantContextResult {
  sessionId: string;
  messages: PrivateConversationContextMessage[];
  omittedMessages: PrivateConversationContextOmittedMessage[];
  messageCount: number;
  omittedMessageCount: number;
  snapshotAvailable: boolean;
  omitted: PrivateConversationContextOmittedCounts;
  transcriptSha256: string;
  nextMessageCursor?: number;
  nextOmittedCursor?: number;
}

export interface PrepareConversationAssistantSessionResult {
  session: ConversationAssistantSession;
  context?: PrivateConversationContextResponse;
}

export interface ExportConversationAssistantPdfResult {
  bytes: Buffer;
  fileName: string;
  contentType: 'application/pdf';
}

export interface ConversationAssistantError {
  code:
    | 'INVALID_REQUEST'
    | 'NOT_FOUND'
    | 'EMPTY_TRANSCRIPT'
    | 'CONTEXT_NOT_READY'
    | 'LLM_ERROR'
    | 'PERSISTENCE_ERROR'
    | 'INTERNAL_ERROR';
  message: string;
}

export type ConversationAssistantResult<T> = import('@intexuraos/common-core').Result<
  T,
  ConversationAssistantError
>;

export type ConversationAssistantStreamEvent =
  | { type: 'user_turn'; turn: ConversationAssistantTurn }
  | { type: 'assistant_delta'; text: string }
  | { type: 'usage'; usage: GenerateChatResult['usage'] }
  | { type: 'error'; error: ConversationAssistantError }
  | { type: 'assistant_turn'; turn: ConversationAssistantTurn }
  | { type: 'done' };

export const CONVERSATION_ASSISTANT_LARGE_CONTEXT_WARNING_THRESHOLD = 5000;
