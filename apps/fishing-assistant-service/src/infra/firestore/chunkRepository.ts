import { err, getErrorMessage, ok, type Logger, type Result } from '@intexuraos/common-core';
import { FieldValue, Timestamp, type Firestore } from '@intexuraos/infra-firestore';
import type { FishingContentType } from '../../domain/chunking/types.js';
import type { KnowledgeChunk, KnowledgeChunkMatch } from '../../domain/models/knowledge.js';
import type {
  FindChunksByPageIdInput,
  FindNearestChunksInput,
  KnowledgeChunkCreateInput,
  KnowledgeChunkRepository,
  KnowledgeRepositoryError,
  ReplaceChunksForPageInput,
} from '../../domain/ports/knowledgeRepositories.js';
import { FISHING_KNOWLEDGE_CHUNKS_COLLECTION } from './collections.js';

export interface FirestoreChunkRepositoryDeps {
  firestore: Firestore;
  logger: Logger;
}

function toTimestamp(value: unknown): Timestamp {
  return value instanceof Timestamp ? value : Timestamp.fromMillis(0);
}

function toContentType(value: unknown): FishingContentType {
  return typeof value === 'string' ? (value as FishingContentType) : 'other';
}

function toKnowledgeChunk(id: string, data: Record<string, unknown>): KnowledgeChunk {
  return {
    id,
    userId: data['userId'] as string,
    pageId: data['pageId'] as string,
    folderId: typeof data['folderId'] === 'string' ? data['folderId'] : '',
    title: typeof data['title'] === 'string' ? data['title'] : '',
    heading: typeof data['heading'] === 'string' ? data['heading'] : null,
    index: typeof data['index'] === 'number' ? data['index'] : 0,
    text: typeof data['text'] === 'string' ? data['text'] : '',
    searchableText: typeof data['searchableText'] === 'string' ? data['searchableText'] : '',
    contentType: toContentType(data['contentType']),
    embeddingModel: typeof data['embeddingModel'] === 'string' ? data['embeddingModel'] : '',
    createdAt: toTimestamp(data['createdAt']),
  };
}

function toChunkWrite(input: KnowledgeChunkCreateInput, createdAt: Timestamp): Record<string, unknown> {
  return {
    userId: input.userId,
    pageId: input.pageId,
    folderId: input.folderId,
    title: input.title,
    heading: input.heading,
    index: input.index,
    text: input.text,
    searchableText: input.searchableText,
    contentType: input.contentType,
    embedding: FieldValue.vector(input.embedding),
    embeddingModel: input.embeddingModel,
    createdAt,
  };
}

export class FirestoreChunkRepository implements KnowledgeChunkRepository {
  private readonly firestore: Firestore;
  private readonly logger: Logger;

  constructor(deps: FirestoreChunkRepositoryDeps) {
    this.firestore = deps.firestore;
    this.logger = deps.logger;
  }

  async replaceForPage(input: ReplaceChunksForPageInput): Promise<Result<void, KnowledgeRepositoryError>> {
    try {
      const collection = this.firestore.collection(FISHING_KNOWLEDGE_CHUNKS_COLLECTION);
      const existing = await collection
        .where('userId', '==', input.userId)
        .where('pageId', '==', input.pageId)
        .get();
      const batch = this.firestore.batch();

      for (const doc of existing.docs) {
        batch.delete(collection.doc(doc.id));
      }

      const now = Timestamp.now();
      for (const chunk of input.chunks) {
        batch.set(collection.doc(chunk.id), toChunkWrite(chunk, now));
      }

      await batch.commit();
      return ok(undefined);
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to replace fishing knowledge chunks');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async findByPageId(input: FindChunksByPageIdInput): Promise<Result<KnowledgeChunk[], KnowledgeRepositoryError>> {
    try {
      const snapshot = await this.firestore
        .collection(FISHING_KNOWLEDGE_CHUNKS_COLLECTION)
        .where('userId', '==', input.userId)
        .where('pageId', '==', input.pageId)
        .orderBy('index', 'asc')
        .get();

      return ok(snapshot.docs.map((doc) => toKnowledgeChunk(doc.id, doc.data() as Record<string, unknown>)));
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to load fishing knowledge chunks');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async deleteByPageId(input: FindChunksByPageIdInput): Promise<Result<void, KnowledgeRepositoryError>> {
    try {
      const collection = this.firestore.collection(FISHING_KNOWLEDGE_CHUNKS_COLLECTION);
      const snapshot = await collection
        .where('userId', '==', input.userId)
        .where('pageId', '==', input.pageId)
        .get();
      const batch = this.firestore.batch();

      for (const doc of snapshot.docs) {
        batch.delete(collection.doc(doc.id));
      }

      await batch.commit();
      return ok(undefined);
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to delete fishing knowledge chunks');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async findNearestByUserId(
    input: FindNearestChunksInput
  ): Promise<Result<KnowledgeChunkMatch[], KnowledgeRepositoryError>> {
    try {
      const vectorQuery = this.firestore
        .collection(FISHING_KNOWLEDGE_CHUNKS_COLLECTION)
        .where('userId', '==', input.userId)
        .findNearest({
          vectorField: 'embedding',
          queryVector: FieldValue.vector(input.embedding),
          limit: input.limit,
          distanceMeasure: 'COSINE',
          distanceResultField: 'vectorDistance',
        });

      const snapshot = await vectorQuery.get();
      const matches = snapshot.docs.flatMap((doc) => {
        const data = doc.data() as Record<string, unknown> | undefined;
        if (data?.['userId'] !== input.userId) {
          return [];
        }

        const distance = typeof data['vectorDistance'] === 'number' ? data['vectorDistance'] : 1;
        return [
          {
            ...toKnowledgeChunk(doc.id, data),
            vectorScore: 1 - distance,
          },
        ];
      });

      return ok(matches);
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to find nearest fishing knowledge chunks');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }
}

export function createFirestoreChunkRepository(
  deps: FirestoreChunkRepositoryDeps
): KnowledgeChunkRepository {
  return new FirestoreChunkRepository(deps);
}
