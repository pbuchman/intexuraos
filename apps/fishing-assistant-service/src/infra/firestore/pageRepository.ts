import { err, getErrorMessage, ok, type Logger, type Result } from '@intexuraos/common-core';
import { FieldValue, Timestamp, type Firestore } from '@intexuraos/infra-firestore';
import type { FishingContentType } from '../../domain/chunking/types.js';
import type { KnowledgeIndexingStatus, KnowledgePage } from '../../domain/models/knowledge.js';
import type {
  DeletePageForUserInput,
  FindPageByIdForUserInput,
  KnowledgePageCreateInput,
  KnowledgePageUpdateInput,
  ListPagesByUserInput,
  KnowledgePageRepository,
  KnowledgeRepositoryError,
} from '../../domain/ports/knowledgeRepositories.js';
import {
  FISHING_KNOWLEDGE_CHUNKS_COLLECTION,
  FISHING_KNOWLEDGE_FOLDERS_COLLECTION,
  FISHING_KNOWLEDGE_PAGES_COLLECTION,
} from './collections.js';

export interface FirestorePageRepositoryDeps {
  firestore: Firestore;
  logger: Logger;
}

function toTimestamp(value: unknown): Timestamp {
  return value instanceof Timestamp ? value : Timestamp.fromMillis(0);
}

function toContentType(value: unknown): FishingContentType {
  return typeof value === 'string' ? (value as FishingContentType) : 'other';
}

function toIndexingStatus(value: unknown): KnowledgeIndexingStatus {
  if (value === 'pending' || value === 'ready' || value === 'failed') {
    return value;
  }
  return 'pending';
}

function toKnowledgePage(id: string, data: Record<string, unknown>): KnowledgePage {
  const page: KnowledgePage = {
    id,
    userId: data['userId'] as string,
    folderId: typeof data['folderId'] === 'string' ? data['folderId'] : '',
    title: typeof data['title'] === 'string' ? data['title'] : '',
    rawText: typeof data['rawText'] === 'string' ? data['rawText'] : '',
    normalizedText: typeof data['normalizedText'] === 'string' ? data['normalizedText'] : '',
    contentType: toContentType(data['contentType']),
    indexingStatus: toIndexingStatus(data['indexingStatus']),
    chunkCount: typeof data['chunkCount'] === 'number' ? data['chunkCount'] : 0,
    createdAt: toTimestamp(data['createdAt']),
    updatedAt: toTimestamp(data['updatedAt']),
  };

  if (typeof data['indexingError'] === 'string') {
    page.indexingError = data['indexingError'];
  }

  return page;
}

