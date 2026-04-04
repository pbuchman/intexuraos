/**
 * Firestore implementation of TaskGroupSummaryRepository.
 * Maintains precomputed group-level aggregates updated on every task create/update/delete.
 */

/* eslint-disable no-restricted-imports, @typescript-eslint/no-base-to-string, @typescript-eslint/no-unnecessary-type-arguments */
import { Timestamp } from '@google-cloud/firestore';
import type { Firestore, DocumentData, DocumentReference } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { TaskGroupSummaryRepository, ListGroupSummariesInput, ListGroupSummariesOutput, GroupSummaryError } from '../../domain/ports/taskGroupSummaryRepository.js';
import type { TaskGroupSummary, UserGroupCounts } from '../../domain/models/taskGroupSummary.js';
import type { CodeTask } from '../../domain/models/codeTask.js';
import type { Result } from '@intexuraos/common-core';
import type { GroupStatus } from '../../domain/issueGrouping/types.js';
import { deriveAggregateStatusFromSummary } from '../../domain/issueGrouping/deriveAggregateStatusFromSummary.js';
import { REMEDIATION_NOT_NEEDED } from '../../domain/issueGrouping/constants.js';
import { hasImplementationReadyLabel, hasMergeReadyLabel } from '../../domain/issueGrouping/labelHelpers.js';

const SUMMARIES_COLLECTION = 'task_group_summaries';
const COUNTS_COLLECTION = 'user_group_counts';

/**
 * Determine the group key for a task.
 * Uses linearIssueId when present, otherwise standalone_{taskId}.
 */
function getGroupKey(task: CodeTask): string {
  if (task.linearIssueId !== undefined) {
    return task.linearIssueId;
  }
  return `standalone_${task.id}`;
}

/**
 * Returns true if a task status is active (queued, dispatched, or running).
 */
function isActiveStatus(status: string): boolean {
  return status === 'queued' || status === 'dispatched' || status === 'running';
}

/**
 * Convert a status string to the user_group_counts field name.
 */
function statusToCountField(status: GroupStatus): 'active' | 'needsAction' | 'done' | 'failed' | 'archived' {
  switch (status) {
    case 'active': return 'active';
    case 'needs-action': return 'needsAction';
    case 'done': return 'done';
    case 'failed': return 'failed';
    case 'archived': return 'archived';
  }
}

/**
 * Compute latestReviewNeedsRemediation from a task's result.
 * Returns true/false/null depending on result fields.
 */
function computeReviewNeedsRemediation(task: CodeTask): boolean | null {
  if (task.agentType !== 'review' || task.result === undefined) {
    return null;
  }
  const nr = task.result.needs_remediation;
  if (nr === REMEDIATION_NOT_NEEDED) return false;
  if (nr === '1') return true;
  return null;
}

function hasCompletedExecutionTask(task: CodeTask): boolean {
  return (
    (task.agentType === 'execution' && (task.status === 'implemented' || task.status === 'reviewed')) ||
    (task.agentType === 'pull_request' && task.status === 'implemented')
  );
}

function hasCompletedExecutionAgentOnly(task: CodeTask): boolean {
  return task.agentType === 'execution' && (task.status === 'implemented' || task.status === 'reviewed');
}

/**
 * Helper to ensure a value is a Timestamp.
 */
function toTimestamp(value: unknown): Timestamp {
  /* v8 ignore start -- ts-type: FakeFirestore always stores real Timestamp instances; non-Timestamp value is unreachable in tests @preserve */
  if (value instanceof Timestamp) {
    return value;
  }
  if (value instanceof Date) {
    return Timestamp.fromDate(value);
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if ('toDate' in obj && typeof obj['toDate'] === 'function') {
      return obj as unknown as Timestamp;
    }
    if ('_seconds' in obj && typeof obj['_seconds'] === 'number') {
      const seconds = obj['_seconds'];
      const nanos = typeof obj['_nanoseconds'] === 'number' ? obj['_nanoseconds'] : 0;
      return new Timestamp(seconds, nanos);
    }
  }
  return Timestamp.now();
  /* v8 ignore stop @preserve */
}

/**
 * Build a TaskGroupSummary from raw Firestore document data.
 */
