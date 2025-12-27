/**
 * Fake repositories for testing.
 *
 * These fakes implement the domain port interfaces but use in-memory storage.
 * They are designed to be exercised by route tests and use case tests.
 *
 * Coverage note: Some methods may show low coverage until all Tier 1 test issues
 * are completed (see docs/continuity/1-4-whatsapp-webhook-usecase.md, 1-5-whatsapp-routes.md).
 */
import type { Result } from '@intexuraos/common';
import { ok, err } from '@intexuraos/common';
import { normalizePhoneNumber } from '../routes/shared.js';
import type {
  WhatsAppWebhookEventRepository,
  WhatsAppUserMappingRepository,
  WhatsAppMessageRepository,
  WhatsAppWebhookEvent,
  WebhookProcessingStatus,
  IgnoredReason,
  WhatsAppUserMappingPublic,
  WhatsAppMessage,
  InboxError,
  MediaStoragePort,
  UploadResult,
  EventPublisherPort,
  MediaCleanupEvent,
  WhatsAppMessageSender,
  TranscriptionState,
  SpeechTranscriptionPort,
  TranscriptionJobInput,
  TranscriptionJobSubmitResult,
  TranscriptionJobPollResult,
  TranscriptionTextResult,
  TranscriptionPortError,
  WhatsAppCloudApiPort,
  MediaUrlInfo,
  SendMessageResult,
  ThumbnailGeneratorPort,
  ThumbnailResult,
} from '../domain/inbox/index.js';
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
  ): Promise<Result<WhatsAppWebhookEvent, InboxError>> {
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
  ): Promise<Result<WhatsAppWebhookEvent, InboxError>> {
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

  getEvent(eventId: string): Promise<Result<WhatsAppWebhookEvent | null, InboxError>> {
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

  saveMapping(
    userId: string,
    phoneNumbers: string[]
  ): Promise<Result<WhatsAppUserMappingPublic, InboxError>> {
    const now = new Date().toISOString();
    // Normalize phone numbers (remove leading "+") to match real implementation
    const normalizedPhoneNumbers = phoneNumbers.map(normalizePhoneNumber);
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

  getMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic | null, InboxError>> {
    const mapping = this.mappings.get(userId);
    if (mapping === undefined) return Promise.resolve(ok(null));
    const { userId: _, ...publicMapping } = mapping;
    return Promise.resolve(ok(publicMapping));
  }

  findUserByPhoneNumber(phoneNumber: string): Promise<Result<string | null, InboxError>> {
    // Normalize phone number to match stored format (without "+")
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    return Promise.resolve(ok(this.phoneIndex.get(normalizedPhone) ?? null));
  }

  disconnectMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic, InboxError>> {
    const mapping = this.mappings.get(userId);
    if (mapping === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Mapping not found' }));
    }
    mapping.connected = false;
    mapping.updatedAt = new Date().toISOString();
    const { userId: _, ...publicMapping } = mapping;
    return Promise.resolve(ok(publicMapping));
  }

  isConnected(userId: string): Promise<Result<boolean, InboxError>> {
    const mapping = this.mappings.get(userId);
    return Promise.resolve(ok(mapping?.connected === true));
  }

  clear(): void {
    this.mappings.clear();
    this.phoneIndex.clear();
  }
}

/**
 * Fake WhatsApp message repository for testing.
 */
export class FakeWhatsAppMessageRepository implements WhatsAppMessageRepository {
  private messages = new Map<string, WhatsAppMessage>();
  private shouldFailSave = false;

  setFailSave(fail: boolean): void {
    this.shouldFailSave = fail;
  }

  saveMessage(message: Omit<WhatsAppMessage, 'id'>): Promise<Result<WhatsAppMessage, InboxError>> {
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

  getMessagesByUser(userId: string, limit = 100): Promise<Result<WhatsAppMessage[], InboxError>> {
    const userMessages = Array.from(this.messages.values())
      .filter((m) => m.userId === userId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, limit);
    return Promise.resolve(ok(userMessages));
  }

  getMessage(messageId: string): Promise<Result<WhatsAppMessage | null, InboxError>> {
    return Promise.resolve(ok(this.messages.get(messageId) ?? null));
  }

  deleteMessage(messageId: string): Promise<Result<void, InboxError>> {
    this.messages.delete(messageId);
    return Promise.resolve(ok(undefined));
  }

  findById(userId: string, messageId: string): Promise<Result<WhatsAppMessage | null, InboxError>> {
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
  ): Promise<Result<void, InboxError>> {
    const message = this.messages.get(messageId);
    if (message?.userId !== userId) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Message not found' }));
    }
    message.transcription = transcription;
    return Promise.resolve(ok(undefined));
  }

  getAll(): WhatsAppMessage[] {
    return Array.from(this.messages.values());
  }

  clear(): void {
    this.messages.clear();
  }
}

/**
 * Fake media storage for testing.
 */
export class FakeMediaStorage implements MediaStoragePort {
  private files = new Map<string, { buffer: Buffer; contentType: string }>();
  private signedUrls = new Map<string, string>();
  private shouldFailUpload = false;
  private shouldFailThumbnailUpload = false;

  setFailUpload(fail: boolean): void {
    this.shouldFailUpload = fail;
  }

  setFailThumbnailUpload(fail: boolean): void {
    this.shouldFailThumbnailUpload = fail;
  }

  upload(
    userId: string,
    messageId: string,
    mediaId: string,
    extension: string,
    buffer: Buffer,
    contentType: string
  ): Promise<Result<UploadResult, InboxError>> {
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
  ): Promise<Result<UploadResult, InboxError>> {
    if (this.shouldFailThumbnailUpload) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated thumbnail upload failure' })
      );
    }
    const gcsPath = `whatsapp/${userId}/${messageId}/${mediaId}_thumb.${extension}`;
    this.files.set(gcsPath, { buffer, contentType });
    return Promise.resolve(ok({ gcsPath }));
  }

  delete(gcsPath: string): Promise<Result<void, InboxError>> {
    this.files.delete(gcsPath);
    return Promise.resolve(ok(undefined));
  }

  getSignedUrl(gcsPath: string, _ttlSeconds?: number): Promise<Result<string, InboxError>> {
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
  }
}

