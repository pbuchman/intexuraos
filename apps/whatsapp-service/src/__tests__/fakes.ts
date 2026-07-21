/**
 * Fake repositories for testing.
 *
 * These fakes implement the domain port interfaces but use in-memory storage.
 * They are designed to be exercised by route tests and use case tests.
 *
 * Coverage note: Some methods may show low coverage until all Tier 1 test issues
 * are completed (see docs/continuity/1-4-whatsapp-webhook-usecase.md, 1-5-whatsapp-routes.md).
 */
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type {
  GenerateOptions,
  GenerateChatOptions,
  GenerateChatResult,
  GenerateChatStreamEvent,
  GenerateResult,
  LlmChatMessage,
  LlmGenerateClient,
  LLMError,
} from '@intexuraos/llm-factory';
import { normalizePhoneNumber } from '../routes/shared.js';
import type {
  AudioStoredEvent,
  ConversationAssistantContextAttachmentPreparationRequestedEvent,
  ConversationAssistantPreparationRequestedEvent,
  EventPublisherPort,
  ExtractLinkPreviewsEvent,
  IntexMessageIngestEvent,
  MatrixCorpusSignedIngestEvent,
  IgnoredReason,
  WhatsAppError,
  LinkPreview,
  LinkPreviewError,
  LinkPreviewFetcherPort,
  LinkPreviewState,
  MediaCleanupEvent,
  MediaTranscriptionRequestedEvent,
  MediaStoragePort,
  MediaUrlInfo,
  NotificationLevel,
  NotificationPreferences,
  NotificationPreferencesRepository,
  OutboundMessage,
  OutboundMessageRepository,
  PhoneVerification,
  PhoneVerificationRepository,
  PhoneVerificationStatus,
  PrivateWhatsAppAggregateRebuildInput,
  PrivateWhatsAppAggregateRebuildResult,
  PrivateWhatsAppChat,
  PrivateWhatsAppChatQueryInput,
  PrivateWhatsAppChatQueryResult,
  PrivateWhatsAppContextChange,
  PrivateWhatsAppContextJournalQueryInput,
  PrivateWhatsAppContextJournalQueryResult,
  PrivateWhatsAppContextMessagesByIdsInput,
  PrivateWhatsAppContextProjection,
  PrivateWhatsAppConversationContextMessageResult,
  PrivateWhatsAppIngestOutcome,
  PrivateWhatsAppMessage,
  PrivateWhatsAppMessageQueryInput,
  PrivateWhatsAppMessageQueryResult,
  PrivateWhatsAppOwnedChatInput,
  PrivateMediaDeletionBatchInput,
  PrivateMediaDeletionBatchResult,
  PrivateWhatsAppReactionSummary,
  PrivateWhatsAppSender,
  PrivateWhatsAppSenderQueryInput,
  PrivateWhatsAppSenderQueryResult,
  PrivateWhatsAppRepository,
  PrivateWhatsAppErasureWorkItem,
  PrivateWhatsAppSenderDay,
  PrivateWhatsAppSenderDayQueryInput,
  PrivateWhatsAppSenderDayQueryResult,
  PrivateWhatsAppTranscriptionState,
  SendMessageResult,
  StorePrivateWhatsAppMessageInput,
  TextMessageSendResult,
  ThumbnailGeneratorPort,
  ThumbnailResult,
  TranscriptionState,
  UpdatePrivateWhatsAppChatTranscriptionInput,
  UpdatePrivateWhatsAppMessageStoredMediaInput,
  UpdatePrivateWhatsAppMessageStoredMediaResult,
  UpdatePrivateWhatsAppMessageTranscriptionInput,
  UpdatePrivateWhatsAppMessageTranscriptionResult,
  UploadResult,
  WebhookProcessEvent,
  WebhookProcessingStatus,
  WhatsAppCloudApiPort,
  WhatsAppInteractiveButton,
  WhatsAppMessage,
  WhatsAppMessageRepository,
  WhatsAppMessageSender,
  WhatsAppUserMappingPublic,
  WhatsAppUserMappingRepository,
  WhatsAppWebhookEvent,
  WhatsAppWebhookEventRepository,
} from '../domain/whatsapp/index.js';
import type { PrivateConversationContextMessageQueryInput } from '../domain/whatsapp/models/PrivateWhatsApp.js';
import type { ConversationAssistantRepository } from '../domain/conversation-assistant/ports.js';
import type {
  ConversationAssistantTurnRequest,
  ConversationAssistantTurnRequestRepository,
  TurnRequestConversationTurn,
} from '../domain/conversation-assistant/turnRequestPorts.js';
import type {
  ConversationAssistantOperationalTelemetry,
  ConversationAssistantTelemetryInput,
} from '../domain/conversation-assistant/operationalTelemetry.js';
import type {
  ConversationAssistantContextAttachment,
  ConversationAssistantContextAttachmentPreparedSnapshot,
  ConversationAssistantContextResult,
  ConversationAssistantSession,
  ConversationAssistantTurn,
} from '../domain/conversation-assistant/types.js';
import { createConversationAssistantDeletionToken } from '../domain/conversation-assistant/deletionToken.js';
import { isLatestRetryableConversationAssistantAnswer } from '../domain/conversation-assistant/answerRetryCapability.js';
import type {
  MatrixOutboundGateway,
  MatrixOutboundReadinessInput,
  MatrixOutboundReadinessResult,
  MatrixOutboundSendInput,
  MatrixOutboundSendResult,
} from '../domain/whatsapp/ports/matrixOutboundGateway.js';
import { randomUUID } from 'node:crypto';

export class FakeConversationAssistantContextAttachmentRepository {
  private readonly sessions = new Map<
    string,
    { userId: string; generationId: string; contextVersion: number }
  >();
  private readonly attachments = new Map<string, ConversationAssistantContextAttachment>();
  private readonly snapshots = new Map<
    string,
    ConversationAssistantContextAttachmentPreparedSnapshot
  >();
  claimResultOverride?: 'busy' | 'stale' | 'not_found' | 'expired';
  persistenceResultOverride?: 'stale' | 'not_found' | 'expired';
  throwOnClaim = false;

  setSession(input: {
    userId: string;
    sessionId: string;
    generationId?: string;
    contextVersion?: number;
  }): void {
    this.sessions.set(input.sessionId, {
      userId: input.userId,
      generationId: input.generationId ?? 'generation-1',
      contextVersion: input.contextVersion ?? 0,
    });
  }

  seedAttachment(
    attachment: ConversationAssistantContextAttachment,
    snapshot?: ConversationAssistantContextAttachmentPreparedSnapshot
  ): void {
    this.attachments.set(attachment.id, structuredClone(attachment));
    if (snapshot !== undefined) this.snapshots.set(attachment.id, structuredClone(snapshot));
  }

  getAttachment(attachmentId: string): ConversationAssistantContextAttachment | undefined {
    const attachment = this.attachments.get(attachmentId);
    return attachment === undefined ? undefined : structuredClone(attachment);
  }

  getSnapshot(
    attachmentId: string
  ): ConversationAssistantContextAttachmentPreparedSnapshot | undefined {
    const snapshot = this.snapshots.get(attachmentId);
    return snapshot === undefined ? undefined : structuredClone(snapshot);
  }

  resolveContextAttachmentSession(input: { userId: string; sessionId: string }): Promise<
    | { status: 'found'; sessionGenerationId: string }
    | { status: 'not_found' }
  > {
    const session = this.sessions.get(input.sessionId);
    if (session?.userId !== input.userId) return Promise.resolve({ status: 'not_found' });
    return Promise.resolve({ status: 'found', sessionGenerationId: session.generationId });
  }

  captureContextAttachment(input: {
    attachmentId: string;
    userId: string;
    sessionId: string;
    expectedSessionGenerationId: string;
    preparationRequestId: string;
    preparationRequestFingerprint: string;
    replacesAttachmentId?: string;
  }): Promise<
    | { status: 'created' | 'replay'; attachment: ConversationAssistantContextAttachment }
    | { status: 'conflict' | 'not_found' | 'stale' }
  > {
    const session = this.sessions.get(input.sessionId);
    if (session?.userId !== input.userId) return Promise.resolve({ status: 'not_found' });
    if (session.generationId !== input.expectedSessionGenerationId) {
      return Promise.resolve({ status: 'stale' });
    }
    const existing = this.attachments.get(input.attachmentId);
    if (existing !== undefined) {
      if (existing.preparationRequestFingerprint !== input.preparationRequestFingerprint) {
        return Promise.resolve({ status: 'conflict' });
      }
      return Promise.resolve({ status: 'replay', attachment: structuredClone(existing) });
    }
    if (input.replacesAttachmentId !== undefined) {
      const replaced = this.attachments.get(input.replacesAttachmentId);
      if (replaced === undefined || replaced.status === 'committed') {
        return Promise.resolve({ status: 'stale' });
      }
      this.attachments.set(replaced.id, { ...replaced, status: 'expired' });
    }
    const attachment: ConversationAssistantContextAttachment = {
      id: input.attachmentId,
      userId: input.userId,
      sessionId: input.sessionId,
      sessionGenerationId: input.expectedSessionGenerationId,
      sourceAccountId: 'source-123',
      sourceAccountGeneration: 'source-123',
      chatId: 'chat:source-123:!direct',
      preparationRequestId: input.preparationRequestId,
      preparationRequestFingerprint: input.preparationRequestFingerprint,
      ...(input.replacesAttachmentId === undefined
        ? {}
        : { replacesAttachmentId: input.replacesAttachmentId }),
      status: 'queued',
      initialContextFrom: '2026-06-30T00:00:00.000Z',
      baseContextVersion: session.contextVersion,
      baseEventThrough: '2026-07-01T00:00:00.000Z',
      capturedAt: '2026-07-02T12:00:00.000Z',
      baseChangeSeq: 1,
      cutoffChangeSeq: 1,
      captureRange: {
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-02T12:00:00.000Z',
      },
      counts: fakeEmptyContextAttachmentCounts(),
      omitted: fakeEmptyConversationContextOmittedCounts(),
      requiresConfirmation: false,
      preparationAttempt: 1,
      expiresAt: '2099-07-02T12:30:00.000Z',
    };
    this.attachments.set(attachment.id, attachment);
    return Promise.resolve({ status: 'created', attachment: structuredClone(attachment) });
  }

  failQueuedContextAttachmentPreparation(input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
    expectedSessionGenerationId: string;
    attempt: number;
    error: { code: string; message: string };
  }): Promise<
    | { status: 'failed' | 'stale'; attachment: ConversationAssistantContextAttachment }
    | { status: 'not_found' }
  > {
    const attachment = this.ownedAttachment(input);
    if (attachment === undefined) return Promise.resolve({ status: 'not_found' });
    if (
      attachment.status !== 'queued' ||
      attachment.preparationAttempt !== input.attempt
    ) {
      return Promise.resolve({ status: 'stale', attachment: structuredClone(attachment) });
    }
    const failed = { ...attachment, status: 'failed' as const, preparationError: input.error };
    this.attachments.set(failed.id, failed);
    return Promise.resolve({ status: 'failed', attachment: structuredClone(failed) });
  }

  claimContextAttachmentPreparation(input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
    expectedSessionGenerationId: string;
    attempt: number;
    claimId: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<
    | { status: 'claimed'; attachment: ConversationAssistantContextAttachment }
    | { status: 'busy' | 'stale' | 'not_found' | 'expired' }
  > {
    if (this.throwOnClaim) throw new Error('fake claim persistence failure');
    if (this.claimResultOverride !== undefined) {
      return Promise.resolve({ status: this.claimResultOverride });
    }
    const attachment = this.ownedAttachment(input);
    if (attachment === undefined) return Promise.resolve({ status: 'not_found' });
    if (attachment.preparationAttempt !== input.attempt) {
      return Promise.resolve({ status: 'stale' });
    }
    if (
      attachment.status === 'preparing' &&
      attachment.preparationClaimId !== input.claimId &&
      (attachment.preparationLeaseExpiresAt ?? '') > input.now
    ) {
      return Promise.resolve({ status: 'busy' });
    }
    if (attachment.status !== 'queued' && attachment.status !== 'preparing') {
      return Promise.resolve({ status: 'stale' });
    }
    const claimed = {
      ...attachment,
      status: 'preparing' as const,
      preparationClaimId: input.claimId,
      preparationLeaseExpiresAt: input.leaseExpiresAt,
    };
    this.attachments.set(claimed.id, claimed);
    return Promise.resolve({ status: 'claimed', attachment: structuredClone(claimed) });
  }

  persistContextAttachmentPreparedSnapshot(input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
    expectedSessionGenerationId: string;
    attempt: number;
    claimId: string;
    snapshotId: string;
    prepared: ConversationAssistantContextAttachmentPreparedSnapshot;
  }): Promise<
    | { status: 'saved'; manifest: { chunkIds: string[]; chunkCount: number } }
    | { status: 'stale' | 'not_found' | 'expired' }
  > {
    if (this.persistenceResultOverride !== undefined) {
      return Promise.resolve({ status: this.persistenceResultOverride });
    }
    const attachment = this.ownedAttachment(input);
    if (
      attachment === undefined ||
      attachment.preparationClaimId !== input.claimId ||
      attachment.preparationAttempt !== input.attempt
    ) {
      return Promise.resolve({ status: attachment === undefined ? 'not_found' : 'stale' });
    }
    this.snapshots.set(input.attachmentId, structuredClone(input.prepared));
    return Promise.resolve({
      status: 'saved',
      manifest: { chunkIds: [`${input.snapshotId}:0`], chunkCount: 1 },
    });
  }

  completeContextAttachmentPreparation(input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
    expectedSessionGenerationId: string;
    attempt: number;
    claimId: string;
    snapshotId: string;
    manifest: { chunkIds: string[]; chunkCount: number };
    prepared: ConversationAssistantContextAttachmentPreparedSnapshot;
  }): Promise<
    | { status: 'ready'; attachment: ConversationAssistantContextAttachment }
    | { status: 'missing_chunks' | 'stale' | 'not_found' | 'expired' }
  > {
    const attachment = this.ownedAttachment(input);
    if (attachment === undefined) return Promise.resolve({ status: 'not_found' });
    if (
      attachment.preparationClaimId !== input.claimId ||
      attachment.preparationAttempt !== input.attempt
    ) {
      return Promise.resolve({ status: 'stale' });
    }
    const ready: ConversationAssistantContextAttachment = {
      ...attachment,
      status: 'ready',
      snapshotId: input.snapshotId,
      chunkManifest: structuredClone(input.manifest),
      ...(input.prepared.eventRange === undefined
        ? {}
        : { eventRange: structuredClone(input.prepared.eventRange) }),
      counts: structuredClone(input.prepared.counts),
      omitted: structuredClone(input.prepared.omitted),
      deltaTranscriptSha256: input.prepared.deltaTranscriptSha256,
      previousContextChainSha256: input.prepared.previousContextChainSha256,
      resultingContextChainSha256: input.prepared.resultingContextChainSha256,
      estimatedInputTokens: input.prepared.estimatedInputTokens,
      requiresConfirmation: input.prepared.requiresConfirmation,
      ...(input.prepared.confirmationToken === undefined
        ? {}
        : { confirmationToken: input.prepared.confirmationToken }),
    };
    delete ready.preparationClaimId;
    delete ready.preparationLeaseExpiresAt;
    this.attachments.set(ready.id, ready);
    return Promise.resolve({ status: 'ready', attachment: structuredClone(ready) });
  }

  failContextAttachmentPreparation(input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
    expectedSessionGenerationId: string;
    attempt: number;
    claimId: string;
    error: { code: string; message: string };
  }): Promise<
    | { status: 'failed'; attachment: ConversationAssistantContextAttachment }
    | { status: 'stale' | 'not_found' | 'expired' }
  > {
    const attachment = this.ownedAttachment(input);
    if (attachment === undefined) return Promise.resolve({ status: 'not_found' });
    if (
      attachment.preparationClaimId !== input.claimId ||
      attachment.preparationAttempt !== input.attempt
    ) {
      return Promise.resolve({ status: 'stale' });
    }
    const failed = {
      ...attachment,
      status: 'failed' as const,
      preparationError: structuredClone(input.error),
    };
    delete failed.preparationClaimId;
    delete failed.preparationLeaseExpiresAt;
    this.attachments.set(failed.id, failed);
    return Promise.resolve({ status: 'failed', attachment: structuredClone(failed) });
  }

  deleteContextAttachmentPreparedSnapshot(input: { attachmentId: string }): Promise<void> {
    this.snapshots.delete(input.attachmentId);
    return Promise.resolve();
  }

  requeueContextAttachmentPreparation(input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
    expectedSessionGenerationId: string;
  }): Promise<
    | { status: 'queued'; attachment: ConversationAssistantContextAttachment }
    | { status: 'stale' | 'not_found' | 'expired' | 'invalid_state' }
  > {
    const attachment = this.ownedAttachment(input);
    if (attachment === undefined) return Promise.resolve({ status: 'not_found' });
    if (attachment.status !== 'failed') return Promise.resolve({ status: 'invalid_state' });
    const queued = {
      ...attachment,
      status: 'queued' as const,
      preparationAttempt: attachment.preparationAttempt + 1,
    };
    delete queued.preparationError;
    this.attachments.set(queued.id, queued);
    return Promise.resolve({ status: 'queued', attachment: structuredClone(queued) });
  }

  getOwnedContextAttachment(input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
  }): Promise<
    | {
        status: 'found';
        attachment: ConversationAssistantContextAttachment;
        currentContextVersion: number;
      }
    | { status: 'not_found' }
  > {
    const attachment = this.attachments.get(input.attachmentId);
    const session = this.sessions.get(input.sessionId);
    if (
      attachment?.userId !== input.userId ||
      attachment.sessionId !== input.sessionId ||
      session?.userId !== input.userId ||
      attachment.sessionGenerationId !== session.generationId
    ) {
      return Promise.resolve({ status: 'not_found' });
    }
    return Promise.resolve({
      status: 'found',
      attachment: structuredClone(attachment),
      currentContextVersion: session.contextVersion,
    });
  }

  async loadOwnedContextAttachmentPreparedSnapshot(input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
    now: string;
  }): Promise<
    | {
        status: 'found';
        attachment: ConversationAssistantContextAttachment;
        snapshot: ConversationAssistantContextAttachmentPreparedSnapshot;
        currentContextVersion: number;
      }
    | { status: 'not_found' | 'snapshot_unavailable' }
  > {
    const owned = await this.getOwnedContextAttachment(input);
    if (owned.status !== 'found') return owned;
    if (
      owned.attachment.status === 'expired' ||
      (owned.attachment.status !== 'committed' &&
        owned.attachment.expiresAt !== undefined &&
        owned.attachment.expiresAt <= input.now)
    ) {
      return { status: 'not_found' };
    }
    const snapshot = this.snapshots.get(input.attachmentId);
    if (snapshot === undefined) return { status: 'snapshot_unavailable' };
    return { ...owned, snapshot: structuredClone(snapshot) };
  }

  async deleteOwnedContextAttachmentDraft(input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
  }): Promise<{ status: 'deleted' | 'committed' | 'not_found' }> {
    const owned = await this.getOwnedContextAttachment(input);
    if (owned.status !== 'found') return owned;
    if (owned.attachment.status === 'committed') return { status: 'committed' };
    if (owned.attachment.status !== 'expired') {
      this.attachments.set(owned.attachment.id, {
        ...owned.attachment,
        status: 'expired',
      });
    }
    this.snapshots.delete(owned.attachment.id);
    return { status: 'deleted' };
  }

  listOwnedContextHistory(input: { userId: string; sessionId: string }): Promise<
    | {
        status: 'found';
        snapshots: import('../domain/conversation-assistant/types.js').ConversationAssistantContextSnapshotSummary[];
      }
    | { status: 'not_found' }
  > {
    const session = this.sessions.get(input.sessionId);
    if (session?.userId !== input.userId) return Promise.resolve({ status: 'not_found' });
    const committed = Array.from(this.attachments.values())
      .filter(
        (attachment) =>
          attachment.userId === input.userId &&
          attachment.sessionId === input.sessionId &&
          attachment.status === 'committed'
      )
      .sort((left, right) => left.baseContextVersion - right.baseContextVersion)
      .map((attachment) => ({
        kind: 'update' as const,
        contextVersion: attachment.baseContextVersion + 1,
        capturedAt: attachment.committedAt ?? attachment.capturedAt,
        messageCount: attachment.counts.included,
        excludedCount: attachment.counts.omitted,
        correctionCount:
          attachment.counts.completedTranscriptions +
          attachment.counts.edited +
          attachment.counts.redacted +
          attachment.counts.deleted +
          attachment.counts.reactionsChanged,
        omitted: structuredClone(attachment.omitted),
        attachmentId: attachment.id,
        captureRange: structuredClone(attachment.captureRange),
        ...(attachment.committedTurnId === undefined
          ? {}
          : { linkedTurnId: attachment.committedTurnId }),
        ...(attachment.eventRange === undefined
          ? {}
          : { eventRange: structuredClone(attachment.eventRange) }),
      }));
    return Promise.resolve({
      status: 'found',
      snapshots: [
        {
          kind: 'initial',
          contextVersion: 0,
          capturedAt: '2026-07-01T00:00:00.000Z',
          messageCount: 1,
          excludedCount: 0,
          correctionCount: 0,
          omitted: {
            mediaOnly: 0,
            failedTranscriptions: 0,
            pendingTranscriptions: 0,
            nonText: 0,
            overLimit: 0,
          },
        },
        ...committed,
      ],
    });
  }

  private ownedAttachment(input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
    expectedSessionGenerationId: string;
  }): ConversationAssistantContextAttachment | undefined {
    const attachment = this.attachments.get(input.attachmentId);
    if (
      attachment?.userId !== input.userId ||
      attachment.sessionId !== input.sessionId ||
      attachment.sessionGenerationId !== input.expectedSessionGenerationId
    ) {
      return undefined;
    }
    return attachment;
  }
}

