import type { Result } from '@intexuraos/common-core';
import type {
  ConversationAssistantContextAttachment,
  ConversationAssistantContextAttachmentChunkManifest,
  ConversationAssistantContextAttachmentPreparedSnapshot,
  ConversationAssistantContextSnapshotSummary,
  CreateConversationAssistantContextAttachmentResult,
} from './types.js';
import type { ConversationAssistantOperationalTelemetry } from './operationalTelemetry.js';

export type ResolveConversationAssistantContextAttachmentSessionResult =
  | { status: 'found'; sessionGenerationId: string }
  | { status: 'not_found' }
  | {
      status: 'unsupported';
      reason: 'legacy_session' | 'source_unavailable';
    };

export interface CaptureConversationAssistantContextAttachmentInput {
  attachmentId: string;
  userId: string;
  sessionId: string;
  expectedSessionGenerationId: string;
  preparationRequestId: string;
  preparationRequestFingerprint: string;
  replacesAttachmentId?: string;
}

export type CaptureConversationAssistantContextAttachmentResult =
  | { status: 'created' | 'replay'; attachment: ConversationAssistantContextAttachment }
  | { status: 'conflict' }
  | { status: 'not_found' }
  | {
      status: 'unsupported';
      reason: 'legacy_session' | 'source_unavailable';
    }
  | { status: 'stale' };

export interface FailQueuedConversationAssistantContextAttachmentPreparationInput {
  userId: string;
  sessionId: string;
  attachmentId: string;
  expectedSessionGenerationId: string;
  attempt: number;
  error: { code: string; message: string };
}

export interface ConversationAssistantContextAttachmentPreparationRequestedEvent {
  type: 'whatsapp.conversation-assistant.context-attachment.prepare';
  userId: string;
  sessionId: string;
  sessionGenerationId: string;
  attachmentId: string;
  attempt: number;
}

export interface ConversationAssistantContextAttachmentPreparationPublisher {
  publish(
    event: ConversationAssistantContextAttachmentPreparationRequestedEvent
  ): Promise<Result<void, { code: string; message: string }>>;
}

export interface ConversationAssistantContextAttachmentRepository {
  resolveContextAttachmentSession(input: {
    userId: string;
    sessionId: string;
  }): Promise<ResolveConversationAssistantContextAttachmentSessionResult>;
  captureContextAttachment(
    input: CaptureConversationAssistantContextAttachmentInput
  ): Promise<CaptureConversationAssistantContextAttachmentResult>;
  failQueuedContextAttachmentPreparation(
    input: FailQueuedConversationAssistantContextAttachmentPreparationInput
  ): Promise<
    | { status: 'failed' | 'stale'; attachment: ConversationAssistantContextAttachment }
    | { status: 'not_found' }
  >;
}

export interface ConversationAssistantContextAttachmentCreationDeps {
  repository: ConversationAssistantContextAttachmentRepository;
  preparationPublisher: ConversationAssistantContextAttachmentPreparationPublisher;
  telemetry?: ConversationAssistantOperationalTelemetry;
}

export interface ContextAttachmentPreparationFence {
  userId: string;
  sessionId: string;
  attachmentId: string;
  expectedSessionGenerationId: string;
  attempt: number;
  claimId: string;
}

export interface PersistConversationAssistantContextAttachmentPreparedSnapshotInput
  extends ContextAttachmentPreparationFence {
  snapshotId: string;
  prepared: ConversationAssistantContextAttachmentPreparedSnapshot;
  maxChunkCount: number;
  now: string;
}

export interface CompleteConversationAssistantContextAttachmentPreparationInput
  extends ContextAttachmentPreparationFence {
  snapshotId: string;
  manifest: ConversationAssistantContextAttachmentChunkManifest;
  prepared: ConversationAssistantContextAttachmentPreparedSnapshot;
  now: string;
}

export interface FailConversationAssistantContextAttachmentPreparationInput
  extends ContextAttachmentPreparationFence {
  error: { code: string; message: string };
  now: string;
}

export interface DeleteConversationAssistantContextAttachmentPreparedSnapshotInput
  extends ContextAttachmentPreparationFence {
  snapshotId: string;
  chunkIds: string[];
}

export interface RequeueConversationAssistantContextAttachmentPreparationInput {
  userId: string;
  sessionId: string;
  attachmentId: string;
  expectedSessionGenerationId: string;
  updatedAt: string;
}

