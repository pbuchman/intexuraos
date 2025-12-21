/**
 * In-memory test fake for WhatsAppWebhookEventRepository.
 */
import { ok, err, type Result } from '@praxos/common';
import type {
  WhatsAppWebhookEventRepository,
  WhatsAppWebhookEvent,
  WebhookProcessingStatus,
  IgnoredReason,
  InboxError,
} from '@praxos/domain-inbox';
import { randomUUID } from 'node:crypto';

/**
 * In-memory fake implementation of WhatsAppWebhookEventRepository.
 * Mimics Firestore behavior for deterministic testing.
 */
export class FakeWhatsAppWebhookEventRepository implements WhatsAppWebhookEventRepository {
  private events = new Map<string, WhatsAppWebhookEvent>();

  async saveEvent(
    event: Omit<WhatsAppWebhookEvent, 'id'>
  ): Promise<Result<WhatsAppWebhookEvent, InboxError>> {
    const id = randomUUID();
    const fullEvent: WhatsAppWebhookEvent = {
      id,
      ...event,
    };

    this.events.set(id, fullEvent);
    return await Promise.resolve(ok(fullEvent));
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
      return Promise.resolve(
        err({
          code: 'NOT_FOUND',
          message: 'Event not found',
        })
      );
    }

    const updated: WhatsAppWebhookEvent = {
      ...event,
      status,
      processedAt: new Date().toISOString(),
      ...(metadata.ignoredReason !== undefined && { ignoredReason: metadata.ignoredReason }),
      ...(metadata.failureDetails !== undefined && { failureDetails: metadata.failureDetails }),
      ...(metadata.inboxNoteId !== undefined && { inboxNoteId: metadata.inboxNoteId }),
    };

    this.events.set(eventId, updated);
    return Promise.resolve(ok(updated));
  }

  getEvent(eventId: string): Promise<Result<WhatsAppWebhookEvent | null, InboxError>> {
    const event = this.events.get(eventId);
    return Promise.resolve(ok(event ?? null));
  }

  /**
   * Get all saved events (for testing assertions).
   */
  getAll(): WhatsAppWebhookEvent[] {
    return Array.from(this.events.values());
  }

  /**
   * Get event by ID (for testing assertions).
   */
  getById(id: string): WhatsAppWebhookEvent | undefined {
    return this.events.get(id);
  }

  /**
   * Clear all events (for test cleanup).
   */
  clear(): void {
    this.events.clear();
  }
}