export class FakeConversationAssistantContextAttachmentDeltaBuilder {
  result: Result<
    ConversationAssistantContextAttachmentPreparedSnapshot,
    { code: string; message: string }
  > = ok(fakePreparedContextAttachmentSnapshot());

  buildExactCutoffDelta(): Promise<typeof this.result> {
    return Promise.resolve(structuredClone(this.result));
  }

  setSnapshot(snapshot: ConversationAssistantContextAttachmentPreparedSnapshot): void {
    this.result = ok(structuredClone(snapshot));
  }

  setFailure(code: string, message: string): void {
    this.result = err({ code, message });
  }
}

function fakeEmptyContextAttachmentCounts(): ConversationAssistantContextAttachment['counts'] {
  return {
    included: 0,
    omitted: 0,
    newlyAvailable: 0,
    edited: 0,
    redacted: 0,
    deleted: 0,
    reactionsChanged: 0,
    lateIngested: 0,
    completedTranscriptions: 0,
  };
}

function fakeEmptyConversationContextOmittedCounts(): ConversationAssistantContextAttachment['omitted'] {
  return {
    mediaOnly: 0,
    failedTranscriptions: 0,
    pendingTranscriptions: 0,
    nonText: 0,
    overLimit: 0,
  };
}

export function fakePreparedContextAttachmentSnapshot(): ConversationAssistantContextAttachmentPreparedSnapshot {
  return {
    transcriptText: '',
    messages: [],
    omittedMessages: [],
    corrections: [],
    counts: fakeEmptyContextAttachmentCounts(),
    omitted: fakeEmptyConversationContextOmittedCounts(),
    deltaTranscriptSha256: 'b'.repeat(64),
    previousContextChainSha256: 'a'.repeat(64),
    resultingContextChainSha256: 'c'.repeat(64),
    estimatedInputTokens: 0,
    requiresConfirmation: false,
  };
}

export class FakeConversationAssistantRepository implements ConversationAssistantRepository {
  private readonly sessions = new Map<string, ConversationAssistantSession>();
  private readonly turns = new Map<string, ConversationAssistantTurn>();
  private readonly contextSnapshots = new Map<
    string,
    Pick<ConversationAssistantContextResult, 'messages' | 'omittedMessages'> & {
      userId: string;
      generationId?: string;
    }
  >();
  readonly snapshotRequests: { sessionId: string; userId: string }[] = [];
  private rejectNextSessionCreationForSourceFence = false;

  fenceNextSessionCreation(): void {
    this.rejectNextSessionCreationForSourceFence = true;
  }

  saveSession(session: ConversationAssistantSession): Promise<void> {
    this.sessions.set(session.id, { ...session });
    return Promise.resolve();
  }

  createSessionIfAbsent(session: ConversationAssistantSession): Promise<
    | { status: 'created'; session: ConversationAssistantSession }
    | { status: 'existing'; session: ConversationAssistantSession }
    | { status: 'source_unavailable' }
  > {
    if (this.rejectNextSessionCreationForSourceFence) {
      this.rejectNextSessionCreationForSourceFence = false;
      return Promise.resolve({ status: 'source_unavailable' });
    }
    const existing = this.sessions.get(session.id);
    if (existing !== undefined) {
      return Promise.resolve({ status: 'existing', session: { ...existing } });
    }
    this.sessions.set(session.id, { ...session });
    return Promise.resolve({ status: 'created', session: { ...session } });
  }

  getSessionById(sessionId: string): Promise<ConversationAssistantSession | null> {
    const session = this.sessions.get(sessionId);
    return Promise.resolve(
      session === undefined || session.deletionStartedAt !== undefined ? null : { ...session }
    );
  }

  getSessionSnapshotById(input: { sessionId: string; userId: string }): Promise<{
    session: ConversationAssistantSession;
    turns: ConversationAssistantTurn[];
  } | null> {
    this.snapshotRequests.push(input);
    const session = this.sessions.get(input.sessionId);
    if (
      session === undefined ||
      session.userId !== input.userId ||
      session.deletionStartedAt !== undefined
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      session: { ...session },
      turns: this.listTurnsForSnapshot(input.sessionId, input.userId),
    });
  }

  listSessionsByUserId(userId: string): Promise<ConversationAssistantSession[]> {
    const sessions = Array.from(this.sessions.values())
      .filter((session) => session.userId === userId)
      .sort((a, b) => {
        const updatedComparison = b.updatedAt.localeCompare(a.updatedAt);
        return updatedComparison === 0 ? b.id.localeCompare(a.id) : updatedComparison;
      })
      .map((session) => ({ ...session }));
    return Promise.resolve(sessions);
  }

  deleteSession(input: {
    sessionId: string;
    userId: string;
    deletionToken: string;
  }): Promise<void> {
    const session = this.sessions.get(input.sessionId);
    if (
      session?.userId !== input.userId ||
      createConversationAssistantDeletionToken(session) !== input.deletionToken
    ) {
      return Promise.resolve();
    }
    this.sessions.delete(input.sessionId);
    for (const [turnId, turn] of this.turns.entries()) {
      if (turn.sessionId === input.sessionId && turn.userId === input.userId) {
        this.turns.delete(turnId);
      }
    }
    for (const [snapshotId, snapshot] of this.contextSnapshots.entries()) {
      if (snapshotId.startsWith(`${input.sessionId}:`) && snapshot.userId === input.userId) {
        this.contextSnapshots.delete(snapshotId);
      }
    }
    return Promise.resolve();
  }

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
  > {
    const session = this.sessions.get(input.sessionId);
    if (
      session === undefined ||
      session.userId !== input.userId ||
      session.deletionStartedAt !== undefined ||
      session.generationId !== input.expectedGenerationId
    ) {
      return Promise.resolve({ status: 'not_found' });
    }
    if (session.status !== 'preparing' || session.preparationAttempt !== input.attempt) {
      return Promise.resolve({ status: 'stale', session: { ...session } });
    }
    if (
      session.preparationClaimId !== undefined &&
      session.preparationLeaseExpiresAt !== undefined &&
      session.preparationLeaseExpiresAt > input.now
    ) {
      return Promise.resolve({ status: 'busy', session: { ...session } });
    }
    const claimed: ConversationAssistantSession = {
      ...session,
      preparationStage: 'loading_messages',
      preparationClaimId: input.claimId,
      preparationLeaseExpiresAt: input.leaseExpiresAt,
      updatedAt: input.now,
    };
    delete claimed.preparationError;
    this.sessions.set(claimed.id, claimed);
    return Promise.resolve({ status: 'claimed', session: { ...claimed } });
  }

  saveClaimedPreparationSession(input: {
    session: ConversationAssistantSession;
    attempt: number;
    claimId: string;
    now: string;
  }): Promise<boolean> {
    const current = this.sessions.get(input.session.id);
    if (
      current?.preparationAttempt !== input.attempt ||
      current.preparationClaimId !== input.claimId ||
      current.preparationLeaseExpiresAt === undefined ||
      current.preparationLeaseExpiresAt <= input.now ||
      current.deletionStartedAt !== undefined ||
      current.generationId !== input.session.generationId
    ) {
      return Promise.resolve(false);
    }
    this.sessions.set(input.session.id, { ...input.session });
    return Promise.resolve(true);
  }

  requeueFailedPreparation(input: {
    sessionId: string;
    userId: string;
    expectedAttempt: number;
    updatedAt: string;
    expectedGenerationId?: string;
  }): Promise<
    | { status: 'queued' | 'stale'; session: ConversationAssistantSession }
    | { status: 'not_found' }
  > {
    const session = this.sessions.get(input.sessionId);
    if (
      session === undefined ||
      session.userId !== input.userId ||
      session.deletionStartedAt !== undefined ||
      session.generationId !== input.expectedGenerationId
    ) {
      return Promise.resolve({ status: 'not_found' });
    }
    if (
      session.status !== 'failed' ||
      (session.preparationAttempt ?? 0) !== input.expectedAttempt
    ) {
      return Promise.resolve({ status: 'stale', session: { ...session } });
    }
    const queued: ConversationAssistantSession = {
      ...session,
      status: 'preparing',
      preparationStage: 'queued',
      preparationAttempt: input.expectedAttempt + 1,
      updatedAt: input.updatedAt,
    };
    delete queued.preparationError;
    delete queued.preparationClaimId;
    delete queued.preparationLeaseExpiresAt;
    this.sessions.set(queued.id, queued);
    return Promise.resolve({ status: 'queued', session: { ...queued } });
  }

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
  > {
    const session = this.sessions.get(input.sessionId);
    if (
      session === undefined ||
      session.userId !== input.userId ||
      session.deletionStartedAt !== undefined ||
      session.generationId !== input.expectedGenerationId
    ) {
      return Promise.resolve({ status: 'not_found' });
    }
    if (
      session.status !== 'preparing' ||
      session.preparationStage !== 'queued' ||
      session.preparationAttempt !== input.attempt ||
      session.preparationClaimId !== undefined
    ) {
      return Promise.resolve({ status: 'stale', session: { ...session } });
    }
    const failed: ConversationAssistantSession = {
      ...session,
      status: 'failed',
      preparationStage: 'failed',
      preparationError: { ...input.error },
      updatedAt: input.updatedAt,
    };
    this.sessions.set(failed.id, failed);
    return Promise.resolve({ status: 'saved', session: { ...failed } });
  }

  saveContextSnapshot(
    sessionId: string,
    userId: string,
    snapshotId: string,
    snapshot: Pick<ConversationAssistantContextResult, 'messages' | 'omittedMessages'>,
    expectedGenerationId?: string
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (
      session?.userId !== userId ||
      session.deletionStartedAt !== undefined ||
      session.generationId !== expectedGenerationId
    ) {
      return Promise.resolve(false);
    }
    this.contextSnapshots.set(
      `${sessionId}:${snapshotId}`,
      {
        userId,
        ...(expectedGenerationId !== undefined
          ? { generationId: expectedGenerationId }
          : {}),
        messages: snapshot.messages.map((message) => ({ ...message })),
        omittedMessages: snapshot.omittedMessages.map((message) => ({ ...message })),
      }
    );
    return Promise.resolve(true);
  }

  deleteContextSnapshot(
    sessionId: string,
    userId: string,
    snapshotId: string,
    expectedGenerationId?: string
  ): Promise<void> {
    const key = `${sessionId}:${snapshotId}`;
    const snapshot = this.contextSnapshots.get(key);
    if (
      snapshot?.userId === userId &&
      snapshot.generationId === expectedGenerationId
    ) {
      this.contextSnapshots.delete(key);
    }
    return Promise.resolve();
  }

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
  > {
    const snapshot = this.contextSnapshots.get(`${sessionId}:${snapshotId}`);
    return Promise.resolve({
      messages: (snapshot?.messages ?? [])
        .slice(input.messageCursor, input.messageCursor + input.limit)
        .map((message) => ({ ...message })),
      omittedMessages: (snapshot?.omittedMessages ?? [])
        .slice(input.omittedCursor, input.omittedCursor + input.limit)
        .map((message) => ({ ...message })),
      snapshotAvailable:
        snapshot !== undefined &&
        snapshot.messages.length === input.messageCount &&
        snapshot.omittedMessages.length === input.omittedMessageCount,
    });
  }

  saveTurn(turn: ConversationAssistantTurn): Promise<void> {
    this.turns.set(turn.id, { ...turn });
    return Promise.resolve();
  }

  saveTurnIfSessionExists(
    turn: ConversationAssistantTurn,
    expectedGenerationId: string | undefined
  ): Promise<boolean> {
    const current = this.sessions.get(turn.sessionId);
    if (
      current?.userId !== turn.userId ||
      current.deletionStartedAt !== undefined ||
      current.generationId !== expectedGenerationId ||
      (current.status !== 'ready' && current.status !== 'active')
    ) {
      return Promise.resolve(false);
    }
    this.turns.set(turn.id, { ...turn });
    return Promise.resolve(true);
  }

  saveAssistantTurnAndTouchSession(input: {
    session: ConversationAssistantSession;
    turn: ConversationAssistantTurn;
  }): Promise<boolean> {
    const current = this.sessions.get(input.session.id);
    if (
      current?.userId !== input.session.userId ||
      input.turn.userId !== input.session.userId ||
      current.deletionStartedAt !== undefined ||
      current.generationId !== input.session.generationId ||
      (current.status !== 'ready' && current.status !== 'active')
    ) {
      return Promise.resolve(false);
    }
    this.turns.set(input.turn.id, { ...input.turn });
    this.sessions.set(input.session.id, {
      ...current,
      updatedAt: input.turn.createdAt,
      lastTurnAt: input.turn.createdAt,
    });
    return Promise.resolve(true);
  }

  listTurnsBySessionId(sessionId: string): Promise<ConversationAssistantTurn[]> {
    return Promise.resolve(this.listTurnsForSnapshot(sessionId));
  }

  private listTurnsForSnapshot(sessionId: string, userId?: string): ConversationAssistantTurn[] {
    const turns = Array.from(this.turns.values())
      .filter((turn) => turn.sessionId === sessionId)
      .filter((turn) => userId === undefined || turn.userId === userId)
      .sort((a, b) => {
        const createdComparison = a.createdAt.localeCompare(b.createdAt);
        return createdComparison === 0 ? a.id.localeCompare(b.id) : createdComparison;
      })
      .map((turn) => ({ ...turn }));
    return turns;
  }

  getAllSessions(): ConversationAssistantSession[] {
    return Array.from(this.sessions.values()).map((session) => ({ ...session }));
  }

  getAllTurns(): ConversationAssistantTurn[] {
    return Array.from(this.turns.values()).map((turn) => ({ ...turn }));
  }

  getContextMessages(
    sessionId: string,
    snapshotId: string
  ): ConversationAssistantContextResult['messages'] {
    return (this.contextSnapshots.get(`${sessionId}:${snapshotId}`)?.messages ?? []).map((message) => ({
      ...message,
    }));
  }
}

