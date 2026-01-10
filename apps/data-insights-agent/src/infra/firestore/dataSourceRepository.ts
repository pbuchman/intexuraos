/**
 * Firestore implementation of DataSourceRepository.
 * Stores user-uploaded custom data sources.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  CreateDataSourceRequest,
  DataSource,
  DataSourceRepository,
  UpdateDataSourceRequest,
} from '../../domain/dataSource/index.js';

const COLLECTION_NAME = 'custom_data_sources';

/**
 * Document structure in Firestore.
 */
interface DataSourceDoc {
  userId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Convert Firestore document to domain model.
 */
function toDataSource(id: string, doc: DataSourceDoc): DataSource {
  return {
    id,
    userId: doc.userId,
    title: doc.title,
    content: doc.content,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  };
}

/**
 * Firestore-backed data source repository.
 */
export class FirestoreDataSourceRepository implements DataSourceRepository {
  async create(
    userId: string,
    request: CreateDataSourceRequest
  ): Promise<Result<DataSource, string>> {
    try {
      const db = getFirestore();
      const now = new Date().toISOString();

      const doc: DataSourceDoc = {
        userId,
        title: request.title,
        content: request.content,
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await db.collection(COLLECTION_NAME).add(doc);

      return ok(toDataSource(docRef.id, doc));
    } catch (error) {
      return err(
        `Failed to create data source: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async getById(id: string, userId: string): Promise<Result<DataSource | null, string>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return ok(null);
      }

      const data = snapshot.data() as DataSourceDoc;

      if (data.userId !== userId) {
        return ok(null);
      }

      return ok(toDataSource(id, data));
    } catch (error) {
      return err(`Failed to get data source: ${getErrorMessage(error, 'Unknown Firestore error')}`);
    }
  }

  async listByUserId(userId: string): Promise<Result<DataSource[], string>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('userId', '==', userId)
        .orderBy('updatedAt', 'desc')
        .get();

      const dataSources = snapshot.docs.map((doc) =>
        toDataSource(doc.id, doc.data() as DataSourceDoc)
      );

      return ok(dataSources);
    } catch (error) {
      return err(
        `Failed to list data sources: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async update(
    id: string,
    userId: string,
    request: UpdateDataSourceRequest
  ): Promise<Result<DataSource, string>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return err('Data source not found');
      }

      const data = snapshot.data() as DataSourceDoc;

      if (data.userId !== userId) {
        return err('Data source not found');
      }

      const now = new Date().toISOString();
      const updates: Partial<DataSourceDoc> = {
        updatedAt: now,
      };

      if (request.title !== undefined) {
        updates.title = request.title;
      }

      if (request.content !== undefined) {
        updates.content = request.content;
      }

      await docRef.update(updates);

      const updatedDoc: DataSourceDoc = {
        ...data,
        ...updates,
      };

      return ok(toDataSource(id, updatedDoc));
    } catch (error) {
      return err(
        `Failed to update data source: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }

  async delete(id: string, userId: string): Promise<Result<void, string>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return err('Data source not found');
      }

      const data = snapshot.data() as DataSourceDoc;

      if (data.userId !== userId) {
        return err('Data source not found');
      }

      await docRef.delete();

      return ok(undefined);
    } catch (error) {
      return err(
        `Failed to delete data source: ${getErrorMessage(error, 'Unknown Firestore error')}`
      );
    }
  }
}
