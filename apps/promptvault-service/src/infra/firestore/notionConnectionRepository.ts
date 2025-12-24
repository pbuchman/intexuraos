/**
 * Firestore repository for Notion connection config.
 */
import { ok, err, type Result, getErrorMessage, getFirestore } from '@intexuraos/common';

export interface NotionConnectionPublic {
  promptVaultPageId: string;
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotionError {
  code: 'NOT_FOUND' | 'UNAUTHORIZED' | 'INTERNAL_ERROR' | 'RATE_LIMITED' | 'VALIDATION_ERROR';
  message: string;
}

interface NotionConnectionDoc extends NotionConnectionPublic {
  userId: string;
  notionToken: string;
}

const COLLECTION_NAME = 'notion_connections';

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
