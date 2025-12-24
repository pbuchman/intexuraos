/**
 * Firestore repository for Notion connection config.
 * Used to get user's Notion token for creating inbox notes.
 */
import { ok, err, type Result, getErrorMessage, getFirestore } from '@intexuraos/common';
import type { InboxError } from './webhookEventRepository.js';

export interface NotionConnectionPublic {
  promptVaultPageId: string;
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

interface NotionConnectionDoc extends NotionConnectionPublic {
  userId: string;
  notionToken: string;
}

const COLLECTION_NAME = 'notion_connections';

export async function getNotionToken(userId: string): Promise<Result<string | null, InboxError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
    if (!doc.exists) return ok(null);

    const data = doc.data() as NotionConnectionDoc;
    if (!data.connected) return ok(null);
    return ok(data.notionToken);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to get token: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function isNotionConnected(userId: string): Promise<Result<boolean, InboxError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
    if (!doc.exists) return ok(false);
    return ok((doc.data() as NotionConnectionDoc).connected);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to check connection: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}