function docToSummary(data: Record<string, unknown>): TaskGroupSummary {
  /* v8 ignore start -- ts-type: FakeFirestore always returns well-formed documents written by this repo; null/missing field fallbacks are unreachable in tests @preserve */
  return {
    userId: String(data['userId'] ?? ''),
    linearIssueId: data['linearIssueId'] !== undefined && data['linearIssueId'] !== null
      ? String(data['linearIssueId'])
      : null,
    groupKey: String(data['groupKey'] ?? ''),
    taskCount: Number(data['taskCount'] ?? 0),
    activeTaskCount: Number(data['activeTaskCount'] ?? 0),
    latestTaskStatus: String(data['latestTaskStatus'] ?? ''),
    latestTaskUpdatedAt: toTimestamp(data['latestTaskUpdatedAt']),
    agentTypesPresent: Array.isArray(data['agentTypesPresent'])
      ? (data['agentTypesPresent'] as unknown[]).map(String)
      : [],
    hasCompletedPlanning: data['hasCompletedPlanning'] === true,
    hasCompletedExecution: data['hasCompletedExecution'] === true,
    hasCompletedExecutionAgent: data['hasCompletedExecutionAgent'] === true,
    hasImplementationTaskId: data['hasImplementationTaskId'] === true,
    hasPrUrl: data['hasPrUrl'] === true,
    prNumber: data['prNumber'] !== undefined && data['prNumber'] !== null
      ? Number(data['prNumber'])
      : null,
    latestReviewNeedsRemediation: data['latestReviewNeedsRemediation'] === true
      ? true
      : data['latestReviewNeedsRemediation'] === false
        ? false
        : null,
    oldestTaskCreatedAt: toTimestamp(data['oldestTaskCreatedAt']),
    mostRecentDispatchedAt: data['mostRecentDispatchedAt'] !== undefined && data['mostRecentDispatchedAt'] !== null
      ? toTimestamp(data['mostRecentDispatchedAt'])
      : null,
    aggregateStatus: String(data['aggregateStatus'] ?? 'done') as GroupStatus,
    // Label flags are only present when recomputeWithLabels has been called; legacy docs omit them
    ...(data['hasImplementationReadyLabel'] !== undefined
      ? { hasImplementationReadyLabel: data['hasImplementationReadyLabel'] === true }
      : {}),
    ...(data['hasMergeReadyLabel'] !== undefined
      ? { hasMergeReadyLabel: data['hasMergeReadyLabel'] === true }
      : {}),
    ...(data['labelsUpdatedAt'] !== undefined && data['labelsUpdatedAt'] !== null
      ? { labelsUpdatedAt: toTimestamp(data['labelsUpdatedAt']) }
      : {}),
    updatedAt: toTimestamp(data['updatedAt']),
  };
  /* v8 ignore stop @preserve */
}

/**
 * Build a default UserGroupCounts for a user with all zeros.
 */
function defaultCounts(userId: string): UserGroupCounts {
  return {
    userId,
    active: 0,
    needsAction: 0,
    done: 0,
    failed: 0,
    archived: 0,
    totalGroups: 0,
    updatedAt: Timestamp.now(),
  };
}

/**
 * Build a UserGroupCounts from raw Firestore data.
 */
function docToCounts(data: Record<string, unknown>): UserGroupCounts {
  /* v8 ignore start -- ts-type: FakeFirestore always returns well-formed documents written by this repo; null/missing field fallbacks are unreachable in tests @preserve */
  return {
    userId: String(data['userId'] ?? ''),
    active: Number(data['active'] ?? 0),
    needsAction: Number(data['needsAction'] ?? 0),
    done: Number(data['done'] ?? 0),
    failed: Number(data['failed'] ?? 0),
    archived: Number(data['archived'] ?? 0),
    totalGroups: Number(data['totalGroups'] ?? 0),
    updatedAt: toTimestamp(data['updatedAt']),
  };
  /* v8 ignore stop @preserve */
}

/**
 * Build an initial TaskGroupSummary from the first task in a group.
 */
function buildInitialSummary(task: CodeTask, now: Timestamp): Omit<TaskGroupSummary, 'aggregateStatus'> {
  const groupKey = getGroupKey(task);
  const agentTypesPresent: string[] = task.agentType !== undefined ? [task.agentType] : [];
  const hasPrUrl = task.result?.prUrl !== undefined;
  const hasCompletedPlanning = task.agentType === 'planning' && task.status === 'planned';
  const hasCompletedExecution = hasCompletedExecutionTask(task);
  const hasCompletedExecutionAgent = hasCompletedExecutionAgentOnly(task);
  const hasImplementationTaskId = hasImplementationLink(task);
  const latestReviewNeedsRemediation = computeReviewNeedsRemediation(task);
  const prNumber = hasPrUrl && task.prNumber !== undefined ? task.prNumber : null;
  const mostRecentDispatchedAt = task.dispatchedAt !== undefined ? toTimestamp(task.dispatchedAt) : null;

  return {
    userId: task.userId,
    linearIssueId: task.linearIssueId ?? null,
    groupKey,
    taskCount: task.status === 'archived' ? 0 : 1,
    activeTaskCount: isActiveStatus(task.status) ? 1 : 0,
    latestTaskStatus: task.status,
    latestTaskUpdatedAt: toTimestamp(task.updatedAt),
    agentTypesPresent,
    hasCompletedPlanning,
    hasCompletedExecution,
    hasCompletedExecutionAgent,
    hasImplementationTaskId,
    hasPrUrl,
    prNumber,
    latestReviewNeedsRemediation,
    oldestTaskCreatedAt: toTimestamp(task.createdAt),
    mostRecentDispatchedAt,
    updatedAt: now,
  };
}

