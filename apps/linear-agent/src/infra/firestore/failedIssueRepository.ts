/**
 * Firestore repository for failed Linear issue creations.
 * Stores issues that couldn't be created for manual review.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { FailedLinearIssue, LinearError } from '../../domain/index.js';

const COLLECTION_NAME = 'linear_failed_issues';

interface FailedIssueDoc {
  userId: string;
  actionId: string;
  originalText: string;
  extractedTitle: string | null;
  extractedPriority: number | null;
  error: string;
  reasoning: string | null;
  createdAt: string;
}

function toFailedIssue(id: string, doc: FailedIssueDoc): FailedLinearIssue {
  return {
    id,
    userId: doc.userId,
    actionId: doc.actionId,
    originalText: doc.originalText,
    extractedTitle: doc.extractedTitle,
    extractedPriority: doc.extractedPriority as 0 | 1 | 2 | 3 | 4 | null,
    error: doc.error,
    reasoning: doc.reasoning,
    createdAt: doc.createdAt,
  };
}

export async function createFailedIssue(input: {
  userId: string;
  actionId: string;
  originalText: string;
  extractedTitle: string | null;
  extractedPriority: number | null;
  error: string;
  reasoning: string | null;
}): Promise<Result<FailedLinearIssue, LinearError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc();
    const now = new Date().toISOString();

    const doc: FailedIssueDoc = {
      userId: input.userId,
      actionId: input.actionId,
      originalText: input.originalText,
      extractedTitle: input.extractedTitle,
      extractedPriority: input.extractedPriority,
      error: input.error,
      reasoning: input.reasoning,
      createdAt: now,
    };

    await docRef.set(doc);

    return ok(toFailedIssue(docRef.id, doc));
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to create failed issue: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function listFailedIssuesByUser(
  userId: string
): Promise<Result<FailedLinearIssue[], LinearError>> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    return ok(snapshot.docs.map((doc) => toFailedIssue(doc.id, doc.data() as FailedIssueDoc)));
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to list failed issues: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function deleteFailedIssue(id: string): Promise<Result<void, LinearError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return err({ code: 'INTERNAL_ERROR', message: 'Failed issue not found' });
    }

    await docRef.delete();
    return ok(undefined);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to delete failed issue: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/** Factory for creating repository with interface */
export function createFailedIssueRepository() {
  return {
    create: createFailedIssue,
    listByUser: listFailedIssuesByUser,
    delete: deleteFailedIssue,
  };
}
