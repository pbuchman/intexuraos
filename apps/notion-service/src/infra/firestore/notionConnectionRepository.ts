/**
 * Firestore repository for Notion connection configuration.
 * Owned by notion-service - manages Notion token and connection state.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { NotionConnectionPublic, NotionError, } from '../../domain/integration/ports/ConnectionRepository.js';

/**
 * Internal document structure stored in Firestore.
 */
interface NotionConnectionDoc {
  userId: string;
  notionToken: string;
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

const COLLECTION_NAME = 'notion_connections';

/**
 * Save a Notion connection for a user.
 */
export async function saveNotionConnection(
  userId: string,
  notionToken: string
): Promise<Result<NotionConnectionPublic, NotionError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    const now = new Date().toISOString();

    const existing = await docRef.get();
    const existingData = existing.data() as NotionConnectionDoc | undefined;

    const doc: NotionConnectionDoc = {
      userId,
      notionToken,
      connected: true,
      createdAt: existingData?.createdAt ?? now,
      updatedAt: now,
    };

    await docRef.set(doc);

    return ok({
      connected: doc.connected,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to save connection: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/**
 * Get a user's Notion connection (without token).
 */
export async function getNotionConnection(
  userId: string
): Promise<Result<NotionConnectionPublic | null, NotionError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
    if (!doc.exists) return ok(null);

    const data = doc.data() as NotionConnectionDoc;
    return ok({
      connected: data.connected,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to get connection: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/**
 * Get a user's Notion token (if connected).
 */
export async function getNotionToken(userId: string): Promise<Result<string | null, NotionError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
    if (!doc.exists) return ok(null);

    const data = doc.data() as NotionConnectionDoc;
    if (!data.connected) return ok(null);
    return ok(data.notionToken);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to get token: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/**
 * Check if a user has an active Notion connection.
 */
export async function isNotionConnected(userId: string): Promise<Result<boolean, NotionError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
    if (!doc.exists) return ok(false);
    return ok((doc.data() as NotionConnectionDoc).connected);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to check connection: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/**
 * Disconnect a user's Notion connection.
 */
export async function disconnectNotion(
  userId: string
): Promise<Result<NotionConnectionPublic, NotionError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    const now = new Date().toISOString();

    const doc = await docRef.get();
    const existingData = doc.data() as NotionConnectionDoc | undefined;

    await docRef.update({ connected: false, updatedAt: now });

    return ok({
      connected: false,
      createdAt: existingData?.createdAt ?? now,
      updatedAt: now,
    });
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to disconnect: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}
