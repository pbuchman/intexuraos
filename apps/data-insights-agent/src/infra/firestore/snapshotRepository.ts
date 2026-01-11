/**
 * Firestore implementation of SnapshotRepository.
 * Stores pre-computed composite feed snapshots.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { CompositeFeedData } from '../../domain/compositeFeed/schemas/index.js';
import type { DataInsightSnapshot, SnapshotRepository } from '../../domain/snapshot/index.js';
import { SNAPSHOT_TTL_MS } from '../../domain/snapshot/models/index.js';

const COLLECTION_NAME = 'composite_feed_snapshots';

/**
 * Document structure in Firestore.
 */
interface SnapshotDoc {
  userId: string;
  feedId: string;
  feedName: string;
  data: CompositeFeedData;
  generatedAt: string;
  expiresAt: string;
}

/**
 * Convert Firestore document to domain model.
 */
function toSnapshot(id: string, doc: SnapshotDoc): DataInsightSnapshot {
  return {
    id,
    userId: doc.userId,
    feedId: doc.feedId,
    feedName: doc.feedName,
    data: doc.data,
    generatedAt: new Date(doc.generatedAt),
    expiresAt: new Date(doc.expiresAt),
  };
}

/**
 * Firestore-backed snapshot repository.
 */
export class FirestoreSnapshotRepository implements SnapshotRepository {
  async getByFeedId(feedId: string, userId: string): Promise<Result<DataInsightSnapshot | null, string>> {
    try {
      const db = getFirestore();
      const snapshot = await db.collection(COLLECTION_NAME).doc(feedId).get();

      if (!snapshot.exists) {
        return ok(null);
      }

      const data = snapshot.data() as SnapshotDoc;

      if (data.userId !== userId) {
        return ok(null);
      }

      return ok(toSnapshot(snapshot.id, data));
    } catch (error) {
      return err(
        `Failed to get snapshot: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async upsert(
    feedId: string,
    userId: string,
    feedName: string,
    data: CompositeFeedData
  ): Promise<Result<DataInsightSnapshot, string>> {
    try {
      const db = getFirestore();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SNAPSHOT_TTL_MS);

      const doc: SnapshotDoc = {
        userId,
        feedId,
        feedName,
        data,
        generatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };

      await db.collection(COLLECTION_NAME).doc(feedId).set(doc);

      return ok(toSnapshot(feedId, doc));
    } catch (error) {
      return err(
        `Failed to upsert snapshot: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async delete(feedId: string, userId: string): Promise<Result<void, string>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(feedId);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return ok(undefined);
      }

      const data = snapshot.data() as SnapshotDoc;

      if (data.userId !== userId) {
        return ok(undefined);
      }

      await docRef.delete();
      return ok(undefined);
    } catch (error) {
      return err(
        `Failed to delete snapshot: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async deleteByFeedId(feedId: string): Promise<Result<void, string>> {
    try {
      const db = getFirestore();
      await db.collection(COLLECTION_NAME).doc(feedId).delete();
      return ok(undefined);
    } catch (error) {
      return err(
        `Failed to delete snapshot by feed ID: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async listByUserId(userId: string): Promise<Result<DataInsightSnapshot[], string>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('userId', '==', userId)
        .orderBy('generatedAt', 'desc')
        .get();

      const snapshots = snapshot.docs.map((doc) =>
        toSnapshot(doc.id, doc.data() as SnapshotDoc)
      );

      return ok(snapshots);
    } catch (error) {
      return err(
        `Failed to list snapshots: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }
}
