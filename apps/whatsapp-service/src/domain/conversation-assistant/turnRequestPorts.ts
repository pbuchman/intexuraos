import type { Result } from '@intexuraos/common-core';
import type { GenerateChatResult } from '@intexuraos/llm-factory';
import type { ConversationAssistantDateRange } from '@intexuraos/llm-contract';
import type { ConversationAssistantTurnContextAttachmentSummary } from './types.js';

export type ConversationAssistantTurnRequestStatus =
  | 'in_progress'
  | 'completed'
  | 'failed';

export interface ConversationAssistantTurnRequest {
  id: string;
  requestFingerprint: string;
  sessionId: string;
  userId: string;
  sessionGenerationId: string;
  status: ConversationAssistantTurnRequestStatus;
  attempt: number;
  stateVersion: number;
  conversationRevision: number;
  userTurnId: string;
  assistantTurnId: string;
  question: string;
  acknowledgment: string;
  claimId: string;
  leaseExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  contextAttachmentId?: string;
  completedAt?: string;
  error?: { code: string; message: string };
}

export interface TurnRequestConversationTurn {
  id: string;
  sessionId: string;
  userId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  sequence: number;
  conversationRevision: number;
  requestId: string;
  kind: 'message' | 'context_attachment_question';
  acknowledgment?: string;
  contextAttachmentId?: string;
  contextAttachment?: ConversationAssistantTurnContextAttachmentSummary;
  usage?: GenerateChatResult['usage'];
  error?: { code: string; message: string };
}

export interface ConversationAssistantTurnRequestPromptSnapshot {
  userId: string;
  sessionId: string;
  model: string;
  transcriptText: string;
  chatDisplayName?: string;
  range: ConversationAssistantDateRange;
  effectiveRange: ConversationAssistantDateRange;
  history: readonly {
    role: 'user' | 'assistant';
    text: string;
    contextUpdate?: {
      transcriptText: string;
      records: readonly (
        | {
            kind: 'correction';
            targetReference: string;
            replacementText: string;
          }
        | {
            kind: 'tombstone';
            targetReference: string;
            state: 'redacted' | 'deleted' | 'unavailable';
          }
      )[];
    };
  }[];
  currentQuestion: string;
  currentContextUpdate?: {
    transcriptText: string;
    records: readonly (
      | {
          kind: 'correction';
          targetReference: string;
          replacementText: string;
        }
      | {
          kind: 'tombstone';
          targetReference: string;
          state: 'redacted' | 'deleted' | 'unavailable';
        }
    )[];
  };
}

export interface StartConversationAssistantTurnRequestRepositoryInput {
  userId: string;
  sessionId: string;
  requestId: string;
  requestFingerprint: string;
  question: string;
  contextAttachmentId?: string;
  confirmationToken?: string;
  claimId: string;
  now: string;
  leaseExpiresAt: string;
}

export type StartConversationAssistantTurnRequestRepositoryResult =
  | {
      status: 'claimed';
      request: ConversationAssistantTurnRequest;
      userTurn: TurnRequestConversationTurn;
    }
  | {
      status: 'replay';
      request: ConversationAssistantTurnRequest;
      userTurn: TurnRequestConversationTurn;
      assistantTurn?: TurnRequestConversationTurn;
      completedConversationRevision?: number;
      activeTurnRequestId?: string;
      activeTurnLeaseExpiresAt?: string;
    }
  | {
      status:
        | 'conflict'
        | 'active_request'
        | 'attachment_stale'
        | 'attachment_not_ready'
        | 'confirmation_required'
        | 'context_window_exceeded'
        | 'not_found';
    };

export interface CompleteConversationAssistantTurnRequestInput {
  userId: string;
  sessionId: string;
  requestId: string;
  expectedSessionGenerationId: string;
  attempt: number;
  claimId: string;
  answerText: string;
  completedAt: string;
  usage?: GenerateChatResult['usage'];
}

export interface FailConversationAssistantTurnRequestInput {
  userId: string;
  sessionId: string;
  requestId: string;
  expectedSessionGenerationId: string;
  attempt: number;
  claimId: string;
  errorBodyText: string;
  error: { code: 'LLM_ERROR' | 'CONTEXT_WINDOW_EXCEEDED' };
  publicErrorMessage: string;
  completedAt: string;
}

export type FinalizeConversationAssistantTurnRequestResult =
  | {
      status: 'completed' | 'failed';
      request: ConversationAssistantTurnRequest;
      assistantTurn: TurnRequestConversationTurn;
    }
  | { status: 'stale' | 'not_found' };

