/**
 * Firestore implementation of VisualizationRepository.
 * Stores saved visualization configurations and computed chart data.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  Visualization,
  VisualizationRepository,
  VisualizationUpdateFields,
} from '../../domain/visualization/index.js';

const COLLECTION_NAME = 'visualizations';

interface VisualizationDoc {
  userId: string;
  feedId: string;
  feedName: string;
  insightId: string;
  insightTitle: string;
  trackableMetric: string;
  chartConfig: object;
  transformInstructions: string;
  chartData: object[] | null;
  status: string;
  lastError: string | null;
  lastRefreshedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toVisualization(id: string, doc: VisualizationDoc): Visualization {
  return {
    id,
    userId: doc.userId,
    feedId: doc.feedId,
    feedName: doc.feedName,
    insightId: doc.insightId,
    insightTitle: doc.insightTitle,
    trackableMetric: doc.trackableMetric,
    chartConfig: doc.chartConfig,
    transformInstructions: doc.transformInstructions,
    chartData: doc.chartData,
    status: doc.status as Visualization['status'],
    ...(doc.lastError !== null && { lastError: doc.lastError }),
    ...(doc.lastRefreshedAt !== null && { lastRefreshedAt: new Date(doc.lastRefreshedAt) }),
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  };
}

export class FirestoreVisualizationRepository implements VisualizationRepository {
  async create(
    viz: Omit<Visualization, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Result<Visualization, string>> {
    try {
      const db = getFirestore();
      const now = new Date();

      const doc: VisualizationDoc = {
        userId: viz.userId,
        feedId: viz.feedId,
        feedName: viz.feedName,
        insightId: viz.insightId,
        insightTitle: viz.insightTitle,
        trackableMetric: viz.trackableMetric,
        chartConfig: viz.chartConfig,
        transformInstructions: viz.transformInstructions,
        chartData: viz.chartData as object[] | null,
        status: viz.status,
        lastError: viz.lastError ?? null,
        lastRefreshedAt: viz.lastRefreshedAt?.toISOString() ?? null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      const docRef = await db.collection(COLLECTION_NAME).add(doc);

      return ok(toVisualization(docRef.id, doc));
    } catch (error) {
      return err(
        `Failed to create visualization: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async getById(id: string, userId: string): Promise<Result<Visualization | null, string>> {
    try {
      const db = getFirestore();
      const snapshot = await db.collection(COLLECTION_NAME).doc(id).get();

      if (!snapshot.exists) {
        return ok(null);
      }

      const data = snapshot.data() as VisualizationDoc;

      if (data.userId !== userId) {
        return ok(null);
      }

      return ok(toVisualization(snapshot.id, data));
    } catch (error) {
      return err(
        `Failed to get visualization: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async getByIdInternal(id: string): Promise<Result<Visualization | null, string>> {
    try {
      const db = getFirestore();
      const snapshot = await db.collection(COLLECTION_NAME).doc(id).get();

      if (!snapshot.exists) {
        return ok(null);
      }

      return ok(toVisualization(snapshot.id, snapshot.data() as VisualizationDoc));
    } catch (error) {
      return err(
        `Failed to get visualization: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async listByUserId(userId: string): Promise<Result<Visualization[], string>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .get();

      const visualizations = snapshot.docs.map((doc) =>
        toVisualization(doc.id, doc.data() as VisualizationDoc)
      );

      return ok(visualizations);
    } catch (error) {
      return err(
        `Failed to list visualizations: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async listByFeedId(feedId: string): Promise<Result<Visualization[], string>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('feedId', '==', feedId)
        .orderBy('createdAt', 'desc')
        .get();

      const visualizations = snapshot.docs.map((doc) =>
        toVisualization(doc.id, doc.data() as VisualizationDoc)
      );

      return ok(visualizations);
    } catch (error) {
      return err(
        `Failed to list visualizations by feed: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async update(
    id: string,
    fields: VisualizationUpdateFields
  ): Promise<Result<Visualization, string>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return err('Visualization not found');
      }

      const now = new Date();
      const updateData: Record<string, unknown> = {
        updatedAt: now.toISOString(),
      };

      if (fields.status !== undefined) {
        updateData['status'] = fields.status;
      }
      if (fields.chartData !== undefined) {
        updateData['chartData'] = fields.chartData;
      }
      if (fields.lastError !== undefined) {
        updateData['lastError'] = fields.lastError;
      }
      if (fields.lastRefreshedAt !== undefined) {
        updateData['lastRefreshedAt'] = fields.lastRefreshedAt.toISOString();
      }

      await docRef.update(updateData);

      const updated = await docRef.get();
      return ok(toVisualization(id, updated.data() as VisualizationDoc));
    } catch (error) {
      return err(
        `Failed to update visualization: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async delete(id: string, userId: string): Promise<Result<void, string>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return ok(undefined);
      }

      const data = snapshot.data() as VisualizationDoc;

      if (data.userId !== userId) {
        return ok(undefined);
      }

      await docRef.delete();
      return ok(undefined);
    } catch (error) {
      return err(
        `Failed to delete visualization: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async deleteByFeedId(feedId: string): Promise<Result<void, string>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('feedId', '==', feedId)
        .get();

      if (snapshot.empty) {
        return ok(undefined);
      }

      // Safe: MAX_VISUALIZATIONS_PER_FEED=10 keeps this well under Firestore's 500-op batch limit
      const batch = db.batch();
      for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();

      return ok(undefined);
    } catch (error) {
      return err(
        `Failed to delete visualizations by feed: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }
}
