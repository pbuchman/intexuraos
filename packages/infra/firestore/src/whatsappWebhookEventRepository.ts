/**
 * Firestore implementation for storing WhatsApp webhook events.
 */
import { ok, err, type Result } from '@praxos/common';
import { getFirestore } from './client.js';
import { randomUUID } from 'node:crypto';

/**
 * Collection name for WhatsApp webhook events.
 */
const WHATSAPP_EVENTS_COLLECTION = 'whatsapp_webhook_events';

/**
 * Persisted webhook event structure.
 */
export interface WhatsAppWebhookEvent {
  /**
   * Unique event ID.
   */
  id: string;
  /**
   * Raw webhook payload from Meta.
   */
  payload: unknown;
  /**
   * Whether signature was valid.
   */
  signatureValid: boolean;
  /**
   * ISO timestamp when event was received.
   */
  receivedAt: string;
  /**
   * Phone number ID from metadata (if available).
   */
  phoneNumberId: string | null;
}

/**
 * Error type for webhook event repository operations.
 */
export interface WebhookEventError {
  code: 'INTERNAL_ERROR';
  message: string;
}

/**
 * Repository interface for WhatsApp webhook events.
 */
export interface WhatsAppWebhookEventRepository {
  /**
   * Save a webhook event to storage.
   */
  saveEvent(
    event: Omit<WhatsAppWebhookEvent, 'id'>
  ): Promise<Result<WhatsAppWebhookEvent, WebhookEventError>>;
}

/**
 * Firestore implementation of WhatsAppWebhookEventRepository.
 */
export class FirestoreWhatsAppWebhookEventRepository implements WhatsAppWebhookEventRepository {
  async saveEvent(
    event: Omit<WhatsAppWebhookEvent, 'id'>
  ): Promise<Result<WhatsAppWebhookEvent, WebhookEventError>> {
    try {
      const db = getFirestore();
      const id = randomUUID();
      const docRef = db.collection(WHATSAPP_EVENTS_COLLECTION).doc(id);

      const fullEvent: WhatsAppWebhookEvent = {
        id,
        ...event,
      };

      await docRef.set(fullEvent);
      return ok(fullEvent);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Firestore error';
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to save webhook event: ${message}`,
      });
    }
  }
}
