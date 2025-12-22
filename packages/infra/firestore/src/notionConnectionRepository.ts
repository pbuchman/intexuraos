/**
 * Firestore implementation of NotionConnectionRepository.
 * Stores per-user Notion configuration with encrypted token.
 */
import { ok, err, type Result, getErrorMessage } from '@praxos/common';
import type {
  NotionConnectionRepository,
  NotionConnectionPublic,
  NotionError,
} from '@praxos/domain-promptvault';
import { getFirestore } from './client.js';

const COLLECTION_NAME = 'notion_connections';

/**
 * Document structure in Firestore.
 */
interface NotionConnectionDoc {
  userId: string;
  promptVaultPageId: string;
  notionToken: string; // stored but never returned
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Firestore-backed Notion connection repository.
 */
export class FirestoreNotionConnectionRepository implements NotionConnectionRepository {
  async saveConnection(
    userId: string,
    promptVaultPageId: string,
    notionToken: string
  ): Promise<Result<NotionConnectionPublic, NotionError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const now = new Date().toISOString();

      // Get existing doc to preserve createdAt
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

  async getConnection(userId: string): Promise<Result<NotionConnectionPublic | null, NotionError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return ok(null);
      }

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

  async disconnectConnection(userId: string): Promise<Result<NotionConnectionPublic, NotionError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const now = new Date().toISOString();

      const doc = await docRef.get();
      const existingData = doc.data() as NotionConnectionDoc | undefined;

      const updatedDoc: Partial<NotionConnectionDoc> = {
        connected: false,
        updatedAt: now,
      };

      await docRef.update(updatedDoc);

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

  async isConnected(userId: string): Promise<Result<boolean, NotionError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return ok(false);
      }

      const data = doc.data() as NotionConnectionDoc;
      return ok(data.connected);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to check connection: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }

  async getToken(userId: string): Promise<Result<string | null, NotionError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(userId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return ok(null);
      }

      const data = doc.data() as NotionConnectionDoc;
      if (!data.connected) {
        return ok(null);
      }

      return ok(data.notionToken);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to get token: ${getErrorMessage(error, 'Unknown Firestore error')}`,
      });
    }
  }
}