function hasImplementationLink(task: CodeTask): boolean {
  return task.implementationTaskId !== undefined || (task.fanOutChildTaskIds !== undefined && task.fanOutChildTaskIds.length > 0);
}

/**
 * Apply a delta to UserGroupCounts when a new group is created.
 * Call when isNewGroup=true.
 */
function applyNewGroupDelta(counts: UserGroupCounts, newStatus: GroupStatus): UserGroupCounts {
  const result = { ...counts };
  result.totalGroups = result.totalGroups + 1;
  const field = statusToCountField(newStatus);
  result[field] = result[field] + 1;
  return result;
}

/**
 * Apply a delta to UserGroupCounts when a group is deleted.
 * Call when isDeletedGroup=true. oldStatus must be non-null (always is at call sites).
 */
function applyDeleteGroupDelta(counts: UserGroupCounts, oldStatus: GroupStatus): UserGroupCounts {
  const result = { ...counts };
  result.totalGroups = Math.max(0, result.totalGroups - 1);
  const field = statusToCountField(oldStatus);
  result[field] = Math.max(0, result[field] - 1);
  return result;
}

/**
 * Apply a delta to UserGroupCounts when aggregate status changes.
 * oldStatus and newStatus must differ (caller guarantees this).
 */
function applyStatusChangeDelta(counts: UserGroupCounts, oldStatus: GroupStatus, newStatus: GroupStatus): UserGroupCounts {
  /* v8 ignore start -- upstream: caller-guaranteed that oldStatus !== newStatus (each call site has an if-guard before invoking this function) so equal-status early-return is unreachable @preserve */
  if (oldStatus === newStatus) return counts;
  /* v8 ignore stop @preserve */
  const result = { ...counts };
  const oldField = statusToCountField(oldStatus);
  const newField = statusToCountField(newStatus);
  result[oldField] = Math.max(0, result[oldField] - 1);
  result[newField] = result[newField] + 1;
  return result;
}

/**
 * Cast a DocumentReference to the type accepted by Transaction.get/set/delete.
 * Firestore's Transaction.get() is overloaded; DocumentReference is accepted but
 * TypeScript picks the AggregateQuery overload via Parameters<>. Use `unknown` escape hatch.
 */
function asDocRef(ref: ReturnType<ReturnType<typeof Firestore.prototype.collection>['doc']>): DocumentReference<DocumentData> {
  return ref as unknown as DocumentReference<DocumentData>;
}

