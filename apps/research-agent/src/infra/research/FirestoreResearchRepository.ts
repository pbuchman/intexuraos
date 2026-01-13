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

      // Cursor format: "fav:<docId>" for favorites, "non:<docId>" for non-favorites
      // This encodes which query we're paginating through and the start position
      let favoritesStartAfter: string | undefined;
      let nonFavoritesStartAfter: string | undefined;
      let skipNonFavorites = false;

      if (options?.cursor !== undefined && options.cursor !== '') {
        const [type, id] = options.cursor.split(':', 2);
        if (type === 'fav') {
          favoritesStartAfter = id;
        } else if (type === 'non') {
          // Already done with favorites, only query non-favorites
          skipNonFavorites = true;
          nonFavoritesStartAfter = id;
        } else if (type === 'done') {
          // No more results
          return ok({ items: [] });
        }
      }

      let items: Research[] = [];

      if (!skipNonFavorites) {
        // Query favorites (with cursor if provided)
        const favoritesQuery = collection
          .where('userId', '==', userId)
          .where('favourite', '==', true)
          .orderBy('startedAt', 'desc')
          .limit(limit + 1); // Fetch one extra to know if there are more

        if (favoritesStartAfter !== undefined) {
          const startDoc = await collection.doc(favoritesStartAfter).get();
          if (startDoc.exists) {
            const snapshot = await favoritesQuery.startAfter(startDoc).get();
            items = snapshot.docs.map((doc) => doc.data() as Research);
          }
        } else {
          const snapshot = await favoritesQuery.get();
          items = snapshot.docs.map((doc) => doc.data() as Research);
        }

        // If we have enough favorites, return them
        if (items.length >= limit) {
          const trimmed = items.slice(0, limit);
          const lastItem = trimmed[trimmed.length - 1];
          const cursor = items.length > limit && lastItem !== undefined ? `fav:${lastItem.id}` : undefined;
          return cursor !== undefined
            ? ok({ items: trimmed, nextCursor: cursor })
            : ok({ items: trimmed });
        }
      }

      // Not enough favorites, fetch non-favorites to fill the rest
      const remaining = limit - items.length;
      const nonFavoritesQuery = collection
        .where('userId', '==', userId)
        .where('favourite', '==', false)
        .orderBy('startedAt', 'desc')
        .limit(remaining + 1);

      let nonFavorites: Research[] = [];
      if (nonFavoritesStartAfter !== undefined) {
        const startDoc = await collection.doc(nonFavoritesStartAfter).get();
        if (startDoc.exists) {
          const snapshot = await nonFavoritesQuery.startAfter(startDoc).get();
          nonFavorites = snapshot.docs.map((doc) => doc.data() as Research);
        }
      } else {
        const snapshot = await nonFavoritesQuery.get();
        nonFavorites = snapshot.docs.map((doc) => doc.data() as Research);
      }

      // Combine and determine cursor
      const combined = [...items, ...nonFavorites];
      const resultItems = combined.slice(0, limit);

      // Determine next cursor based on what we fetched
      const lastItem = resultItems[resultItems.length - 1];
      const cursor = combined.length > limit && lastItem !== undefined
        ? `non:${lastItem.id}`
        : undefined;

      return cursor !== undefined
        ? ok({ items: resultItems, nextCursor: cursor })
        : ok({ items: resultItems });
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