export class FakeConversationAssistantTurnRequestRepository
  implements ConversationAssistantTurnRequestRepository
{
  private readonly requests = new Map<
    string,
    {
      request: ConversationAssistantTurnRequest;
      userTurn: TurnRequestConversationTurn;
      assistantTurn?: TurnRequestConversationTurn;
    }
  >();
  private nextStartStatus?:
    | 'conflict'
    | 'active_request'
    | 'attachment_stale'
    | 'attachment_not_ready'
    | 'confirmation_required'
    | 'context_window_exceeded'
    | 'not_found';
  private nextRetryStatus?: 'not_found' | 'invalid_state' | 'busy';
  private throwStart = false;

  constructor(
    private readonly sessionRepository: FakeConversationAssistantRepository,
    private readonly attachmentRepository: FakeConversationAssistantContextAttachmentRepository
  ) {}

  failNextStartWith(status: NonNullable<typeof this.nextStartStatus>): void {
    this.nextStartStatus = status;
  }

  failNextRetryWith(status: NonNullable<typeof this.nextRetryStatus>): void {
    this.nextRetryStatus = status;
  }

  throwOnNextStart(): void {
    this.throwStart = true;
  }

  getStoredRequest(requestId: string): ConversationAssistantTurnRequest | undefined {
    const stored = this.requests.get(requestId)?.request;
    return stored === undefined ? undefined : structuredClone(stored);
  }

  async startTurnRequest(
    input: Parameters<ConversationAssistantTurnRequestRepository['startTurnRequest']>[0]
  ): ReturnType<ConversationAssistantTurnRequestRepository['startTurnRequest']> {
    if (this.throwStart) {
      this.throwStart = false;
      throw new Error('fake turn request persistence failure');
    }
    const session = await this.sessionRepository.getSessionById(input.sessionId);
    if (
      session?.userId !== input.userId ||
      session.generationId === undefined ||
      (session.status !== 'ready' && session.status !== 'active')
    ) {
      return { status: 'not_found' };
    }
    const forced = this.nextStartStatus;
    delete this.nextStartStatus;
    if (forced !== undefined) return { status: forced };

    const existing = this.requests.get(input.requestId);
    if (existing !== undefined) {
      if (
        existing.request.userId !== input.userId ||
        existing.request.sessionId !== input.sessionId
      ) {
        return { status: 'not_found' };
      }
      if (existing.request.requestFingerprint !== input.requestFingerprint) {
        return { status: 'conflict' };
      }
      return {
        status: 'replay',
        request: structuredClone(existing.request),
        userTurn: structuredClone(existing.userTurn),
        ...(existing.assistantTurn === undefined
          ? {}
          : { assistantTurn: structuredClone(existing.assistantTurn) }),
      };
    }
    if (
      Array.from(this.requests.values()).some(
        (stored) =>
          stored.request.userId === input.userId &&
          stored.request.sessionId === input.sessionId &&
          stored.request.status === 'in_progress'
      )
    ) {
      return { status: 'active_request' };
    }

    const attachment =
      input.contextAttachmentId === undefined
        ? undefined
        : this.attachmentRepository.getAttachment(input.contextAttachmentId);
    if (input.contextAttachmentId !== undefined) {
      if (
        attachment === undefined ||
        attachment.userId !== input.userId ||
        attachment.sessionId !== input.sessionId
      ) {
        return { status: 'not_found' };
      }
      if (attachment.status !== 'ready') return { status: 'attachment_not_ready' };
      if (
        attachment.requiresConfirmation &&
        input.confirmationToken !== attachment.confirmationToken
      ) {
        return { status: 'confirmation_required' };
      }
    }

    const sequence = this.requests.size * 2 + 1;
    const conversationRevision = this.requests.size + 1;
    const acknowledgment = attachment === undefined ? '' : 'Added the selected WhatsApp context.';
    const request: ConversationAssistantTurnRequest = {
      id: input.requestId,
      requestFingerprint: input.requestFingerprint,
      sessionId: input.sessionId,
      userId: input.userId,
      sessionGenerationId: session.generationId,
      status: 'in_progress',
      attempt: 1,
      stateVersion: 1,
      conversationRevision,
      userTurnId: `${input.requestId}_user`,
      assistantTurnId: `${input.requestId}_assistant`,
      question: input.question,
      acknowledgment,
      claimId: input.claimId,
      leaseExpiresAt: input.leaseExpiresAt,
      createdAt: input.now,
      updatedAt: input.now,
      ...(input.contextAttachmentId === undefined
        ? {}
        : { contextAttachmentId: input.contextAttachmentId }),
    };
    const userTurn: TurnRequestConversationTurn = {
      id: request.userTurnId,
      sessionId: input.sessionId,
      userId: input.userId,
      role: 'user',
      text: input.question,
      createdAt: input.now,
      sequence,
      conversationRevision,
      requestId: input.requestId,
      kind: attachment === undefined ? 'message' : 'context_attachment_question',
      ...(attachment === undefined
        ? {}
        : {
            contextAttachmentId: attachment.id,
            contextAttachment: {
              id: attachment.id,
              capturedAt: attachment.capturedAt,
              captureRange: { ...attachment.captureRange },
              ...(attachment.eventRange === undefined
                ? {}
                : { eventRange: { ...attachment.eventRange } }),
              counts: {
                included: attachment.counts.included,
                excluded: attachment.counts.omitted,
                newlyAvailable: attachment.counts.newlyAvailable,
                edited: attachment.counts.edited,
                redacted: attachment.counts.redacted,
                deleted: attachment.counts.deleted,
                reactionsChanged: attachment.counts.reactionsChanged,
                lateIngested: attachment.counts.lateIngested,
                completedTranscriptions: attachment.counts.completedTranscriptions,
              },
              omitted: { ...attachment.omitted },
            },
          }),
    };
    this.requests.set(input.requestId, { request, userTurn });
    await this.sessionRepository.saveTurn(userTurn);
    if (session.continuation !== undefined) {
      await this.sessionRepository.saveSession({
        ...session,
        status: 'active',
        updatedAt: input.now,
        continuation: {
          ...session.continuation,
          activeTurnRequestId: input.requestId,
          activeTurnLeaseExpiresAt: input.leaseExpiresAt,
        },
      });
    }
    if (attachment !== undefined) {
      this.attachmentRepository.seedAttachment({
        ...attachment,
        status: 'committed',
        committedTurnId: userTurn.id,
        committedAt: input.now,
      });
    }
    return {
      status: 'claimed',
      request: structuredClone(request),
      userTurn: structuredClone(userTurn),
    };
  }

  async loadPromptSnapshot(
    input: Parameters<ConversationAssistantTurnRequestRepository['loadPromptSnapshot']>[0]
  ): ReturnType<ConversationAssistantTurnRequestRepository['loadPromptSnapshot']> {
    const session = await this.sessionRepository.getSessionById(input.sessionId);
    const stored = this.requests.get(input.requestId);
    if (session?.userId !== input.userId || stored === undefined) return { status: 'not_found' };
    if (
      stored.request.sessionGenerationId !== input.expectedSessionGenerationId ||
      stored.request.status !== 'in_progress' ||
      stored.request.attempt !== input.attempt ||
      stored.request.claimId !== input.claimId ||
      stored.request.leaseExpiresAt <= input.now ||
      session.continuation?.activeTurnRequestId !== stored.request.id ||
      session.continuation.activeTurnLeaseExpiresAt !== stored.request.leaseExpiresAt
    ) {
      return { status: 'stale' };
    }
    return {
      status: 'found',
      snapshot: {
        userId: input.userId,
        sessionId: input.sessionId,
        model: session.model,
        transcriptText: session.transcriptText ?? 'Immutable test transcript',
        ...(session.chatDisplayName === undefined
          ? {}
          : { chatDisplayName: session.chatDisplayName }),
        range: { ...session.range },
        effectiveRange: { ...session.effectiveRange },
        history: [],
        currentQuestion: stored.request.question,
      },
    };
  }

  async completeTurnRequest(
    input: Parameters<ConversationAssistantTurnRequestRepository['completeTurnRequest']>[0]
  ): ReturnType<ConversationAssistantTurnRequestRepository['completeTurnRequest']> {
    const stored = this.ownedClaimedRequest(input);
    if (stored === undefined) return { status: 'stale' };
    const assistantTurn = this.assistantTurn(stored.request, input.answerText, input.completedAt, {
      ...(input.usage === undefined ? {} : { usage: input.usage }),
    });
    const completed: ConversationAssistantTurnRequest = {
      ...stored.request,
      status: 'completed',
      stateVersion: stored.request.stateVersion + 1,
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
    };
    delete completed.error;
    this.requests.set(input.requestId, {
      request: completed,
      userTurn: stored.userTurn,
      assistantTurn,
    });
    await this.sessionRepository.saveTurn(assistantTurn);
    await this.completeSessionRevision(completed, input.completedAt);
    return { status: 'completed', request: completed, assistantTurn };
  }

  async failTurnRequest(
    input: Parameters<ConversationAssistantTurnRequestRepository['failTurnRequest']>[0]
  ): ReturnType<ConversationAssistantTurnRequestRepository['failTurnRequest']> {
    const stored = this.ownedClaimedRequest(input);
    if (stored === undefined) return { status: 'stale' };
    const error = { code: input.error.code, message: input.publicErrorMessage };
    const assistantTurn = this.assistantTurn(
      stored.request,
      input.errorBodyText,
      input.completedAt,
      { error }
    );
    const failed: ConversationAssistantTurnRequest = {
      ...stored.request,
      status: 'failed',
      stateVersion: stored.request.stateVersion + 1,
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
      error,
    };
    this.requests.set(input.requestId, {
      request: failed,
      userTurn: stored.userTurn,
      assistantTurn,
    });
    await this.sessionRepository.saveTurn(assistantTurn);
    await this.completeSessionRevision(failed, input.completedAt);
    return { status: 'failed', request: failed, assistantTurn };
  }

  async getTurnRequest(
    input: Parameters<ConversationAssistantTurnRequestRepository['getTurnRequest']>[0]
  ): ReturnType<ConversationAssistantTurnRequestRepository['getTurnRequest']> {
    const session = await this.sessionRepository.getSessionById(input.sessionId);
    const stored = this.requests.get(input.requestId);
    if (
      session?.userId !== input.userId ||
      stored?.request.userId !== input.userId ||
      stored.request.sessionId !== input.sessionId ||
      stored.request.sessionGenerationId !== session.generationId
    ) {
      return { status: 'not_found' };
    }
    return {
      status: 'found',
      request: structuredClone(stored.request),
      userTurn: structuredClone(stored.userTurn),
      ...(session.continuation === undefined
        ? {}
        : {
            completedConversationRevision:
              session.continuation.completedConversationRevision,
          }),
      ...(session.continuation?.activeTurnRequestId === undefined
        ? {}
        : { activeTurnRequestId: session.continuation.activeTurnRequestId }),
      ...(session.continuation?.activeTurnLeaseExpiresAt === undefined
        ? {}
        : { activeTurnLeaseExpiresAt: session.continuation.activeTurnLeaseExpiresAt }),
      ...(stored.assistantTurn === undefined
        ? {}
        : { assistantTurn: structuredClone(stored.assistantTurn) }),
    };
  }

  async claimAnswerRetry(
    input: Parameters<ConversationAssistantTurnRequestRepository['claimAnswerRetry']>[0]
  ): ReturnType<ConversationAssistantTurnRequestRepository['claimAnswerRetry']> {
    const forced = this.nextRetryStatus;
    delete this.nextRetryStatus;
    if (forced !== undefined) return { status: forced };
    const loaded = await this.getTurnRequest(input);
    if (loaded.status !== 'found') return { status: 'not_found' };
    if (loaded.request.status === 'completed') {
      const { status: _status, ...replay } = loaded;
      return { status: 'replay', ...replay };
    }
    if (loaded.request.status !== 'failed' || loaded.request.error?.code !== 'LLM_ERROR') {
      return { status: 'invalid_state' };
    }
    if (
      loaded.activeTurnRequestId !== undefined &&
      loaded.activeTurnLeaseExpiresAt !== undefined &&
      loaded.activeTurnLeaseExpiresAt > input.now
    ) {
      return { status: 'busy' };
    }
    if (
      !isLatestRetryableConversationAssistantAnswer({
        failed: true,
        errorCode: loaded.request.error.code,
        conversationRevision: loaded.request.conversationRevision,
        completedConversationRevision: loaded.completedConversationRevision,
        activeTurnRequestId: loaded.activeTurnRequestId,
        activeTurnLeaseExpiresAt: loaded.activeTurnLeaseExpiresAt,
        now: input.now,
      })
    ) {
      return { status: 'invalid_state' };
    }
    const claimed: ConversationAssistantTurnRequest = {
      ...loaded.request,
      status: 'in_progress',
      attempt: loaded.request.attempt + 1,
      stateVersion: loaded.request.stateVersion + 1,
      claimId: input.claimId,
      leaseExpiresAt: input.leaseExpiresAt,
      updatedAt: input.now,
    };
    delete claimed.completedAt;
    delete claimed.error;
    this.requests.set(input.requestId, {
      request: claimed,
      userTurn: loaded.userTurn,
      ...(loaded.assistantTurn === undefined ? {} : { assistantTurn: loaded.assistantTurn }),
    });
    const session = await this.sessionRepository.getSessionById(input.sessionId);
    if (session?.continuation !== undefined) {
      await this.sessionRepository.saveSession({
        ...session,
        updatedAt: input.now,
        continuation: {
          ...session.continuation,
          activeTurnRequestId: input.requestId,
          activeTurnLeaseExpiresAt: input.leaseExpiresAt,
        },
      });
    }
    return { status: 'claimed', request: claimed, userTurn: loaded.userTurn };
  }

  async claimTurnRequestRecovery(
    input: Parameters<ConversationAssistantTurnRequestRepository['claimTurnRequestRecovery']>[0]
  ): ReturnType<ConversationAssistantTurnRequestRepository['claimTurnRequestRecovery']> {
    const loaded = await this.getTurnRequest(input);
    if (loaded.status !== 'found') return { status: 'not_found' };
    if (loaded.request.status !== 'in_progress' || loaded.request.leaseExpiresAt > input.now) {
      const { status: _status, ...replay } = loaded;
      return { status: 'replay', ...replay };
    }
    const session = await this.sessionRepository.getSessionById(input.sessionId);
    if (
      session?.continuation?.activeTurnRequestId !== input.requestId ||
      session.continuation.activeTurnLeaseExpiresAt !== loaded.request.leaseExpiresAt
    ) {
      return { status: 'busy' };
    }
    const claimed: ConversationAssistantTurnRequest = {
      ...loaded.request,
      attempt: loaded.request.attempt + 1,
      stateVersion: loaded.request.stateVersion + 1,
      claimId: input.claimId,
      leaseExpiresAt: input.leaseExpiresAt,
      updatedAt: input.now,
    };
    this.requests.set(input.requestId, {
      request: claimed,
      userTurn: loaded.userTurn,
      ...(loaded.assistantTurn === undefined ? {} : { assistantTurn: loaded.assistantTurn }),
    });
    await this.sessionRepository.saveSession({
      ...session,
      updatedAt: input.now,
      continuation: {
        ...session.continuation,
        activeTurnRequestId: input.requestId,
        activeTurnLeaseExpiresAt: input.leaseExpiresAt,
      },
    });
    return { status: 'claimed', request: claimed, userTurn: loaded.userTurn };
  }

  async renewTurnRequestLease(
    input: Parameters<ConversationAssistantTurnRequestRepository['renewTurnRequestLease']>[0]
  ): ReturnType<ConversationAssistantTurnRequestRepository['renewTurnRequestLease']> {
    const loaded = await this.getTurnRequest(input);
    if (loaded.status !== 'found') return { status: 'not_found' };
    const session = await this.sessionRepository.getSessionById(input.sessionId);
    if (
      loaded.request.sessionGenerationId !== input.expectedSessionGenerationId ||
      loaded.request.status !== 'in_progress' ||
      loaded.request.attempt !== input.attempt ||
      loaded.request.claimId !== input.claimId ||
      loaded.request.leaseExpiresAt <= input.now ||
      input.leaseExpiresAt <= input.now ||
      session?.continuation?.activeTurnRequestId !== input.requestId ||
      session.continuation.activeTurnLeaseExpiresAt !== loaded.request.leaseExpiresAt
    ) {
      return { status: 'stale' };
    }
    const renewed: ConversationAssistantTurnRequest = {
      ...loaded.request,
      leaseExpiresAt: input.leaseExpiresAt,
      updatedAt: input.now,
    };
    this.requests.set(input.requestId, {
      request: renewed,
      userTurn: loaded.userTurn,
      ...(loaded.assistantTurn === undefined ? {} : { assistantTurn: loaded.assistantTurn }),
    });
    await this.sessionRepository.saveSession({
      ...session,
      updatedAt: input.now,
      continuation: {
        ...session.continuation,
        activeTurnRequestId: input.requestId,
        activeTurnLeaseExpiresAt: input.leaseExpiresAt,
      },
    });
    return { status: 'renewed', request: renewed };
  }

  private ownedClaimedRequest(input: {
    userId: string;
    sessionId: string;
    requestId: string;
    expectedSessionGenerationId: string;
    attempt: number;
    claimId: string;
  }):
    | {
        request: ConversationAssistantTurnRequest;
        userTurn: TurnRequestConversationTurn;
        assistantTurn?: TurnRequestConversationTurn;
      }
    | undefined {
    const stored = this.requests.get(input.requestId);
    return stored?.request.userId === input.userId &&
      stored.request.sessionId === input.sessionId &&
      stored.request.sessionGenerationId === input.expectedSessionGenerationId &&
      stored.request.attempt === input.attempt &&
      stored.request.claimId === input.claimId
      ? stored
      : undefined;
  }

  private assistantTurn(
    request: ConversationAssistantTurnRequest,
    text: string,
    createdAt: string,
    optional: Pick<TurnRequestConversationTurn, 'usage' | 'error'>
  ): TurnRequestConversationTurn {
    return {
      id: request.assistantTurnId,
      sessionId: request.sessionId,
      userId: request.userId,
      role: 'assistant',
      text,
      createdAt,
      sequence: request.conversationRevision * 2,
      conversationRevision: request.conversationRevision,
      requestId: request.id,
      kind: 'message',
      acknowledgment: request.acknowledgment,
      ...(optional.usage === undefined ? {} : { usage: optional.usage }),
      ...(optional.error === undefined ? {} : { error: optional.error }),
    };
  }

  private async completeSessionRevision(
    request: ConversationAssistantTurnRequest,
    completedAt: string
  ): Promise<void> {
    const session = await this.sessionRepository.getSessionById(request.sessionId);
    if (session?.continuation === undefined) return;
    const continuation = {
      ...session.continuation,
      completedConversationRevision: request.conversationRevision,
    };
    delete continuation.activeTurnRequestId;
    delete continuation.activeTurnLeaseExpiresAt;
    await this.sessionRepository.saveSession({
      ...session,
      status: 'active',
      updatedAt: completedAt,
      continuation,
    });
  }
}

export class FakeConversationAssistantOperationalTelemetry
  implements ConversationAssistantOperationalTelemetry
{
  readonly records: ConversationAssistantTelemetryInput[] = [];

  record(input: ConversationAssistantTelemetryInput): Promise<void> {
    this.records.push(structuredClone(input));
    return Promise.resolve();
  }
}

export class FakeMatrixOutboundGateway implements MatrixOutboundGateway {
  readonly readinessCalls: MatrixOutboundReadinessInput[] = [];
  readonly sendCalls: MatrixOutboundSendInput[] = [];
  private readinessResult: MatrixOutboundReadinessResult = {
    status: 'setup_required',
    reason: 'Matrix outbound target is not configured',
  };
  private sendResult: MatrixOutboundSendResult = {
    status: 'setup_required',
    reason: 'Matrix outbound target is not configured',
  };

  setReadinessResult(result: MatrixOutboundReadinessResult): void {
    this.readinessResult = result;
  }

  setSendResult(result: MatrixOutboundSendResult): void {
    this.sendResult = result;
  }

  getDeliveryReadiness(
    input: MatrixOutboundReadinessInput
  ): Promise<MatrixOutboundReadinessResult> {
    this.readinessCalls.push(input);
    return Promise.resolve(this.readinessResult);
  }

  sendMessage(input: MatrixOutboundSendInput): Promise<MatrixOutboundSendResult> {
    this.sendCalls.push(input);
    return Promise.resolve(this.sendResult);
  }
}

export class FakeLlmGenerateClient implements LlmGenerateClient {
  private readonly generateResponses: Result<GenerateResult, LLMError>[] = [];
  private readonly chatResponses: Result<GenerateChatResult, LLMError>[] = [];
  private nextChatResult: Result<GenerateChatResult, LLMError> = ok({
    content: 'assistant answer',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
  });
  private nextStreamResult: Result<GenerateChatResult, LLMError> = ok({
    content: 'assistant answer',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
  });
  private nextStreamEvents: GenerateChatStreamEvent[] = [];
  readonly chatCalls: { messages: LlmChatMessage[]; options: GenerateChatOptions }[] = [];
  readonly streamChatCalls: { messages: LlmChatMessage[]; options: GenerateChatOptions }[] = [];

  generate(
    _prompt?: string,
    _options?: GenerateOptions
  ): Promise<Result<GenerateResult, LLMError>> {
    const queued = this.generateResponses.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return Promise.resolve(
      ok({
        content: 'assistant answer',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 },
      })
    );
  }

  generateChat(
    messages: LlmChatMessage[],
    options: GenerateChatOptions
  ): Promise<Result<GenerateChatResult, LLMError>> {
    this.chatCalls.push({ messages, options });
    const queued = this.chatResponses.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return Promise.resolve(this.nextChatResult);
  }

  generateChatStream(
    messages: LlmChatMessage[],
    options: GenerateChatOptions,
    onEvent: (event: GenerateChatStreamEvent) => void
  ): Promise<Result<GenerateChatResult, LLMError>> {
    this.streamChatCalls.push({ messages, options });
    for (const event of this.nextStreamEvents) {
      onEvent(event);
    }
    return Promise.resolve(this.nextStreamResult);
  }

  setNextStreamEvents(events: GenerateChatStreamEvent[]): void {
    this.nextStreamEvents = events;
  }

  queueGenerateResponse(response: Partial<GenerateResult> & Pick<GenerateResult, 'content'>): void {
    this.generateResponses.push(
      ok({
        content: response.content,
        usage: response.usage ?? {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          costUsd: 0,
        },
      })
    );
  }

  queueChatResponse(content: string, usage?: GenerateChatResult['usage']): void {
    this.chatResponses.push(
      ok({
        content,
        usage: usage ?? {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          costUsd: 0.001,
        },
      })
    );
  }

  failNextChat(message = 'model failed'): void {
    this.nextChatResult = err({ code: 'API_ERROR', message });
  }

  failNextStream(message = 'stream failed', events: GenerateChatStreamEvent[] = []): void {
    this.nextStreamEvents = events;
    this.nextStreamResult = err({ code: 'API_ERROR', message });
  }

  succeedNextStream(
    content = 'assistant answer',
    events: GenerateChatStreamEvent[] = []
  ): void {
    this.nextStreamEvents = events;
    this.nextStreamResult = ok({
      content,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
    });
  }
}

