import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { ConversationAssistantDateRange, ConversationAssistantModel } from '@intexuraos/llm-contract';
import type { Result } from '@intexuraos/common-core';
import type {
  ConversationAssistantContextResult,
  ConversationAssistantResult,
  ConversationAssistantSession,
  ConversationAssistantTurn,
  ConversationAssistantTurnRole,
  ExportConversationAssistantPdfResult,
} from './types.js';
import type { ConversationAssistantPreparationRequestedEvent } from '../whatsapp/index.js';

export interface ConversationAssistantRepository {
  saveSession(session: ConversationAssistantSession): Promise<void>;
  createSessionIfAbsent(session: ConversationAssistantSession): Promise<
    | { status: 'created'; session: ConversationAssistantSession }
    | { status: 'existing'; session: ConversationAssistantSession }
  >;
  getSessionById(sessionId: string): Promise<ConversationAssistantSession | null>;
  getSessionSnapshotById(
    input: { sessionId: string; userId: string }
  ): Promise<{ session: ConversationAssistantSession; turns: ConversationAssistantTurn[] } | null>;
  listSessionsByUserId(userId: string): Promise<ConversationAssistantSession[]>;
  deleteSession(input: {
    sessionId: string;
    userId: string;
    deletionToken: string;
  }): Promise<void>;
  claimPreparation(input: {
    sessionId: string;
    userId: string;
    attempt: number;
    claimId: string;
    now: string;
    leaseExpiresAt: string;
    expectedGenerationId?: string;
  }): Promise<
    | { status: 'claimed'; session: ConversationAssistantSession }
    | { status: 'busy'; session: ConversationAssistantSession }
    | { status: 'stale'; session: ConversationAssistantSession }
    | { status: 'not_found' }
  >;
  saveClaimedPreparationSession(input: {
    session: ConversationAssistantSession;
    attempt: number;
    claimId: string;
  }): Promise<boolean>;
  requeueFailedPreparation(input: {
    sessionId: string;
    userId: string;
    expectedAttempt: number;
    updatedAt: string;
    expectedGenerationId?: string;
  }): Promise<
    | { status: 'queued' | 'stale'; session: ConversationAssistantSession }
    | { status: 'not_found' }
  >;
  failQueuedPreparation(input: {
    sessionId: string;
    userId: string;
    attempt: number;
    error: { code: string; message: string };
    updatedAt: string;
    expectedGenerationId?: string;
  }): Promise<
    | { status: 'saved' | 'stale'; session: ConversationAssistantSession }
    | { status: 'not_found' }
  >;
  saveContextSnapshot(
    sessionId: string,
    userId: string,
    snapshotId: string,
    snapshot: Pick<ConversationAssistantContextResult, 'messages' | 'omittedMessages'>,
    expectedGenerationId?: string
  ): Promise<boolean>;
  deleteContextSnapshot(
    sessionId: string,
    userId: string,
    snapshotId: string,
    expectedGenerationId?: string
  ): Promise<void>;
  getContextPage(
    sessionId: string,
    snapshotId: string,
    input: {
      messageCursor: number;
      omittedCursor: number;
      limit: number;
      messageCount: number;
      omittedMessageCount: number;
    }
  ): Promise<
    Pick<ConversationAssistantContextResult, 'messages' | 'omittedMessages' | 'snapshotAvailable'>
  >;
  saveTurn(turn: ConversationAssistantTurn): Promise<void>;
  saveTurnIfSessionExists(
    turn: ConversationAssistantTurn,
    expectedGenerationId: string | undefined
  ): Promise<boolean>;
  saveAssistantTurnAndTouchSession(input: {
    session: ConversationAssistantSession;
    turn: ConversationAssistantTurn;
  }): Promise<boolean>;
  listTurnsBySessionId(sessionId: string): Promise<ConversationAssistantTurn[]>;
}

export interface ConversationAssistantClock {
  now(): string;
}

export interface ConversationAssistantIdGenerator {
  sessionId(input?: { userId: string; requestId: string }): string;
  sessionGenerationId(): string;
  turnId(): string;
}

export interface ConversationAssistantPreparationPublisher {
  publish(
    event: ConversationAssistantPreparationRequestedEvent
  ): Promise<ConversationAssistantResult<void>>;
}

export interface ConversationAssistantLlmClientFactory {
  createLlmClientForUser(
    userId: string,
    model: ConversationAssistantModel | string
  ): Promise<ConversationAssistantResult<LlmGenerateClient>>;
}

export interface ConversationAssistantPdfExportInput {
  title: string;
  modelName: string;
  assistantRoleLabel: string;
  initialPrompt: string;
  generatedAt: string;
  sourceRange: ConversationAssistantDateRange;
  effectiveRange: ConversationAssistantDateRange;
  messageCounts: { included: number; excluded: number };
  omittedBreakdown?: Record<string, number>;
  messages: {
    role: ConversationAssistantTurnRole;
    createdAt: string;
    text: string;
  }[];
}

export interface ConversationAssistantPdfExportError {
  message: string;
}

export interface ConversationAssistantPdfExporter {
  exportConversation(
    input: ConversationAssistantPdfExportInput
  ): Promise<Result<ExportConversationAssistantPdfResult, ConversationAssistantPdfExportError>>;
}

export interface ConversationAssistantDeps {
  repository: ConversationAssistantRepository;
  privateWhatsAppRepository: import('../whatsapp/index.js').PrivateWhatsAppRepository;
  llmClientFactory: ConversationAssistantLlmClientFactory;
  pdfExporter?: ConversationAssistantPdfExporter;
  preparationPublisher: ConversationAssistantPreparationPublisher;
  defaultModel: ConversationAssistantModel;
  clock: ConversationAssistantClock;
  ids: ConversationAssistantIdGenerator;
}
