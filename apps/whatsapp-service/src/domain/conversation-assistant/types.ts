import type { GenerateChatResult } from '@intexuraos/llm-factory';
import type { ConversationAssistantDateRange, ConversationAssistantModel } from '@intexuraos/llm-contract';
import type {
  PrivateConversationContextMessage,
  PrivateConversationContextOmittedMessage,
  PrivateConversationContextOmittedCounts,
  PrivateConversationContextResponse,
} from '../whatsapp/models/PrivateWhatsApp.js';
import type { PrivateWhatsAppContextChange } from '../whatsapp/models/PrivateWhatsAppContextJournal.js';
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

export interface ConversationAssistantSessionContinuation {
  sourceAccountId: string;
  contextVersion: number;
  contextEventThrough: string;
  contextChangeThrough: number;
  contextChainSha256: string;
  displayTimeZone: string;
  nextTurnSequence: number;
  nextConversationRevision: number;
  completedConversationRevision: number;
  attachmentCount: number;
  totalAttachedMessageCount: number;
  totalAttachedOmittedCount: number;
  activeTurnRequestId?: string;
  activeTurnLeaseExpiresAt?: string;
}

export type ConversationAssistantContextAttachmentStatus =
  | 'queued'
  | 'preparing'
  | 'ready'
  | 'failed'
  | 'expired'
  | 'committed';

export interface ConversationAssistantContextAttachmentCounts {
  included: number;
  omitted: number;
  newlyAvailable: number;
  edited: number;
  redacted: number;
  /** Legacy storage compatibility; current Matrix ingest writes no separate deletion category. */
  deleted: number;
  reactionsChanged: number;
  lateIngested: number;
  completedTranscriptions: number;
}

export interface ConversationAssistantContextAttachmentChunkManifest {
  chunkIds: string[];
  chunkCount: number;
}

export interface ConversationAssistantContextAttachment {
  id: string;
  sessionId: string;
  userId: string;
  sessionGenerationId: string;
  sourceAccountId: string;
  sourceAccountGeneration: string;
  chatId: string;
  preparationRequestId: string;
  preparationRequestFingerprint: string;
  replacesAttachmentId?: string;
  status: ConversationAssistantContextAttachmentStatus;
  initialContextFrom: string;
  baseContextVersion: number;
  baseEventThrough: string;
  capturedAt: string;
  baseChangeSeq: number;
  cutoffChangeSeq: number;
  captureRange: ConversationAssistantDateRange;
  eventRange?: ConversationAssistantDateRange;
  counts: ConversationAssistantContextAttachmentCounts;
  omitted: PrivateConversationContextOmittedCounts;
  snapshotId?: string;
  chunkManifest?: ConversationAssistantContextAttachmentChunkManifest;
  deltaTranscriptSha256?: string;
  previousContextChainSha256?: string;
  resultingContextChainSha256?: string;
  estimatedInputTokens?: number;
  requiresConfirmation: boolean;
  confirmationToken?: string;
  preparationAttempt: number;
  preparationClaimId?: string;
  preparationLeaseExpiresAt?: string;
  preparationError?: { code: string; message: string };
  expiresAt?: string;
  committedTurnId?: string;
  committedAt?: string;
  newerAvailableCount?: number;
  newerAvailableCorrectionCount?: number;
}

export type PublicConversationAssistantContextAttachmentStatus = Exclude<
  ConversationAssistantContextAttachmentStatus,
  'queued'
>;

export interface PublicConversationAssistantContextAttachmentCounts {
  included: number;
  excluded: number;
  completedTranscriptions: number;
  edited: number;
  redacted: number;
  /** @deprecated Wire compatibility only. Public projections always return 0. */
  deleted?: 0;
  reactionsChanged: number;
  lateIngested: number;
}

export interface PublicConversationAssistantContextAttachmentError {
  code: 'ATTACHMENT_TOO_LARGE' | 'PREPARATION_FAILED';
  message: string;
}

/** Explicit allowlist. Internal source watermarks, hashes, claims and snapshot ids stay private. */
export interface PublicConversationAssistantContextAttachment {
  id: string;
  status: PublicConversationAssistantContextAttachmentStatus;
  compatibility: 'current' | 'stale';
  capturedAt: string;
  expiresAt?: string;
  captureRange?: ConversationAssistantDateRange;
  eventRange?: ConversationAssistantDateRange;
  counts?: PublicConversationAssistantContextAttachmentCounts;
  omitted?: PrivateConversationContextOmittedCounts;
  newerAvailableCount: number;
  newerAvailableCorrectionCount: number;
  requiresConfirmation: boolean;
  confirmationToken?: string;
  error?: PublicConversationAssistantContextAttachmentError;
}

