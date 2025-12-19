/**
 * In-memory test fake for WhatsAppWebhookEventRepository.
 */
import { ok, type Result } from '@praxos/common';
import type {
  WhatsAppWebhookEvent,
  WhatsAppWebhookEventRepository,
  WebhookEventError,
} from '../whatsappWebhookEventRepository.js';
import { randomUUID } from 'node:crypto';

/**
 * In-memory fake implementation of WhatsAppWebhookEventRepository.
 * Mimics Firestore behavior for deterministic testing.
 */
export class FakeWhatsAppWebhookEventRepository implements WhatsAppWebhookEventRepository {
  private events = new Map<string, WhatsAppWebhookEvent>();

  async saveEvent(
    event: Omit<WhatsAppWebhookEvent, 'id'>
  ): Promise<Result<WhatsAppWebhookEvent, WebhookEventError>> {
    const id = randomUUID();
    const fullEvent: WhatsAppWebhookEvent = {
      id,
      ...event,
    };

    this.events.set(id, fullEvent);
    return await Promise.resolve(ok(fullEvent));
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
