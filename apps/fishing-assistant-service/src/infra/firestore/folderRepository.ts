import { err, getErrorMessage, ok, type Logger, type Result } from '@intexuraos/common-core';
import { Timestamp, type Firestore } from '@intexuraos/infra-firestore';
import type { KnowledgeFolder } from '../../domain/models/knowledge.js';
import type {
  FindByIdForUserInput,
  KnowledgeFolderCreateInput,
  KnowledgeFolderRepository,
  KnowledgeRepositoryError,
} from '../../domain/ports/knowledgeRepositories.js';
import { FISHING_KNOWLEDGE_FOLDERS_COLLECTION } from './collections.js';

export interface FirestoreFolderRepositoryDeps {
  firestore: Firestore;
  logger: Logger;
}

function toTimestamp(value: unknown): Timestamp {
  return value instanceof Timestamp ? value : Timestamp.fromMillis(0);
}

function toKnowledgeFolder(id: string, data: Record<string, unknown>): KnowledgeFolder {
  return {
    id,
    userId: data['userId'] as string,
    name: typeof data['name'] === 'string' ? data['name'] : '',
    parentId: typeof data['parentId'] === 'string' ? data['parentId'] : null,
    sortOrder: typeof data['sortOrder'] === 'number' ? data['sortOrder'] : 0,
    pageCount: typeof data['pageCount'] === 'number' ? data['pageCount'] : 0,
    createdAt: toTimestamp(data['createdAt']),
    updatedAt: toTimestamp(data['updatedAt']),
  };
}

export class FirestoreFolderRepository implements KnowledgeFolderRepository {
  private readonly firestore: Firestore;
  private readonly logger: Logger;

  constructor(deps: FirestoreFolderRepositoryDeps) {
    this.firestore = deps.firestore;
    this.logger = deps.logger;
  }

  async create(
    input: KnowledgeFolderCreateInput
  ): Promise<Result<KnowledgeFolder, KnowledgeRepositoryError>> {
    const now = Timestamp.now();
    const folder: KnowledgeFolder = {
      ...input,
      pageCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.firestore.collection(FISHING_KNOWLEDGE_FOLDERS_COLLECTION).doc(input.id).set(folder);
      return ok(folder);
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to create fishing knowledge folder');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async getByIdForUser(
    input: FindByIdForUserInput
  ): Promise<Result<KnowledgeFolder | null, KnowledgeRepositoryError>> {
    try {
      const doc = await this.firestore.collection(FISHING_KNOWLEDGE_FOLDERS_COLLECTION).doc(input.folderId).get();
      const data = doc.data();
      if (!doc.exists || data?.['userId'] !== input.userId) {
        return ok(null);
      }

      return ok(toKnowledgeFolder(doc.id, data as Record<string, unknown>));
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to load fishing knowledge folder');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async listByUserId(userId: string): Promise<Result<KnowledgeFolder[], KnowledgeRepositoryError>> {
    try {
      const snapshot = await this.firestore
        .collection(FISHING_KNOWLEDGE_FOLDERS_COLLECTION)
        .where('userId', '==', userId)
        .orderBy('sortOrder', 'desc')
        .get();

      return ok(snapshot.docs.map((doc) => toKnowledgeFolder(doc.id, doc.data() as Record<string, unknown>)));
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), userId }, 'Failed to list fishing knowledge folders');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async adjustPageCount(input: {
    userId: string;
    folderId: string;
    delta: number;
  }): Promise<Result<void, KnowledgeRepositoryError>> {
    try {
      const folderRef = this.firestore.collection(FISHING_KNOWLEDGE_FOLDERS_COLLECTION).doc(input.folderId);
      await this.firestore.runTransaction(async (transaction) => {
        const doc = await transaction.get(folderRef);
        const data = doc.data() as Record<string, unknown> | undefined;
        if (!doc.exists || data?.['userId'] !== input.userId) {
          throw new Error(`Fishing knowledge folder ${input.folderId} not found`);
        }

        const currentCount = typeof data['pageCount'] === 'number' ? data['pageCount'] : 0;
        transaction.update(folderRef, {
          pageCount: Math.max(0, currentCount + input.delta),
          updatedAt: Timestamp.now(),
        });
      });

      return ok(undefined);
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to adjust fishing knowledge folder page count');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }
}

export function createFirestoreFolderRepository(
  deps: FirestoreFolderRepositoryDeps
): KnowledgeFolderRepository {
  return new FirestoreFolderRepository(deps);
}
