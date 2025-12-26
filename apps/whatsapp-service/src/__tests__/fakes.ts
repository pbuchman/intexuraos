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
import { normalizePhoneNumber } from '../routes/v1/shared.js';
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
  AudioStoredEvent,
  MediaCleanupEvent,
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

  saveMessage(message: Omit<WhatsAppMessage, 'id'>): Promise<Result<WhatsAppMessage, InboxError>> {
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

  upload(
    userId: string,
    messageId: string,
    mediaId: string,
    extension: string,
    buffer: Buffer,
    contentType: string
  ): Promise<Result<UploadResult, InboxError>> {
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
  private audioStoredEvents: AudioStoredEvent[] = [];
  private mediaCleanupEvents: MediaCleanupEvent[] = [];

  publishAudioStored(event: AudioStoredEvent): Promise<Result<void, InboxError>> {
    this.audioStoredEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  publishMediaCleanup(event: MediaCleanupEvent): Promise<Result<void, InboxError>> {
    this.mediaCleanupEvents.push(event);
    return Promise.resolve(ok(undefined));
  }

  getAudioStoredEvents(): AudioStoredEvent[] {
    return [...this.audioStoredEvents];
  }

  getMediaCleanupEvents(): MediaCleanupEvent[] {
    return [...this.mediaCleanupEvents];
  }

  clear(): void {
    this.audioStoredEvents = [];
    this.mediaCleanupEvents = [];
  }
}
