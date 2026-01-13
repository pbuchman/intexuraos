/**
 * Firestore implementation of ResearchRepository.
 * Handles persistence of Research documents.
 */

import { FieldValue, getFirestore } from '@intexuraos/infra-firestore';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type {
  LlmResult,
  RepositoryError,
  Research,
  ResearchRepository,
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
      const limit = options?.limit ?? 50;

      // Query favorites first, then non-favorites
      const [favoritesSnapshot, nonFavoritesSnapshot] = await Promise.all([
        collection
          .where('userId', '==', userId)
          .where('favourite', '==', true)
          .orderBy('startedAt', 'desc')
          .limit(limit)
          .get(),
        collection
          .where('userId', '==', userId)
          .where('favourite', '==', false)
          .orderBy('startedAt', 'desc')
          .limit(limit)
          .get(),
      ]);

      const favorites = favoritesSnapshot.docs.map((doc) => doc.data() as Research);
      const nonFavorites = nonFavoritesSnapshot.docs.map((doc) => doc.data() as Research);

      // Combine: favorites first, then non-favorites, each sorted by startedAt desc
      const items = [...favorites, ...nonFavorites].slice(0, limit);

      const lastDoc = items.length > 0 ? items[items.length - 1] : undefined;

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
    model: string,
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
      const llmResults = research.llmResults.map((r) => {
        if (r.model !== model) {
          return r;
        }
        const merged = { ...r, ...result };
        if (result.status === 'pending' || result.status === 'processing') {
          const { error: _error, ...withoutError } = merged;
          return withoutError;
        }
        return merged;
      });

      await docRef.update({ llmResults });
      return ok(undefined);
    } catch (error) {
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Failed to update LLM result'),
      });
    }
  }

  async clearShareInfo(id: string): Promise<Result<Research, RepositoryError>> {
    try {
      const db = getFirestore();
      await db.collection(this.collectionName).doc(id).update({
        shareInfo: FieldValue.delete(),
      });
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
        message: getErrorMessage(error, 'Failed to clear share info'),
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
