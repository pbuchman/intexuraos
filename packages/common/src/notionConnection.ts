/**
 * Firestore repository for Notion connection config.
 * Shared between promptvault-service and notion-service.
 */
import { ok, err, type Result } from './result.js';
import { getErrorMessage } from './http/errors.js';
import { getFirestore } from './firestore.js';
import type { NotionError } from './notion.js';

/**
 * Public-facing Notion connection data (excludes sensitive token).
 */
export interface NotionConnectionPublic {
  promptVaultPageId: string;
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Internal document structure stored in Firestore.
 */
interface NotionConnectionDoc extends NotionConnectionPublic {
  userId: string;
  notionToken: string;
}

const COLLECTION_NAME = 'notion_connections';

/**
 * Save a Notion connection for a user.
 */
export async function saveNotionConnection(
  userId: string,
  promptVaultPageId: string,
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
      promptVaultPageId,
      notionToken,
      connected: true,
      createdAt: existingData?.createdAt ?? now,
      updatedAt: now,
    };

    await docRef.set(doc);

    return ok({
      promptVaultPageId: doc.promptVaultPageId,
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
      promptVaultPageId: data.promptVaultPageId,
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
      promptVaultPageId: existingData?.promptVaultPageId ?? '',
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