/**
 * Fake WhatsApp webhook event repository for testing.
 */
export class FakeWhatsAppWebhookEventRepository implements WhatsAppWebhookEventRepository {
  private events = new Map<string, WhatsAppWebhookEvent>();
  private shouldFailSave = false;

  /**
   * Configure the fake to fail the next saveEvent call.
   */
  setFailNextSave(fail: boolean): void {
    this.shouldFailSave = fail;
  }

  saveEvent(
    event: Omit<WhatsAppWebhookEvent, 'id'>
  ): Promise<Result<WhatsAppWebhookEvent, WhatsAppError>> {
    if (this.shouldFailSave) {
      this.shouldFailSave = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated save failure' }));
    }
    const id = randomUUID();
    const fullEvent: WhatsAppWebhookEvent = { id, ...event };
    this.events.set(id, fullEvent);
    return Promise.resolve(ok(fullEvent));
  }

  updateEventStatus(
    eventId: string,
    status: WebhookProcessingStatus,
    metadata: {
      ignoredReason?: IgnoredReason;
      failureDetails?: string;
      retryable?: boolean;
      inboxNoteId?: string;
    }
  ): Promise<Result<WhatsAppWebhookEvent, WhatsAppError>> {
    const event = this.events.get(eventId);
    if (event === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Event not found' }));
    }
    const updated: WhatsAppWebhookEvent = {
      ...event,
      status,
      processedAt: new Date().toISOString(),
      ...metadata,
      retryable: status === 'failed' ? (metadata.retryable ?? false) : false,
    };
    this.events.set(eventId, updated);
    return Promise.resolve(ok(updated));
  }

  getEvent(eventId: string): Promise<Result<WhatsAppWebhookEvent | null, WhatsAppError>> {
    return Promise.resolve(ok(this.events.get(eventId) ?? null));
  }

  findRetryableEvents(options: {
    olderThan: string;
    limit: number;
  }): Promise<Result<WhatsAppWebhookEvent[], WhatsAppError>> {
    const events = Array.from(this.events.values())
      .filter(
        (event) =>
          (event.status === 'pending' || (event.status === 'failed' && event.retryable === true)) &&
          event.receivedAt < options.olderThan
      )
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      .slice(0, options.limit);
    return Promise.resolve(ok(events));
  }

  getAll(): WhatsAppWebhookEvent[] {
    return Array.from(this.events.values());
  }

  clear(): void {
    this.events.clear();
  }

  /**
   * Set an event with a specific ID for testing.
   * Allows tests to pre-populate events that usecases will reference by ID.
   */
  setEvent(event: WhatsAppWebhookEvent): void {
    this.events.set(event.id, event);
  }
}

/**
 * Fake WhatsApp user mapping repository for testing.
 */
export class FakeWhatsAppUserMappingRepository implements WhatsAppUserMappingRepository {
  private mappings = new Map<string, WhatsAppUserMappingPublic & { userId: string }>();
  private phoneIndex = new Map<string, string>();
  private shouldFailGetMapping = false;
  private shouldFailDisconnect = false;
  private shouldFailSaveMapping = false;
  private shouldFailFindUserByPhoneNumber = false;
  private shouldFailFindPhoneByUserId = false;
  private shouldThrowOnGetMapping = false;
  private enforcePhoneUniqueness = false;

  /**
   * Configure the fake to fail getMapping calls with an INTERNAL_ERROR to simulate downstream failures.
   */
  setFailGetMapping(fail: boolean): void {
    this.shouldFailGetMapping = fail;
  }

  /**
   * Configure the fake to throw an exception on getMapping.
   * Used to test unexpected error handling.
   */
  setThrowOnGetMapping(shouldThrow: boolean): void {
    this.shouldThrowOnGetMapping = shouldThrow;
  }

  /**
   * Configure the fake to fail disconnectMapping calls with an INTERNAL_ERROR to simulate downstream failures.
   */
  setFailDisconnect(fail: boolean): void {
    this.shouldFailDisconnect = fail;
  }

  /**
   * Configure the fake to fail saveMapping calls with an INTERNAL_ERROR to simulate downstream failures.
   */
  setFailSaveMapping(fail: boolean): void {
    this.shouldFailSaveMapping = fail;
  }

  /**
   * Configure the fake to fail findUserByPhoneNumber calls with an INTERNAL_ERROR.
   * Simulates downstream failures such as database connection failures or external service timeouts.
   */
  setFailFindUserByPhoneNumber(fail: boolean): void {
    this.shouldFailFindUserByPhoneNumber = fail;
  }

  /**
   * Configure the fake to fail findPhoneByUserId calls with an INTERNAL_ERROR.
   * Simulates downstream failures such as database connection failures or external service timeouts.
   */
  setFailFindPhoneByUserId(fail: boolean): void {
    this.shouldFailFindPhoneByUserId = fail;
  }

  /**
   * Configure the fake to enforce phone number uniqueness (simulates real Firestore behavior).
   * When enabled, saveMapping will fail if a phone number is already mapped to a different user.
   */
  setEnforcePhoneUniqueness(enforce: boolean): void {
    this.enforcePhoneUniqueness = enforce;
  }

  saveMapping(
    userId: string,
    phoneNumbers: string[]
  ): Promise<Result<WhatsAppUserMappingPublic, WhatsAppError>> {
    // Simulate downstream failure
    if (this.shouldFailSaveMapping) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated saveMapping failure' })
      );
    }

    const now = new Date().toISOString();
    // Normalize phone numbers (remove leading "+") to match real implementation
    const normalizedPhoneNumbers = phoneNumbers.map(normalizePhoneNumber);

    // Check for phone number conflicts if uniqueness is enforced
    if (this.enforcePhoneUniqueness) {
      for (const phone of normalizedPhoneNumbers) {
        const existingUserId = this.phoneIndex.get(phone);
        if (existingUserId !== undefined && existingUserId !== userId) {
          return Promise.resolve(
            err({
              code: 'VALIDATION_ERROR',
              message: `Phone number ${phone} is already mapped to another user`,
              details: { phoneNumber: phone, existingUserId },
            })
          );
        }
      }
    }

    const mapping = {
      userId,
      phoneNumbers: normalizedPhoneNumbers,
      connected: true,
      createdAt: now,
      updatedAt: now,
    };
    this.mappings.set(userId, mapping);
    for (const phone of normalizedPhoneNumbers) {
      this.phoneIndex.set(phone, userId);
    }
    const { userId: _, ...publicMapping } = mapping;
    return Promise.resolve(ok(publicMapping));
  }

  getMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic | null, WhatsAppError>> {
    if (this.shouldThrowOnGetMapping) {
      throw new Error('Simulated unexpected error in getMapping');
    }
    if (this.shouldFailGetMapping) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated getMapping failure' })
      );
    }
    const mapping = this.mappings.get(userId);
    if (mapping === undefined) return Promise.resolve(ok(null));
    const { userId: _, ...publicMapping } = mapping;
    return Promise.resolve(ok(publicMapping));
  }

  findUserByPhoneNumber(phoneNumber: string): Promise<Result<string | null, WhatsAppError>> {
    if (this.shouldFailFindUserByPhoneNumber) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated user lookup failure' })
      );
    }
    // Normalize phone number to match stored format (without "+")
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    return Promise.resolve(ok(this.phoneIndex.get(normalizedPhone) ?? null));
  }

  findPhoneByUserId(userId: string): Promise<Result<string | null, WhatsAppError>> {
    if (this.shouldFailFindPhoneByUserId) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated phone lookup failure' })
      );
    }
    const mapping = this.mappings.get(userId);
    if (mapping === undefined) return Promise.resolve(ok(null));
    if (!mapping.connected) return Promise.resolve(ok(null));
    const firstPhone = mapping.phoneNumbers[0];
    if (firstPhone === undefined) return Promise.resolve(ok(null));
    return Promise.resolve(ok(firstPhone));
  }

  disconnectMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic, WhatsAppError>> {
    if (this.shouldFailDisconnect) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated disconnectMapping failure' })
      );
    }
    const mapping = this.mappings.get(userId);
    if (mapping === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Mapping not found' }));
    }
    mapping.connected = false;
    mapping.updatedAt = new Date().toISOString();
    const { userId: _, ...publicMapping } = mapping;
    return Promise.resolve(ok(publicMapping));
  }

  isConnected(userId: string): Promise<Result<boolean, WhatsAppError>> {
    const mapping = this.mappings.get(userId);
    return Promise.resolve(ok(mapping?.connected === true));
  }

  /**
   * Set a mapping for a phone number for testing.
   * Convenience method to set up user mappings in tests.
   */
  setMappingForPhone(phoneNumber: string, userId: string, options?: { connected?: boolean }): void {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    const mapping = {
      userId,
      phoneNumbers: [normalizedPhone],
      connected: options?.connected ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.mappings.set(userId, mapping);
    this.phoneIndex.set(normalizedPhone, userId);
  }

  clear(): void {
    this.mappings.clear();
    this.phoneIndex.clear();
    this.shouldFailGetMapping = false;
    this.shouldFailDisconnect = false;
    this.shouldFailSaveMapping = false;
    this.shouldFailFindUserByPhoneNumber = false;
    this.shouldFailFindPhoneByUserId = false;
    this.shouldThrowOnGetMapping = false;
    this.enforcePhoneUniqueness = false;
  }
}

/**
 * Fake WhatsApp message repository for testing.
 */
export class FakeWhatsAppMessageRepository implements WhatsAppMessageRepository {
  private messages = new Map<string, WhatsAppMessage>();
  private shouldFailSave = false;
  private shouldFailGetMessage = false;
  private shouldFailDeleteMessage = false;
  private shouldFailGetMessagesByUser = false;
  private shouldThrowOnGetMessage = false;
  private shouldThrowOnUpdateTranscription = false;
  private shouldFailUpdateTranscription = false;
  private shouldFailFindById = false;
  private shouldFailFindByWaMessageId = false;
  private nextCursorToReturn: string | undefined = undefined;

  setFailSave(fail: boolean): void {
    this.shouldFailSave = fail;
  }

  setFailGetMessage(fail: boolean): void {
    this.shouldFailGetMessage = fail;
  }

  setFailDeleteMessage(fail: boolean): void {
    this.shouldFailDeleteMessage = fail;
  }

  setFailGetMessagesByUser(fail: boolean): void {
    this.shouldFailGetMessagesByUser = fail;
  }

  setThrowOnGetMessage(shouldThrow: boolean): void {
    this.shouldThrowOnGetMessage = shouldThrow;
  }

  setThrowOnUpdateTranscription(shouldThrow: boolean): void {
    this.shouldThrowOnUpdateTranscription = shouldThrow;
  }

  setFailUpdateTranscription(fail: boolean): void {
    this.shouldFailUpdateTranscription = fail;
  }

  setFailFindById(fail: boolean): void {
    this.shouldFailFindById = fail;
  }

  setFailFindByWaMessageId(fail: boolean): void {
    this.shouldFailFindByWaMessageId = fail;
  }

  /**
   * Configure the fake to return a nextCursor in getMessagesByUser response.
   * Used to test pagination handling.
   */
  setNextCursor(cursor: string | undefined): void {
    this.nextCursorToReturn = cursor;
  }

  /**
   * Pre-populate a message with a specific ID for testing.
   */
  setMessage(message: WhatsAppMessage): void {
    this.messages.set(message.id, message);
  }

  /**
   * Get a message synchronously for test assertions.
   */
  getMessageSync(messageId: string): WhatsAppMessage | undefined {
    return this.messages.get(messageId);
  }