export interface ConversationAssistantContextSnapshotSummary {
  kind: 'initial' | 'update';
  contextVersion: number;
  capturedAt: string;
  messageCount: number;
  excludedCount: number;
  correctionCount: number;
  omitted: PrivateConversationContextOmittedCounts;
  attachmentId?: string;
  linkedTurnId?: string;
  captureRange?: ConversationAssistantDateRange;
  eventRange?: ConversationAssistantDateRange;
}

export interface CreateConversationAssistantContextAttachmentInput {
  userId: string;
  sessionId: string;
  requestId: string;
  replacesAttachmentId?: string;
}

export type CreateConversationAssistantContextAttachmentResult =
  | { kind: 'created' | 'replay'; attachment: ConversationAssistantContextAttachment }
  | { kind: 'conflict'; code: 'REQUEST_BODY_CONFLICT' }
  | { kind: 'not_found' }
  | {
      kind: 'unsupported';
      reason: 'legacy_session' | 'source_unavailable';
    }
  | { kind: 'stale' }
  | { kind: 'invalid'; code: 'INVALID_REQUEST'; message: string };

export interface ConversationAssistantContextAttachmentPreparedSnapshot {
  transcriptText: string;
  messages: PrivateConversationContextMessage[];
  omittedMessages: PrivateConversationContextOmittedMessage[];
  corrections: PrivateWhatsAppContextChange[];
  eventRange?: ConversationAssistantDateRange;
  counts: ConversationAssistantContextAttachmentCounts;
  omitted: PrivateConversationContextOmittedCounts;
  deltaTranscriptSha256: string;
  previousContextChainSha256: string;
  resultingContextChainSha256: string;
  estimatedInputTokens: number;
  requiresConfirmation: boolean;
  confirmationToken?: string;
}

export interface PrepareConversationAssistantContextAttachmentInput {
  userId: string;
  sessionId: string;
  attachmentId: string;
  sessionGenerationId: string;
  attempt: number;
  claimId: string;
}

export type PrepareConversationAssistantContextAttachmentResult =
  | { kind: 'ready' | 'failed'; attachment: ConversationAssistantContextAttachment }
  | { kind: 'busy' | 'stale' | 'not_found' | 'expired' }
  | { kind: 'invalid'; code: 'INVALID_REQUEST'; message: string };

export interface RetryConversationAssistantContextAttachmentPreparationInput {
  userId: string;
  sessionId: string;
  attachmentId: string;
  sessionGenerationId: string;
}

export type RetryConversationAssistantContextAttachmentPreparationResult =
  | { kind: 'queued'; attachment: ConversationAssistantContextAttachment }
  | { kind: 'stale' | 'not_found' | 'expired' | 'invalid_state' }
  | { kind: 'invalid'; code: 'INVALID_REQUEST'; message: string };

export interface ConversationAssistantSession {
  id: string;
  userId: string;
  chatId: string;
  /** Internal immutable source-erasure fence; never project in public DTOs. */
  sourceAccountId?: string;
  /** Internal immutable account generation paired with sourceAccountId. */
  sourceAccountGeneration?: string;
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
  generationId?: string;
  deletionStartedAt?: string;
  preparationDisplayTimeZone?: string;
  continuation?: ConversationAssistantSessionContinuation;
}

export type PublicConversationAssistantContinuationAvailability =
  | { state: 'available'; displayTimeZone: string }
  | { state: 'legacy_session' | 'source_unavailable' };

export interface PublicConversationAssistantContextSummary {
  displayTimeZone: string;
  availability: PublicConversationAssistantContinuationAvailability;
  contextVersion: number;
  snapshotCount: number;
  totalAttachedMessageCount: number;
  totalAttachedOmittedCount: number;
  completedConversationRevision: number;
  activeTurn: null | { requestId: string; stateVersion: number };
}

/** Explicit public allowlist. Source ownership, chat keys, hashes and fences stay private. */
export interface PublicConversationAssistantSession {
  id: string;
  chatDisplayName?: string;
  status: ConversationAssistantSessionStatus;
  preparationStage?: ConversationAssistantPreparationStage;
  preparationAttempt?: number;
  preparationError?: { code: string; message: string };
  range: ConversationAssistantDateRange;
  effectiveRange: ConversationAssistantDateRange;
  model: string;
  transcriptMessageCount: number;
  assistantRoleLabel: string;
  omitted: PrivateConversationContextOmittedCounts;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastTurnAt?: string;
  deletionToken: string;
  deletionPending: boolean;
  modelDisplayName: string;
  contextSummary: PublicConversationAssistantContextSummary;
}

