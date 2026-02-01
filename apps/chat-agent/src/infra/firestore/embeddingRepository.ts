/**
 * Firestore implementation of embedding repository.
 * Uses Firestore's native vector search with findNearest().
 */

import { getFirestore, type Firestore, FieldValue } from '@intexuraos/infra-firestore';
import { ok, err, type Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import type {
  EmbeddingRepositoryPort,
  DocChunkWithScore,
  DocChunk,
} from '../../domain/models/docChunk.js';

/** Error types for repository operations. */
type RepositoryErrorCode = 'FIRESTORE_ERROR' | 'QUERY_ERROR';

/** Repository error with code. */
class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(code: RepositoryErrorCode, message: string) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
  }
}

/** Options for findNearest query. */
export interface FindNearestOptions {
  readonly docType?: string;
}

/**
 * Firestore implementation of embedding repository.
 * Uses vector search to find semantically similar document chunks.
 */
export class FirestoreEmbeddingRepository implements EmbeddingRepositoryPort {
  private readonly firestore: Firestore;
  private readonly collectionName = 'doc_embeddings';

  constructor() {
    this.firestore = getFirestore();
  }

  /**
   * Find documents most similar to the given embedding vector.
   * Uses Firestore's findNearest() for vector similarity search.
   */
  async findNearest(
    embedding: number[],
    limit: number,
    options?: FindNearestOptions
  ): Promise<Result<DocChunkWithScore[], RepositoryError>> {
    try {
      const collection = this.firestore.collection(this.collectionName);
      const queryVector = FieldValue.vector(embedding);

      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const vectorQuery = collection.findNearest('embedding', queryVector, {
        limit,
        distanceMeasure: 'COSINE',
      });

      const snapshot = await vectorQuery.get();

      if (snapshot.empty) {
        return ok([]);
      }

      const results: DocChunkWithScore[] = [];

      for (const doc of snapshot.docs) {
        const data = doc.data();
        // Convert distance to similarity score (1 - distance for COSINE)
        const distanceDoc = doc as { distance?: number };
        const distance = distanceDoc.distance ?? 0;
        const score = 1 - distance;

        const contentValue: unknown = data['content'];
        const filePathValue: unknown = data['filePath'];
        const sectionValue: unknown = data['section'];
        const docTypeValue: unknown = data['docType'];
        const createdAtValue: unknown = data['createdAt'];

        const docTypeTyped = docTypeValue === 'markdown' || docTypeValue === 'openapi'
          ? docTypeValue
          : 'markdown';
        const createdAtTyped = (createdAtValue ?? { seconds: 0, nanoseconds: 0 }) as FirebaseFirestore.Timestamp;

        // Safe string conversion with type check
        const contentStr = contentValue !== undefined && contentValue !== null && typeof contentValue === 'string'
          ? contentValue
          : '';
        const filePathStr = filePathValue !== undefined && filePathValue !== null && typeof filePathValue === 'string'
          ? filePathValue
          : '';
        const sectionStr = sectionValue !== undefined && sectionValue !== null && typeof sectionValue === 'string'
          ? sectionValue
          : '';

        results.push({
          id: doc.id,
          content: contentStr,
          filePath: filePathStr,
          section: sectionStr,
          docType: docTypeTyped,
          createdAt: createdAtTyped,
          score,
        });
      }

      // Apply docType filter if specified (done in-memory since where clause on vector queries is limited)
      if (options?.docType !== undefined) {
        return ok(results.filter((r) => r.docType === options.docType));
      }

      return ok(results);
    } catch (error) {
      const message = getErrorMessage(error);
      return err(new RepositoryError('QUERY_ERROR', `Firestore query failed: ${message}`));
    }
  }

  /**
   * Find a document chunk by its ID.
   */
  async findById(id: string): Promise<Result<DocChunk | null, RepositoryError>> {
    try {
      const doc = await this.firestore.collection(this.collectionName).doc(id).get();

      if (!doc.exists) {
        return ok(null);
      }

      const data = doc.data();

      if (data === undefined) {
        return ok(null);
      }

      const docTypeValue: unknown = data['docType'];
      const createdAtValue: unknown = data['createdAt'];
      const contentValue: unknown = data['content'];
      const filePathValue: unknown = data['filePath'];
      const sectionValue: unknown = data['section'];

      const docTypeTyped = docTypeValue === 'markdown' || docTypeValue === 'openapi'
        ? docTypeValue
        : 'markdown';
      const createdAtTyped = (createdAtValue ?? { seconds: 0, nanoseconds: 0 }) as FirebaseFirestore.Timestamp;

      // Safe string conversion with type check
      const contentStr = contentValue !== undefined && contentValue !== null && typeof contentValue === 'string'
        ? contentValue
        : '';
      const filePathStr = filePathValue !== undefined && filePathValue !== null && typeof filePathValue === 'string'
        ? filePathValue
        : '';
      const sectionStr = sectionValue !== undefined && sectionValue !== null && typeof sectionValue === 'string'
        ? sectionValue
        : '';

      const chunk: DocChunk = {
        id: doc.id,
        content: contentStr,
        embedding: [], // Embedding is stored but we don't need to load it for findById
        filePath: filePathStr,
        section: sectionStr,
        docType: docTypeTyped,
        createdAt: createdAtTyped,
      };

      return ok(chunk);
    } catch (error) {
      const message = getErrorMessage(error);
      return err(new RepositoryError('FIRESTORE_ERROR', `Failed to fetch document: ${message}`));
    }
  }

  /**
   * Find similar documents (alias for findNearest).
   */
  async findSimilar(
    embedding: number[],
    limit: number
  ): Promise<Result<DocChunkWithScore[], RepositoryError>> {
    return await this.findNearest(embedding, limit);
  }
}
