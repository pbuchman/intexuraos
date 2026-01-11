/**
 * Firestore implementation of VisualizationRepository.
 * Stores LLM-generated data visualizations with insights and Vega-Lite specs.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  Visualization,
  VisualizationType,
  VisualizationStatus,
  VisualizationRepository,
} from '../../domain/visualization/index.js';

const COLLECTION_NAME = 'visualizations';

/**
 * Document structure in Firestore.
 */
interface VisualizationDoc {
  feedId: string;
  userId: string;
  title: string;
  description: string;
  type: VisualizationType;
  status: VisualizationStatus;
  htmlContent: string | null;
  errorMessage: string | null;
  renderErrorCount: number;
  createdAt: string;
  updatedAt: string;
  lastGeneratedAt: string | null;
}

/**
 * Convert Firestore document to domain model.
 */
function toVisualization(id: string, doc: VisualizationDoc): Visualization {
  return {
    id,
    feedId: doc.feedId,
    userId: doc.userId,
    title: doc.title,
    description: doc.description,
    type: doc.type,
    status: doc.status,
    htmlContent: doc.htmlContent,
    errorMessage: doc.errorMessage,
    renderErrorCount: doc.renderErrorCount,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
    lastGeneratedAt: doc.lastGeneratedAt !== null ? new Date(doc.lastGeneratedAt) : null,
  };
}

/**
 * Firestore-backed visualization repository.
 */
export class FirestoreVisualizationRepository implements VisualizationRepository {
  async create(
    feedId: string,
    userId: string,
    data: {
      title: string;
      description: string;
      type: VisualizationType;
    }
  ): Promise<Result<Visualization, string>> {
    try {
      const db = getFirestore();
      const now = new Date().toISOString();

      const doc: VisualizationDoc = {
        feedId,
        userId,
        title: data.title,
        description: data.description,
        type: data.type,
        status: 'pending',
        htmlContent: null,
        errorMessage: null,
        renderErrorCount: 0,
        createdAt: now,
        updatedAt: now,
        lastGeneratedAt: null,
      };

      const docRef = await db.collection(COLLECTION_NAME).add(doc);

      return ok(toVisualization(docRef.id, doc));
    } catch (error) {
      return err(
        `Failed to create visualization: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async getById(
    id: string,
    feedId: string,
    userId: string
  ): Promise<Result<Visualization | null, string>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return ok(null);
      }

      const data = snapshot.data() as VisualizationDoc;

      if (data.feedId !== feedId || data.userId !== userId) {
        return ok(null);
      }

      return ok(toVisualization(id, data));
    } catch (error) {
      return err(
        `Failed to get visualization: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async listByFeedId(feedId: string, userId: string): Promise<Result<Visualization[], string>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('feedId', '==', feedId)
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

  async update(
    id: string,
    feedId: string,
    userId: string,
    data: {
      title?: string;
      description?: string;
      type?: VisualizationType;
      status?: VisualizationStatus;
      htmlContent?: string | null;
      errorMessage?: string | null;
      renderErrorCount?: number;
      lastGeneratedAt?: Date;
    }
  ): Promise<Result<Visualization, string>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return err('Visualization not found');
      }

      const existingData = snapshot.data() as VisualizationDoc;

      if (existingData.feedId !== feedId || existingData.userId !== userId) {
        return err('Visualization not found');
      }

      const now = new Date().toISOString();
      const updates: Partial<VisualizationDoc> = {
        updatedAt: now,
      };

      if (data.title !== undefined) {
        updates.title = data.title;
      }

      if (data.description !== undefined) {
        updates.description = data.description;
      }

      if (data.type !== undefined) {
        updates.type = data.type;
      }

      if (data.status !== undefined) {
        updates.status = data.status;
      }

      if (data.htmlContent !== undefined) {
        updates.htmlContent = data.htmlContent;
      }

      if (data.errorMessage !== undefined) {
        updates.errorMessage = data.errorMessage;
      }

      if (data.renderErrorCount !== undefined) {
        updates.renderErrorCount = data.renderErrorCount;
      }

      if (data.lastGeneratedAt !== undefined) {
        updates.lastGeneratedAt = data.lastGeneratedAt.toISOString();
      }

      await docRef.update(updates);

      const updatedDoc: VisualizationDoc = {
        ...existingData,
        ...updates,
      };

      return ok(toVisualization(id, updatedDoc));
    } catch (error) {
      return err(
        `Failed to update visualization: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async delete(id: string, feedId: string, userId: string): Promise<Result<void, string>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return err('Visualization not found');
      }

      const data = snapshot.data() as VisualizationDoc;

      if (data.feedId !== feedId || data.userId !== userId) {
        return err('Visualization not found');
      }

      await docRef.delete();

      return ok(undefined);
    } catch (error) {
      return err(
        `Failed to delete visualization: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async incrementRenderErrorCount(
    id: string,
    feedId: string,
    userId: string
  ): Promise<Result<number, string>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return err('Visualization not found');
      }

      const data = snapshot.data() as VisualizationDoc;

      if (data.feedId !== feedId || data.userId !== userId) {
        return err('Visualization not found');
      }

      const newCount = data.renderErrorCount + 1;

      await docRef.update({
        renderErrorCount: newCount,
        updatedAt: new Date().toISOString(),
      });

      return ok(newCount);
    } catch (error) {
      return err(
        `Failed to increment render error count: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }
}
