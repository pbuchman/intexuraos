/**
 * Query-construction helpers for CodeTask list/find operations.
 *
 * Centralizes the Firestore Query shapes that the adapter uses for `list()`
 * and for other multi-filter lookups so each repository method stays a
 * one-liner.
 */

/* eslint-disable */

import type { CollectionReference, Query, Timestamp } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTask } from '../../domain/models/codeTask.js';
import type { ListTasksInput } from '../../domain/repositories/codeTaskRepository.js';
import {
  ACTIVE_TASK_STATUSES,
  DISPATCHED_OR_RUNNING_STATUSES,
  type DocLike,
  isMergeConflictTaskData,
} from './task-constants.js';
import { fromFirestoreDoc } from './task-serializer.js';

/**
 * Build the Firestore query for `list()`, ordered by createdAt desc with a
 * limit of `limit + 1` so the caller can detect hasMore. Resolves a cursor
 * (taskId) by reading the referenced document and calling `startAfter` when
 * the doc exists.
 */
export async function buildListQuery(
  collection: CollectionReference,
  input: ListTasksInput
): Promise<{ query: Query; limit: number }> {
  let query: Query = collection.where('userId', '==', input.userId);

  // Firestore 'in' operator throws on empty array, so only add filter when non-empty
  if (input.status !== undefined && input.status.length > 0) {
    query = query.where('status', 'in', input.status);
  }

  query = query.orderBy('createdAt', 'desc');

  if (input.cursor !== undefined) {
    const cursorDoc = await collection.doc(input.cursor).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  // Fetch limit + 1 to detect hasMore
  const limit = input.limit ?? 20;
  query = query.limit(limit + 1);

  return { query, limit };
}

/** Newest tasks for a given PR (50 latest, createdAt desc). */
export function prTasksByCreatedAt(
  collection: CollectionReference,
  repository: string,
  prNumber: number,
  limit = 50,
): Query {
  return collection
    .where('repository', '==', repository)
    .where('prNumber', '==', prNumber)
    .orderBy('createdAt', 'desc')
    .limit(limit);
}

/** Active review task for a PR (limit 1). */
export function activeReviewForPR(
  collection: CollectionReference,
  repository: string,
  prNumber: number
): Query {
  return collection
    .where('repository', '==', repository)
    .where('prNumber', '==', prNumber)
    .where('agentType', '==', 'review')
    .where('status', 'in', ACTIVE_TASK_STATUSES)
    .limit(1);
}

/** Most-recent remediation task for a PR (limit 1, createdAt desc). */
export function recentRemediationForPR(
  collection: CollectionReference,
  repository: string,
  prNumber: number
): Query {
  return collection
    .where('repository', '==', repository)
    .where('prNumber', '==', prNumber)
    .where('agentType', '==', 'remediation')
    .orderBy('createdAt', 'desc')
    .limit(1);
}

/** Preserved pull_request task for a PR (implemented, 50 latest by completedAt). */
export function preservedPullRequestForPR(
  collection: CollectionReference,
  repository: string,
  prNumber: number
): Query {
  return collection
    .where('repository', '==', repository)
    .where('prNumber', '==', prNumber)
    .where('agentType', '==', 'pull_request')
    .where('status', '==', 'implemented')
    .orderBy('completedAt', 'desc')
    .limit(50);
}

/** Dispatched or running task for a PR (limit 1). */
export function dispatchedOrRunningForPR(
  collection: CollectionReference,
  repository: string,
  prNumber: number
): Query {
  return collection
    .where('repository', '==', repository)
    .where('prNumber', '==', prNumber)
    .where('status', 'in', DISPATCHED_OR_RUNNING_STATUSES)
    .limit(1);
}

/** Active (queued/dispatched/running) task for a Linear issue. */
export function activeByLinearIssue(
  collection: CollectionReference,
  linearIssueId: string
): Query {
  return collection
    .where('linearIssueId', '==', linearIssueId)
    .where('status', 'in', ACTIVE_TASK_STATUSES);
}

/**
 * Dispatched or running task for a Linear issue (limit 2).
 *
 * [INT-1560 Fix B] Used by `drainTaskQueue` to defer review-side candidates
 * when a non-self sibling on the same Linear issue is actively executing.
 * Excludes `queued` (uses `DISPATCHED_OR_RUNNING_STATUSES`, not
 * `ACTIVE_TASK_STATUSES`) so two queued reviews on the same Linear issue
 * cannot deadlock — only a true running planning/execution sibling blocks.
 *
 * Limit 2 (not 1) so the caller can filter the candidate's own document
 * out and still report a sibling if one exists.
 */
export function dispatchedOrRunningForLinearIssue(
  collection: CollectionReference,
  linearIssueId: string
): Query {
  return collection
    .where('linearIssueId', '==', linearIssueId)
    .where('status', 'in', DISPATCHED_OR_RUNNING_STATUSES)
    .limit(2);
}

/** Recent tasks for a Linear issue (createdAt desc). */
export function recentByLinearIssue(
  collection: CollectionReference,
  linearIssueId: string,
  limit: number
): Query {
  return collection
    .where('linearIssueId', '==', linearIssueId)
    .orderBy('createdAt', 'desc')
    .limit(limit);
}

/** Latest non-archived ask-agent task for a user (limit 1). */
export function latestAskAgentForUser(
  collection: CollectionReference,
  userId: string,
  nonArchivedStatuses: readonly string[]
): Query {
  return collection
    .where('userId', '==', userId)
    .where('agentType', '==', 'ask_agent')
    .where('status', 'in', nonArchivedStatuses)
    .orderBy('createdAt', 'desc')
    .limit(1);
}

/** Planned planning task for a Linear issue (limit 1). */
export function plannedPlanningByLinearIssue(
  collection: CollectionReference,
  linearIssueId: string
): Query {
  return collection
    .where('linearIssueId', '==', linearIssueId)
    .where('status', '==', 'planned')
    .where('agentType', '==', 'planning')
    .limit(1);
}

/** Queued tasks ordered ascending by createdAt (FIFO). */
export function queuedOrderedByAge(collection: CollectionReference, limit: number): Query {
  return collection
    .where('status', '==', 'queued')
    .orderBy('createdAt', 'asc')
    .limit(limit);
}

/** All non-archived tasks for a user, createdAt desc. */
export function nonArchivedForUser(
  collection: CollectionReference,
  userId: string,
  nonArchivedStatuses: readonly string[]
): Query {
  return collection
    .where('userId', '==', userId)
    .where('status', 'in', nonArchivedStatuses)
    .orderBy('createdAt', 'desc');
}

/** All non-archived tasks across all users, updatedAt asc. */
export function nonArchivedGlobal(
  collection: CollectionReference,
  nonArchivedStatuses: readonly string[]
): Query {
  return collection.where('status', 'in', nonArchivedStatuses).orderBy('updatedAt', 'asc');
}

/** All tasks with status != 'archived'. */
export function allNotArchived(collection: CollectionReference): Query {
  // Uses != 'archived' deliberately: future-proof — any new status added later is
  // automatically included so the hasActive safety check sees the complete picture.
  return collection.where('status', '!=', 'archived');
}

/** Errored execution-memory post-run tasks (limit 50). */
export function erroredExecutionMemoryPostRun(collection: CollectionReference): Query {
  return collection.where('executionMemoryPostRun.status', '==', 'error').limit(50);
}

/** Zombie (silently-stuck) dispatched/running tasks via lastHeartbeat < threshold. */
export function zombieTasks(
  collection: CollectionReference,
  lastHeartbeatBefore: Timestamp
): Query {
  // Query on lastHeartbeat (not updatedAt). updatedAt is falsely refreshed by
  // unrelated writes (PR merge webhooks, Linear event ingestion, etc.) so a
  // silent-but-running task can appear fresh indefinitely. 'queued' is excluded
  // because queued tasks don't heartbeat.
  return collection
    .where('status', 'in', ['dispatched', 'running'])
    .where('lastHeartbeat', '<', lastHeartbeatBefore);
}

/** Tasks created by user since startOfDay (for per-day rate limiting). */
export function tasksCreatedSince(
  collection: CollectionReference,
  userId: string,
  since: Timestamp
): Query {
  return collection.where('userId', '==', userId).where('createdAt', '>=', since);
}

/** Pending execution-memory post-run tasks (agent filter, oldest-first). */
export function pendingExecutionMemoryPostRun(
  collection: CollectionReference,
  limit: number
): Query {
  return collection
    .where('agentType', 'in', ['execution', 'planning', 'review', 'remediation', 'pull_request'])
    .where('executionMemoryPostRun.status', '==', 'pending')
    .orderBy('completedAt', 'asc')
    .limit(limit);
}

/**
 * Select the first execution-eligible task from a PR-scoped query snapshot.
 * Excludes review, remediation, planning, and merge-conflict follow-up tasks.
 * Treats missing agentType as execution-eligible (backward compatibility).
 */
export function selectLatestExecutionTask(
  docs: readonly DocLike[]
): CodeTask | null {
  for (const doc of docs) {
    const data = doc.data();
    const agentType = data['agentType'];
    if (
      agentType !== 'review' &&
      agentType !== 'remediation' &&
      agentType !== 'planning' &&
      !isMergeConflictTaskData(data)
    ) {
      return fromFirestoreDoc(doc);
    }
  }
  return null;
}

/**
 * Select the origin task (planning/execution preferred, pull_request fallback)
 * from a PR-scoped query snapshot.
 */
export function selectOriginTask(
  docs: readonly DocLike[]
): CodeTask | null {
  let fallback: DocLike | null = null;
  for (const doc of docs) {
    const agentType = doc.data()['agentType'];
    if (agentType === 'planning' || agentType === 'execution') {
      return fromFirestoreDoc(doc);
    }
    if (agentType === 'pull_request' && fallback === null) fallback = doc;
  }
  return fallback !== null ? fromFirestoreDoc(fallback) : null;
}

/**
 * Select the non-merge-conflict task from a PR-scoped query snapshot,
 * returning null if none match.
 */
export function selectNonMergeConflict(
  docs: readonly DocLike[]
): CodeTask | null {
  for (const doc of docs) {
    if (!isMergeConflictTaskData(doc.data())) return fromFirestoreDoc(doc);
  }
  return null;
}

/**
 * Select the preserved pull_request container from a PR-scoped query snapshot.
 * Returns the first non-merge-conflict doc with its identifying fields, or
 * null if none match.
 */
export function selectPreservedPullRequest(
  docs: readonly DocLike[]
): { id: string; workerLocation: string; userId: string } | null {
  for (const doc of docs) {
    const data = doc.data();
    if (!isMergeConflictTaskData(data)) {
      return {
        id: doc.id,
        workerLocation: String(data['workerLocation'] ?? ''),
        userId: String(data['userId'] ?? ''),
      };
    }
  }
  return null;
}

/** Width of the PR-scoped scan window used by PR task selectors. */
const PR_SCAN_WINDOW = 50;

/**
 * Scan the PR-scoped tasks-by-createdAt window and delegate selection to
 * the provided selector. Emits the caller-supplied `warnMessage` when the
 * window is fully exhausted without a match, so callers can detect
 * truncation and preserve their method-specific diagnostic text.
 */
export async function scanPrWindow(
  collection: CollectionReference,
  repository: string,
  prNumber: number,
  selector: (docs: readonly DocLike[]) => CodeTask | null,
  logger: Logger,
  warnMessage: string
): Promise<CodeTask | null> {
  const snap = await prTasksByCreatedAt(collection, repository, prNumber).get();
  const task = selector(snap.docs);
  if (task === null && snap.docs.length === PR_SCAN_WINDOW) {
    logger.warn(
      { repository, prNumber, docsScanned: PR_SCAN_WINDOW },
      warnMessage
    );
  }
  return task;
}