  saveMessage(
    message: Omit<WhatsAppMessage, 'id'>
  ): Promise<Result<WhatsAppMessage, WhatsAppError>> {
    if (this.shouldFailSave) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated message save failure' })
      );
    }
    const id = randomUUID();
    const fullMessage: WhatsAppMessage = { id, ...message };
    this.messages.set(id, fullMessage);
    return Promise.resolve(ok(fullMessage));
  }

  getMessagesByUser(
    userId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<Result<{ messages: WhatsAppMessage[]; nextCursor?: string }, WhatsAppError>> {
    if (this.shouldFailGetMessagesByUser) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated getMessagesByUser failure' })
      );
    }
    const limit = options?.limit ?? 50;
    const userMessages = Array.from(this.messages.values())
      .filter((m) => m.userId === userId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, limit);
    const result: { messages: WhatsAppMessage[]; nextCursor?: string } = { messages: userMessages };
    if (this.nextCursorToReturn !== undefined) {
      result.nextCursor = this.nextCursorToReturn;
    }
    return Promise.resolve(ok(result));
  }

  getMessage(messageId: string): Promise<Result<WhatsAppMessage | null, WhatsAppError>> {
    if (this.shouldThrowOnGetMessage) {
      return Promise.reject(new Error('Simulated unexpected getMessage exception'));
    }
    if (this.shouldFailGetMessage) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated getMessage failure' })
      );
    }
    return Promise.resolve(ok(this.messages.get(messageId) ?? null));
  }

  deleteMessage(messageId: string): Promise<Result<void, WhatsAppError>> {
    if (this.shouldFailDeleteMessage) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated deleteMessage failure' })
      );
    }
    this.messages.delete(messageId);
    return Promise.resolve(ok(undefined));
  }

  findById(
    userId: string,
    messageId: string
  ): Promise<Result<WhatsAppMessage | null, WhatsAppError>> {
    if (this.shouldFailFindById) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated findById failure' })
      );
    }
    const message = this.messages.get(messageId);
    if (message?.userId !== userId) {
      return Promise.resolve(ok(null));
    }
    return Promise.resolve(ok(message));
  }

  findByWaMessageId(
    userId: string,
    waMessageId: string
  ): Promise<Result<WhatsAppMessage | null, WhatsAppError>> {
    if (this.shouldFailFindByWaMessageId) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated findByWaMessageId failure' })
      );
    }
    const message =
      Array.from(this.messages.values()).find(
        (candidate) => candidate.userId === userId && candidate.waMessageId === waMessageId
      ) ?? null;
    return Promise.resolve(ok(message));
  }

  updateTranscription(
    userId: string,
    messageId: string,
    transcription: TranscriptionState
  ): Promise<Result<void, WhatsAppError>> {
    if (this.shouldThrowOnUpdateTranscription) {
      return Promise.reject(new Error('Simulated unexpected updateTranscription exception'));
    }
    if (this.shouldFailUpdateTranscription) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated updateTranscription failure' })
      );
    }
    const message = this.messages.get(messageId);
    if (message?.userId !== userId) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Message not found' }));
    }
    message.transcription = transcription;
    return Promise.resolve(ok(undefined));
  }

  updateLinkPreview(
    userId: string,
    messageId: string,
    linkPreview: LinkPreviewState
  ): Promise<Result<void, WhatsAppError>> {
    const message = this.messages.get(messageId);
    if (message?.userId !== userId) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Message not found' }));
    }
    message.linkPreview = linkPreview;
    return Promise.resolve(ok(undefined));
  }

  getAll(): WhatsAppMessage[] {
    return Array.from(this.messages.values());
  }

  /**
   * Synchronously get messages by user for test assertions.
   * Returns the messages array directly (not the Result wrapper).
   */
  getMessagesByUserSync(userId: string): WhatsAppMessage[] {
    return Array.from(this.messages.values())
      .filter((m) => m.userId === userId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  clear(): void {
    this.messages.clear();
    this.shouldFailSave = false;
    this.shouldFailGetMessage = false;
    this.shouldFailDeleteMessage = false;
    this.shouldFailGetMessagesByUser = false;
    this.shouldThrowOnGetMessage = false;
    this.shouldThrowOnUpdateTranscription = false;
    this.shouldFailUpdateTranscription = false;
    this.shouldFailFindById = false;
    this.shouldFailFindByWaMessageId = false;
    this.nextCursorToReturn = undefined;
  }
}

/**
 * Fake private WhatsApp repository for sync route and use case tests.
 */
interface FakePrivateWhatsAppAccount {
  id: string;
  userId: string;
  sourceAccountId: string;
  generationId?: string;
  phoneNumberNormalized: string;
  displayName: string;
  status: 'active' | 'disabled';
  erasureStatus?: 'erasing';
  erasureRequestId?: string;
  createdAt: string;
  updatedAt: string;
  lastIngestAt?: string;
  lastEventAt?: string;
  messageCount?: number;
  senderCount?: number;
  schemaVersion: 1;
}

interface FakeUpsertPrivateWhatsAppAccountInput {
  userId: string;
  phoneNumberNormalized: string;
  displayName?: string;
  now: string;
}

interface FakeDisablePrivateWhatsAppAccountInput {
  userId: string;
  now: string;
}

interface FakePrivateWhatsAppChatTranscriptionSetting {
  transcriptionEnabled: boolean;
  transcriptionUpdatedAt: string;
  transcriptionEnabledAt?: string;
}

export class FakePrivateWhatsAppRepository implements PrivateWhatsAppRepository {
  private readonly stored = new Map<string, StorePrivateWhatsAppMessageInput>();
  private readonly contextChangesByChat = new Map<string, PrivateWhatsAppContextChange[]>();
  private readonly contextMetadataByMessageId = new Map<
    string,
    { revision: number; sequence: number }
  >();
  private readonly accounts = new Map<string, FakePrivateWhatsAppAccount>();
  private readonly chatTranscriptionSettings = new Map<
    string,
    FakePrivateWhatsAppChatTranscriptionSetting
  >();
  private readonly messageTranscriptions = new Map<string, PrivateWhatsAppTranscriptionState>();
  private failNextError: WhatsAppError | null = null;
  private failNextStoreError: WhatsAppError | null = null;
  private failNextDataQueryError: WhatsAppError | null = null;
  private failNextMessageLookupError: WhatsAppError | null = null;
  private failNextReactionQueryError: WhatsAppError | null = null;
  private failNextChatTranscriptionUpdateError: WhatsAppError | null = null;
  private failNextConversationContextQueryError: WhatsAppError | null = null;

  failNext(error: WhatsAppError): void {
    this.failNextError = error;
  }

  failNextStore(error: WhatsAppError): void {
    this.failNextStoreError = error;
  }

  failNextDataQuery(error: WhatsAppError): void {
    this.failNextDataQueryError = error;
  }

  failNextReactionQuery(error: WhatsAppError): void {
    this.failNextReactionQueryError = error;
  }

  failNextMessageLookup(error: WhatsAppError): void {
    this.failNextMessageLookupError = error;
  }

  failNextChatTranscriptionUpdate(error: WhatsAppError): void {
    this.failNextChatTranscriptionUpdateError = error;
  }

  failNextConversationContextQuery(error: WhatsAppError): void {
    this.failNextConversationContextQueryError = error;
  }

  setAccount(account: FakePrivateWhatsAppAccount): void {
    this.accounts.set(account.userId, account);
  }

  getAccountByUserId(
    userId: string
  ): Promise<Result<FakePrivateWhatsAppAccount | null, WhatsAppError>> {
    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }
    return Promise.resolve(ok(this.accounts.get(userId) ?? null));
  }

  getActiveAccountBySourceAccountId(
    sourceAccountId: string
  ): Promise<Result<FakePrivateWhatsAppAccount | null, WhatsAppError>> {
    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }
    const account = Array.from(this.accounts.values()).find(
      (candidate) => candidate.sourceAccountId === sourceAccountId && candidate.status === 'active'
    );
    return Promise.resolve(ok(account ?? null));
  }

  upsertAccount(
    input: FakeUpsertPrivateWhatsAppAccountInput
  ): Promise<Result<FakePrivateWhatsAppAccount, WhatsAppError>> {
    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }
    const existing = this.accounts.get(input.userId);
    const now = input.now;
    const account: FakePrivateWhatsAppAccount = {
      id: input.userId,
      userId: input.userId,
      sourceAccountId: existing?.sourceAccountId ?? `private-wa-test-${input.userId}`,
      phoneNumberNormalized: input.phoneNumberNormalized,
      displayName: input.displayName ?? `+${input.phoneNumberNormalized}`,
      status: 'active',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      schemaVersion: 1,
    };
    if (existing?.lastIngestAt !== undefined) {
      account.lastIngestAt = existing.lastIngestAt;
    }
    if (existing?.lastEventAt !== undefined) {
      account.lastEventAt = existing.lastEventAt;
    }
    if (existing?.messageCount !== undefined) {
      account.messageCount = existing.messageCount;
    }
    if (existing?.senderCount !== undefined) {
      account.senderCount = existing.senderCount;
    }
    this.accounts.set(input.userId, account);
    return Promise.resolve(ok(account));
  }

  disableAccount(
    input: FakeDisablePrivateWhatsAppAccountInput
  ): Promise<Result<FakePrivateWhatsAppAccount, WhatsAppError>> {
    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }
    const existing = this.accounts.get(input.userId);
    if (existing === undefined) {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: 'Private WhatsApp account not found' })
      );
    }
    const account: FakePrivateWhatsAppAccount = {
      ...existing,
      status: 'disabled',
      updatedAt: input.now,
    };
    this.accounts.set(input.userId, account);
    return Promise.resolve(ok(account));
  }

  storeIncomingMessage(
    input: StorePrivateWhatsAppMessageInput
  ): Promise<Result<PrivateWhatsAppIngestOutcome, WhatsAppError>> {
    const storeFailure = this.consumeStoreFailure();
    if (storeFailure !== null) {
      return Promise.resolve(err(storeFailure));
    }

    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }

    const existing = this.stored.get(input.message.matrixEventId);
    const chatId = `chat:${input.sourceAccountId}:${input.chat.matrixRoomId}`;
    const messageId = `message:${input.sourceAccountId}:${input.message.matrixEventId}`;
    const chatTranscriptionEnabled =
      this.chatTranscriptionSettings.get(chatId)?.transcriptionEnabled === true;

    if (existing !== undefined) {
      return Promise.resolve(
        ok({
          outcome: 'duplicate',
          chatId,
          messageId,
          matrixEventId: input.message.matrixEventId,
        })
      );
    }

    this.stored.set(input.message.matrixEventId, input);
    if (input.message.relation === undefined && input.message.type !== 'reaction' && input.message.type !== 'redaction') {
      const message = this.toMessage(input);
      const entries = this.contextChangesByChat.get(chatId) ?? [];
      const sequence = entries.length + 1;
      this.contextMetadataByMessageId.set(messageId, { revision: 1, sequence });
      entries.push({
        userId: input.userId,
        sourceAccountId: input.sourceAccountId,
        chatId,
        sequence,
        messageId,
        messageRevision: 1,
        changeType: 'created',
        changedAt: input.receivedAt,
        eventTimestamp: input.message.eventTimestamp,
        before: { state: 'missing' },
        after: this.toContextProjection(message),
        schemaVersion: 1,
      });
      this.contextChangesByChat.set(chatId, entries);
    }
    return Promise.resolve(
      ok({
        outcome: 'created',
        chatId,
        messageId,
        matrixEventId: input.message.matrixEventId,
        ...(chatTranscriptionEnabled ? { chatTranscriptionEnabled: true } : {}),
      })
    );
  }

  getMessageById(messageId: string): Promise<Result<PrivateWhatsAppMessage | null, WhatsAppError>> {
    const lookupFailure = this.consumeMessageLookupFailure();
    if (lookupFailure !== null) {
      return Promise.resolve(err(lookupFailure));
    }

    const stored = Array.from(this.stored.values()).find(
      (candidate) => this.toMessage(candidate).id === messageId
    );
    if (stored === undefined) {
      return Promise.resolve(ok(null));
    }
    return Promise.resolve(ok(this.toMessage(stored)));
  }

  getChatById(input: {
    sourceAccountId: string;
    chatId: string;
  }): Promise<Result<PrivateWhatsAppChat | null, WhatsAppError>> {
    const dataFailure = this.consumeDataQueryFailure();
    if (dataFailure !== null) {
      return Promise.resolve(err(dataFailure));
    }

    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }

    const chat = this.buildChats().get(input.chatId);
    if (chat === undefined || chat.sourceAccountId !== input.sourceAccountId) {
      return Promise.resolve(ok(null));
    }
    return Promise.resolve(ok(chat));
  }

  updateChatTranscriptionSetting(
    input: UpdatePrivateWhatsAppChatTranscriptionInput
  ): Promise<Result<PrivateWhatsAppChat, WhatsAppError>> {
    const updateFailure = this.consumeChatTranscriptionUpdateFailure();
    if (updateFailure !== null) {
      return Promise.resolve(err(updateFailure));
    }

    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }

    const existing = this.buildChats().get(input.chatId);
    if (existing === undefined || existing.sourceAccountId !== input.sourceAccountId) {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: 'Private WhatsApp chat not found' })
      );
    }

    const updated: PrivateWhatsAppChat = {
      ...existing,
      transcriptionEnabled: input.enabled,
      transcriptionUpdatedAt: input.now,
      updatedAt: input.now,
    };
    if (input.enabled && existing.transcriptionEnabledAt === undefined) {
      updated.transcriptionEnabledAt = input.now;
    } else if (existing.transcriptionEnabledAt !== undefined) {
      updated.transcriptionEnabledAt = existing.transcriptionEnabledAt;
    }
    this.chatTranscriptionSettings.set(input.chatId, {
      transcriptionEnabled: input.enabled,
      transcriptionUpdatedAt: input.now,
      ...(updated.transcriptionEnabledAt !== undefined
        ? { transcriptionEnabledAt: updated.transcriptionEnabledAt }
        : {}),
    });
    return Promise.resolve(ok(updated));
  }

  updateMessageStoredMedia(
    input: UpdatePrivateWhatsAppMessageStoredMediaInput
  ): Promise<Result<UpdatePrivateWhatsAppMessageStoredMediaResult, WhatsAppError>> {
    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }
    if (input.media.storageStatus !== 'stored' || input.media.gcsPath === undefined) {
      return Promise.resolve(
        err({
          code: 'VALIDATION_ERROR',
          message: 'Stored private WhatsApp media requires a storage status and GCS path',
        })
      );
    }

    const stored = Array.from(this.stored.values()).find(
      (candidate) => this.toMessage(candidate).id === input.messageId
    );
    if (stored === undefined || stored.sourceAccountId !== input.sourceAccountId) {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: 'Private WhatsApp message not found' })
      );
    }

    const existingMedia = stored.message.media;
    if (existingMedia === undefined) {
      return Promise.resolve(
        err({
          code: 'VALIDATION_ERROR',
          message: 'Private WhatsApp message does not contain media metadata',
        })
      );
    }
    if (existingMedia.mxcUri !== input.media.mxcUri) {
      return Promise.resolve(
        err({
          code: 'VALIDATION_ERROR',
          message: 'Stored private WhatsApp media does not match the message media id',
        })
      );
    }

    const chat = this.buildChats().get(
      `chat:${stored.sourceAccountId}:${stored.chat.matrixRoomId}`
    );
    if (chat === undefined) {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: 'Private WhatsApp message not found' })
      );
    }

    if (existingMedia.gcsPath !== undefined) {
      if (existingMedia.gcsPath === input.media.gcsPath) {
        return Promise.resolve(
          ok({
            status: 'already_stored',
            message: this.toMessage(stored),
            chat,
          })
        );
      }
      return Promise.resolve(
        err({
          code: 'VALIDATION_ERROR',
          message: 'Private WhatsApp message already references different stored media',
        })
      );
    }

    stored.message.media = {
      ...existingMedia,
      ...input.media,
      storageStatus: 'stored',
    };
    return Promise.resolve(
      ok({
        status: 'updated',
        message: this.toMessage(stored),
        chat,
      })
    );
  }

  updateMessageTranscription(
    input: UpdatePrivateWhatsAppMessageTranscriptionInput
  ): Promise<Result<UpdatePrivateWhatsAppMessageTranscriptionResult, WhatsAppError>> {
    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }

    const stored = Array.from(this.stored.values()).find(
      (candidate) => this.toMessage(candidate).id === input.messageId
    );
    if (stored === undefined || stored.userId !== input.userId) {
      return Promise.resolve(
        err({ code: 'NOT_FOUND', message: 'Private WhatsApp message not found' })
      );
    }

    const before = this.toContextProjection(this.toMessage(stored));
    const unchanged = JSON.stringify(this.messageTranscriptions.get(input.messageId)) === JSON.stringify(input.transcription);
    this.messageTranscriptions.set(input.messageId, input.transcription);
    const after = this.toContextProjection(this.toMessage(stored));
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      const chatId = `chat:${stored.sourceAccountId}:${stored.chat.matrixRoomId}`;
      const entries = this.contextChangesByChat.get(chatId) ?? [];
      const current = this.contextMetadataByMessageId.get(input.messageId) ?? {
        revision: 1,
        sequence: entries.length,
      };
      const sequence = entries.length + 1;
      const revision = current.revision + 1;
      this.contextMetadataByMessageId.set(input.messageId, { revision, sequence });
      entries.push({
        userId: stored.userId,
        sourceAccountId: stored.sourceAccountId,
        chatId,
        sequence,
        messageId: input.messageId,
        messageRevision: revision,
        changeType: 'transcription_changed',
        changedAt: input.transcription.completedAt ?? stored.receivedAt,
        eventTimestamp: stored.message.eventTimestamp,
        before,
        after,
        schemaVersion: 1,
      });
      this.contextChangesByChat.set(chatId, entries);
    }
    return Promise.resolve(
      ok({
        status: unchanged ? 'unchanged' : 'updated',
        messageId: input.messageId,
      })
    );
  }

  async getConversationContextJournalHead(
    input: PrivateWhatsAppOwnedChatInput
  ): Promise<Result<number, WhatsAppError>> {
    const chat = await this.getChatById(input);
    if (!chat.ok) return chat;
    if (chat.value === null || chat.value.userId !== input.userId) {
      return err({ code: 'NOT_FOUND', message: 'Private WhatsApp chat not found' });
    }
    return ok(this.contextChangesByChat.get(input.chatId)?.length ?? 0);
  }

  findConversationContextJournalEntries(
    input: PrivateWhatsAppContextJournalQueryInput
  ): Promise<Result<PrivateWhatsAppContextJournalQueryResult, WhatsAppError>> {
    const chat = this.buildChats().get(input.chatId);
    if (
      chat === undefined ||
      chat.userId !== input.userId ||
      chat.sourceAccountId !== input.sourceAccountId
    ) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Private WhatsApp chat not found' }));
    }
    const matching = (this.contextChangesByChat.get(input.chatId) ?? []).filter(
      (entry) =>
        entry.sequence > input.afterSequence && entry.sequence <= input.throughSequence
    );
    const entries = matching.slice(0, input.limit);
    const result: PrivateWhatsAppContextJournalQueryResult = { entries };
    if (matching.length > entries.length) {
      const lastEntry = entries.at(-1);
      if (lastEntry !== undefined) result.nextAfterSequence = lastEntry.sequence;
    }
    return Promise.resolve(ok(result));
  }

  findConversationContextMessagesByIds(
    input: PrivateWhatsAppContextMessagesByIdsInput
  ): Promise<Result<PrivateWhatsAppMessage[], WhatsAppError>> {
    const ids = new Set(input.messageIds);
    const messages = [...this.stored.values()]
      .map((stored) => this.toMessage(stored))
      .filter(
        (message) =>
          ids.has(message.id) &&
          message.sourceAccountId === input.sourceAccountId &&
          message.chatId === input.chatId
      )
      .sort((left, right) => {
        const timestampComparison = left.eventTimestamp.localeCompare(right.eventTimestamp);
        return timestampComparison === 0 ? left.id.localeCompare(right.id) : timestampComparison;
      });
    return Promise.resolve(ok(messages));
  }

  findMessages(
    input: PrivateWhatsAppMessageQueryInput
  ): Promise<Result<PrivateWhatsAppMessageQueryResult, WhatsAppError>> {
    const dataFailure = this.consumeDataQueryFailure();
    if (dataFailure !== null) {
      return Promise.resolve(err(dataFailure));
    }

    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }

    const messages = Array.from(this.stored.values())
      .filter((stored) => stored.sourceAccountId === input.sourceAccountId)
      .map((stored) => this.toMessage(stored))
      .filter((message) => input.chatId === undefined || message.chatId === input.chatId)
      .filter((message) => input.senderKey === undefined || message.senderKey === input.senderKey)
      .filter(
        (message) => input.eventDayKey === undefined || message.eventDayKey === input.eventDayKey
      )
      .filter((message) => input.from === undefined || message.eventTimestamp >= input.from)
      .filter((message) => input.to === undefined || message.eventTimestamp < input.to)
      .sort((a, b) => {
        const timestampComparison = b.eventTimestamp.localeCompare(a.eventTimestamp);
        return timestampComparison === 0 ? b.id.localeCompare(a.id) : timestampComparison;
      });
    const cursor = decodeFakePrivateWhatsAppCursor(input.cursor);
    const startIndex =
      cursor === undefined
        ? 0
        : messages.findIndex(
            (message) => message.eventTimestamp === cursor.sortValue && message.id === cursor.id
          ) + 1;
    const safeStartIndex = startIndex < 0 ? 0 : startIndex;
    const page = messages.slice(safeStartIndex, safeStartIndex + input.limit);
    const result: PrivateWhatsAppMessageQueryResult = { messages: page };
    if (messages.length > safeStartIndex + input.limit) {
      const lastMessage = page[page.length - 1];
      if (lastMessage !== undefined) {
        result.nextCursor = encodeFakePrivateWhatsAppCursor(
          lastMessage.eventTimestamp,
          lastMessage.id
        );
      }
    }
    return Promise.resolve(ok(result));
  }

  findReactionsForMessageIds(
    input: Parameters<PrivateWhatsAppRepository['findReactionsForMessageIds']>[0]
  ): ReturnType<PrivateWhatsAppRepository['findReactionsForMessageIds']> {
    const reactionFailure = this.consumeReactionQueryFailure();
    if (reactionFailure !== null) {
      return Promise.resolve(err(reactionFailure));
    }

    const dataFailure = this.consumeDataQueryFailure();
    if (dataFailure !== null) {
      return Promise.resolve(err(dataFailure));
    }

    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }

    const targetsByMatrixEventId = new Map(
      input.targets.map((target) => [target.matrixEventId, target.messageId] as const)
    );
    const targetMessageIds = new Set(input.targets.map((target) => target.messageId));
    const reactionsByMessageId: Record<string, PrivateWhatsAppReactionSummary[]> = {};
    const attachedReactionMessageIds = new Set<string>();

    for (const stored of this.stored.values()) {
      if (stored.sourceAccountId !== input.sourceAccountId) {
        continue;
      }
      const message = this.toMessage(stored);
      if (input.chatId !== undefined && message.chatId !== input.chatId) {
        continue;
      }
      if (message.messageType !== 'reaction') {
        continue;
      }

      const normalizedReaction = message.reaction;
      const legacyReaction =
        normalizedReaction === undefined
          ? extractFakeLegacyReaction(message.rawMatrixEvent)
          : undefined;
      const targetMessageId =
        normalizedReaction?.targetMessageId ??
        (legacyReaction === undefined
          ? undefined
          : targetsByMatrixEventId.get(legacyReaction.targetMatrixEventId));
      const emoji = normalizedReaction?.emoji ?? legacyReaction?.emoji ?? message.text;
      if (targetMessageId === undefined || !targetMessageIds.has(targetMessageId)) {
        continue;
      }
      const normalizedEmoji = firstFakeNonEmpty(emoji);
      if (normalizedEmoji === undefined) {
        continue;
      }

      const summary: PrivateWhatsAppReactionSummary = {
        id: message.id,
        emoji: normalizedEmoji,
        direction: message.direction,
        eventTimestamp: message.eventTimestamp,
        ...(message.senderKey !== undefined ? { senderKey: message.senderKey } : {}),
        ...(message.senderDisplayName !== undefined
          ? { senderDisplayName: message.senderDisplayName }
          : {}),
        ...(message.senderPhoneNumber !== undefined
          ? { senderPhoneNumber: message.senderPhoneNumber }
          : {}),
      };
      reactionsByMessageId[targetMessageId] = [
        ...(reactionsByMessageId[targetMessageId] ?? []),
        summary,
      ].sort(compareFakeReactionSummaries);
      attachedReactionMessageIds.add(message.id);
    }

    return Promise.resolve(
      ok({
        reactionsByMessageId,
        attachedReactionMessageIds: [...attachedReactionMessageIds].sort((left, right) =>
          left.localeCompare(right)
        ),
      })
    );
  }

  findConversationContextMessages(
    input: PrivateConversationContextMessageQueryInput
  ): Promise<Result<PrivateWhatsAppConversationContextMessageResult, WhatsAppError>> {
    const contextFailure = this.consumeConversationContextQueryFailure();
    if (contextFailure !== null) {
      return Promise.resolve(err(contextFailure));
    }

    const dataFailure = this.consumeDataQueryFailure();
    if (dataFailure !== null) {
      return Promise.resolve(err(dataFailure));
    }

    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }

    const messages = Array.from(this.stored.values())
      .filter((stored) => stored.sourceAccountId === input.sourceAccountId)
      .map((stored) => this.toMessage(stored))
      .filter((message) => message.chatId === input.chatId)
      .filter((message) => message.eventTimestamp >= input.from)
      .filter((message) => message.eventTimestamp < input.to)
      .sort((a, b) => {
        const timestampComparison = a.eventTimestamp.localeCompare(b.eventTimestamp);
        return timestampComparison === 0 ? a.id.localeCompare(b.id) : timestampComparison;
      });
    const cursor = decodeFakePrivateWhatsAppCursor(input.cursor);
    const startIndex =
      cursor === undefined
        ? 0
        : messages.findIndex(
            (message) => message.eventTimestamp === cursor.sortValue && message.id === cursor.id
          ) + 1;
    const safeStartIndex = startIndex < 0 ? 0 : startIndex;
    const page = messages.slice(safeStartIndex, safeStartIndex + input.limit);
    const result: PrivateWhatsAppConversationContextMessageResult = {
      messages: page,
      totalCount: messages.length,
    };
    if (messages.length > safeStartIndex + input.limit) {
      const lastMessage = page[page.length - 1];
      if (lastMessage !== undefined) {
        result.nextCursor = encodeFakePrivateWhatsAppCursor(
          lastMessage.eventTimestamp,
          lastMessage.id
        );
      }
    }
    return Promise.resolve(ok(result));
  }

  findChats(
    input: PrivateWhatsAppChatQueryInput
  ): Promise<Result<PrivateWhatsAppChatQueryResult, WhatsAppError>> {
    const dataFailure = this.consumeDataQueryFailure();
    if (dataFailure !== null) {
      return Promise.resolve(err(dataFailure));
    }

    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }

    const chats = Array.from(this.buildChats().values())
      .filter((chat) => chat.sourceAccountId === input.sourceAccountId)
      .sort((a, b) => {
        const timestampComparison = b.lastEventAt.localeCompare(a.lastEventAt);
        return timestampComparison === 0 ? b.id.localeCompare(a.id) : timestampComparison;
      });
    const cursor = decodeFakePrivateWhatsAppCursor(input.cursor);
    const startIndex =
      cursor === undefined
        ? 0
        : chats.findIndex(
            (chat) => chat.lastEventAt === cursor.sortValue && chat.id === cursor.id
          ) + 1;
    const safeStartIndex = startIndex < 0 ? 0 : startIndex;
    const page = chats.slice(safeStartIndex, safeStartIndex + input.limit);
    const result: PrivateWhatsAppChatQueryResult = { chats: page };
    if (chats.length > safeStartIndex + input.limit) {
      const lastChat = page[page.length - 1];
      if (lastChat !== undefined) {
        result.nextCursor = encodeFakePrivateWhatsAppCursor(lastChat.lastEventAt, lastChat.id);
      }
    }
    return Promise.resolve(ok(result));
  }

  findSenders(
    input: PrivateWhatsAppSenderQueryInput
  ): Promise<Result<PrivateWhatsAppSenderQueryResult, WhatsAppError>> {
    const dataFailure = this.consumeDataQueryFailure();
    if (dataFailure !== null) {
      return Promise.resolve(err(dataFailure));
    }

    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }

    const senders = Array.from(this.buildSenders().values())
      .filter((sender) => sender.sourceAccountId === input.sourceAccountId)
      .sort((a, b) => {
        const timestampComparison = b.lastEventAt.localeCompare(a.lastEventAt);
        return timestampComparison === 0 ? b.id.localeCompare(a.id) : timestampComparison;
      });
    const cursor = decodeFakePrivateWhatsAppCursor(input.cursor);
    const startIndex =
      cursor === undefined
        ? 0
        : senders.findIndex(
            (sender) => sender.lastEventAt === cursor.sortValue && sender.id === cursor.id
          ) + 1;
    const safeStartIndex = startIndex < 0 ? 0 : startIndex;
    const page = senders.slice(safeStartIndex, safeStartIndex + input.limit);
    const result: PrivateWhatsAppSenderQueryResult = { senders: page };
    if (senders.length > safeStartIndex + input.limit) {
      const lastSender = page[page.length - 1];
      if (lastSender !== undefined) {
        result.nextCursor = encodeFakePrivateWhatsAppCursor(lastSender.lastEventAt, lastSender.id);
      }
    }
    return Promise.resolve(ok(result));
  }

  findSenderDays(
    input: PrivateWhatsAppSenderDayQueryInput
  ): Promise<Result<PrivateWhatsAppSenderDayQueryResult, WhatsAppError>> {
    const dataFailure = this.consumeDataQueryFailure();
    if (dataFailure !== null) {
      return Promise.resolve(err(dataFailure));
    }

    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }

    const senderDays = Array.from(this.buildSenderDays().values())
      .filter((senderDay) => senderDay.sourceAccountId === input.sourceAccountId)
      .filter(
        (senderDay) => input.senderKey === undefined || senderDay.senderKey === input.senderKey
      )
      .filter((senderDay) => input.fromDay === undefined || senderDay.eventDayKey >= input.fromDay)
      .filter((senderDay) => input.toDay === undefined || senderDay.eventDayKey <= input.toDay)
      .sort((a, b) => {
        const dayComparison = b.eventDayKey.localeCompare(a.eventDayKey);
        return dayComparison === 0 ? a.senderKey.localeCompare(b.senderKey) : dayComparison;
      });
    const cursor = decodeFakePrivateWhatsAppCursor(input.cursor);
    const startIndex =
      cursor === undefined
        ? 0
        : senderDays.findIndex(
            (senderDay) =>
              senderDay.eventDayKey === cursor.sortValue &&
              (input.senderKey !== undefined || senderDay.senderKey === cursor.id)
          ) + 1;
    const safeStartIndex = startIndex < 0 ? 0 : startIndex;
    const page = senderDays.slice(safeStartIndex, safeStartIndex + input.limit);
    const result: PrivateWhatsAppSenderDayQueryResult = { senderDays: page };
    if (senderDays.length > safeStartIndex + input.limit) {
      const lastSenderDay = page[page.length - 1];
      if (lastSenderDay !== undefined) {
        result.nextCursor = encodeFakePrivateWhatsAppCursor(
          lastSenderDay.eventDayKey,
          lastSenderDay.senderKey
        );
      }
    }
    return Promise.resolve(ok(result));
  }

  rebuildAggregates(
    input: PrivateWhatsAppAggregateRebuildInput
  ): Promise<Result<PrivateWhatsAppAggregateRebuildResult, WhatsAppError>> {
    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }

    const scannedMessages = Array.from(this.stored.values()).filter(
      (stored) =>
        stored.sourceAccountId === input.sourceAccountId &&
        (input.from === undefined || stored.message.eventTimestamp >= input.from) &&
        (input.to === undefined || stored.message.eventTimestamp < input.to)
    ).length;
    return Promise.resolve(
      ok({
        scannedMessages,
        upgradedMessages: 0,
        senderCount: this.buildSenderDays().size,
        senderDayCount: this.buildSenderDays().size,
      })
    );
  }

  getAll(): StorePrivateWhatsAppMessageInput[] {
    return Array.from(this.stored.values());
  }

  clear(): void {
    this.stored.clear();
    this.contextChangesByChat.clear();
    this.contextMetadataByMessageId.clear();
    this.accounts.clear();
    this.chatTranscriptionSettings.clear();
    this.messageTranscriptions.clear();
    this.failNextError = null;
    this.failNextStoreError = null;
    this.failNextDataQueryError = null;
    this.failNextMessageLookupError = null;
    this.failNextReactionQueryError = null;
    this.failNextChatTranscriptionUpdateError = null;
    this.failNextConversationContextQueryError = null;
  }

  private consumeFailure(): WhatsAppError | null {
    if (this.failNextError === null) {
      return null;
    }
    const error = this.failNextError;
    this.failNextError = null;
    return error;
  }

  private consumeStoreFailure(): WhatsAppError | null {
    if (this.failNextStoreError === null) {
      return null;
    }
    const error = this.failNextStoreError;
    this.failNextStoreError = null;
    return error;
  }

  private consumeDataQueryFailure(): WhatsAppError | null {
    if (this.failNextDataQueryError === null) {
      return null;
    }
    const error = this.failNextDataQueryError;
    this.failNextDataQueryError = null;
    return error;
  }

  private consumeMessageLookupFailure(): WhatsAppError | null {
    if (this.failNextMessageLookupError === null) {
      return null;
    }
    const error = this.failNextMessageLookupError;
    this.failNextMessageLookupError = null;
    return error;
  }

  private consumeReactionQueryFailure(): WhatsAppError | null {
    if (this.failNextReactionQueryError === null) {
      return null;
    }
    const error = this.failNextReactionQueryError;
    this.failNextReactionQueryError = null;
    return error;
  }

  private consumeChatTranscriptionUpdateFailure(): WhatsAppError | null {
    if (this.failNextChatTranscriptionUpdateError === null) {
      return null;
    }
    const error = this.failNextChatTranscriptionUpdateError;
    this.failNextChatTranscriptionUpdateError = null;
    return error;
  }

  private consumeConversationContextQueryFailure(): WhatsAppError | null {
    if (this.failNextConversationContextQueryError === null) {
      return null;
    }
    const error = this.failNextConversationContextQueryError;
    this.failNextConversationContextQueryError = null;
    return error;
  }

  private toMessage(input: StorePrivateWhatsAppMessageInput): PrivateWhatsAppMessage {
    const message: PrivateWhatsAppMessage = {
      id: `message:${input.sourceAccountId}:${input.message.matrixEventId}`,
      chatId: `chat:${input.sourceAccountId}:${input.chat.matrixRoomId}`,
      userId: input.userId,
      sourceAccountId: input.sourceAccountId,
      matrixRoomId: input.message.matrixRoomId,
      matrixEventId: input.message.matrixEventId,
      matrixSenderId: input.message.matrixSenderId,
      direction: input.message.direction,
      messageType: input.message.type,
      eventTimestamp: input.message.eventTimestamp,
      chatType: input.chat.type,
      receivedAt: input.receivedAt,
      ingestedAt: input.receivedAt,
      deliveryMode: input.deliveryMode,
      rawMatrixEvent: input.message.rawMatrixEvent,
      schemaVersion: 2,
    };
    if (input.message.senderKey !== undefined) {
      message.senderKey = input.message.senderKey;
    }
    if (input.message.eventDayKey !== undefined) {
      message.eventDayKey = input.message.eventDayKey;
    }
    if (input.message.eventTimeZone !== undefined) {
      message.eventTimeZone = input.message.eventTimeZone;
    }
    if (input.message.senderDisplayName !== undefined) {
      message.senderDisplayName = input.message.senderDisplayName;
    }
    if (input.message.senderPhoneNumber !== undefined) {
      message.senderPhoneNumber = input.message.senderPhoneNumber;
    }
    if (input.message.senderPhoneNumberNormalized !== undefined) {
      message.senderPhoneNumberNormalized = input.message.senderPhoneNumberNormalized;
    }
    if (input.chat.displayName !== undefined) {
      message.chatDisplayName = input.chat.displayName;
    }
    if (input.message.text !== undefined) {
      message.text = input.message.text;
    }
    if (input.message.media !== undefined) {
      message.media = input.message.media;
    }
    if (input.message.reaction !== undefined) {
      message.reaction = {
        emoji: input.message.reaction.emoji,
        targetMatrixEventId: input.message.reaction.targetMatrixEventId,
        targetMessageId: `message:${input.sourceAccountId}:${input.message.reaction.targetMatrixEventId}`,
      };
    }
    if (input.message.relation !== undefined) {
      message.relation = { ...input.message.relation };
    }
    const transcription = this.messageTranscriptions.get(message.id);
    if (transcription !== undefined) {
      message.transcription = transcription;
    }
    const contextMetadata = this.contextMetadataByMessageId.get(message.id);
    if (contextMetadata !== undefined) {
      message.contextRevision = contextMetadata.revision;
      message.contextChangeSequence = contextMetadata.sequence;
      message.contextState = 'visible';
    }
    return message;
  }

  private toContextProjection(message: PrivateWhatsAppMessage): PrivateWhatsAppContextProjection {
    const base = {
      eventTimestamp: message.eventTimestamp,
      importedAt: message.receivedAt,
      direction: message.direction,
      speakerLabel:
        message.direction === 'outgoing'
          ? 'You'
          : message.senderDisplayName?.trim() || 'Participant',
      messageType: message.messageType,
    };
    const text = message.text?.trim();
    if (text !== undefined && text.length > 0) {
      return {
        state: 'included',
        ...base,
        contentKind: 'text',
        content: text,
        reactions: [],
      };
    }
    const transcription = message.transcription?.text?.trim();
    if (
      message.transcription?.status === 'completed' &&
      transcription !== undefined &&
      transcription.length > 0
    ) {
      return {
        state: 'included',
        ...base,
        contentKind: 'transcription',
        content: transcription,
        reactions: [],
      };
    }
    return {
      state: 'omitted',
      ...base,
      omissionReason:
        message.transcription?.status === 'pending' ||
        message.transcription?.status === 'processing'
          ? 'pending_transcription'
          : message.messageType === 'image' ||
              message.messageType === 'audio' ||
              message.messageType === 'video' ||
              message.messageType === 'file' ||
              message.messageType === 'sticker'
            ? 'media_only'
            : 'non_text',
      reactions: [],
    };
  }

  private buildSenderDays(): Map<string, PrivateWhatsAppSenderDay> {
    const senderDays = new Map<string, PrivateWhatsAppSenderDay>();
    for (const stored of this.stored.values()) {
      const message = this.toMessage(stored);
      if (message.senderKey === undefined || message.eventDayKey === undefined) {
        continue;
      }
      const key = `${message.sourceAccountId}\0${message.senderKey}\0${message.eventDayKey}`;
      const existing = senderDays.get(key);
      if (existing === undefined) {
        const senderDay: PrivateWhatsAppSenderDay = {
          id: `sender-day:${message.sourceAccountId}:${message.senderKey}:${message.eventDayKey}`,
          userId: message.userId,
          sourceAccountId: message.sourceAccountId,
          senderKey: message.senderKey,
          eventDayKey: message.eventDayKey,
          eventTimeZone: message.eventTimeZone ?? 'Europe/Warsaw',
          firstEventAt: message.eventTimestamp,
          lastEventAt: message.eventTimestamp,
          messageCount: 1,
          chatIds: [message.chatId],
          messageTypeCounts: { [message.messageType]: 1 },
          summaryStatus: 'not_started',
          summarySourceMessageCount: 0,
          updatedAt: message.receivedAt,
          schemaVersion: 2,
        };
        if (message.senderDisplayName !== undefined) {
          senderDay.senderDisplayName = message.senderDisplayName;
        }
        if (message.senderPhoneNumber !== undefined) {
          senderDay.senderPhoneNumber = message.senderPhoneNumber;
        }
        senderDays.set(key, senderDay);
        continue;
      }

      existing.messageCount += 1;
      existing.firstEventAt =
        message.eventTimestamp < existing.firstEventAt
          ? message.eventTimestamp
          : existing.firstEventAt;
      existing.lastEventAt =
        message.eventTimestamp > existing.lastEventAt
          ? message.eventTimestamp
          : existing.lastEventAt;
      if (!existing.chatIds.includes(message.chatId)) {
        existing.chatIds.push(message.chatId);
      }
      existing.messageTypeCounts[message.messageType] =
        (existing.messageTypeCounts[message.messageType] ?? 0) + 1;
      existing.updatedAt = message.receivedAt;
    }
    return senderDays;
  }

  private buildSenders(): Map<string, PrivateWhatsAppSender> {
    const senders = new Map<string, PrivateWhatsAppSender>();
    for (const stored of this.stored.values()) {
      const message = this.toMessage(stored);
      if (message.senderKey === undefined) {
        continue;
      }
      const key = `${message.sourceAccountId}\0${message.senderKey}`;
      const existing = senders.get(key);
      if (existing === undefined) {
        const sender: PrivateWhatsAppSender = {
          id: `sender:${message.sourceAccountId}:${message.senderKey}`,
          userId: message.userId,
          sourceAccountId: message.sourceAccountId,
          senderKey: message.senderKey,
          firstEventAt: message.eventTimestamp,
          lastEventAt: message.eventTimestamp,
          messageCount: 1,
          chatIds: [message.chatId],
          updatedAt: message.receivedAt,
          schemaVersion: 2,
        };
        if (message.senderDisplayName !== undefined) {
          sender.senderDisplayName = message.senderDisplayName;
        }
        if (message.senderPhoneNumber !== undefined) {
          sender.senderPhoneNumber = message.senderPhoneNumber;
        }
        if (message.senderPhoneNumberNormalized !== undefined) {
          sender.senderPhoneNumberNormalized = message.senderPhoneNumberNormalized;
        }
        senders.set(key, sender);
        continue;
      }

      existing.messageCount += 1;
      existing.firstEventAt =
        message.eventTimestamp < existing.firstEventAt
          ? message.eventTimestamp
          : existing.firstEventAt;
      existing.lastEventAt =
        message.eventTimestamp > existing.lastEventAt
          ? message.eventTimestamp
          : existing.lastEventAt;
      if (!existing.chatIds.includes(message.chatId)) {
        existing.chatIds.push(message.chatId);
      }
      existing.updatedAt = message.receivedAt;
      if (
        message.senderDisplayName !== undefined &&
        message.eventTimestamp >= existing.lastEventAt
      ) {
        existing.senderDisplayName = message.senderDisplayName;
      }
      if (message.senderPhoneNumber !== undefined) {
        existing.senderPhoneNumber = message.senderPhoneNumber;
      }
      if (message.senderPhoneNumberNormalized !== undefined) {
        existing.senderPhoneNumberNormalized = message.senderPhoneNumberNormalized;
      }
    }
    return senders;
  }

  private buildChats(): Map<string, PrivateWhatsAppChat> {
    const chats = new Map<string, PrivateWhatsAppChat>();
    for (const stored of this.stored.values()) {
      const message = this.toMessage(stored);
      const existing = chats.get(message.chatId);
      const participantKeys = existing?.participantKeys ?? [];
      const nextParticipantKeys =
        message.senderKey === undefined || participantKeys.includes(message.senderKey)
          ? participantKeys
          : [...participantKeys, message.senderKey];

      if (existing === undefined) {
        const chat: PrivateWhatsAppChat = {
          id: message.chatId,
          userId: message.userId,
          sourceAccountId: message.sourceAccountId,
          matrixRoomId: message.matrixRoomId,
          chatType: message.chatType ?? 'unknown',
          firstSeenAt: message.eventTimestamp,
          lastEventAt: message.eventTimestamp,
          messageCount: 1,
          participantCount: nextParticipantKeys.length,
          participantKeys: nextParticipantKeys,
          updatedAt: message.receivedAt,
          schemaVersion: 2,
        };
        if (message.chatDisplayName !== undefined) {
          chat.displayName = message.chatDisplayName;
        }
        const contextHead = this.contextChangesByChat.get(message.chatId)?.length;
        if (contextHead !== undefined && contextHead > 0) {
          chat.contextChangeSequence = contextHead;
          const latestContextChange = this.contextChangesByChat.get(message.chatId)?.at(-1);
          if (latestContextChange !== undefined) {
            chat.contextChangedAt = latestContextChange.changedAt;
          }
        }
        chats.set(message.chatId, chat);
        continue;
      }

      existing.messageCount = (existing.messageCount ?? 0) + 1;
      existing.participantKeys = nextParticipantKeys;
      existing.participantCount = nextParticipantKeys.length;
      existing.firstSeenAt =
        message.eventTimestamp < existing.firstSeenAt
          ? message.eventTimestamp
          : existing.firstSeenAt;
      existing.lastEventAt =
        message.eventTimestamp > existing.lastEventAt
          ? message.eventTimestamp
          : existing.lastEventAt;
      existing.updatedAt = message.receivedAt;
      if (message.chatDisplayName !== undefined && message.eventTimestamp >= existing.lastEventAt) {
        existing.displayName = message.chatDisplayName;
      }
      if (message.chatType !== undefined && message.chatType !== 'unknown') {
        existing.chatType = message.chatType;
      }
    }
    for (const chat of chats.values()) {
      const contextEntries = this.contextChangesByChat.get(chat.id) ?? [];
      const contextHead = contextEntries.at(-1);
      if (contextHead !== undefined) {
        chat.contextChangeSequence = contextHead.sequence;
        chat.contextChangedAt = contextHead.changedAt;
      }
      const setting = this.chatTranscriptionSettings.get(chat.id);
      if (setting !== undefined) {
        chat.transcriptionEnabled = setting.transcriptionEnabled;
        chat.transcriptionUpdatedAt = setting.transcriptionUpdatedAt;
        if (setting.transcriptionEnabledAt !== undefined) {
          chat.transcriptionEnabledAt = setting.transcriptionEnabledAt;
        }
      }
    }
    return chats;
  }
}

