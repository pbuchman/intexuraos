/**
 * Fake repositories for testing.
 *
 * These fakes implement the domain port interfaces but use in-memory storage.
 * They are designed to be exercised by route tests and use case tests.
 *
 * Coverage note: Some methods may show low coverage until all Tier 1 test issues
 * are completed (see docs/todo/1-4-whatsapp-webhook-usecase.md, 1-5-whatsapp-routes.md).
 */
import type { Result } from '@praxos/common';
import { ok, err } from '@praxos/common';
import type {
  WhatsAppWebhookEventRepository,
  WhatsAppUserMappingRepository,
  WhatsAppWebhookEvent,
  WebhookProcessingStatus,
  IgnoredReason,
  WhatsAppUserMappingPublic,
  InboxError,
} from '../domain/inbox/index.js';
import { randomUUID } from 'node:crypto';

/**
 * Fake WhatsApp webhook event repository for testing.
 */
export class FakeWhatsAppWebhookEventRepository implements WhatsAppWebhookEventRepository {
  private events = new Map<string, WhatsAppWebhookEvent>();

  saveEvent(
    event: Omit<WhatsAppWebhookEvent, 'id'>
  ): Promise<Result<WhatsAppWebhookEvent, InboxError>> {
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
    phoneNumbers: string[],
    inboxNotesDbId: string
  ): Promise<Result<WhatsAppUserMappingPublic, InboxError>> {
    const now = new Date().toISOString();
    const mapping = {
      userId,
      phoneNumbers,
      inboxNotesDbId,
      connected: true,
      createdAt: now,
      updatedAt: now,
    };
    this.mappings.set(userId, mapping);
    for (const phone of phoneNumbers) {
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
    return Promise.resolve(ok(this.phoneIndex.get(phoneNumber) ?? null));
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
 * Fake Notion connection repository for testing.
 */
export class FakeNotionConnectionRepository {
  private connections = new Map<string, { token: string; connected: boolean }>();

  getToken(userId: string): Promise<Result<string | null, InboxError>> {
    const conn = this.connections.get(userId);
    if (conn?.connected !== true) return Promise.resolve(ok(null));
    return Promise.resolve(ok(conn.token));
  }

  setConnection(userId: string, token: string, connected = true): void {
    this.connections.set(userId, { token, connected });
  }

  clear(): void {
    this.connections.clear();
  }
}
