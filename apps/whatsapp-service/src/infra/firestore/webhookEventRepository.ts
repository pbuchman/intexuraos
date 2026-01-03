/**
 * Firestore repository for WhatsApp webhook events.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import { randomUUID } from 'node:crypto';

export type WebhookProcessingStatus =
  | 'PENDING'
  | 'PROCESSED'
  | 'IGNORED'
  | 'USER_UNMAPPED'
  | 'FAILED';

export interface IgnoredReason {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface WhatsAppWebhookEvent {
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
 * Error type for inbox operations.
 * Intentionally matches domain WhatsAppError for structural compatibility.
 */
export interface WhatsAppError {
  code: 'NOT_FOUND' | 'VALIDATION_ERROR' | 'PERSISTENCE_ERROR' | 'INTERNAL_ERROR';
  message: string;
  details?: Record<string, unknown>;
}

const WHATSAPP_EVENTS_COLLECTION = 'whatsapp_webhook_events';

export async function saveWebhookEvent(
  event: Omit<WhatsAppWebhookEvent, 'id'>
): Promise<Result<WhatsAppWebhookEvent, WhatsAppError>> {
  try {
    const db = getFirestore();
    const id = randomUUID();
    const docRef = db.collection(WHATSAPP_EVENTS_COLLECTION).doc(id);
    const fullEvent: WhatsAppWebhookEvent = { id, ...event };
    await docRef.set(fullEvent);
    return ok(fullEvent);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to save webhook event: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function updateWebhookEventStatus(
  eventId: string,
  status: WebhookProcessingStatus,
  metadata: {
    ignoredReason?: IgnoredReason;
    failureDetails?: string;
    inboxNoteId?: string;
  }
): Promise<Result<WhatsAppWebhookEvent, WhatsAppError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(WHATSAPP_EVENTS_COLLECTION).doc(eventId);

    const update: Partial<WhatsAppWebhookEvent> = {
      status,
      processedAt: new Date().toISOString(),
    };

    if (metadata.ignoredReason !== undefined) update.ignoredReason = metadata.ignoredReason;
    if (metadata.failureDetails !== undefined) update.failureDetails = metadata.failureDetails;
    if (metadata.inboxNoteId !== undefined) update.inboxNoteId = metadata.inboxNoteId;

    await docRef.update(update);

    const doc = await docRef.get();
    const data = doc.data() as WhatsAppWebhookEvent;
    return ok(data);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to update webhook event: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function getWebhookEvent(
  eventId: string
): Promise<Result<WhatsAppWebhookEvent | null, WhatsAppError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(WHATSAPP_EVENTS_COLLECTION).doc(eventId).get();
    if (!doc.exists) return ok(null);
    return ok(doc.data() as WhatsAppWebhookEvent);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to get webhook event: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}