interface FakePrivateWhatsAppCursor {
  sortValue: string;
  id: string;
}

function encodeFakePrivateWhatsAppCursor(sortValue: string, id: string): string {
  return Buffer.from(JSON.stringify({ sortValue, id })).toString('base64url');
}

function compareFakeReactionSummaries(
  left: PrivateWhatsAppReactionSummary,
  right: PrivateWhatsAppReactionSummary
): number {
  const timestampComparison = left.eventTimestamp.localeCompare(right.eventTimestamp);
  return timestampComparison === 0 ? left.id.localeCompare(right.id) : timestampComparison;
}

function firstFakeNonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function extractFakeLegacyReaction(
  rawMatrixEvent: unknown
): { emoji: string; targetMatrixEventId: string } | undefined {
  if (!isFakeRecord(rawMatrixEvent)) {
    return undefined;
  }
  const content = rawMatrixEvent['content'];
  if (!isFakeRecord(content)) {
    return undefined;
  }
  const relatesTo = content['m.relates_to'];
  if (!isFakeRecord(relatesTo) || relatesTo['rel_type'] !== 'm.annotation') {
    return undefined;
  }

  const targetMatrixEventId = firstFakeNonEmpty(asFakeOptionalString(relatesTo['event_id']));
  const emoji = firstFakeNonEmpty(asFakeOptionalString(relatesTo['key']));
  if (targetMatrixEventId === undefined || emoji === undefined) {
    return undefined;
  }
  return { emoji, targetMatrixEventId };
}

function isFakeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asFakeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function decodeFakePrivateWhatsAppCursor(
  cursor: string | undefined
): FakePrivateWhatsAppCursor | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      sortValue?: unknown;
      id?: unknown;
    };
    if (typeof parsed.sortValue !== 'string' || typeof parsed.id !== 'string') {
      return undefined;
    }
    return { sortValue: parsed.sortValue, id: parsed.id };
  } catch {
    return undefined;
  }
}

/**
 * Fake media storage for testing.
 */
export class FakeMediaStorage implements MediaStoragePort {
  private files = new Map<string, { buffer: Buffer; contentType: string }>();
  private signedUrls = new Map<string, string>();
  private deletedPaths: string[] = [];
  private shouldFailUpload = false;
  private shouldFailThumbnailUpload = false;
  private shouldFailGetSignedUrl = false;
  private shouldFailDelete = false;
  private shouldThrowOnDelete = false;

  setFailUpload(fail: boolean): void {
    this.shouldFailUpload = fail;
  }

  setFailThumbnailUpload(fail: boolean): void {
    this.shouldFailThumbnailUpload = fail;
  }

  setFailGetSignedUrl(fail: boolean): void {
    this.shouldFailGetSignedUrl = fail;
  }

  setFailDelete(fail: boolean): void {
    this.shouldFailDelete = fail;
  }

  setThrowOnDelete(shouldThrow: boolean): void {
    this.shouldThrowOnDelete = shouldThrow;
  }

  getDeletedPaths(): string[] {
    return [...this.deletedPaths];
  }

  upload(
    userId: string,
    messageId: string,
    mediaId: string,
    extension: string,
    buffer: Buffer,
    contentType: string
  ): Promise<Result<UploadResult, WhatsAppError>> {
    if (this.shouldFailUpload) {
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated upload failure' }));
    }
    const gcsPath = `whatsapp/${userId}/${messageId}/${mediaId}.${extension}`;
    this.files.set(gcsPath, { buffer, contentType });
    return Promise.resolve(ok({ gcsPath }));
  }

  uploadThumbnail(
    userId: string,
    messageId: string,
    mediaId: string,
    extension: string,
    buffer: Buffer,
    contentType: string
  ): Promise<Result<UploadResult, WhatsAppError>> {
    if (this.shouldFailThumbnailUpload) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated thumbnail upload failure' })
      );
    }
    const gcsPath = `whatsapp/${userId}/${messageId}/${mediaId}_thumb.${extension}`;
    this.files.set(gcsPath, { buffer, contentType });
    return Promise.resolve(ok({ gcsPath }));
  }

  uploadPrivateMedia(
    userId: string,
    messageId: string,
    mediaId: string,
    extension: string,
    buffer: Buffer,
    contentType: string
  ): Promise<Result<UploadResult, WhatsAppError>> {
    if (this.shouldFailUpload) {
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated upload failure' }));
    }
    const gcsPath = `whatsapp/private/${userId}/${messageId}/${mediaId}.${extension}`;
    this.files.set(gcsPath, { buffer, contentType });
    return Promise.resolve(ok({ gcsPath }));
  }

  uploadPrivateThumbnail(
    userId: string,
    messageId: string,
    mediaId: string,
    extension: string,
    buffer: Buffer,
    contentType: string
  ): Promise<Result<UploadResult, WhatsAppError>> {
    if (this.shouldFailThumbnailUpload) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated thumbnail upload failure' })
      );
    }
    const gcsPath = `whatsapp/private/${userId}/${messageId}/${mediaId}_thumb.${extension}`;
    this.files.set(gcsPath, { buffer, contentType });
    return Promise.resolve(ok({ gcsPath }));
  }

  delete(gcsPath: string): Promise<Result<void, WhatsAppError>> {
    if (this.shouldThrowOnDelete) {
      throw new Error('Simulated unexpected delete exception');
    }
    if (this.shouldFailDelete) {
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated delete failure' }));
    }
    this.deletedPaths.push(gcsPath);
    this.files.delete(gcsPath);
    return Promise.resolve(ok(undefined));
  }

  deletePrivateMediaBatch(
    input: PrivateMediaDeletionBatchInput
  ): Promise<Result<PrivateMediaDeletionBatchResult, WhatsAppError>> {
    const prefix = `whatsapp/private/${input.userId}/`;
    const paths = Array.from(this.files.keys())
      .filter(
        (path) =>
          path.startsWith(prefix) && (input.cursor === undefined || path >= input.cursor)
      )
      .sort()
      .slice(0, input.limit);
    const nextCursor = paths.at(-1);
    if (nextCursor === undefined) {
      return Promise.resolve(ok({ status: 'empty', deletedCount: 0 }));
    }
    if (this.shouldFailDelete) {
      return Promise.resolve(ok({ status: 'retry', deletedCount: 0 }));
    }
    for (const path of paths) {
      this.deletedPaths.push(path);
      this.files.delete(path);
    }
    return Promise.resolve(
      ok({
        status: 'advanced',
        deletedCount: paths.length,
        nextCursor,
      })
    );
  }

  getSignedUrl(gcsPath: string, _ttlSeconds?: number): Promise<Result<string, WhatsAppError>> {
    if (this.shouldFailGetSignedUrl) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated getSignedUrl failure' })
      );
    }
    const url = `https://storage.example.com/signed/${gcsPath}`;
    this.signedUrls.set(gcsPath, url);
    return Promise.resolve(ok(url));
  }

  getFile(gcsPath: string): { buffer: Buffer; contentType: string } | undefined {
    return this.files.get(gcsPath);
  }

  getAllFiles(): Map<string, { buffer: Buffer; contentType: string }> {
    return new Map(this.files);
  }

  clear(): void {
    this.files.clear();
    this.signedUrls.clear();
    this.deletedPaths = [];
    this.shouldFailDelete = false;
    this.shouldThrowOnDelete = false;
  }
}

/**
 * Fake event publisher for testing.
 */
export class FakeEventPublisher implements EventPublisherPort {
  private mediaCleanupEvents: MediaCleanupEvent[] = [];
  private audioStoredEvents: AudioStoredEvent[] = [];
  private mediaTranscriptionRequestedEvents: MediaTranscriptionRequestedEvent[] = [];
  private intexMessageIngestEvents: IntexMessageIngestEvent[] = [];
  private webhookProcessEvents: WebhookProcessEvent[] = [];
  private extractLinkPreviewsEvents: ExtractLinkPreviewsEvent[] = [];
  private conversationAssistantPreparationEvents: ConversationAssistantPreparationRequestedEvent[] = [];
  private conversationAssistantContextAttachmentPreparationEvents: ConversationAssistantContextAttachmentPreparationRequestedEvent[] = [];
  private privateWhatsAppErasureEvents: PrivateWhatsAppErasureWorkItem[] = [];
  private extractLinkPreviewsFailureMessage: string | null = null;
  private audioStoredFailureMessage: string | null = null;
  private mediaTranscriptionRequestedFailureMessage: string | null = null;
  private intexMessageIngestFailureMessage: string | null = null;
  private webhookProcessFailureMessage: string | null = null;
  private conversationAssistantPreparationFailureMessage: string | null = null;
  private privateWhatsAppErasureFailureMessage: string | null = null;

  publishMediaCleanup(event: MediaCleanupEvent): Promise<Result<void, WhatsAppError>> {
    this.mediaCleanupEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  publishAudioStored(event: AudioStoredEvent): Promise<Result<void, WhatsAppError>> {
    if (this.audioStoredFailureMessage !== null) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR' as const, message: this.audioStoredFailureMessage })
      );
    }
    this.audioStoredEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  publishMediaTranscriptionRequested(
    event: MediaTranscriptionRequestedEvent
  ): Promise<Result<void, WhatsAppError>> {
    if (this.mediaTranscriptionRequestedFailureMessage !== null) {
      return Promise.resolve(
        err({
          code: 'INTERNAL_ERROR' as const,
          message: this.mediaTranscriptionRequestedFailureMessage,
        })
      );
    }
    this.mediaTranscriptionRequestedEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  setAudioStoredFailure(message: string): void {
    this.audioStoredFailureMessage = message;
  }

  setMediaTranscriptionRequestedFailure(message: string): void {
    this.mediaTranscriptionRequestedFailureMessage = message;
  }

  publishIntexMessageIngest(event: IntexMessageIngestEvent): Promise<Result<void, WhatsAppError>> {
    if (this.intexMessageIngestFailureMessage !== null) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR' as const, message: this.intexMessageIngestFailureMessage })
      );
    }
    this.intexMessageIngestEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  publishMatrixCorpusIngest(
    _event: MatrixCorpusSignedIngestEvent
  ): Promise<Result<{ publisherReceiptDigest: string }, WhatsAppError>> {
    return Promise.resolve(ok({ publisherReceiptDigest: '1'.repeat(64) }));
  }

  setIntexMessageIngestFailure(message: string): void {
    this.intexMessageIngestFailureMessage = message;
  }

  publishWebhookProcess(event: WebhookProcessEvent): Promise<Result<void, WhatsAppError>> {
    if (this.webhookProcessFailureMessage !== null) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR' as const, message: this.webhookProcessFailureMessage })
      );
    }
    this.webhookProcessEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  setWebhookProcessFailure(message: string): void {
    this.webhookProcessFailureMessage = message;
  }

  publishExtractLinkPreviews(
    event: ExtractLinkPreviewsEvent
  ): Promise<Result<void, WhatsAppError>> {
    if (this.extractLinkPreviewsFailureMessage !== null) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR' as const, message: this.extractLinkPreviewsFailureMessage })
      );
    }
    this.extractLinkPreviewsEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  publishConversationAssistantPreparation(
    event: ConversationAssistantPreparationRequestedEvent
  ): Promise<Result<void, WhatsAppError>> {
    if (this.conversationAssistantPreparationFailureMessage !== null) {
      return Promise.resolve(
        err({
          code: 'INTERNAL_ERROR' as const,
          message: this.conversationAssistantPreparationFailureMessage,
        })
      );
    }
    this.conversationAssistantPreparationEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  publishConversationAssistantContextAttachmentPreparation(
    event: ConversationAssistantContextAttachmentPreparationRequestedEvent
  ): Promise<Result<void, WhatsAppError>> {
    this.conversationAssistantContextAttachmentPreparationEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  publishPrivateWhatsAppErasure(
    event: PrivateWhatsAppErasureWorkItem
  ): Promise<Result<void, WhatsAppError>> {
    if (this.privateWhatsAppErasureFailureMessage !== null) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: this.privateWhatsAppErasureFailureMessage })
      );
    }
    this.privateWhatsAppErasureEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  setPrivateWhatsAppErasureFailure(message: string | null): void {
    this.privateWhatsAppErasureFailureMessage = message;
  }

  setConversationAssistantPreparationFailure(message: string | null): void {
    this.conversationAssistantPreparationFailureMessage = message;
  }

  setExtractLinkPreviewsFailure(message: string): void {
    this.extractLinkPreviewsFailureMessage = message;
  }

  getMediaCleanupEvents(): MediaCleanupEvent[] {
    return [...this.mediaCleanupEvents];
  }

  getAudioStoredEvents(): AudioStoredEvent[] {
    return [...this.audioStoredEvents];
  }

  getMediaTranscriptionRequestedEvents(): MediaTranscriptionRequestedEvent[] {
    return [...this.mediaTranscriptionRequestedEvents];
  }

  getIntexMessageIngestEvents(): IntexMessageIngestEvent[] {
    return [...this.intexMessageIngestEvents];
  }

  getWebhookProcessEvents(): WebhookProcessEvent[] {
    return [...this.webhookProcessEvents];
  }

  getExtractLinkPreviewsEvents(): ExtractLinkPreviewsEvent[] {
    return [...this.extractLinkPreviewsEvents];
  }

  getConversationAssistantPreparationEvents(): ConversationAssistantPreparationRequestedEvent[] {
    return [...this.conversationAssistantPreparationEvents];
  }

  getConversationAssistantContextAttachmentPreparationEvents(): ConversationAssistantContextAttachmentPreparationRequestedEvent[] {
    return [...this.conversationAssistantContextAttachmentPreparationEvents];
  }

  getPrivateWhatsAppErasureEvents(): PrivateWhatsAppErasureWorkItem[] {
    return [...this.privateWhatsAppErasureEvents];
  }

  clear(): void {
    this.mediaCleanupEvents = [];
    this.audioStoredEvents = [];
    this.mediaTranscriptionRequestedEvents = [];
    this.intexMessageIngestEvents = [];
    this.webhookProcessEvents = [];
    this.extractLinkPreviewsEvents = [];
    this.conversationAssistantPreparationEvents = [];
    this.conversationAssistantContextAttachmentPreparationEvents = [];
    this.privateWhatsAppErasureEvents = [];
    this.extractLinkPreviewsFailureMessage = null;
    this.audioStoredFailureMessage = null;
    this.mediaTranscriptionRequestedFailureMessage = null;
    this.intexMessageIngestFailureMessage = null;
    this.webhookProcessFailureMessage = null;
    this.conversationAssistantPreparationFailureMessage = null;
    this.privateWhatsAppErasureFailureMessage = null;
  }
}

/**
 * Fake message sender for testing.
 */
export class FakeMessageSender implements WhatsAppMessageSender {
  private sentMessages: {
    phoneNumber: string;
    message: string;
    buttons?: WhatsAppInteractiveButton[];
    ctaUrl?: { displayText: string; url: string };
  }[] = [];
  private shouldFail = false;
  private shouldThrow = false;
  private failError: WhatsAppError = { code: 'INTERNAL_ERROR', message: 'Simulated send failure' };

  setFail(fail: boolean, error?: WhatsAppError): void {
    this.shouldFail = fail;
    if (error !== undefined) {
      this.failError = error;
    }
  }

  setThrow(shouldThrow: boolean): void {
    this.shouldThrow = shouldThrow;
  }

  async sendTextMessage(
    phoneNumber: string,
    message: string
  ): Promise<Result<TextMessageSendResult, WhatsAppError>> {
    if (this.shouldThrow) {
      throw new Error('Unexpected send error');
    }
    if (this.shouldFail) {
      return Promise.resolve(err(this.failError));
    }
    this.sentMessages.push({ phoneNumber, message });
    const wamid = `fake-wamid-${String(Date.now())}-${randomUUID().slice(0, 8)}`;
    return Promise.resolve(ok({ wamid }));
  }

  async sendInteractiveMessage(
    phoneNumber: string,
    message: string,
    buttons: WhatsAppInteractiveButton[]
  ): Promise<Result<TextMessageSendResult, WhatsAppError>> {
    if (this.shouldThrow) {
      throw new Error('Unexpected send error');
    }
    if (this.shouldFail) {
      return Promise.resolve(err(this.failError));
    }
    this.sentMessages.push({ phoneNumber, message, buttons });
    const wamid = `fake-wamid-${String(Date.now())}-${randomUUID().slice(0, 8)}`;
    return Promise.resolve(ok({ wamid }));
  }

  async sendCtaUrlMessage(
    phoneNumber: string,
    message: string,
    ctaUrl: { displayText: string; url: string }
  ): Promise<Result<TextMessageSendResult, WhatsAppError>> {
    if (this.shouldThrow) {
      throw new Error('Unexpected send error');
    }
    if (this.shouldFail) {
      return Promise.resolve(err(this.failError));
    }
    this.sentMessages.push({ phoneNumber, message, ctaUrl });
    const wamid = `fake-wamid-${String(Date.now())}-${randomUUID().slice(0, 8)}`;
    return Promise.resolve(ok({ wamid }));
  }

  getSentMessages(): {
    phoneNumber: string;
    message: string;
    buttons?: WhatsAppInteractiveButton[];
    ctaUrl?: { displayText: string; url: string };
  }[] {
    return [...this.sentMessages];
  }

  clear(): void {
    this.sentMessages = [];
    this.shouldFail = false;
    this.shouldThrow = false;
    this.failError = { code: 'INTERNAL_ERROR', message: 'Simulated send failure' };
  }
}

/**
 * Fake WhatsApp Cloud API port for testing.
 */
export class FakeWhatsAppCloudApiPort implements WhatsAppCloudApiPort {
  private mediaUrls = new Map<string, MediaUrlInfo>();
  private mediaContent = new Map<string, Buffer>();
  private sentMessages: {
    phoneNumberId: string;
    recipientPhone: string;
    message: string;
    replyToMessageId?: string;
    messageId: string;
  }[] = [];
  private markedAsReadMessages: { phoneNumberId: string; messageId: string }[] = [];
  private markedAsReadWithTypingMessages: { phoneNumberId: string; messageId: string }[] = [];
  private shouldFailGetMediaUrl = false;
  private shouldFailDownload = false;
  private shouldFailSendMessage = false;
  private shouldFailMarkAsRead = false;
  private messageIdCounter = 0;

  setMediaUrl(mediaId: string, info: MediaUrlInfo): void {
    this.mediaUrls.set(mediaId, info);
  }

  setMediaContent(url: string, content: Buffer): void {
    this.mediaContent.set(url, content);
  }

  setFailGetMediaUrl(fail: boolean): void {
    this.shouldFailGetMediaUrl = fail;
  }

  setFailDownload(fail: boolean): void {
    this.shouldFailDownload = fail;
  }

  setFailSendMessage(fail: boolean): void {
    this.shouldFailSendMessage = fail;
  }

  setFailMarkAsRead(fail: boolean): void {
    this.shouldFailMarkAsRead = fail;
  }

  getSentMessages(): typeof this.sentMessages {
    return this.sentMessages;
  }

  getMarkedAsReadMessages(): typeof this.markedAsReadMessages {
    return this.markedAsReadMessages;
  }