function toPageWrite(input: KnowledgePageCreateInput, now: Timestamp): Record<string, unknown> {
  return {
    userId: input.userId,
    folderId: input.folderId,
    title: input.title,
    rawText: input.rawText,
    normalizedText: input.normalizedText,
    contentType: input.contentType,
    indexingStatus: input.indexingStatus,
    chunkCount: input.chunkCount,
    ...(input.indexingError !== undefined ? { indexingError: input.indexingError } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

export class FirestorePageRepository implements KnowledgePageRepository {
  private readonly firestore: Firestore;
  private readonly logger: Logger;

  constructor(deps: FirestorePageRepositoryDeps) {
    this.firestore = deps.firestore;
    this.logger = deps.logger;
  }

  async create(input: KnowledgePageCreateInput): Promise<Result<KnowledgePage, KnowledgeRepositoryError>> {
    try {
      const now = Timestamp.now();
      const pageRef = this.firestore.collection(FISHING_KNOWLEDGE_PAGES_COLLECTION).doc(input.id);
      const folderRef = this.firestore.collection(FISHING_KNOWLEDGE_FOLDERS_COLLECTION).doc(input.folderId);

      await this.firestore.runTransaction(async (transaction) => {
        const folderDoc = await transaction.get(folderRef);
        const folderData = folderDoc.data() as Record<string, unknown> | undefined;
        if (!folderDoc.exists || folderData?.['userId'] !== input.userId) {
          throw new Error(`Fishing knowledge folder ${input.folderId} not found`);
        }

        const currentCount = typeof folderData['pageCount'] === 'number' ? folderData['pageCount'] : 0;
        transaction.set(pageRef, toPageWrite(input, now));
        transaction.update(folderRef, {
          pageCount: currentCount + 1,
          updatedAt: now,
        });
      });

      return ok({
        id: input.id,
        userId: input.userId,
        folderId: input.folderId,
        title: input.title,
        rawText: input.rawText,
        normalizedText: input.normalizedText,
        contentType: input.contentType,
        indexingStatus: input.indexingStatus,
        chunkCount: input.chunkCount,
        ...(input.indexingError !== undefined ? { indexingError: input.indexingError } : {}),
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to create fishing knowledge page');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async getByIdForUser(
    input: FindPageByIdForUserInput
  ): Promise<Result<KnowledgePage | null, KnowledgeRepositoryError>> {
    try {
      const doc = await this.firestore.collection(FISHING_KNOWLEDGE_PAGES_COLLECTION).doc(input.pageId).get();
      const data = doc.data();
      if (!doc.exists || data?.['userId'] !== input.userId) {
        return ok(null);
      }

      return ok(toKnowledgePage(doc.id, data as Record<string, unknown>));
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to load fishing knowledge page');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async listByUserId(input: ListPagesByUserInput): Promise<Result<KnowledgePage[], KnowledgeRepositoryError>> {
    try {
      let query = this.firestore
        .collection(FISHING_KNOWLEDGE_PAGES_COLLECTION)
        .where('userId', '==', input.userId);

      if (input.folderId !== undefined) {
        query = query.where('folderId', '==', input.folderId);
      }

      const snapshot = await query.orderBy('updatedAt', 'desc').get();
      return ok(snapshot.docs.map((doc) => toKnowledgePage(doc.id, doc.data() as Record<string, unknown>)));
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to list fishing knowledge pages');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async updateForUser(input: KnowledgePageUpdateInput): Promise<Result<KnowledgePage, KnowledgeRepositoryError>> {
    try {
      const pageRef = this.firestore.collection(FISHING_KNOWLEDGE_PAGES_COLLECTION).doc(input.pageId);
      const existing = await pageRef.get();
      const existingData = existing.data() as Record<string, unknown> | undefined;
      if (!existing.exists || existingData?.['userId'] !== input.userId) {
        return err({ code: 'NOT_FOUND', message: `Fishing knowledge page ${input.pageId} not found` });
      }

      const updateData: Record<string, unknown> = {
        updatedAt: Timestamp.now(),
      };

      if (input.title !== undefined) updateData['title'] = input.title;
      if (input.rawText !== undefined) updateData['rawText'] = input.rawText;
      if (input.normalizedText !== undefined) updateData['normalizedText'] = input.normalizedText;
      if (input.contentType !== undefined) updateData['contentType'] = input.contentType;
      if (input.indexingStatus !== undefined) updateData['indexingStatus'] = input.indexingStatus;
      if (input.chunkCount !== undefined) updateData['chunkCount'] = input.chunkCount;
      if (input.indexingError !== undefined) {
        updateData['indexingError'] = input.indexingError ?? FieldValue.delete();
      }

      await pageRef.update(updateData);
      const updated = await pageRef.get();
      return ok(toKnowledgePage(updated.id, updated.data() as Record<string, unknown>));
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to update fishing knowledge page');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async deleteForUser(input: DeletePageForUserInput): Promise<Result<void, KnowledgeRepositoryError>> {
    try {
      const pageRef = this.firestore.collection(FISHING_KNOWLEDGE_PAGES_COLLECTION).doc(input.pageId);
      const pageDoc = await pageRef.get();
      const pageData = pageDoc.data() as Record<string, unknown> | undefined;
      if (!pageDoc.exists || pageData?.['userId'] !== input.userId) {
        return ok(undefined);
      }

      const folderId = typeof pageData['folderId'] === 'string' ? pageData['folderId'] : '';
      const chunkCollection = this.firestore.collection(FISHING_KNOWLEDGE_CHUNKS_COLLECTION);
      const chunksSnapshot = await chunkCollection
        .where('userId', '==', input.userId)
        .where('pageId', '==', input.pageId)
        .get();
      const batch = this.firestore.batch();
      for (const doc of chunksSnapshot.docs) {
        batch.delete(chunkCollection.doc(doc.id));
      }
      batch.delete(pageRef);
      await batch.commit();

      if (folderId !== '') {
        const folderRef = this.firestore.collection(FISHING_KNOWLEDGE_FOLDERS_COLLECTION).doc(folderId);
        await this.firestore.runTransaction(async (transaction) => {
          const folderDoc = await transaction.get(folderRef);
          const folderData = folderDoc.data() as Record<string, unknown> | undefined;
          if (!folderDoc.exists || folderData?.['userId'] !== input.userId) {
            return;
          }
          const currentCount = typeof folderData['pageCount'] === 'number' ? folderData['pageCount'] : 0;
          transaction.update(folderRef, {
            pageCount: Math.max(0, currentCount - 1),
            updatedAt: Timestamp.now(),
          });
        });
      }

      return ok(undefined);
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to delete fishing knowledge page');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }
}

export function createFirestorePageRepository(
  deps: FirestorePageRepositoryDeps
): KnowledgePageRepository {
  return new FirestorePageRepository(deps);
}
