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
import { normalizePhoneNumber } from '../routes/shared.js';
import type {
  ApprovalReplyEvent,
  CommandIngestEvent,
  EventPublisherPort,
  ExtractLinkPreviewsEvent,
  IgnoredReason,
  WhatsAppError,
  LinkPreview,
  LinkPreviewError,
  LinkPreviewFetcherPort,
  LinkPreviewState,
  MediaCleanupEvent,
  MediaStoragePort,
  MediaUrlInfo,
  OutboundMessage,
  OutboundMessageRepository,
  SendMessageResult,
  SpeechTranscriptionPort,
  TextMessageSendResult,
  ThumbnailGeneratorPort,
  ThumbnailResult,
  TranscribeAudioEvent,
  TranscriptionJobInput,
  TranscriptionJobPollResult,
  TranscriptionJobSubmitResult,
  TranscriptionPortError,
  TranscriptionState,
  TranscriptionTextResult,
  UploadResult,
  WebhookProcessEvent,
  WebhookProcessingStatus,
  WhatsAppCloudApiPort,
  WhatsAppMessage,
  WhatsAppMessageRepository,
  WhatsAppMessageSender,
  WhatsAppUserMappingPublic,
  WhatsAppUserMappingRepository,
  WhatsAppWebhookEvent,
  WhatsAppWebhookEventRepository,
} from '../domain/whatsapp/index.js';
import { randomUUID } from 'node:crypto';

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
    };
    this.events.set(eventId, updated);
    return Promise.resolve(ok(updated));
  }

  getEvent(eventId: string): Promise<Result<WhatsAppWebhookEvent | null, WhatsAppError>> {
    return Promise.resolve(ok(this.events.get(eventId) ?? null));
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
    const message = this.messages.get(messageId);
    if (message?.userId !== userId) {
      return Promise.resolve(ok(null));
    }
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
    this.nextCursorToReturn = undefined;
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
  private commandIngestEvents: CommandIngestEvent[] = [];
  private webhookProcessEvents: WebhookProcessEvent[] = [];
  private transcribeAudioEvents: TranscribeAudioEvent[] = [];
  private extractLinkPreviewsEvents: ExtractLinkPreviewsEvent[] = [];
  private approvalReplyEvents: ApprovalReplyEvent[] = [];

  publishMediaCleanup(event: MediaCleanupEvent): Promise<Result<void, WhatsAppError>> {
    this.mediaCleanupEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  publishCommandIngest(event: CommandIngestEvent): Promise<Result<void, WhatsAppError>> {
    this.commandIngestEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  publishWebhookProcess(event: WebhookProcessEvent): Promise<Result<void, WhatsAppError>> {
    this.webhookProcessEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  publishTranscribeAudio(event: TranscribeAudioEvent): Promise<Result<void, WhatsAppError>> {
    this.transcribeAudioEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  publishExtractLinkPreviews(
    event: ExtractLinkPreviewsEvent
  ): Promise<Result<void, WhatsAppError>> {
    this.extractLinkPreviewsEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  publishApprovalReply(event: ApprovalReplyEvent): Promise<Result<void, WhatsAppError>> {
    this.approvalReplyEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  getMediaCleanupEvents(): MediaCleanupEvent[] {
    return [...this.mediaCleanupEvents];
  }

  getCommandIngestEvents(): CommandIngestEvent[] {
    return [...this.commandIngestEvents];
  }

  getWebhookProcessEvents(): WebhookProcessEvent[] {
    return [...this.webhookProcessEvents];
  }

  getTranscribeAudioEvents(): TranscribeAudioEvent[] {
    return [...this.transcribeAudioEvents];
  }

  getExtractLinkPreviewsEvents(): ExtractLinkPreviewsEvent[] {
    return [...this.extractLinkPreviewsEvents];
  }

  getApprovalReplyEvents(): ApprovalReplyEvent[] {
    return [...this.approvalReplyEvents];
  }

  clear(): void {
    this.mediaCleanupEvents = [];
    this.commandIngestEvents = [];
    this.webhookProcessEvents = [];
    this.transcribeAudioEvents = [];
    this.extractLinkPreviewsEvents = [];
    this.approvalReplyEvents = [];
  }
}

/**
 * Fake message sender for testing.
 */
export class FakeMessageSender implements WhatsAppMessageSender {
  private sentMessages: { phoneNumber: string; message: string }[] = [];
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

  sendTextMessage(
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

  getSentMessages(): { phoneNumber: string; message: string }[] {
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
 * Fake speech transcription service for testing.
 */
export class FakeSpeechTranscriptionPort implements SpeechTranscriptionPort {
  private jobs = new Map<
    string,
    {
      status: 'running' | 'done' | 'rejected';
      transcript?: string;
      summary?: string;
      detectedLanguage?: string;
      error?: string;
    }
  >();
  private jobCounter = 0;
  private shouldFail = false;
  private failMessage = 'Fake transcription error';
  private failWithoutApiCall = false;
  private getTranscriptWithoutApiCall = false;
  private pollFailuresRemaining = 0;
  private pollFailError: TranscriptionPortError = {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Service temporarily unavailable',
  };
  private autoComplete = false;
  private autoCompleteTranscript = 'Auto-completed transcript for testing';

  /**
   * Configure the fake to auto-complete jobs on creation.
   * Useful for testing success paths without waiting for polling.
   */
  setAutoComplete(enabled: boolean, transcript?: string): void {
    this.autoComplete = enabled;
    if (transcript !== undefined) {
      this.autoCompleteTranscript = transcript;
    }
  }

  /**
   * Configure the fake to fail subsequent calls.
   * @param fail - Whether to fail
   * @param message - Optional error message
   * @param withoutApiCall - If true, error will not include apiCall field
   */
  setFailMode(fail: boolean, message?: string, withoutApiCall?: boolean): void {
    this.shouldFail = fail;
    if (message !== undefined) {
      this.failMessage = message;
    }
    this.failWithoutApiCall = withoutApiCall === true;
  }

  /**
   * Set job completion result (for testing polling).
   */
  setJobResult(jobId: string, transcript: string, summary?: string, detectedLanguage?: string): void {
    const job = this.jobs.get(jobId);
    if (job !== undefined) {
      job.status = 'done';
      job.transcript = transcript;
      if (summary !== undefined) {
        job.summary = summary;
      }
      if (detectedLanguage !== undefined) {
        job.detectedLanguage = detectedLanguage;
      }
    }
  }

  /**
   * Set job failure (for testing error handling).
   */
  setJobFailed(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (job !== undefined) {
      job.status = 'rejected';
      job.error = error;
    }
  }

  /**
   * Set job as rejected without an error message (for testing error-less rejection).
   */
  setJobRejectedWithoutError(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job !== undefined) {
      job.status = 'rejected';
      // Intentionally not setting job.error to test the branch
      // where pollResult.value.error is undefined
    }
  }

  /**
   * Configure the fake to fail the next N pollJob calls with a transient error.
   * After the specified count, polls will succeed normally.
   *
   * @param count - Number of poll failures to simulate before allowing success
   * @param error - Optional custom error to return on failure (defaults to SERVICE_UNAVAILABLE)
   */
  setPollFailures(count: number, error?: TranscriptionPortError): void {
    this.pollFailuresRemaining = count;
    if (error !== undefined) {
      this.pollFailError = error;
    }
  }

  /**
   * Configure getTranscript to return errors without apiCall field.
   */
  setGetTranscriptWithoutApiCall(withoutApiCall: boolean): void {
    this.getTranscriptWithoutApiCall = withoutApiCall;
  }

  submitJob(
    input: TranscriptionJobInput
  ): Promise<Result<TranscriptionJobSubmitResult, TranscriptionPortError>> {
    if (this.shouldFail) {
      const error: TranscriptionPortError = {
        code: 'FAKE_ERROR',
        message: this.failMessage,
      };
      if (!this.failWithoutApiCall) {
        error.apiCall = {
          timestamp: new Date().toISOString(),
          operation: 'submit',
          success: false,
          response: { error: this.failMessage },
        };
      }
      return Promise.resolve(err(error));
    }

    this.jobCounter++;
    const jobId = `fake-job-${String(this.jobCounter)}`;
    if (this.autoComplete) {
      this.jobs.set(jobId, { status: 'done', transcript: this.autoCompleteTranscript });
    } else {
      this.jobs.set(jobId, { status: 'running' });
    }

    return Promise.resolve(
      ok({
        jobId,
        apiCall: {
          timestamp: new Date().toISOString(),
          operation: 'submit',
          success: true,
          response: { jobId, audioUrl: input.audioUrl },
        },
      })
    );
  }

  pollJob(jobId: string): Promise<Result<TranscriptionJobPollResult, TranscriptionPortError>> {
    // Simulate transient failures if configured
    if (this.pollFailuresRemaining > 0) {
      this.pollFailuresRemaining--;
      return Promise.resolve(err(this.pollFailError));
    }

    const job = this.jobs.get(jobId);
    if (job === undefined) {
      return Promise.resolve(
        err({
          code: 'NOT_FOUND',
          message: `Job ${jobId} not found`,
          apiCall: {
            timestamp: new Date().toISOString(),
            operation: 'poll',
            success: false,
          },
        })
      );
    }

    const result: TranscriptionJobPollResult = {
      status: job.status,
      apiCall: {
        timestamp: new Date().toISOString(),
        operation: 'poll',
        success: true,
        response: { status: job.status },
      },
    };

    if (job.status === 'rejected' && job.error !== undefined) {
      result.error = { code: 'JOB_REJECTED', message: job.error };
    }

    return Promise.resolve(ok(result));
  }

  getTranscript(jobId: string): Promise<Result<TranscriptionTextResult, TranscriptionPortError>> {
    const job = this.jobs.get(jobId);
    if (job?.transcript === undefined) {
      const error: TranscriptionPortError = {
        code: 'NOT_FOUND',
        message: `Transcript for job ${jobId} not found`,
      };
      if (!this.getTranscriptWithoutApiCall) {
        error.apiCall = {
          timestamp: new Date().toISOString(),
          operation: 'fetch_result',
          success: false,
        };
      }
      return Promise.resolve(err(error));
    }

    return Promise.resolve(
      ok({
        text: job.transcript,
        ...(job.summary !== undefined && { summary: job.summary }),
        ...(job.detectedLanguage !== undefined && { detectedLanguage: job.detectedLanguage }),
        apiCall: {
          timestamp: new Date().toISOString(),
          operation: 'fetch_result',
          success: true,
          response: {
            transcriptLength: job.transcript.length,
            hasSummary: job.summary !== undefined,
          },
        },
      })
    );
  }

  getJobs(): Map<
    string,
    {
      status: 'running' | 'done' | 'rejected';
      transcript?: string;
      summary?: string;
      error?: string;
    }
  > {
    return this.jobs;
  }

  clear(): void {
    this.jobs.clear();
    this.jobCounter = 0;
    this.shouldFail = false;
    this.failWithoutApiCall = false;
    this.getTranscriptWithoutApiCall = false;
    this.pollFailuresRemaining = 0;
    this.pollFailError = {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Service temporarily unavailable',
    };
    this.autoComplete = false;
    this.autoCompleteTranscript = 'Auto-completed transcript for testing';
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

  clear(): void {
    this.mediaUrls.clear();
    this.mediaContent.clear();
    this.sentMessages = [];
    this.markedAsReadMessages = [];
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