export interface ConversationAssistantTurn {
  id: string;
  sessionId: string;
  userId: string;
  role: ConversationAssistantTurnRole;
  text: string;
  createdAt: string;
  /** Additive durable ordering fields; absent on legacy turns. */
  sequence?: number;
  conversationRevision?: number;
  requestId?: string;
  kind?: 'message' | 'context_attachment_question';
  contextAttachmentId?: string;
  contextAttachment?: ConversationAssistantTurnContextAttachmentSummary;
  acknowledgment?: string;
  usage?: GenerateChatResult['usage'];
  error?: { code: string; message: string };
}

export interface ConversationAssistantTurnContextAttachmentSummary {
  id: string;
  capturedAt: string;
  captureRange: ConversationAssistantDateRange;
  eventRange?: ConversationAssistantDateRange;
  counts: ConversationAssistantTurnContextAttachmentCounts;
  omitted: PrivateConversationContextOmittedCounts;
}

export interface ConversationAssistantTurnContextAttachmentCounts {
  included: number;
  excluded: number;
  newlyAvailable: number;
  completedTranscriptions: number;
  edited: number;
  redacted: number;
  deleted: number;
  reactionsChanged: number;
  lateIngested: number;
}

export interface PublicConversationAssistantTurnContextAttachmentSummary {
  id: string;
  capturedAt: string;
  captureRange: ConversationAssistantDateRange;
  eventRange?: ConversationAssistantDateRange;
  counts: PublicConversationAssistantContextAttachmentCounts;
  omitted: PrivateConversationContextOmittedCounts;
}

export interface PublicConversationAssistantUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
}

/** Explicit public allowlist shared by legacy and durable turn transports. */
export interface PublicConversationAssistantTurn {
  id: string;
  sessionId: string;
  role: ConversationAssistantTurnRole;
  text: string;
  createdAt: string;
  sequence?: number;
  conversationRevision?: number;
  requestId?: string;
  canRetryAnswer?: boolean;
  kind?: 'message' | 'context_attachment_question';
  contextAttachmentId?: string;
  contextAttachment?: PublicConversationAssistantTurnContextAttachmentSummary;
  acknowledgment?: string;
  usage?: PublicConversationAssistantUsage;
  error?: { code: string; message: string };
}

export interface PublicConversationAssistantContextReaction {
  id: string;
  emoji: string;
  senderDisplayName?: string;
  direction: 'incoming' | 'outgoing';
  eventTimestamp: string;
}

export interface PublicConversationAssistantContextMessage {
  id: string;
  eventTimestamp: string;
  importedAt: string;
  direction: 'incoming' | 'outgoing';
  speakerLabel: string;
  messageType: PrivateConversationContextMessage['messageType'];
  contentKind: 'text' | 'transcription';
  content: string;
  reactions?: PublicConversationAssistantContextReaction[];
}

export interface PublicConversationAssistantOmittedContextMessage {
  id: string;
  eventTimestamp: string;
  importedAt: string;
  direction: 'incoming' | 'outgoing';
  speakerLabel: string;
  messageType: PrivateConversationContextMessage['messageType'];
  omissionReason: PrivateConversationContextOmittedMessage['omissionReason'];
  contentKind?: 'text' | 'transcription';
  content?: string;
  reactions?: PublicConversationAssistantContextReaction[];
  reaction?: { emoji: string; targetReference?: string };
}

export interface PublicConversationAssistantContextResult {
  sessionId: string;
  messages: PublicConversationAssistantContextMessage[];
  omittedMessages: PublicConversationAssistantOmittedContextMessage[];
  messageCount: number;
  omittedMessageCount: number;
  snapshotAvailable: boolean;
  omitted: PrivateConversationContextOmittedCounts;
  nextMessageCursor?: number;
  nextOmittedCursor?: number;
}

export interface CreateConversationAssistantSessionInput {
  userId: string;
  chatId: string;
  from: string;
  to: string;
  model?: ConversationAssistantModel;
  maxMessages?: number;
  requestId?: string;
  displayTimeZone?: string;
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

export interface DeleteConversationAssistantSessionInput {
  userId: string;
  sessionId: string;
  deletionToken: string;
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
  generationId?: string;
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

export const CONVERSATION_ASSISTANT_PUBLIC_LLM_ERROR_MESSAGE =
  'Conversation Assistant request failed';

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