/**
 * Fake event publisher for testing.
 */
export class FakeEventPublisher implements EventPublisherPort {
  private mediaCleanupEvents: MediaCleanupEvent[] = [];

  publishMediaCleanup(event: MediaCleanupEvent): Promise<Result<void, InboxError>> {
    this.mediaCleanupEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  getMediaCleanupEvents(): MediaCleanupEvent[] {
    return [...this.mediaCleanupEvents];
  }

  clear(): void {
    this.mediaCleanupEvents = [];
  }
}

/**
 * Fake message sender for testing.
 */
export class FakeMessageSender implements WhatsAppMessageSender {
  private sentMessages: { phoneNumber: string; message: string }[] = [];

  sendTextMessage(phoneNumber: string, message: string): Promise<Result<void, InboxError>> {
    this.sentMessages.push({ phoneNumber, message });
    return Promise.resolve(ok(undefined));
  }

  getSentMessages(): { phoneNumber: string; message: string }[] {
    return [...this.sentMessages];
  }

  clear(): void {
    this.sentMessages = [];
  }
}

/**
 * Fake speech transcription service for testing.
 */
export class FakeSpeechTranscriptionPort implements SpeechTranscriptionPort {
  private jobs = new Map<
    string,
    { status: 'running' | 'done' | 'rejected'; transcript?: string; error?: string }
  >();
  private jobCounter = 0;
  private shouldFail = false;
  private failMessage = 'Fake transcription error';

  /**
   * Configure the fake to fail subsequent calls.
   */
  setFailMode(fail: boolean, message?: string): void {
    this.shouldFail = fail;
    if (message !== undefined) {
      this.failMessage = message;
    }
  }

  /**
   * Set job completion result (for testing polling).
   */
  setJobResult(jobId: string, transcript: string): void {
    const job = this.jobs.get(jobId);
    if (job !== undefined) {
      job.status = 'done';
      job.transcript = transcript;
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

  submitJob(
    input: TranscriptionJobInput
  ): Promise<Result<TranscriptionJobSubmitResult, TranscriptionPortError>> {
    if (this.shouldFail) {
      return Promise.resolve(
        err({
          code: 'FAKE_ERROR',
          message: this.failMessage,
          apiCall: {
            timestamp: new Date().toISOString(),
            operation: 'submit',
            success: false,
            response: { error: this.failMessage },
          },
        })
      );
    }

    this.jobCounter++;
    const jobId = `fake-job-${String(this.jobCounter)}`;
    this.jobs.set(jobId, { status: 'running' });

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
      return Promise.resolve(
        err({
          code: 'NOT_FOUND',
          message: `Transcript for job ${jobId} not found`,
          apiCall: {
            timestamp: new Date().toISOString(),
            operation: 'fetch_result',
            success: false,
          },
        })
      );
    }

    return Promise.resolve(
      ok({
        text: job.transcript,
        apiCall: {
          timestamp: new Date().toISOString(),
          operation: 'fetch_result',
          success: true,
          response: { transcriptLength: job.transcript.length },
        },
      })
    );
  }

  getJobs(): Map<
    string,
    { status: 'running' | 'done' | 'rejected'; transcript?: string; error?: string }
  > {
    return this.jobs;
  }

  clear(): void {
    this.jobs.clear();
    this.jobCounter = 0;
    this.shouldFail = false;
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
  private shouldFailGetMediaUrl = false;
  private shouldFailDownload = false;
  private shouldFailSendMessage = false;
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

  getSentMessages(): typeof this.sentMessages {
    return this.sentMessages;
  }

  getMediaUrl(mediaId: string): Promise<Result<MediaUrlInfo, InboxError>> {
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

  downloadMedia(url: string): Promise<Result<Buffer, InboxError>> {
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
  ): Promise<Result<SendMessageResult, InboxError>> {
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

  clear(): void {
    this.mediaUrls.clear();
    this.mediaContent.clear();
    this.sentMessages = [];
    this.shouldFailGetMediaUrl = false;
    this.shouldFailDownload = false;
    this.shouldFailSendMessage = false;
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

  generate(imageBuffer: Buffer): Promise<Result<ThumbnailResult, InboxError>> {
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
