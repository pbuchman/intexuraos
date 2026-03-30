/**
 * Firestore repository for Linear prune candidates.
 * Stores candidates classified by Gemini so users can review before confirming deletion.
 *
 * All candidates are stored globally (not per-user) since pruning operates across
 * the entire Linear workspace. Document IDs use the Linear issue UUID.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { StoredPruneCandidate, PruneCandidateRepository, LinearError } from '../../domain/index.js';

const COLLECTION_NAME = 'linear_prune_candidates';

interface PruneCandidateDoc {
  id: string;
  identifier: string;
  title: string;
  score: number;
  reason: string;
  category: string;
  classifiedAt: string;
}

function toStoredPruneCandidate(doc: PruneCandidateDoc): StoredPruneCandidate {
  return { ...doc, category: doc.category as StoredPruneCandidate['category'] };
}

const BATCH_LIMIT = 500;

async function clearAll(): Promise<Result<void, LinearError>> {
  try {
    const db = getFirestore();
    // listDocuments() returns refs without fetching field data — more efficient than get()
    const refs = await db.collection(COLLECTION_NAME).listDocuments();

    if (refs.length === 0) {
      return ok(undefined);
    }

    for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
      const chunk = refs.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();
      for (const ref of chunk) {
        batch.delete(ref);
      }
      await batch.commit();
    }

    return ok(undefined);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to clear prune candidates: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function storeAll(candidates: StoredPruneCandidate[]): Promise<Result<void, LinearError>> {
  try {
    const db = getFirestore();

    for (let i = 0; i < candidates.length; i += BATCH_LIMIT) {
      const chunk = candidates.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();
      for (const candidate of chunk) {
        const docRef = db.collection(COLLECTION_NAME).doc(candidate.id);
        batch.set(docRef, { ...candidate } satisfies PruneCandidateDoc);
      }
      await batch.commit();
    }

    return ok(undefined);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to store prune candidates: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function listAll(): Promise<Result<StoredPruneCandidate[], LinearError>> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .orderBy('score', 'desc')
      .get();

    return ok(snapshot.docs.map((doc) => toStoredPruneCandidate(doc.data() as PruneCandidateDoc)));
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to list prune candidates: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export function createPruneCandidateRepository(): PruneCandidateRepository {
  return {
    clearAll,
    storeAll,
    listAll,
  };
}
