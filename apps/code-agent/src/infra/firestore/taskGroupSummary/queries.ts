/**
 * Query and doc-reference construction for TaskGroupSummary Firestore storage.
 *
 * Pure, synchronous query-builder helpers — no transaction orchestration here.
 * Cursor resolution is performed by the caller (repo) which then passes the
 * resolved `startAfterDoc` in. This keeps `buildListQuery` sync and easy to test.
 */

/* eslint-disable no-restricted-imports */
import type {
  Firestore,
  DocumentReference,
  DocumentSnapshot,
  Query,
} from '@google-cloud/firestore';
import type { ListGroupSummariesInput } from '../../../domain/ports/taskGroupSummaryRepository.js';

export const SUMMARIES_COLLECTION = 'task_group_summaries';
export const COUNTS_COLLECTION = 'user_group_counts';

/**
 * Document reference for a TaskGroupSummary doc keyed as `{userId}_{groupKey}`.
 */
export function summaryDocRef(
  firestore: Firestore,
  userId: string,
  groupKey: string,
): DocumentReference {
  const docId = `${userId}_${groupKey}`;
  return asDocRef(firestore.collection(SUMMARIES_COLLECTION).doc(docId));
}

/**
 * Document reference for a UserGroupCounts doc keyed by userId.
 */
export function countsDocRef(firestore: Firestore, userId: string): DocumentReference {
  return asDocRef(firestore.collection(COUNTS_COLLECTION).doc(userId));
}

/**
 * Cast a DocumentReference to the type accepted by Transaction.get/set/delete.
 * Firestore's Transaction.get() is overloaded; DocumentReference is accepted but
 * TypeScript picks the AggregateQuery overload via Parameters<>. Use `unknown` escape hatch.
 */
export function asDocRef(ref: unknown): DocumentReference {
  return ref as DocumentReference;
}

/**
 * Build the Firestore query for `listGroupSummaries`.
 *
 * The caller resolves cursor documents up front and passes `startAfterDoc` in,
 * so this function stays synchronous and purely declarative.
 */
export function buildListQuery(
  firestore: Firestore,
  input: ListGroupSummariesInput,
  startAfterDoc?: DocumentSnapshot,
): Query {
  let query: Query = firestore.collection(SUMMARIES_COLLECTION).where('userId', '==', input.userId);

  if (input.statusFilter !== undefined && input.statusFilter.length > 0) {
    query = query.where('aggregateStatus', 'in', input.statusFilter);
  }

  // `latestTaskUpdatedAt` is the retained physical/index field name for group
  // lifecycle activity. Keeping it avoids an index and cursor migration.
  switch (input.sortBy) {
    case 'linear-id':
      query = query.orderBy('linearIssueSortKey', 'desc').orderBy('latestTaskUpdatedAt', 'desc');
      break;
    case 'pr-number':
      query = query.orderBy('prNumber', 'desc');
      break;
    case 'last-updated':
      query = query.orderBy('latestTaskUpdatedAt', 'desc');
      break;
    case 'dispatched':
      query = query.orderBy('mostRecentDispatchedAt', 'desc');
      break;
  }

  if (startAfterDoc !== undefined) {
    query = query.startAfter(startAfterDoc);
  }

  // Fetch one extra to detect hasMore
  query = query.limit(input.limit + 1);

  return query;
}
