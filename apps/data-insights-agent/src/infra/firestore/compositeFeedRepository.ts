/**
 * Firestore implementation of CompositeFeedRepository.
 * Stores user-created composite feeds.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  CompositeFeed,
  CompositeFeedRepository,
  CreateCompositeFeedRequest,
  NotificationFilterConfig,
  UpdateCompositeFeedRequest,
} from '../../domain/compositeFeed/index.js';
import type { DataInsight } from '../../domain/dataInsights/index.js';

const COLLECTION_NAME = 'composite_feeds';

/**
 * Document structure in Firestore.
 */
interface CompositeFeedDoc {
  userId: string;
  name: string;
  purpose: string;
  staticSourceIds: string[];
  notificationFilters: NotificationFilterConfig[];
  dataInsights: DataInsight[] | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Convert Firestore document to domain model.
 */
function toCompositeFeed(id: string, doc: CompositeFeedDoc): CompositeFeed {
  return {
    id,
    userId: doc.userId,
    name: doc.name,
    purpose: doc.purpose,
    staticSourceIds: doc.staticSourceIds,
    notificationFilters: doc.notificationFilters,
    dataInsights: doc.dataInsights,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  };
}

/**
 * Firestore-backed composite feed repository.
 */
export class FirestoreCompositeFeedRepository implements CompositeFeedRepository {
  async create(
    userId: string,
    name: string,
    request: CreateCompositeFeedRequest
  ): Promise<Result<CompositeFeed, string>> {
    try {
      const db = getFirestore();
      const now = new Date().toISOString();

      const doc: CompositeFeedDoc = {
        userId,
        name,
        purpose: request.purpose,
        staticSourceIds: request.staticSourceIds,
        notificationFilters: request.notificationFilters,
        dataInsights: null,
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await db.collection(COLLECTION_NAME).add(doc);

      return ok(toCompositeFeed(docRef.id, doc));
    } catch (error) {
      return err(
        `Failed to create composite feed: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async getById(id: string, userId: string): Promise<Result<CompositeFeed | null, string>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return ok(null);
      }

      const data = snapshot.data() as CompositeFeedDoc;

      if (data.userId !== userId) {
        return ok(null);
      }

      return ok(toCompositeFeed(id, data));
    } catch (error) {
      return err(
        `Failed to get composite feed: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async listByUserId(userId: string): Promise<Result<CompositeFeed[], string>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('userId', '==', userId)
        .orderBy('updatedAt', 'desc')
        .get();

      const feeds = snapshot.docs.map((doc) =>
        toCompositeFeed(doc.id, doc.data() as CompositeFeedDoc)
      );

      return ok(feeds);
    } catch (error) {
      return err(
        `Failed to list composite feeds: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async listAll(): Promise<Result<CompositeFeed[], string>> {
    try {
      const db = getFirestore();
      const snapshot = await db.collection(COLLECTION_NAME).orderBy('updatedAt', 'desc').get();

      const feeds = snapshot.docs.map((doc) =>
        toCompositeFeed(doc.id, doc.data() as CompositeFeedDoc)
      );

      return ok(feeds);
    } catch (error) {
      return err(
        `Failed to list all composite feeds: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async update(
    id: string,
    userId: string,
    request: UpdateCompositeFeedRequest
  ): Promise<Result<CompositeFeed, string>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return err('Composite feed not found');
      }

      const data = snapshot.data() as CompositeFeedDoc;

      if (data.userId !== userId) {
        return err('Composite feed not found');
      }

      const now = new Date().toISOString();
      const updates: Partial<CompositeFeedDoc> = {
        updatedAt: now,
      };

      if (request.purpose !== undefined) {
        updates.purpose = request.purpose;
      }

      if (request.staticSourceIds !== undefined) {
        updates.staticSourceIds = request.staticSourceIds;
        updates.dataInsights = null;
      }

      if (request.notificationFilters !== undefined) {
        updates.notificationFilters = request.notificationFilters;
        updates.dataInsights = null;
      }

      await docRef.update(updates);

      const updatedDoc: CompositeFeedDoc = {
        ...data,
        ...updates,
      };

      return ok(toCompositeFeed(id, updatedDoc));
    } catch (error) {
      return err(
        `Failed to update composite feed: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async delete(id: string, userId: string): Promise<Result<void, string>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return err('Composite feed not found');
      }

      const data = snapshot.data() as CompositeFeedDoc;

      if (data.userId !== userId) {
        return err('Composite feed not found');
      }

      await docRef.delete();

      return ok(undefined);
    } catch (error) {
      return err(
        `Failed to delete composite feed: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async findByStaticSourceId(
    userId: string,
    staticSourceId: string
  ): Promise<Result<CompositeFeed[], string>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('userId', '==', userId)
        .where('staticSourceIds', 'array-contains', staticSourceId)
        .get();

      const feeds = snapshot.docs.map((doc) =>
        toCompositeFeed(doc.id, doc.data() as CompositeFeedDoc)
      );

      return ok(feeds);
    } catch (error) {
      return err(
        `Failed to find composite feeds: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }
}