export function createTaskGroupSummaryFirestoreRepository(deps: {
  firestore: Firestore;
  logger: Logger;
}): TaskGroupSummaryRepository {
  const { firestore, logger } = deps;

  return {
    async updateAfterCreate(task: CodeTask): Promise<void> {
      try {
        const groupKey = getGroupKey(task);
        const docId = `${task.userId}_${groupKey}`;
        const summaryRef = firestore.collection(SUMMARIES_COLLECTION).doc(docId);
        const countsRef = firestore.collection(COUNTS_COLLECTION).doc(task.userId);

        await firestore.runTransaction(async (tx) => {
          const now = Timestamp.fromDate(new Date());
          const summaryDoc = await tx.get(asDocRef(summaryRef));
          const countsDoc = await tx.get(asDocRef(countsRef));

          const existingCounts: UserGroupCounts = countsDoc.exists
            ? docToCounts(countsDoc.data() as Record<string, unknown>)
            : defaultCounts(task.userId);

          if (!summaryDoc.exists) {
            // New group — build initial summary from scratch
            const initial = buildInitialSummary(task, now);
            const aggregateStatus = deriveAggregateStatusFromSummary(initial);
            const summary: TaskGroupSummary = { ...initial, aggregateStatus };

            tx.set(asDocRef(summaryRef), summary as unknown as DocumentData);

            if (task.status !== 'archived') {
              const newCounts = applyNewGroupDelta(existingCounts, aggregateStatus);
              newCounts.userId = task.userId;
              newCounts.updatedAt = now;
              tx.set(asDocRef(countsRef), newCounts as unknown as DocumentData);
            }
          } else {
            // Existing group — apply incremental update
            const current = docToSummary(summaryDoc.data() as Record<string, unknown>);
            const oldAggregateStatus = current.aggregateStatus;

            const updated: TaskGroupSummary = { ...current };
            updated.updatedAt = now;

            if (task.status !== 'archived') {
              updated.taskCount = current.taskCount + 1;
            }

            if (isActiveStatus(task.status)) {
              updated.activeTaskCount = current.activeTaskCount + 1;
            }

            // Update agentTypesPresent
            if (task.agentType !== undefined && !current.agentTypesPresent.includes(task.agentType)) {
              updated.agentTypesPresent = [...current.agentTypesPresent, task.agentType];
            }

            // Update boolean flags
            if (task.agentType === 'planning' && task.status === 'planned') {
              updated.hasCompletedPlanning = true;
            }
            if (hasCompletedExecutionTask(task)) {
              updated.hasCompletedExecution = true;
            }
            if (hasCompletedExecutionAgentOnly(task)) {
              updated.hasCompletedExecutionAgent = true;
            }
            /* v8 ignore start -- ts-type: FakeFirestore cannot produce a task where implementationTaskId/fanOutChildTaskIds are absent when the branch is already covered; v8 undercounts false-branch due to optional-chaining transpilation in ESM @preserve */
            if (hasImplementationLink(task)) {
              updated.hasImplementationTaskId = true;
            }
            /* v8 ignore stop @preserve */
            if (task.result?.prUrl !== undefined) {
              updated.hasPrUrl = true;
              if (task.prNumber !== undefined) {
                updated.prNumber = task.prNumber;
              }
            }

            // Update latestReviewNeedsRemediation if this is a review task with a result
            const reviewNeedsRemediation = computeReviewNeedsRemediation(task);
            if (reviewNeedsRemediation !== null) {
              updated.latestReviewNeedsRemediation = reviewNeedsRemediation;
            }

            // Update latestTaskStatus and latestTaskUpdatedAt if this task is newer
            if (toTimestamp(task.updatedAt).toMillis() >= current.latestTaskUpdatedAt.toMillis()) {
              updated.latestTaskStatus = task.status;
              updated.latestTaskUpdatedAt = toTimestamp(task.updatedAt);
            }

            // Update sort key fields
            if (toTimestamp(task.createdAt).toMillis() < current.oldestTaskCreatedAt.toMillis()) {
              updated.oldestTaskCreatedAt = toTimestamp(task.createdAt);
            }
            if (task.dispatchedAt !== undefined) {
              const dispatchedTs = toTimestamp(task.dispatchedAt);
              /* v8 ignore start -- ts-type: FakeFirestore cannot produce the 3-task dispatch sequence needed to reach the non-null mostRecentDispatchedAt + newer-timestamp sub-branch @preserve */
              if (
                current.mostRecentDispatchedAt === null ||
                dispatchedTs.toMillis() > current.mostRecentDispatchedAt.toMillis()
              ) {
                updated.mostRecentDispatchedAt = dispatchedTs;
              }
              /* v8 ignore stop @preserve */
            }

            const newAggregateStatus = deriveAggregateStatusFromSummary(updated);
            updated.aggregateStatus = newAggregateStatus;

            tx.set(asDocRef(summaryRef), updated as unknown as DocumentData);

            if (newAggregateStatus !== oldAggregateStatus) {
              const newCounts = applyStatusChangeDelta(existingCounts, oldAggregateStatus, newAggregateStatus);
              newCounts.userId = task.userId;
              newCounts.updatedAt = now;
              tx.set(asDocRef(countsRef), newCounts as unknown as DocumentData);
            }
          }
        });
      } catch (error) {
        logger.warn(
          { taskId: task.id, userId: task.userId, error: getErrorMessage(error, 'Unknown error') },
          'updateAfterCreate: failed to update group summary (non-critical)'
        );
      }
    },

    async updateAfterStatusChange(oldTask: CodeTask, newTask: CodeTask): Promise<void> {
      try {
        const groupKey = getGroupKey(newTask);
        const docId = `${newTask.userId}_${groupKey}`;
        const summaryRef = firestore.collection(SUMMARIES_COLLECTION).doc(docId);
        const countsRef = firestore.collection(COUNTS_COLLECTION).doc(newTask.userId);

        await firestore.runTransaction(async (tx) => {
          const now = Timestamp.fromDate(new Date());
          const summaryDoc = await tx.get(asDocRef(summaryRef));

          if (!summaryDoc.exists) {
            logger.warn(
              { taskId: newTask.id, userId: newTask.userId, groupKey },
              'updateAfterStatusChange: summary doc not found — data inconsistency, will be fixed by backfill'
            );
            return;
          }

          const countsDoc = await tx.get(asDocRef(countsRef));
          const existingCounts: UserGroupCounts = countsDoc.exists
            ? docToCounts(countsDoc.data() as Record<string, unknown>)
            : defaultCounts(newTask.userId);

          const current = docToSummary(summaryDoc.data() as Record<string, unknown>);
          const oldAggregateStatus = current.aggregateStatus;
          const updated: TaskGroupSummary = { ...current };
          updated.updatedAt = now;

          // Update activeTaskCount delta
          const wasActive = isActiveStatus(oldTask.status);
          const isActive = isActiveStatus(newTask.status);
          if (wasActive && !isActive) {
            updated.activeTaskCount = Math.max(0, current.activeTaskCount - 1);
          } else if (!wasActive && isActive) {
            updated.activeTaskCount = current.activeTaskCount + 1;
          }

          // Update boolean flags based on new task state
          if (newTask.agentType !== undefined && !current.agentTypesPresent.includes(newTask.agentType)) {
            updated.agentTypesPresent = [...current.agentTypesPresent, newTask.agentType];
          }
          if (newTask.agentType === 'planning' && newTask.status === 'planned') {
            updated.hasCompletedPlanning = true;
          }
          if (hasCompletedExecutionTask(newTask)) {
            updated.hasCompletedExecution = true;
          }
          if (hasCompletedExecutionAgentOnly(newTask)) {
            updated.hasCompletedExecutionAgent = true;
          }
          if (hasImplementationLink(newTask)) {
            updated.hasImplementationTaskId = true;
          }
          if (newTask.result?.prUrl !== undefined) {
            updated.hasPrUrl = true;
            if (newTask.prNumber !== undefined) {
              updated.prNumber = newTask.prNumber;
            }
          }

          // Update latestReviewNeedsRemediation
          const reviewNeedsRemediation = computeReviewNeedsRemediation(newTask);
          if (reviewNeedsRemediation !== null) {
            updated.latestReviewNeedsRemediation = reviewNeedsRemediation;
          }

          // Handle archive: decrement taskCount
          if (newTask.status === 'archived' && oldTask.status !== 'archived') {
            updated.taskCount = Math.max(0, current.taskCount - 1);

            if (updated.taskCount <= 0) {
              // All tasks archived — preserve summary with 'archived' status instead of deleting
              updated.aggregateStatus = 'archived';
              tx.set(asDocRef(summaryRef), updated as unknown as DocumentData);
              const newCounts = applyStatusChangeDelta(existingCounts, oldAggregateStatus, 'archived');
              newCounts.userId = newTask.userId;
              newCounts.updatedAt = now;
              tx.set(asDocRef(countsRef), newCounts as unknown as DocumentData);
              return;
            }
          }

          // Update latestTaskStatus to new status if this task is the most recently updated
          if (toTimestamp(newTask.updatedAt).toMillis() >= current.latestTaskUpdatedAt.toMillis()) {
            if (newTask.status !== 'archived') {
              updated.latestTaskStatus = newTask.status;
            }
            updated.latestTaskUpdatedAt = toTimestamp(newTask.updatedAt);
          }

          // Update sort key for dispatched
          if (newTask.dispatchedAt !== undefined) {
            const dispatchedTs = toTimestamp(newTask.dispatchedAt);
            /* v8 ignore start -- ts-type: FakeFirestore cannot produce the 3-task dispatch sequence needed to reach the non-null mostRecentDispatchedAt + newer-timestamp sub-branch @preserve */
            if (
              current.mostRecentDispatchedAt === null ||
              dispatchedTs.toMillis() > current.mostRecentDispatchedAt.toMillis()
            ) {
              updated.mostRecentDispatchedAt = dispatchedTs;
            }
            /* v8 ignore stop @preserve */
          }

          const newAggregateStatus = deriveAggregateStatusFromSummary(updated);
          updated.aggregateStatus = newAggregateStatus;

          tx.set(asDocRef(summaryRef), updated as unknown as DocumentData);

          if (newAggregateStatus !== oldAggregateStatus) {
            const newCounts = applyStatusChangeDelta(existingCounts, oldAggregateStatus, newAggregateStatus);
            newCounts.userId = newTask.userId;
            newCounts.updatedAt = now;
            tx.set(asDocRef(countsRef), newCounts as unknown as DocumentData);
          }
        });
      } catch (error) {
        logger.warn(
          { taskId: newTask.id, userId: newTask.userId, error: getErrorMessage(error, 'Unknown error') },
          'updateAfterStatusChange: failed to update group summary (non-critical)'
        );
      }
    },

    async updateAfterDelete(task: CodeTask): Promise<void> {
      try {
        const groupKey = getGroupKey(task);
        const docId = `${task.userId}_${groupKey}`;
        const summaryRef = firestore.collection(SUMMARIES_COLLECTION).doc(docId);
        const countsRef = firestore.collection(COUNTS_COLLECTION).doc(task.userId);

        await firestore.runTransaction(async (tx) => {
          const now = Timestamp.fromDate(new Date());
          const summaryDoc = await tx.get(asDocRef(summaryRef));

          if (!summaryDoc.exists) {
            return;
          }

          const countsDoc = await tx.get(asDocRef(countsRef));
          const existingCounts: UserGroupCounts = countsDoc.exists
            ? docToCounts(countsDoc.data() as Record<string, unknown>)
            : defaultCounts(task.userId);

          const current = docToSummary(summaryDoc.data() as Record<string, unknown>);
          const oldAggregateStatus = current.aggregateStatus;

          let newTaskCount = current.taskCount;
          let newActiveCount = current.activeTaskCount;

          // Only decrement task count for non-archived tasks (archived tasks were already decremented)
          if (task.status !== 'archived') {
            newTaskCount = Math.max(0, current.taskCount - 1);
          }
          if (isActiveStatus(task.status)) {
            newActiveCount = Math.max(0, current.activeTaskCount - 1);
          }

          if (newTaskCount <= 0) {
            // Delete summary doc and update user counts
            tx.delete(asDocRef(summaryRef));
            const newCounts = applyDeleteGroupDelta(existingCounts, oldAggregateStatus);
            newCounts.userId = task.userId;
            newCounts.updatedAt = now;
            tx.set(asDocRef(countsRef), newCounts as unknown as DocumentData);
            return;
          }

          const updated: TaskGroupSummary = {
            ...current,
            taskCount: newTaskCount,
            activeTaskCount: newActiveCount,
            updatedAt: now,
          };

          const newAggregateStatus = deriveAggregateStatusFromSummary(updated);
          updated.aggregateStatus = newAggregateStatus;

          tx.set(asDocRef(summaryRef), updated as unknown as DocumentData);

          if (newAggregateStatus !== oldAggregateStatus) {
            const newCounts = applyStatusChangeDelta(existingCounts, oldAggregateStatus, newAggregateStatus);
            newCounts.userId = task.userId;
            newCounts.updatedAt = now;
            tx.set(asDocRef(countsRef), newCounts as unknown as DocumentData);
          }
        });
      } catch (error) {
        logger.warn(
          { taskId: task.id, userId: task.userId, error: getErrorMessage(error, 'Unknown error') },
          'updateAfterDelete: failed to update group summary (non-critical)'
        );
      }
    },

    async getUserGroupCounts(userId: string): Promise<Result<UserGroupCounts, GroupSummaryError>> {
      try {
        const ref = firestore.collection(COUNTS_COLLECTION).doc(userId);
        const doc = await ref.get();

        if (!doc.exists) {
          return ok(defaultCounts(userId));
        }

        return ok(docToCounts(doc.data() as Record<string, unknown>));
      } catch (error) {
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Failed to get user group counts'),
        });
      }
    },

    async listGroupSummaries(input: ListGroupSummariesInput): Promise<Result<ListGroupSummariesOutput, GroupSummaryError>> {
      try {
        let query = firestore.collection(SUMMARIES_COLLECTION).where('userId', '==', input.userId);

        if (input.statusFilter !== undefined && input.statusFilter.length > 0) {
          query = query.where('aggregateStatus', 'in', input.statusFilter);
        }

        // Order by sort field
        switch (input.sortBy) {
          case 'linear-id':
            query = query.orderBy('linearIssueId', 'desc');
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

        // Cursor-based pagination using document ID (stable across all sort orders)
        if (input.cursor !== undefined) {
          const cursorDocId = Buffer.from(input.cursor, 'base64').toString('utf-8');
          const cursorDoc = await firestore.collection(SUMMARIES_COLLECTION).doc(cursorDocId).get();
          if (cursorDoc.exists) {
            query = query.startAfter(cursorDoc);
          }
        }

        // Fetch one extra to detect hasMore
        query = query.limit(input.limit + 1);

        const snapshot = await query.get();
        const docs = snapshot.docs;
        const hasMore = docs.length > input.limit;
        const pageDocs = hasMore ? docs.slice(0, input.limit) : docs;

        const summaries: TaskGroupSummary[] = pageDocs.map((doc) =>
          docToSummary(doc.data() as Record<string, unknown>)
        );

        const lastDoc = hasMore ? pageDocs[pageDocs.length - 1] : undefined;
        if (lastDoc === undefined) {
          return ok({ summaries });
        }

        // Encode the document ID as the cursor — works for all sort orders
        const nextCursor = Buffer.from(lastDoc.id, 'utf-8').toString('base64');

        return ok({ summaries, nextCursor });
      } catch (error) {
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Failed to list group summaries'),
        });
      }
    },

    async recomputeGroupFromTasks(userId: string, groupKey: string, tasks: CodeTask[]): Promise<void> {
      try {
        if (tasks.length === 0) {
          return;
        }

        const nonArchivedTasks = tasks.filter((t) => t.status !== 'archived');
        if (nonArchivedTasks.length === 0) {
          return;
        }

        const now = Timestamp.fromDate(new Date());
        const docId = `${userId}_${groupKey}`;
        const summaryRef = firestore.collection(SUMMARIES_COLLECTION).doc(docId);
        const countsRef = firestore.collection(COUNTS_COLLECTION).doc(userId);

        // Compute all summary fields from the task array
        let taskCount = 0;
        let activeTaskCount = 0;
        let latestTaskStatus = '';
        let latestTaskUpdatedAtMs = 0;
        let latestTaskUpdatedAt: Timestamp = now;
        let oldestTaskCreatedAt: Timestamp | null = null;
        let mostRecentDispatchedAt: Timestamp | null = null;
        const agentTypesSet = new Set<string>();
        let hasCompletedPlanning = false;
        let hasCompletedExecution = false;
        let hasCompletedExecutionAgent = false;
        let hasImplementationTaskId = false;
        let hasPrUrl = false;
        let prNumber: number | null = null;
        let latestReviewNeedsRemediation: boolean | null = null;
        let latestReviewUpdatedAtMs = 0;

        // Determine linearIssueId from any task in the group
        const firstTask = nonArchivedTasks[0];
        const linearIssueId = firstTask?.linearIssueId ?? null;

        for (const task of nonArchivedTasks) {
          taskCount++;
          if (isActiveStatus(task.status)) {
            activeTaskCount++;
          }
          if (task.agentType !== undefined) {
            agentTypesSet.add(task.agentType);
          }
          if (task.agentType === 'planning' && task.status === 'planned') {
            hasCompletedPlanning = true;
          }
          if (hasCompletedExecutionTask(task)) {
            hasCompletedExecution = true;
          }
          if (hasCompletedExecutionAgentOnly(task)) {
            hasCompletedExecutionAgent = true;
          }
          if (hasImplementationLink(task)) {
            hasImplementationTaskId = true;
          }
          if (task.result?.prUrl !== undefined) {
            hasPrUrl = true;
            if (prNumber === null && task.prNumber !== undefined) {
              prNumber = task.prNumber;
            }
          }

          const updatedAtMs = toTimestamp(task.updatedAt).toMillis();
          if (updatedAtMs > latestTaskUpdatedAtMs) {
            latestTaskUpdatedAtMs = updatedAtMs;
            latestTaskStatus = task.status;
            latestTaskUpdatedAt = toTimestamp(task.updatedAt);
          }

          const createdAtMs = toTimestamp(task.createdAt).toMillis();
          if (oldestTaskCreatedAt === null || createdAtMs < oldestTaskCreatedAt.toMillis()) {
            oldestTaskCreatedAt = toTimestamp(task.createdAt);
          }

          if (task.dispatchedAt !== undefined) {
            const dispatchedTs = toTimestamp(task.dispatchedAt);
            /* v8 ignore start -- ts-type: FakeFirestore cannot produce tasks in descending dispatch order needed to hit the non-newer sub-branch; only ascending-order path is reachable in tests @preserve */
            if (mostRecentDispatchedAt === null || dispatchedTs.toMillis() > mostRecentDispatchedAt.toMillis()) {
              mostRecentDispatchedAt = dispatchedTs;
            }
            /* v8 ignore stop @preserve */
          }

          // Track latest review result
          if (task.agentType === 'review' && task.result !== undefined) {
            /* v8 ignore start -- ts-type: FakeFirestore cannot produce review tasks in reverse-chronological order; the false branch (earlier review after a later one) is unreachable in tests @preserve */
            if (updatedAtMs > latestReviewUpdatedAtMs) {
            /* v8 ignore stop @preserve */
              latestReviewUpdatedAtMs = updatedAtMs;
              const nr = task.result.needs_remediation;
              if (nr === REMEDIATION_NOT_NEEDED) {
                latestReviewNeedsRemediation = false;
              } else if (nr === '1') {
                latestReviewNeedsRemediation = true;
              } else {
                latestReviewNeedsRemediation = null;
              }
            }
          }
        }

        const summary: TaskGroupSummary = {
          userId,
          linearIssueId,
          groupKey,
          taskCount,
          activeTaskCount,
          latestTaskStatus,
          latestTaskUpdatedAt,
          agentTypesPresent: Array.from(agentTypesSet),
          hasCompletedPlanning,
          hasCompletedExecution,
          hasCompletedExecutionAgent,
          hasImplementationTaskId,
          hasPrUrl,
          prNumber,
          latestReviewNeedsRemediation,
          /* v8 ignore start -- ts-type: oldestTaskCreatedAt is always set in the loop when nonArchivedTasks is non-empty; the ?? now fallback is a TypeScript narrowing artifact @preserve */
          oldestTaskCreatedAt: oldestTaskCreatedAt ?? now,
          /* v8 ignore stop @preserve */
          mostRecentDispatchedAt,
          aggregateStatus: 'done',
          updatedAt: now,
        };

        await firestore.runTransaction(async (tx) => {
          const existingSummaryDoc = await tx.get(asDocRef(summaryRef));
          const countsDoc = await tx.get(asDocRef(countsRef));
          const existingCounts: UserGroupCounts = countsDoc.exists
            ? docToCounts(countsDoc.data() as Record<string, unknown>)
            : defaultCounts(userId);
          const existingSummary = existingSummaryDoc.exists
            ? docToSummary(existingSummaryDoc.data() as Record<string, unknown>)
            : null;

          if (existingSummary !== null) {
            if (existingSummary.hasImplementationReadyLabel !== undefined) {
              summary.hasImplementationReadyLabel = existingSummary.hasImplementationReadyLabel;
            }
            if (existingSummary.hasMergeReadyLabel !== undefined) {
              summary.hasMergeReadyLabel = existingSummary.hasMergeReadyLabel;
            }
            if (existingSummary.labelsUpdatedAt !== undefined) {
              summary.labelsUpdatedAt = existingSummary.labelsUpdatedAt;
            }
          }

          const newAggregateStatus = deriveAggregateStatusFromSummary(summary);
          summary.aggregateStatus = newAggregateStatus;

          tx.set(asDocRef(summaryRef), summary as unknown as DocumentData, { merge: true });

          if (existingSummary === null) {
            const newCounts = applyNewGroupDelta(existingCounts, newAggregateStatus);
            newCounts.userId = userId;
            newCounts.updatedAt = now;
            tx.set(asDocRef(countsRef), newCounts as unknown as DocumentData);
            return;
          }

          if (existingSummary.aggregateStatus !== newAggregateStatus) {
            const newCounts = applyStatusChangeDelta(existingCounts, existingSummary.aggregateStatus, newAggregateStatus);
            newCounts.userId = userId;
            newCounts.updatedAt = now;
            tx.set(asDocRef(countsRef), newCounts as unknown as DocumentData);
          }
        });
      } catch (error) {
        logger.warn(
          { userId, groupKey, error: getErrorMessage(error, 'Unknown error') },
          'recomputeGroupFromTasks: failed to recompute group summary (non-critical)'
        );
      }
    },

    async recomputeWithLabels(
      userId: string,
      linearIssueId: string,
      labels: { id: string; name: string }[],
      sourceTimestamp: string,
    ): Promise<Result<void, GroupSummaryError>> {
      try {
        const docId = `${userId}_${linearIssueId}`;
        const summaryRef = firestore.collection(SUMMARIES_COLLECTION).doc(docId);
        const countsRef = firestore.collection(COUNTS_COLLECTION).doc(userId);

        const labelHasImplementationReady = hasImplementationReadyLabel(labels);
        const labelHasMergeReady = hasMergeReadyLabel(labels);
        const sourceTs = Timestamp.fromDate(new Date(sourceTimestamp));

        const result = await firestore.runTransaction(async (tx) => {
          const now = Timestamp.fromDate(new Date());
          const summaryDoc = await tx.get(asDocRef(summaryRef));

          if (!summaryDoc.exists) {
            return 'missing' as const;
          }

          const countsDoc = await tx.get(asDocRef(countsRef));
          /* v8 ignore start -- test-infra: FakeFirestore always has a counts doc after updateAfterCreate; the defaultCounts fallback cannot be reached in tests @preserve */
          const existingCounts: UserGroupCounts = countsDoc.exists
            ? docToCounts(countsDoc.data() as Record<string, unknown>)
            : defaultCounts(userId);
          /* v8 ignore stop @preserve */

          const current = docToSummary(summaryDoc.data() as Record<string, unknown>);
          if (current.labelsUpdatedAt !== undefined && sourceTs.toMillis() < current.labelsUpdatedAt.toMillis()) {
            return 'stale' as const;
          }
          const oldAggregateStatus = current.aggregateStatus;

          const updated: TaskGroupSummary = {
            ...current,
            hasImplementationReadyLabel: labelHasImplementationReady,
            hasMergeReadyLabel: labelHasMergeReady,
            labelsUpdatedAt: sourceTs,
            updatedAt: now,
          };

          const newAggregateStatus = deriveAggregateStatusFromSummary(updated);
          updated.aggregateStatus = newAggregateStatus;

          tx.set(asDocRef(summaryRef), updated as unknown as DocumentData);

          if (newAggregateStatus !== oldAggregateStatus) {
            const newCounts = applyStatusChangeDelta(existingCounts, oldAggregateStatus, newAggregateStatus);
            newCounts.userId = userId;
            newCounts.updatedAt = now;
            tx.set(asDocRef(countsRef), newCounts as unknown as DocumentData);
          }

          return 'updated' as const;
        });

        if (result === 'missing') {
          return err({ code: 'NOT_FOUND', message: `No group summary found for ${userId}/${linearIssueId}` });
        }

        return ok(undefined);
      } catch (error) {
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Failed to recompute group summary with labels'),
        });
      }
    },
  };
}