  getMarkedAsReadWithTypingMessages(): typeof this.markedAsReadWithTypingMessages {
    return this.markedAsReadWithTypingMessages;
  }

  getMediaUrl(mediaId: string): Promise<Result<MediaUrlInfo, WhatsAppError>> {
    if (this.shouldFailGetMediaUrl) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated getMediaUrl failure' })
      );
    }

    const info = this.mediaUrls.get(mediaId);
    if (info === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: `Media ${mediaId} not found` }));
    }

    return Promise.resolve(ok(info));
  }

  downloadMedia(url: string): Promise<Result<Buffer, WhatsAppError>> {
    if (this.shouldFailDownload) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated download failure' })
      );
    }

    const content = this.mediaContent.get(url);
    if (content === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: `Media at ${url} not found` }));
    }

    return Promise.resolve(ok(content));
  }

  sendMessage(
    phoneNumberId: string,
    recipientPhone: string,
    message: string,
    replyToMessageId?: string
  ): Promise<Result<SendMessageResult, WhatsAppError>> {
    if (this.shouldFailSendMessage) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated sendMessage failure' })
      );
    }

    this.messageIdCounter++;
    const messageId = `wamid.test${String(this.messageIdCounter)}`;

    const sent: (typeof this.sentMessages)[0] = {
      phoneNumberId,
      recipientPhone,
      message,
      messageId,
    };
    if (replyToMessageId !== undefined) {
      sent.replyToMessageId = replyToMessageId;
    }
    this.sentMessages.push(sent);

    return Promise.resolve(ok({ messageId }));
  }

  markAsRead(phoneNumberId: string, messageId: string): Promise<Result<void, WhatsAppError>> {
    if (this.shouldFailMarkAsRead) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated markAsRead failure' })
      );
    }

    this.markedAsReadMessages.push({ phoneNumberId, messageId });
    return Promise.resolve(ok(undefined));
  }

  markAsReadWithTyping(
    phoneNumberId: string,
    messageId: string
  ): Promise<Result<void, WhatsAppError>> {
    if (this.shouldFailMarkAsRead) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated markAsReadWithTyping failure' })
      );
    }

    this.markedAsReadWithTypingMessages.push({ phoneNumberId, messageId });
    return Promise.resolve(ok(undefined));
  }

  clear(): void {
    this.mediaUrls.clear();
    this.mediaContent.clear();
    this.sentMessages = [];
    this.markedAsReadMessages = [];
    this.markedAsReadWithTypingMessages = [];
    this.shouldFailGetMediaUrl = false;
    this.shouldFailDownload = false;
    this.shouldFailSendMessage = false;
    this.shouldFailMarkAsRead = false;
    this.messageIdCounter = 0;
  }
}

/**
 * Fake thumbnail generator port for testing.
 */
export class FakeThumbnailGeneratorPort implements ThumbnailGeneratorPort {
  private shouldFail = false;
  private customResult: ThumbnailResult | null = null;

  setFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  setCustomResult(result: ThumbnailResult): void {
    this.customResult = result;
  }

  generate(imageBuffer: Buffer): Promise<Result<ThumbnailResult, WhatsAppError>> {
    if (this.shouldFail) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated thumbnail generation failure' })
      );
    }

    if (this.customResult !== null) {
      return Promise.resolve(ok(this.customResult));
    }

    // Return a fake thumbnail
    return Promise.resolve(
      ok({
        buffer: Buffer.from('fake-thumbnail-' + String(imageBuffer.length)),
        mimeType: 'image/jpeg',
        width: 256,
        height: 256,
      })
    );
  }

  clear(): void {
    this.shouldFail = false;
    this.customResult = null;
  }
}

/**
 * Fake link preview fetcher port for testing.
 */
export class FakeLinkPreviewFetcherPort implements LinkPreviewFetcherPort {
  private previews = new Map<string, LinkPreview>();
  private shouldFail = false;
  private failureError: LinkPreviewError = { code: 'FETCH_FAILED', message: 'Simulated failure' };

  /**
   * Set a preview result for a specific URL.
   */
  setPreview(url: string, preview: LinkPreview): void {
    this.previews.set(url, preview);
  }

  /**
   * Configure the fake to fail all requests.
   */
  setFail(fail: boolean, error?: LinkPreviewError): void {
    this.shouldFail = fail;
    if (error !== undefined) {
      this.failureError = error;
    }
  }

  fetchPreview(url: string): Promise<Result<LinkPreview, LinkPreviewError>> {
    if (this.shouldFail) {
      return Promise.resolve(err(this.failureError));
    }

    const preview = this.previews.get(url);
    if (preview !== undefined) {
      return Promise.resolve(ok(preview));
    }

    // Return a default preview for any URL
    return Promise.resolve(
      ok({
        url,
        title: `Title for ${url}`,
        description: `Description for ${url}`,
        siteName: new URL(url).hostname,
      })
    );
  }

  clear(): void {
    this.previews.clear();
    this.shouldFail = false;
    this.failureError = { code: 'FETCH_FAILED', message: 'Simulated failure' };
  }
}

/**
 * Fake OutboundMessageRepository for testing.
 */
export class FakeOutboundMessageRepository implements OutboundMessageRepository {
  private messages = new Map<string, OutboundMessage>();
  private idempotentDeliveries = new Map<
    string,
    { payloadDigest: string; state: 'sending' | 'sent' | 'ambiguous'; updatedAt: string }
  >();
  private shouldFail = false;
  private shouldFailIdempotentCompletion = false;
  private failureError: WhatsAppError = {
    code: 'PERSISTENCE_ERROR',
    message: 'Simulated failure',
  };

  /**
   * Configure the fake to fail all requests.
   */
  setFail(fail: boolean, error?: WhatsAppError): void {
    this.shouldFail = fail;
    if (error !== undefined) {
      this.failureError = error;
    }
  }

  setFailIdempotentCompletion(fail: boolean): void {
    this.shouldFailIdempotentCompletion = fail;
  }

  async save(message: OutboundMessage): Promise<Result<void, WhatsAppError>> {
    if (this.shouldFail) {
      return err(this.failureError);
    }
    this.messages.set(message.wamid, message);
    return ok(undefined);
  }

  async findByWamid(wamid: string): Promise<Result<OutboundMessage | null, WhatsAppError>> {
    if (this.shouldFail) {
      return err(this.failureError);
    }
    return ok(this.messages.get(wamid) ?? null);
  }

  async deleteByWamid(wamid: string): Promise<Result<void, WhatsAppError>> {
    if (this.shouldFail) {
      return err(this.failureError);
    }
    this.messages.delete(wamid);
    return ok(undefined);
  }

  async reserveIdempotentDelivery(
    input: Parameters<OutboundMessageRepository['reserveIdempotentDelivery']>[0]
  ): ReturnType<OutboundMessageRepository['reserveIdempotentDelivery']> {
    if (this.shouldFail) return { ok: false, code: 'PERSISTENCE_ERROR' };
    const existing = this.idempotentDeliveries.get(input.idempotencyKey);
    if (existing !== undefined) {
      if (existing.payloadDigest !== input.payloadDigest)
        return { ok: false, code: 'CORRELATED_REPLAY_CONFLICT' };
      if (
        existing.state === 'sending' &&
        Date.parse(input.now) - Date.parse(existing.updatedAt) >= 15 * 60 * 1000
      ) {
        this.idempotentDeliveries.set(input.idempotencyKey, {
          ...existing,
          state: 'ambiguous',
          updatedAt: input.now,
        });
        return { ok: true, disposition: 'duplicate_ambiguous' };
      }
      return {
        ok: true,
        disposition:
          existing.state === 'sent'
            ? 'duplicate_sent'
            : existing.state === 'ambiguous'
              ? 'duplicate_ambiguous'
              : 'duplicate_in_flight',
      };
    }
    this.idempotentDeliveries.set(input.idempotencyKey, {
      payloadDigest: input.payloadDigest,
      state: 'sending',
      updatedAt: input.now,
    });
    return { ok: true, disposition: 'acquired' };
  }

  async completeIdempotentDelivery(
    input: Parameters<OutboundMessageRepository['completeIdempotentDelivery']>[0]
  ): ReturnType<OutboundMessageRepository['completeIdempotentDelivery']> {
    if (this.shouldFail || this.shouldFailIdempotentCompletion)
      return { ok: false, code: 'PERSISTENCE_ERROR' };
    const existing = this.idempotentDeliveries.get(input.idempotencyKey);
    if (existing === undefined) return { ok: false, code: 'NOT_FOUND' };
    if (existing.payloadDigest !== input.payloadDigest)
      return { ok: false, code: 'CORRELATED_REPLAY_CONFLICT' };
    if (existing.state === 'ambiguous') return { ok: false, code: 'INVALID_STATE' };
    if (existing.state === 'sent') return { ok: true, disposition: 'already_applied' };
    this.messages.set(input.outboundMessage.wamid, input.outboundMessage);
    this.idempotentDeliveries.set(input.idempotencyKey, {
      ...existing,
      state: 'sent',
      updatedAt: input.outboundMessage.sentAt,
    });
    return { ok: true, disposition: 'applied' };
  }

  async markIdempotentDeliveryAmbiguous(
    input: Parameters<OutboundMessageRepository['markIdempotentDeliveryAmbiguous']>[0]
  ): ReturnType<OutboundMessageRepository['markIdempotentDeliveryAmbiguous']> {
    if (this.shouldFail) return { ok: false, code: 'PERSISTENCE_ERROR' };
    const existing = this.idempotentDeliveries.get(input.idempotencyKey);
    if (existing === undefined) return { ok: false, code: 'NOT_FOUND' };
    if (existing.payloadDigest !== input.payloadDigest)
      return { ok: false, code: 'CORRELATED_REPLAY_CONFLICT' };
    if (existing.state === 'sent') return { ok: false, code: 'INVALID_STATE' };
    if (existing.state === 'ambiguous') return { ok: true, disposition: 'already_applied' };
    this.idempotentDeliveries.set(input.idempotencyKey, {
      ...existing,
      state: 'ambiguous',
      updatedAt: input.now,
    });
    return { ok: true, disposition: 'applied' };
  }

  /**
   * Get all stored messages (for test assertions).
   */
  getMessages(): OutboundMessage[] {
    return Array.from(this.messages.values());
  }

  /**
   * Clear all stored messages.
   */
  clear(): void {
    this.messages.clear();
    this.idempotentDeliveries.clear();
    this.shouldFail = false;
    this.shouldFailIdempotentCompletion = false;
    this.failureError = { code: 'PERSISTENCE_ERROR', message: 'Simulated failure' };
  }
}

/**
 * Fake phone verification repository for testing.
 */
export class FakePhoneVerificationRepository implements PhoneVerificationRepository {
  private verifications = new Map<string, PhoneVerification>();
  private idCounter = 0;
  private shouldFail = false;
  private failureError: WhatsAppError = {
    code: 'PERSISTENCE_ERROR',
    message: 'Simulated failure',
  };
  private shouldFailCreate = false;
  private shouldFailFindPending = false;
  private shouldFailCountRecent = false;
  private shouldFailIncrementAttempts = false;
  private shouldFailUpdateStatus = false;

  setFail(fail: boolean, error?: WhatsAppError): void {
    this.shouldFail = fail;
    if (error !== undefined) {
      this.failureError = error;
    }
  }

  setFailCreate(fail: boolean): void {
    this.shouldFailCreate = fail;
  }

  setFailFindPending(fail: boolean): void {
    this.shouldFailFindPending = fail;
  }

  setFailCountRecent(fail: boolean): void {
    this.shouldFailCountRecent = fail;
  }

  setFailIncrementAttempts(fail: boolean): void {
    this.shouldFailIncrementAttempts = fail;
  }

  setFailUpdateStatus(fail: boolean): void {
    this.shouldFailUpdateStatus = fail;
  }

  async create(
    verification: Omit<PhoneVerification, 'id'>
  ): Promise<Result<PhoneVerification, WhatsAppError>> {
    if (this.shouldFail || this.shouldFailCreate) {
      return err(this.failureError);
    }
    this.idCounter++;
    const id = `fake-verification-${String(this.idCounter)}`;
    const doc: PhoneVerification = { id, ...verification };
    this.verifications.set(id, doc);
    return ok(doc);
  }

  async findById(id: string): Promise<Result<PhoneVerification | null, WhatsAppError>> {
    if (this.shouldFail) {
      return err(this.failureError);
    }
    return ok(this.verifications.get(id) ?? null);
  }

  async findPendingByUserAndPhone(
    userId: string,
    phoneNumber: string
  ): Promise<Result<PhoneVerification | null, WhatsAppError>> {
    if (this.shouldFail || this.shouldFailFindPending) {
      return err(this.failureError);
    }
    const now = Math.floor(Date.now() / 1000);
    for (const v of this.verifications.values()) {
      if (
        v.userId === userId &&
        v.phoneNumber === phoneNumber &&
        v.status === 'pending' &&
        v.expiresAt > now
      ) {
        return ok(v);
      }
    }
    return ok(null);
  }

  async isPhoneVerified(
    userId: string,
    phoneNumber: string
  ): Promise<Result<boolean, WhatsAppError>> {
    if (this.shouldFail) {
      return err(this.failureError);
    }
    for (const v of this.verifications.values()) {
      if (v.userId === userId && v.phoneNumber === phoneNumber && v.status === 'verified') {
        return ok(true);
      }
    }
    return ok(false);
  }

  async updateStatus(
    id: string,
    status: PhoneVerificationStatus,
    metadata?: { verifiedAt?: string; lastAttemptAt?: string }
  ): Promise<Result<PhoneVerification, WhatsAppError>> {
    if (this.shouldFail || this.shouldFailUpdateStatus) {
      return err(this.failureError);
    }
    const verification = this.verifications.get(id);
    if (verification === undefined) {
      return err({ code: 'NOT_FOUND', message: 'Verification not found' });
    }
    verification.status = status;
    if (metadata?.verifiedAt !== undefined) {
      verification.verifiedAt = metadata.verifiedAt;
    }
    if (metadata?.lastAttemptAt !== undefined) {
      verification.lastAttemptAt = metadata.lastAttemptAt;
    }
    return ok(verification);
  }

  async incrementAttempts(id: string): Promise<Result<PhoneVerification, WhatsAppError>> {
    if (this.shouldFail || this.shouldFailIncrementAttempts) {
      return err(this.failureError);
    }
    const verification = this.verifications.get(id);
    if (verification === undefined) {
      return err({ code: 'NOT_FOUND', message: 'Verification not found' });
    }
    verification.attempts += 1;
    verification.lastAttemptAt = new Date().toISOString();
    return ok(verification);
  }

  async countRecentByPhone(
    phoneNumber: string,
    windowStartTime: string
  ): Promise<Result<number, WhatsAppError>> {
    if (this.shouldFail || this.shouldFailCountRecent) {
      return err(this.failureError);
    }
    let count = 0;
    for (const v of this.verifications.values()) {
      if (v.phoneNumber === phoneNumber && v.createdAt >= windowStartTime) {
        count++;
      }
    }
    return ok(count);
  }

  async createWithChecks(params: {
    userId: string;
    phoneNumber: string;
    code: string;
    expiresAt: number;
    cooldownSeconds: number;
    maxRequestsPerHour: number;
    windowStartTime: string;
  }): Promise<
    Result<
      {
        verification: PhoneVerification;
        cooldownUntil: number;
        existingPendingId?: string;
      },
      WhatsAppError
    >
  > {
    if (this.shouldFail || this.shouldFailCreate) {
      return err(this.failureError);
    }

    const now = new Date();
    const nowSeconds = Math.floor(now.getTime() / 1000);

    // Check 1: Phone already verified
    for (const v of this.verifications.values()) {
      if (
        v.userId === params.userId &&
        v.phoneNumber === params.phoneNumber &&
        v.status === 'verified'
      ) {
        return err({
          code: 'ALREADY_VERIFIED',
          message: 'Phone number already verified',
        });
      }
    }

    // Check 2: Pending verification within cooldown
    if (this.shouldFailFindPending) {
      return err({ code: 'PERSISTENCE_ERROR', message: 'Failed to find pending verification' });
    }
    for (const v of this.verifications.values()) {
      if (
        v.userId === params.userId &&
        v.phoneNumber === params.phoneNumber &&
        v.status === 'pending' &&
        v.expiresAt > nowSeconds
      ) {
        const createdAtTime = new Date(v.createdAt).getTime();
        const cooldownEnd = createdAtTime + params.cooldownSeconds * 1000;
        if (Date.now() < cooldownEnd) {
          return err({
            code: 'COOLDOWN_ACTIVE',
            message: 'Please wait before requesting another code',
            details: {
              cooldownUntil: Math.floor(cooldownEnd / 1000),
              existingPendingId: v.id,
            },
          });
        }
      }
    }

    // Check 3: Rate limit
    if (this.shouldFailCountRecent) {
      return err({ code: 'PERSISTENCE_ERROR', message: 'Failed to count recent verifications' });
    }
    let recentCount = 0;
    for (const v of this.verifications.values()) {
      if (v.phoneNumber === params.phoneNumber && v.createdAt >= params.windowStartTime) {
        recentCount++;
      }
    }
    if (recentCount >= params.maxRequestsPerHour) {
      return err({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many verification requests. Try again later.',
      });
    }

    // Create verification
    this.idCounter++;
    const id = `fake-verification-${String(this.idCounter)}`;
    const verification: PhoneVerification = {
      id,
      userId: params.userId,
      phoneNumber: params.phoneNumber,
      code: params.code,
      attempts: 0,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: params.expiresAt,
    };
    this.verifications.set(id, verification);

    const cooldownUntil = nowSeconds + params.cooldownSeconds;
    return ok({ verification, cooldownUntil });
  }

  setVerification(verification: PhoneVerification): void {
    this.verifications.set(verification.id, verification);
  }

  getVerifications(): PhoneVerification[] {
    return Array.from(this.verifications.values());
  }

  clear(): void {
    this.verifications.clear();
    this.idCounter = 0;
    this.shouldFail = false;
    this.failureError = { code: 'PERSISTENCE_ERROR', message: 'Simulated failure' };
    this.shouldFailCreate = false;
    this.shouldFailFindPending = false;
    this.shouldFailCountRecent = false;
    this.shouldFailIncrementAttempts = false;
    this.shouldFailUpdateStatus = false;
  }
}

/**
 * Fake NotificationPreferencesRepository for testing.
 */
export class FakeNotificationPreferencesRepository implements NotificationPreferencesRepository {
  private levels = new Map<string, NotificationLevel>();
  private failNextError: WhatsAppError | null = null;

  setLevel(userId: string, level: NotificationLevel): void {
    this.levels.set(userId, level);
  }

  failNext(error: WhatsAppError): void {
    this.failNextError = error;
  }

  async getPreferences(userId: string): Promise<Result<NotificationPreferences, WhatsAppError>> {
    if (this.failNextError !== null) {
      const error = this.failNextError;
      this.failNextError = null;
      return err(error);
    }
    return ok({ notificationLevel: this.levels.get(userId) ?? 'all' });
  }

  async savePreferences(
    userId: string,
    level: NotificationLevel
  ): Promise<Result<NotificationPreferences, WhatsAppError>> {
    if (this.failNextError !== null) {
      const error = this.failNextError;
      this.failNextError = null;
      return err(error);
    }
    this.levels.set(userId, level);
    return ok({ notificationLevel: level });
  }

  clear(): void {
    this.levels.clear();
    this.failNextError = null;
  }
}
