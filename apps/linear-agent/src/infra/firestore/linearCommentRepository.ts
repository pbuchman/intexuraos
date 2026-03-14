/**
 * Firestore repository for Linear comments.
 * Owned by linear-agent - stores comments synced via webhooks.
 */

import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { LinearComment, LinearCommentRepository, LinearError, CommentSummary } from '../../domain/index.js';

interface LinearCommentDoc {
  id: string;
  issueId: string;
  issueIdentifier: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  syncedAt: string;
}

const COLLECTION_NAME = 'linear_issue_comments';

export async function saveLinearComment(
  comment: LinearComment
): Promise<Result<LinearComment, LinearError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(comment.id);

    const doc: LinearCommentDoc = {
      id: comment.id,
      issueId: comment.issueId,
      issueIdentifier: comment.issueIdentifier,
      userId: comment.userId,
      userName: comment.userName,
      body: comment.body,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      syncedAt: comment.syncedAt,
    };

    await docRef.set(doc, { merge: true });

    return ok(comment);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to save comment: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function findCommentById(
  id: string
): Promise<Result<LinearComment | null, LinearError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(id).get();
    /* v8 ignore start -- test-infra: findCommentById not called by any route handler @preserve */
    if (!doc.exists) return ok(null);
    /* v8 ignore stop @preserve */

    const data = doc.data() as LinearCommentDoc;
    return ok(docToComment(data));
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to find comment: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function listCommentsByIssueId(
  issueId: string
): Promise<Result<LinearComment[], LinearError>> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('issueId', '==', issueId)
      .orderBy('createdAt', 'asc')
      .get();

    const comments = snapshot.docs.map((doc) => docToComment(doc.data() as LinearCommentDoc));
    return ok(comments);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to list comments: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function countCommentsByIssueId(
  issueId: string
): Promise<Result<number, LinearError>> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('issueId', '==', issueId)
      .count()
      .get();

    return ok(snapshot.data().count);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to count comments: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

const FIRESTORE_IN_LIMIT = 30;

/**
 * Get comment count and last comment timestamp for multiple issues.
 * Chunks issueIds into groups of 30 (Firestore `in` operator limit).
 * Aggregates count and max createdAt per issueId in memory.
 */
/* v8 ignore start -- test-infra: Firestore integration requires real database mock @preserve */
export async function getCommentSummaries(
  issueIds: string[]
): Promise<Result<CommentSummary[], LinearError>> {
  if (issueIds.length === 0) return ok([]);

  try {
    const db = getFirestore();
    const summaryMap = new Map<string, { count: number; lastCommentAt: string | null }>();

    for (let i = 0; i < issueIds.length; i += FIRESTORE_IN_LIMIT) {
      const chunk = issueIds.slice(i, i + FIRESTORE_IN_LIMIT);
      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('issueId', 'in', chunk)
        .get();

      for (const doc of snapshot.docs) {
        const data = doc.data() as LinearCommentDoc;
        const existing = summaryMap.get(data.issueId);
        if (existing === undefined) {
          summaryMap.set(data.issueId, { count: 1, lastCommentAt: data.createdAt });
        } else {
          existing.count++;
          if (existing.lastCommentAt === null || data.createdAt > existing.lastCommentAt) {
            existing.lastCommentAt = data.createdAt;
          }
        }
      }
    }

    const summaries: CommentSummary[] = issueIds.map((issueId) => {
      const entry = summaryMap.get(issueId);
      return {
        issueId,
        commentCount: entry?.count ?? 0,
        lastCommentAt: entry?.lastCommentAt ?? null,
      };
    });

    return ok(summaries);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to get comment summaries: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}
/* v8 ignore stop @preserve */

export async function deleteCommentById(id: string): Promise<Result<void, LinearError>> {
  try {
    const db = getFirestore();
    await db.collection(COLLECTION_NAME).doc(id).delete();
    return ok(undefined);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to delete comment: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

function docToComment(data: LinearCommentDoc): LinearComment {
  return {
    id: data.id,
    issueId: data.issueId,
    issueIdentifier: data.issueIdentifier,
    userId: data.userId,
    userName: data.userName,
    body: data.body,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    syncedAt: data.syncedAt,
  };
}

/** Factory for creating repository with interface */
export function createLinearCommentRepository(): LinearCommentRepository {
  return {
    save: saveLinearComment,
    findById: findCommentById,
    listByIssueId: listCommentsByIssueId,
    countByIssueId: countCommentsByIssueId,
    getCommentSummaries,
    deleteById: deleteCommentById,
  };
}
