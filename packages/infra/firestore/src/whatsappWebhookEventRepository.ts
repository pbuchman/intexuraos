/**
 * Firestore implementation for storing WhatsApp webhook events.
 * Implements the domain interface from @praxos/domain-inbox.
 */
import { ok, err, type Result, getErrorMessage } from '@praxos/common';
import type {
  WhatsAppWebhookEventRepository,
  WhatsAppWebhookEvent,
  WebhookProcessingStatus,
  IgnoredReason,
  InboxError,
} from '@praxos/domain-inbox';
import { getFirestore } from './client.js';
import { randomUUID } from 'node:crypto';

/**
 * Collection name for WhatsApp webhook events.
 */
const WHATSAPP_EVENTS_COLLECTION = 'whatsapp_webhook_events';

/**
 * Firestore document structure.
 */
interface WhatsAppWebhookEventDoc {
  id: string;
  payload: unknown;
  signatureValid: boolean;
  receivedAt: string;
  phoneNumberId: string | null;
  status: WebhookProcessingStatus;
  ignoredReason?: IgnoredReason;
  failureDetails?: string;
  inboxNoteId?: string;
  processedAt?: string;
}

/**
 * Firestore implementation of WhatsAppWebhookEventRepository.
 */
export class FirestoreWhatsAppWebhookEventRepository implements WhatsAppWebhookEventRepository {
  async saveEvent(
    event: Omit<WhatsAppWebhookEvent, 'id'>
  ): Promise<Result<WhatsAppWebhookEvent, InboxError>> {
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
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to save webhook event: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async updateEventStatus(
    eventId: string,
    status: WebhookProcessingStatus,
    metadata: {
      ignoredReason?: IgnoredReason;
      failureDetails?: string;
      inboxNoteId?: string;
    }
  ): Promise<Result<WhatsAppWebhookEvent, InboxError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(WHATSAPP_EVENTS_COLLECTION).doc(eventId);

      const update: Partial<WhatsAppWebhookEventDoc> = {
        status,
        processedAt: new Date().toISOString(),
      };

      if (metadata.ignoredReason !== undefined) {
        update.ignoredReason = metadata.ignoredReason;
      }
      if (metadata.failureDetails !== undefined) {
        update.failureDetails = metadata.failureDetails;
      }
      if (metadata.inboxNoteId !== undefined) {
        update.inboxNoteId = metadata.inboxNoteId;
      }

      await docRef.update(update);

      // Fetch and return updated event
      const doc = await docRef.get();
      const data = doc.data() as WhatsAppWebhookEventDoc;

      const event: WhatsAppWebhookEvent = {
        id: data.id,
        payload: data.payload,
        signatureValid: data.signatureValid,
        receivedAt: data.receivedAt,
        phoneNumberId: data.phoneNumberId,
        status: data.status,
        ...(data.ignoredReason !== undefined && { ignoredReason: data.ignoredReason }),
        ...(data.failureDetails !== undefined && { failureDetails: data.failureDetails }),
        ...(data.inboxNoteId !== undefined && { inboxNoteId: data.inboxNoteId }),
        ...(data.processedAt !== undefined && { processedAt: data.processedAt }),
      };

      return ok(event);
    } catch (error) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to update webhook event status: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async getEvent(eventId: string): Promise<Result<WhatsAppWebhookEvent | null, InboxError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(WHATSAPP_EVENTS_COLLECTION).doc(eventId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return ok(null);
      }

      const data = doc.data() as WhatsAppWebhookEventDoc;
      const event: WhatsAppWebhookEvent = {
        id: data.id,
        payload: data.payload,
        signatureValid: data.signatureValid,
        receivedAt: data.receivedAt,
        phoneNumberId: data.phoneNumberId,
        status: data.status,
        ...(data.ignoredReason !== undefined && { ignoredReason: data.ignoredReason }),
        ...(data.failureDetails !== undefined && { failureDetails: data.failureDetails }),
        ...(data.inboxNoteId !== undefined && { inboxNoteId: data.inboxNoteId }),
        ...(data.processedAt !== undefined && { processedAt: data.processedAt }),
      };
      return ok(event);
    } catch (error) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to get webhook event: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }
}