export interface ConversationAssistantContextAttachmentPreparationRepository {
  claimContextAttachmentPreparation(
    input: ContextAttachmentPreparationFence & { now: string; leaseExpiresAt: string }
  ): Promise<
    | { status: 'claimed'; attachment: ConversationAssistantContextAttachment }
    | { status: 'busy' | 'stale' | 'not_found' | 'expired' }
  >;
  persistContextAttachmentPreparedSnapshot(
    input: PersistConversationAssistantContextAttachmentPreparedSnapshotInput
  ): Promise<
    | { status: 'saved'; manifest: ConversationAssistantContextAttachmentChunkManifest }
    | { status: 'too_large'; chunkCount: number }
    | { status: 'stale' | 'not_found' | 'expired' }
  >;
  completeContextAttachmentPreparation(
    input: CompleteConversationAssistantContextAttachmentPreparationInput
  ): Promise<
    | { status: 'ready'; attachment: ConversationAssistantContextAttachment }
    | { status: 'missing_chunks' | 'stale' | 'not_found' | 'expired' }
  >;
  failContextAttachmentPreparation(
    input: FailConversationAssistantContextAttachmentPreparationInput
  ): Promise<
    | { status: 'failed'; attachment: ConversationAssistantContextAttachment }
    | { status: 'stale' | 'not_found' | 'expired' }
  >;
  deleteContextAttachmentPreparedSnapshot(
    input: DeleteConversationAssistantContextAttachmentPreparedSnapshotInput
  ): Promise<void>;
  requeueContextAttachmentPreparation(
    input: RequeueConversationAssistantContextAttachmentPreparationInput
  ): Promise<
    | { status: 'queued'; attachment: ConversationAssistantContextAttachment }
    | { status: 'stale' | 'not_found' | 'expired' | 'invalid_state' }
  >;
}

export interface ConversationAssistantContextAttachmentDeltaBuilder {
  buildExactCutoffDelta(input: {
    attachment: ConversationAssistantContextAttachment;
  }): Promise<
    Result<
      ConversationAssistantContextAttachmentPreparedSnapshot,
      { code: string; message: string }
    >
  >;
}

export interface ConversationAssistantContextAttachmentClock {
  now(): string;
}

export interface ConversationAssistantContextAttachmentPreparationDeps {
  repository: ConversationAssistantContextAttachmentPreparationRepository;
  deltaBuilder: ConversationAssistantContextAttachmentDeltaBuilder;
  clock: ConversationAssistantContextAttachmentClock;
  telemetry?: ConversationAssistantOperationalTelemetry;
}

export interface ConversationAssistantContextAttachmentRetryDeps {
  repository: ConversationAssistantContextAttachmentPreparationRepository;
  clock: ConversationAssistantContextAttachmentClock;
}

export type GetOwnedConversationAssistantContextAttachmentResult =
  | {
      status: 'found';
      attachment: ConversationAssistantContextAttachment;
      currentContextVersion: number;
    }
  | { status: 'not_found' };

export type LoadOwnedConversationAssistantContextAttachmentSnapshotResult =
  | {
      status: 'found';
      attachment: ConversationAssistantContextAttachment;
      snapshot: ConversationAssistantContextAttachmentPreparedSnapshot;
      currentContextVersion: number;
    }
  | { status: 'not_found' | 'snapshot_unavailable' };

export type DeleteOwnedConversationAssistantContextAttachmentDraftResult =
  | { status: 'deleted' }
  | { status: 'committed' | 'not_found' };

export type ListOwnedConversationAssistantContextHistoryResult =
  | { status: 'found'; snapshots: ConversationAssistantContextSnapshotSummary[] }
  | { status: 'not_found' };

export interface ConversationAssistantContextAttachmentAccessRepository {
  getOwnedContextAttachment(input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
  }): Promise<GetOwnedConversationAssistantContextAttachmentResult>;
  loadOwnedContextAttachmentPreparedSnapshot(input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
    now: string;
  }): Promise<LoadOwnedConversationAssistantContextAttachmentSnapshotResult>;
  deleteOwnedContextAttachmentDraft(input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
  }): Promise<DeleteOwnedConversationAssistantContextAttachmentDraftResult>;
  listOwnedContextHistory(input: {
    userId: string;
    sessionId: string;
  }): Promise<ListOwnedConversationAssistantContextHistoryResult>;
}

export interface ConversationAssistantContextAttachmentAccessDeps {
  repository: ConversationAssistantContextAttachmentAccessRepository;
  privateWhatsAppRepository: import('../whatsapp/index.js').PrivateWhatsAppRepository;
  clock: ConversationAssistantContextAttachmentClock;
}

export interface ConversationAssistantContextAttachmentPublicRetryDeps {
  repository: ConversationAssistantContextAttachmentAccessRepository &
    ConversationAssistantContextAttachmentRepository &
    ConversationAssistantContextAttachmentPreparationRepository;
  preparationPublisher: ConversationAssistantContextAttachmentPreparationPublisher;
  clock: ConversationAssistantContextAttachmentClock;
}

export type ConversationAssistantContextAttachmentCreationRepositoryResult = Extract<
  CreateConversationAssistantContextAttachmentResult,
  { kind: 'created' | 'replay' | 'conflict' | 'not_found' | 'unsupported' | 'stale' }
>;
