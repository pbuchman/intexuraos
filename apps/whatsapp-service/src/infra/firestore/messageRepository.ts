/**
 * Firestore repository for WhatsApp messages.
 */
import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import { randomUUID } from 'node:crypto';
import type { InboxError } from './webhookEventRepository.js';
import type {
  WhatsAppMessage,
  WhatsAppMessageMetadata,
  TranscriptionState,
  LinkPreviewState,
} from '../../domain/inbox/index.js';

// Re-export for convenience
export type { WhatsAppMessage, WhatsAppMessageMetadata };

const COLLECTION_NAME = 'whatsapp_messages';

/**
 * Decode a cursor string to pagination data.
 */
function decodeCursor(cursor: string | undefined): { receivedAt: string; id: string } | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded) as { receivedAt?: string; id?: string };
    if (typeof parsed.receivedAt === 'string' && typeof parsed.id === 'string') {
      return { receivedAt: parsed.receivedAt, id: parsed.id };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Encode pagination data to a cursor string.
 */
function encodeCursor(receivedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ receivedAt, id })).toString('base64');
}

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
 * Supports cursor-based pagination.
 */
export async function getMessagesByUser(
  userId: string,
  options: { limit?: number; cursor?: string } = {}
): Promise<Result<{ messages: WhatsAppMessage[]; nextCursor?: string }, InboxError>> {
  const limit = options.limit ?? 50;

  try {
    const db = getFirestore();
    let query = db
      .collection(COLLECTION_NAME)
      .where('userId', '==', userId)
      .orderBy('receivedAt', 'desc');

    // Apply cursor if provided
    const cursorData = decodeCursor(options.cursor);
    if (cursorData !== undefined) {
      query = query.startAfter(cursorData.receivedAt);
    }

    // Fetch one extra to determine if there are more results
    const snapshot = await query.limit(limit + 1).get();

    const docs = snapshot.docs;
    const hasMore = docs.length > limit;

    // Take only the requested number of results
    const resultDocs = hasMore ? docs.slice(0, limit) : docs;

    const messages = resultDocs.map((doc) => doc.data() as WhatsAppMessage);

    const result: { messages: WhatsAppMessage[]; nextCursor?: string } = { messages };

    // Set next cursor if there are more results
    if (hasMore && resultDocs.length > 0) {
      const lastDoc = resultDocs[resultDocs.length - 1];
      if (lastDoc !== undefined) {
        const lastData = lastDoc.data() as WhatsAppMessage;
        result.nextCursor = encodeCursor(lastData.receivedAt, lastDoc.id);
      }
    }

    return ok(result);
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
 * Update message transcription state.
 */
export async function updateTranscription(
  userId: string,
  messageId: string,
  transcription: TranscriptionState
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

    await db.collection(COLLECTION_NAME).doc(messageId).update({
      transcription,
    });
    return ok(undefined);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to update transcription: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/**
 * Update message link preview state.
 */
export async function updateLinkPreview(
  userId: string,
  messageId: string,
  linkPreview: LinkPreviewState
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

    await db.collection(COLLECTION_NAME).doc(messageId).update({
      linkPreview,
    });
    return ok(undefined);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to update link preview: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}
