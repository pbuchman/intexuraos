/**
 * Firestore repository for WhatsApp messages.
 */
import { ok, err, type Result, getErrorMessage, getFirestore } from '@intexuraos/common';
import { randomUUID } from 'node:crypto';
import type { InboxError } from './webhookEventRepository.js';
import type { WhatsAppMessage, WhatsAppMessageMetadata } from '../../domain/inbox/index.js';

// Re-export for convenience
export type { WhatsAppMessage, WhatsAppMessageMetadata };

const COLLECTION_NAME = 'whatsapp_messages';

/**
 * Save a new WhatsApp message.
 */
export async function saveMessage(
  message: Omit<WhatsAppMessage, 'id'>
): Promise<Result<WhatsAppMessage, InboxError>> {
  try {
    const db = getFirestore();
    const id = randomUUID();
    const docRef = db.collection(COLLECTION_NAME).doc(id);
    const fullMessage: WhatsAppMessage = { id, ...message };
    await docRef.set(fullMessage);
    return ok(fullMessage);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to save message: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/**
 * Get messages for a user, ordered by receivedAt descending (newest first).
 */
export async function getMessagesByUser(
  userId: string,
  limit = 100
): Promise<Result<WhatsAppMessage[], InboxError>> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('userId', '==', userId)
      .orderBy('receivedAt', 'desc')
      .limit(limit)
      .get();

    const messages = snapshot.docs.map((doc) => doc.data() as WhatsAppMessage);
    return ok(messages);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to get messages: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/**
 * Get a single message by ID.
 */
export async function getMessage(
  messageId: string
): Promise<Result<WhatsAppMessage | null, InboxError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(messageId).get();
    if (!doc.exists) return ok(null);
    return ok(doc.data() as WhatsAppMessage);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to get message: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/**
 * Delete a message by ID.
 */
export async function deleteMessage(messageId: string): Promise<Result<void, InboxError>> {
  try {
    const db = getFirestore();
    await db.collection(COLLECTION_NAME).doc(messageId).delete();
    return ok(undefined);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to delete message: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/**
 * Find a message by user ID and message ID.
 * Verifies the message belongs to the specified user.
 */
export async function findById(
  userId: string,
  messageId: string
): Promise<Result<WhatsAppMessage | null, InboxError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(messageId).get();
    if (!doc.exists) return ok(null);

    const message = doc.data() as WhatsAppMessage;
    // Verify user ownership
    if (message.userId !== userId) return ok(null);

    return ok(message);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to find message: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/**
 * Update message transcription fields.
 */
export async function updateTranscription(
  userId: string,
  messageId: string,
  transcription: {
    transcriptionJobId: string;
    transcriptionStatus: 'pending' | 'processing' | 'completed' | 'failed';
    transcription?: string;
  }
): Promise<Result<void, InboxError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(messageId).get();

    if (!doc.exists) {
      return err({
        code: 'NOT_FOUND',
        message: 'Message not found',
      });
    }

    const message = doc.data() as WhatsAppMessage;
    if (message.userId !== userId) {
      return err({
        code: 'NOT_FOUND',
        message: 'Message not found',
      });
    }

    const updateData: Record<string, unknown> = {
      transcriptionJobId: transcription.transcriptionJobId,
      transcriptionStatus: transcription.transcriptionStatus,
    };

    if (transcription.transcription !== undefined) {
      updateData['transcription'] = transcription.transcription;
    }

    await db.collection(COLLECTION_NAME).doc(messageId).update(updateData);
    return ok(undefined);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to update transcription: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}
