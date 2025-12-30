/**
 * Firestore implementation of ResearchRepository.
 * Handles persistence of Research documents.
 */

import { getFirestore } from '@intexuraos/infra-firestore';
import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type {
  Research,
  LlmResult,
  LlmProvider,
  ResearchRepository,
  RepositoryError,
} from '../../domain/research/index.js';

export class FirestoreResearchRepository implements ResearchRepository {
  private readonly collectionName: string;

  constructor(collectionName = 'researches') {
    this.collectionName = collectionName;
  }

  async save(research: Research): Promise<Result<Research, RepositoryError>> {
    try {
      const db = getFirestore();
      await db.collection(this.collectionName).doc(research.id).set(research);
      return ok(research);
    } catch (error) {
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Failed to save research'),
      });
    }
  }

  async findById(id: string): Promise<Result<Research | null, RepositoryError>> {
    try {
      const db = getFirestore();
      const doc = await db.collection(this.collectionName).doc(id).get();
      if (!doc.exists) {
        return ok(null);
      }
      return ok(doc.data() as Research);
    } catch (error) {
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Failed to find research'),
      });
    }
  }

  async findByUserId(
    userId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<Result<{ items: Research[]; nextCursor?: string }, RepositoryError>> {
    try {
      const db = getFirestore();
      const collection = db.collection(this.collectionName);

      let query = collection
        .where('userId', '==', userId)
        .orderBy('startedAt', 'desc')
        .limit(options?.limit ?? 50);

      if (options?.cursor !== undefined && options.cursor !== '') {
        const cursorDoc = await collection.doc(options.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.get();
      const items = snapshot.docs.map((doc) => doc.data() as Research);
      const lastDoc = snapshot.docs[snapshot.docs.length - 1];

      const result: { items: Research[]; nextCursor?: string } = { items };
      if (lastDoc !== undefined) {
        result.nextCursor = lastDoc.id;
      }

      return ok(result);
    } catch (error) {
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Failed to list researches'),
      });
    }
  }

  async update(id: string, updates: Partial<Research>): Promise<Result<Research, RepositoryError>> {
    try {
      const db = getFirestore();
      await db.collection(this.collectionName).doc(id).update(updates);
      const updated = await this.findById(id);
      if (!updated.ok) {
        return updated;
      }
      if (updated.value === null) {
        return err({ code: 'NOT_FOUND', message: 'Research not found' });
      }
      return ok(updated.value);
    } catch (error) {
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Failed to update research'),
      });
    }
  }

  async updateLlmResult(
    researchId: string,
    provider: LlmProvider,
    result: Partial<LlmResult>
  ): Promise<Result<void, RepositoryError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(this.collectionName).doc(researchId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return err({ code: 'NOT_FOUND', message: 'Research not found' });
      }

      const research = doc.data() as Research;
      const llmResults = research.llmResults.map((r) =>
        r.provider === provider ? { ...r, ...result } : r
      );

      await docRef.update({ llmResults });
      return ok(undefined);
    } catch (error) {
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Failed to update LLM result'),
      });
    }
  }

  async delete(id: string): Promise<Result<void, RepositoryError>> {
    try {
      const db = getFirestore();
      await db.collection(this.collectionName).doc(id).delete();
      return ok(undefined);
    } catch (error) {
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Failed to delete research'),
      });
    }
  }
}