export interface ClaimConversationAssistantTurnRequestRetryInput {
  userId: string;
  sessionId: string;
  requestId: string;
  claimId: string;
  now: string;
  leaseExpiresAt: string;
}

export type ClaimConversationAssistantTurnRequestRetryResult =
  | {
      status: 'claimed';
      request: ConversationAssistantTurnRequest;
      userTurn: TurnRequestConversationTurn;
    }
  | {
      status: 'replay';
      request: ConversationAssistantTurnRequest;
      userTurn: TurnRequestConversationTurn;
      assistantTurn?: TurnRequestConversationTurn;
      completedConversationRevision?: number;
      activeTurnRequestId?: string;
      activeTurnLeaseExpiresAt?: string;
    }
  | { status: 'not_found' | 'invalid_state' | 'busy' };

export interface ClaimConversationAssistantTurnRequestRecoveryInput {
  userId: string;
  sessionId: string;
  requestId: string;
  claimId: string;
  now: string;
  leaseExpiresAt: string;
}

export type ClaimConversationAssistantTurnRequestRecoveryResult =
  | {
      status: 'claimed';
      request: ConversationAssistantTurnRequest;
      userTurn: TurnRequestConversationTurn;
    }
  | {
      status: 'replay';
      request: ConversationAssistantTurnRequest;
      userTurn: TurnRequestConversationTurn;
      assistantTurn?: TurnRequestConversationTurn;
      completedConversationRevision?: number;
      activeTurnRequestId?: string;
      activeTurnLeaseExpiresAt?: string;
    }
  | { status: 'not_found' | 'busy' };

export interface RenewConversationAssistantTurnRequestLeaseInput {
  userId: string;
  sessionId: string;
  requestId: string;
  expectedSessionGenerationId: string;
  attempt: number;
  claimId: string;
  now: string;
  leaseExpiresAt: string;
}

export type RenewConversationAssistantTurnRequestLeaseResult =
  | { status: 'renewed'; request: ConversationAssistantTurnRequest }
  | { status: 'stale' | 'not_found' };

export interface ConversationAssistantTurnRequestRepository {
  startTurnRequest(
    input: StartConversationAssistantTurnRequestRepositoryInput
  ): Promise<StartConversationAssistantTurnRequestRepositoryResult>;
  loadPromptSnapshot(input: {
    userId: string;
    sessionId: string;
    requestId: string;
    expectedSessionGenerationId: string;
    attempt: number;
    claimId: string;
    now: string;
  }): Promise<
    | { status: 'found'; snapshot: ConversationAssistantTurnRequestPromptSnapshot }
    | { status: 'not_found' | 'stale' }
  >;
  completeTurnRequest(
    input: CompleteConversationAssistantTurnRequestInput
  ): Promise<FinalizeConversationAssistantTurnRequestResult>;
  failTurnRequest(
    input: FailConversationAssistantTurnRequestInput
  ): Promise<FinalizeConversationAssistantTurnRequestResult>;
  getTurnRequest(input: {
    userId: string;
    sessionId: string;
    requestId: string;
  }): Promise<
    | {
        status: 'found';
        request: ConversationAssistantTurnRequest;
        userTurn: TurnRequestConversationTurn;
        assistantTurn?: TurnRequestConversationTurn;
        completedConversationRevision?: number;
        activeTurnRequestId?: string;
        activeTurnLeaseExpiresAt?: string;
      }
    | { status: 'not_found' }
  >;
  claimAnswerRetry(
    input: ClaimConversationAssistantTurnRequestRetryInput
  ): Promise<ClaimConversationAssistantTurnRequestRetryResult>;
  claimTurnRequestRecovery(
    input: ClaimConversationAssistantTurnRequestRecoveryInput
  ): Promise<ClaimConversationAssistantTurnRequestRecoveryResult>;
  renewTurnRequestLease(
    input: RenewConversationAssistantTurnRequestLeaseInput
  ): Promise<RenewConversationAssistantTurnRequestLeaseResult>;
}

export interface ConversationAssistantTurnRequestRunner {
  generateAnswer(
    input: ConversationAssistantTurnRequestPromptSnapshot,
    onDelta: (text: string) => void
  ): Promise<
    Result<
      { text: string; usage?: GenerateChatResult['usage'] },
      { code: string; message: string }
    >
  >;
}
