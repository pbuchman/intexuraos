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
  ConversationAssistantPreparationRequestedEvent,
  EventPublisherPort,
  ExtractLinkPreviewsEvent,
  IntexMessageIngestEvent,
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
  PrivateWhatsAppConversationContextMessageResult,
  PrivateWhatsAppIngestOutcome,
  PrivateWhatsAppMessage,
  PrivateWhatsAppMessageQueryInput,
  PrivateWhatsAppMessageQueryResult,
  PrivateWhatsAppReactionSummary,
  PrivateWhatsAppSender,
  PrivateWhatsAppSenderQueryInput,
  PrivateWhatsAppSenderQueryResult,
  PrivateWhatsAppRepository,
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
  ConversationAssistantContextResult,
  ConversationAssistantSession,
  ConversationAssistantTurn,
} from '../domain/conversation-assistant/types.js';
import { createConversationAssistantDeletionToken } from '../domain/conversation-assistant/deletionToken.js';
import type {
  MatrixOutboundGateway,
  MatrixOutboundReadinessInput,
  MatrixOutboundReadinessResult,
  MatrixOutboundSendInput,
  MatrixOutboundSendResult,
} from '../domain/whatsapp/ports/matrixOutboundGateway.js';
import { randomUUID } from 'node:crypto';

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

  saveSession(session: ConversationAssistantSession): Promise<void> {
    this.sessions.set(session.id, { ...session });
    return Promise.resolve();
  }

  createSessionIfAbsent(session: ConversationAssistantSession): Promise<
    | { status: 'created'; session: ConversationAssistantSession }
    | { status: 'existing'; session: ConversationAssistantSession }
  > {
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

  getSessionSnapshotById(
    input: { sessionId: string; userId: string }
  ): Promise<{ session: ConversationAssistantSession; turns: ConversationAssistantTurn[] } | null> {
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
  }): Promise<boolean> {
    const current = this.sessions.get(input.session.id);
    if (
      current?.preparationAttempt !== input.attempt ||
      current.preparationClaimId !== input.claimId ||
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

  private listTurnsForSnapshot(
    sessionId: string,
    userId?: string
  ): ConversationAssistantTurn[] {
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

  queueGenerateResponse(
    response: Partial<GenerateResult> & Pick<GenerateResult, 'content'>
  ): void {
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
  setMappingForPhone(
    phoneNumber: string,
    userId: string,
    options?: { connected?: boolean }
  ): void {
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
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated findById failure' }));
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
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated updateTranscription failure' }));
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
  phoneNumberNormalized: string;
  displayName: string;
  status: 'active' | 'disabled';
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
      (candidate) =>
        candidate.sourceAccountId === sourceAccountId && candidate.status === 'active'
    );
    return Promise.resolve(ok(account ?? null));
  }

  upsertAccount(input: FakeUpsertPrivateWhatsAppAccountInput): Promise<Result<FakePrivateWhatsAppAccount, WhatsAppError>> {
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

  disableAccount(input: FakeDisablePrivateWhatsAppAccountInput): Promise<Result<FakePrivateWhatsAppAccount, WhatsAppError>> {
    const failure = this.consumeFailure();
    if (failure !== null) {
      return Promise.resolve(err(failure));
    }
    const existing = this.accounts.get(input.userId);
    if (existing === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Private WhatsApp account not found' }));
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
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Private WhatsApp chat not found' }));
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

    const chat = this.buildChats().get(`chat:${stored.sourceAccountId}:${stored.chat.matrixRoomId}`);
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
  ): Promise<Result<void, WhatsAppError>> {
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

    this.messageTranscriptions.set(input.messageId, input.transcription);
    return Promise.resolve(ok(undefined));
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
        normalizedReaction === undefined ? extractFakeLegacyReaction(message.rawMatrixEvent) : undefined;
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
        result.nextCursor = encodeFakePrivateWhatsAppCursor(lastMessage.eventTimestamp, lastMessage.id);
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
        result.nextCursor = encodeFakePrivateWhatsAppCursor(lastSenderDay.eventDayKey, lastSenderDay.senderKey);
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
    const transcription = this.messageTranscriptions.get(message.id);
    if (transcription !== undefined) {
      message.transcription = transcription;
    }
    return message;
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
        message.eventTimestamp < existing.firstEventAt ? message.eventTimestamp : existing.firstEventAt;
      existing.lastEventAt =
        message.eventTimestamp > existing.lastEventAt ? message.eventTimestamp : existing.lastEventAt;
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
        message.eventTimestamp < existing.firstEventAt ? message.eventTimestamp : existing.firstEventAt;
      existing.lastEventAt =
        message.eventTimestamp > existing.lastEventAt ? message.eventTimestamp : existing.lastEventAt;
      if (!existing.chatIds.includes(message.chatId)) {
        existing.chatIds.push(message.chatId);
      }
      existing.updatedAt = message.receivedAt;
      if (message.senderDisplayName !== undefined && message.eventTimestamp >= existing.lastEventAt) {
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
        chats.set(message.chatId, chat);
        continue;
      }

      existing.messageCount = (existing.messageCount ?? 0) + 1;
      existing.participantKeys = nextParticipantKeys;
      existing.participantCount = nextParticipantKeys.length;
      existing.firstSeenAt =
        message.eventTimestamp < existing.firstSeenAt ? message.eventTimestamp : existing.firstSeenAt;
      existing.lastEventAt =
        message.eventTimestamp > existing.lastEventAt ? message.eventTimestamp : existing.lastEventAt;
      existing.updatedAt = message.receivedAt;
      if (message.chatDisplayName !== undefined && message.eventTimestamp >= existing.lastEventAt) {
        existing.displayName = message.chatDisplayName;
      }
      if (message.chatType !== undefined && message.chatType !== 'unknown') {
        existing.chatType = message.chatType;
      }
    }
    for (const chat of chats.values()) {
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
  private extractLinkPreviewsFailureMessage: string | null = null;
  private audioStoredFailureMessage: string | null = null;
  private mediaTranscriptionRequestedFailureMessage: string | null = null;
  private intexMessageIngestFailureMessage: string | null = null;
  private webhookProcessFailureMessage: string | null = null;
  private conversationAssistantPreparationFailureMessage: string | null = null;

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

  clear(): void {
    this.mediaCleanupEvents = [];
    this.audioStoredEvents = [];
    this.mediaTranscriptionRequestedEvents = [];
    this.intexMessageIngestEvents = [];
    this.webhookProcessEvents = [];
    this.extractLinkPreviewsEvents = [];
    this.conversationAssistantPreparationEvents = [];
    this.extractLinkPreviewsFailureMessage = null;
    this.audioStoredFailureMessage = null;
    this.mediaTranscriptionRequestedFailureMessage = null;
    this.intexMessageIngestFailureMessage = null;
    this.webhookProcessFailureMessage = null;
    this.conversationAssistantPreparationFailureMessage = null;
  }
}

/**
 * Fake message sender for testing.
 */
export class FakeMessageSender implements WhatsAppMessageSender {
  private sentMessages: { phoneNumber: string; message: string; buttons?: WhatsAppInteractiveButton[]; ctaUrl?: { displayText: string; url: string } }[] = [];
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

  getSentMessages(): { phoneNumber: string; message: string; buttons?: WhatsAppInteractiveButton[]; ctaUrl?: { displayText: string; url: string } }[] {
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
  private shouldFail = false;
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
    this.shouldFail = false;
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

  async createWithChecks(
    params: {
      userId: string;
      phoneNumber: string;
      code: string;
      expiresAt: number;
      cooldownSeconds: number;
      maxRequestsPerHour: number;
      windowStartTime: string;
    }
  ): Promise<Result<{
    verification: PhoneVerification;
    cooldownUntil: number;
    existingPendingId?: string;
  }, WhatsAppError>> {
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
export class FakeNotificationPreferencesRepository
  implements NotificationPreferencesRepository
{
  private levels = new Map<string, NotificationLevel>();
  private failNextError: WhatsAppError | null = null;

  setLevel(userId: string, level: NotificationLevel): void {
    this.levels.set(userId, level);
  }

  failNext(error: WhatsAppError): void {
    this.failNextError = error;
  }

  async getPreferences(
    userId: string
  ): Promise<Result<NotificationPreferences, WhatsAppError>> {
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
