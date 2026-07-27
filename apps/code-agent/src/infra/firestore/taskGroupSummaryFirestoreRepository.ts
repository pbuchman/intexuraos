/**
 * Firestore implementation of TaskGroupSummaryRepository.
 * Thin adapter — delegates to `./taskGroupSummary/{serializer,queries}.ts`.
 */
/* eslint-disable no-restricted-imports */
import { Timestamp, FieldValue } from '@google-cloud/firestore';
import type { DocumentData, Firestore, DocumentSnapshot, Transaction } from '@google-cloud/firestore';
import type { Logger, Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { TaskGroupSummaryRepository, ListGroupSummariesInput, ListGroupSummariesOutput, GroupSummaryError } from '../../domain/ports/taskGroupSummaryRepository.js';
import type { TaskGroupSummary, UserGroupCounts } from '../../domain/models/taskGroupSummary.js';
import type { CodeTask } from '../../domain/models/codeTask.js';
import { deriveAggregateStatusFromSummary } from '../../domain/issueGrouping/deriveAggregateStatusFromSummary.js';
import { hasImplementationReadyLabel, hasMergeReadyLabel } from '../../domain/issueGrouping/labelHelpers.js';
import {
  applyDeleteGroupDelta, applyDeleteUpdate, applyIncrementalCreateUpdate,
  applyNewGroupDelta, applyStatusChangeDelta, applyStatusChangeUpdate,
  buildInitialSummary, computeAllArchivedSummaryFromTasks, computeSummaryFromTasks, defaultCounts,
  docToCounts, docToSummary, getGroupKey,
} from './taskGroupSummary/serializer.js';
import { SUMMARIES_COLLECTION, buildListQuery, countsDocRef, summaryDocRef } from './taskGroupSummary/queries.js';
import { fromFirestoreDoc } from './task-serializer.js';

export interface RepairReadableTaskGroupSummaryRepository extends TaskGroupSummaryRepository {
  getSummary(userId: string, groupKey: string): Promise<Result<TaskGroupSummary | null, GroupSummaryError>>;
}

export function createTaskGroupSummaryFirestoreRepository(
  deps: { firestore: Firestore; logger: Logger; authoritativeTaskReads?: boolean }
): RepairReadableTaskGroupSummaryRepository {
  const { firestore, logger } = deps;
  const authoritativeTaskReads = deps.authoritativeTaskReads ?? true;

  async function loadPersistedGroupTasks(
    tx: Transaction,
    userId: string,
    groupKey: string,
  ): Promise<CodeTask[]> {
    if (groupKey.startsWith('standalone_')) {
      const taskId = groupKey.slice('standalone_'.length);
      const snapshot = await tx.get(firestore.collection('code_tasks').doc(taskId));
      if (!snapshot.exists) return [];
      const task = fromFirestoreDoc(snapshot);
      return task.userId === userId && task.agentType !== 'ask_agent' && getGroupKey(task) === groupKey
        ? [task]
        : [];
    }

    const snapshot = await tx.get(
      firestore.collection('code_tasks')
        .where('userId', '==', userId)
        .where('linearIssueId', '==', groupKey),
    );
    return snapshot.docs
      .map((doc) => fromFirestoreDoc(doc))
      .filter((task) => task.agentType !== 'ask_agent' && getGroupKey(task) === groupKey);
  }

  async function loadCounts(tx: Transaction, userId: string): Promise<UserGroupCounts> {
    const doc = await tx.get(countsDocRef(firestore, userId));
    return doc.exists ? docToCounts(doc.data() as Record<string, unknown>) : defaultCounts(userId);
  }

  function writeCounts(tx: Transaction, userId: string, counts: UserGroupCounts, now: Timestamp): void {
    tx.set(countsDocRef(firestore, userId), { ...counts, userId, updatedAt: now } as unknown as DocumentData);
  }

  function timestampsMatchExactly(left: Timestamp, right: Timestamp): boolean {
    return left.seconds === right.seconds && left.nanoseconds === right.nanoseconds;
  }

  function hasConsistentOwnershipState(summary: TaskGroupSummary): boolean {
    const taskIds = summary.taskIds;
    const statusById = summary.taskStatusById;
    const lifecycleAtById = summary.taskLifecycleAtById;
    if (
      taskIds === undefined ||
      statusById === undefined ||
      lifecycleAtById === undefined ||
      summary.latestTaskId === undefined ||
      summary.latestTaskCreatedAt === undefined ||
      summary.latestLifecycleTaskId === undefined
    ) return false;

    const uniqueTaskIds = new Set(taskIds);
    const statusIds = Object.keys(statusById);
    const lifecycleIds = Object.keys(lifecycleAtById);
    if (
      uniqueTaskIds.size !== taskIds.length ||
      summary.taskCount !== taskIds.length ||
      statusIds.length !== taskIds.length ||
      lifecycleIds.length !== taskIds.length ||
      !taskIds.every((id) => statusById[id] !== undefined && lifecycleAtById[id] !== undefined)
    ) return false;

    if (summary.taskCount === 0) {
      return summary.aggregateStatus === 'archived' && summary.activeTaskCount === 0;
    }
    const latestOwnedLifecycleAt = lifecycleAtById[summary.latestLifecycleTaskId] as Timestamp;
    if (
      !uniqueTaskIds.has(summary.latestTaskId) ||
      !uniqueTaskIds.has(summary.latestLifecycleTaskId) ||
      statusById[summary.latestTaskId] !== summary.latestTaskStatus ||
      !timestampsMatchExactly(latestOwnedLifecycleAt, summary.latestTaskUpdatedAt)
    ) return false;

    const activeTaskCount = statusIds.filter((id) => {
      const status = statusById[id];
      return status === 'queued' || status === 'dispatched' || status === 'running';
    }).length;
    return activeTaskCount === summary.activeTaskCount;
  }

  function preserveUserOwnedState(current: TaskGroupSummary, recomputed: TaskGroupSummary): void {
    if (current.hasImplementationReadyLabel !== undefined) {
      recomputed.hasImplementationReadyLabel = current.hasImplementationReadyLabel;
    }
    if (current.hasMergeReadyLabel !== undefined) {
      recomputed.hasMergeReadyLabel = current.hasMergeReadyLabel;
    }
    if (current.labelsUpdatedAt !== undefined) {
      recomputed.labelsUpdatedAt = current.labelsUpdatedAt;
    }
    if (current.isImportant !== undefined) {
      recomputed.isImportant = current.isImportant;
    }
  }

  function writeRecomputedGroup(
    tx: Transaction,
    userId: string,
    groupKey: string,
    sourceTasks: CodeTask[],
    current: TaskGroupSummary | null,
    existingCounts: UserGroupCounts,
    now: Timestamp,
    options: { includeArchivedShell: boolean; deleteWhenEmpty: boolean; replaceExisting: boolean },
  ): void {
    const summaryRef = summaryDocRef(firestore, userId, groupKey);
    const recomputed = computeSummaryFromTasks(userId, groupKey, sourceTasks, now) ??
      (options.includeArchivedShell
        ? computeAllArchivedSummaryFromTasks(userId, groupKey, sourceTasks, now)
        : null);

    if (recomputed === null) {
      if (!options.deleteWhenEmpty || current === null) return;
      tx.delete(summaryRef);
      writeCounts(tx, userId, applyDeleteGroupDelta(existingCounts, current.aggregateStatus), now);
      return;
    }

    if (current !== null) preserveUserOwnedState(current, recomputed);
    recomputed.aggregateStatus = deriveAggregateStatusFromSummary(recomputed);
    if (options.replaceExisting) {
      tx.set(summaryRef, recomputed as unknown as DocumentData);
    } else {
      tx.set(summaryRef, recomputed as unknown as DocumentData, { merge: true });
    }

    if (current === null) {
      writeCounts(tx, userId, applyNewGroupDelta(existingCounts, recomputed.aggregateStatus), now);
      return;
    }
    if (current.aggregateStatus !== recomputed.aggregateStatus) {
      writeCounts(
        tx,
        userId,
        applyStatusChangeDelta(existingCounts, current.aggregateStatus, recomputed.aggregateStatus),
        now,
      );
    }
  }

  async function recomputeGroup(
    userId: string,
    groupKey: string,
    suppliedTasks: CodeTask[],
    forceAuthoritativeRead: boolean,
  ): Promise<Result<void, GroupSummaryError>> {
    try {
      const summaryRef = summaryDocRef(firestore, userId, groupKey);
      await firestore.runTransaction(async (tx) => {
        const now = Timestamp.fromDate(new Date());
        const sourceTasks = forceAuthoritativeRead
          ? await loadPersistedGroupTasks(tx, userId, groupKey)
          : suppliedTasks;
        const existingSummaryDoc = await tx.get(summaryRef);
        const existingCounts = await loadCounts(tx, userId);
        const existingSummary = existingSummaryDoc.exists
          ? docToSummary(existingSummaryDoc.data() as Record<string, unknown>)
          : null;
        writeRecomputedGroup(tx, userId, groupKey, sourceTasks, existingSummary, existingCounts, now, {
          includeArchivedShell: forceAuthoritativeRead,
          deleteWhenEmpty: forceAuthoritativeRead,
          replaceExisting: forceAuthoritativeRead,
        });
      });
      return ok(undefined);
    } catch (error) {
      logger.warn(
        { userId, groupKey, error: getErrorMessage(error, 'Unknown error') },
        'recomputeGroup: failed to recompute group summary (non-critical)',
      );
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Failed to recompute group summary'),
      });
    }
  }

  return {
    async updateAfterCreate(task: CodeTask): Promise<void> {
      try {
        const summaryRef = summaryDocRef(firestore, task.userId, getGroupKey(task));
        await firestore.runTransaction(async (tx) => {
          let sourceTask = task;
          if (authoritativeTaskReads) {
            const taskDoc = await tx.get(firestore.collection('code_tasks').doc(task.id));
            if (!taskDoc.exists) return;
            sourceTask = fromFirestoreDoc(taskDoc);
            if (
              sourceTask.userId !== task.userId ||
              sourceTask.agentType === 'ask_agent' ||
              sourceTask.status === 'archived' ||
              getGroupKey(sourceTask) !== getGroupKey(task)
            ) return;
          }
          const now = Timestamp.fromDate(new Date());
          const summaryDoc = await tx.get(summaryRef);
          const existingCounts = await loadCounts(tx, task.userId);
          const current = summaryDoc.exists
            ? docToSummary(summaryDoc.data() as Record<string, unknown>)
            : null;

          const needsAuthoritativeRepair = authoritativeTaskReads && (
            current === null ||
            !hasConsistentOwnershipState(current) ||
            current.aggregateStatus === 'archived' ||
            current.taskCount <= 0
          );
          if (needsAuthoritativeRepair) {
            const groupKey = getGroupKey(sourceTask);
            const sourceTasks = await loadPersistedGroupTasks(tx, sourceTask.userId, groupKey);
            writeRecomputedGroup(
              tx,
              sourceTask.userId,
              groupKey,
              sourceTasks,
              current,
              existingCounts,
              now,
              { includeArchivedShell: true, deleteWhenEmpty: true, replaceExisting: true },
            );
            return;
          }

          if (current === null) {
            const initial = buildInitialSummary(sourceTask, now);
            const aggregateStatus = deriveAggregateStatusFromSummary(initial);
            const summary: TaskGroupSummary = { ...initial, aggregateStatus };
            tx.set(summaryRef, summary as unknown as DocumentData);
            if (sourceTask.status !== 'archived') {
              writeCounts(tx, task.userId, applyNewGroupDelta(existingCounts, aggregateStatus), now);
            }
            return;
          }

          const oldStatus = current.aggregateStatus;
          const updated = applyIncrementalCreateUpdate(current, sourceTask, now);
          tx.set(summaryRef, updated as unknown as DocumentData);
          if (updated.aggregateStatus !== oldStatus) {
            writeCounts(tx, task.userId, applyStatusChangeDelta(existingCounts, oldStatus, updated.aggregateStatus), now);
          }
        });
      } catch (error) {
        logger.warn(
          { taskId: task.id, userId: task.userId, error: getErrorMessage(error, 'Unknown error') },
          'updateAfterCreate: failed to update group summary (non-critical)',
        );
      }
    },

    async updateAfterStatusChange(oldTask: CodeTask, newTask: CodeTask): Promise<void> {
      try {
        const groupKey = getGroupKey(newTask);
        const summaryRef = summaryDocRef(firestore, newTask.userId, groupKey);
        await firestore.runTransaction(async (tx) => {
          let sourceTask = newTask;
          if (authoritativeTaskReads) {
            const taskDoc = await tx.get(firestore.collection('code_tasks').doc(newTask.id));
            if (!taskDoc.exists) return;
            sourceTask = fromFirestoreDoc(taskDoc);
            if (
              sourceTask.userId !== newTask.userId ||
              sourceTask.agentType === 'ask_agent' ||
              getGroupKey(sourceTask) !== groupKey
            ) return;
          }
          const now = Timestamp.fromDate(new Date());
          const summaryDoc = await tx.get(summaryRef);
          const current = summaryDoc.exists
            ? docToSummary(summaryDoc.data() as Record<string, unknown>)
            : null;
          const needsAuthoritativeRepair = authoritativeTaskReads && (
            current === null ||
            !hasConsistentOwnershipState(current) ||
            current.taskIds?.includes(sourceTask.id) !== true
          );
          if (needsAuthoritativeRepair) {
            const sourceTasks = await loadPersistedGroupTasks(tx, sourceTask.userId, groupKey);
            const existingCounts = await loadCounts(tx, sourceTask.userId);
            writeRecomputedGroup(
              tx,
              sourceTask.userId,
              groupKey,
              sourceTasks,
              current,
              existingCounts,
              now,
              { includeArchivedShell: true, deleteWhenEmpty: true, replaceExisting: true },
            );
            return;
          }
          if (current === null) {
            logger.warn(
              { taskId: newTask.id, userId: newTask.userId, groupKey },
              'updateAfterStatusChange: summary doc not found — data inconsistency, will be fixed by backfill',
            );
            return;
          }

          const existingCounts = await loadCounts(tx, newTask.userId);
          const oldStatus = current.aggregateStatus;
          const { updated, allArchived } = applyStatusChangeUpdate(current, oldTask, sourceTask, now);
          tx.set(summaryRef, updated as unknown as DocumentData);

          if (allArchived) {
            writeCounts(tx, newTask.userId, applyStatusChangeDelta(existingCounts, oldStatus, 'archived'), now);
            return;
          }
          if (updated.aggregateStatus !== oldStatus) {
            writeCounts(tx, newTask.userId, applyStatusChangeDelta(existingCounts, oldStatus, updated.aggregateStatus), now);
          }
        });
      } catch (error) {
        logger.warn(
          { taskId: newTask.id, userId: newTask.userId, error: getErrorMessage(error, 'Unknown error') },
          'updateAfterStatusChange: failed to update group summary (non-critical)',
        );
      }
    },

    async updateAfterDelete(task: CodeTask): Promise<void> {
      try {
        const summaryRef = summaryDocRef(firestore, task.userId, getGroupKey(task));
        await firestore.runTransaction(async (tx) => {
          const now = Timestamp.fromDate(new Date());
          const summaryDoc = await tx.get(summaryRef);
          if (!summaryDoc.exists) return;

          const existingCounts = await loadCounts(tx, task.userId);
          const current = docToSummary(summaryDoc.data() as Record<string, unknown>);
          const oldStatus = current.aggregateStatus;
          const { updated, shouldDelete } = applyDeleteUpdate(current, task, now);

          if (shouldDelete) {
            tx.delete(summaryRef);
            writeCounts(tx, task.userId, applyDeleteGroupDelta(existingCounts, oldStatus), now);
            return;
          }

          tx.set(summaryRef, updated as unknown as DocumentData);
          if (updated.aggregateStatus !== oldStatus) {
            writeCounts(tx, task.userId, applyStatusChangeDelta(existingCounts, oldStatus, updated.aggregateStatus), now);
          }
        });
      } catch (error) {
        logger.warn(
          { taskId: task.id, userId: task.userId, error: getErrorMessage(error, 'Unknown error') },
          'updateAfterDelete: failed to update group summary (non-critical)',
        );
      }
    },

    async getUserGroupCounts(userId: string): Promise<Result<UserGroupCounts, GroupSummaryError>> {
      try {
        const doc = await countsDocRef(firestore, userId).get();
        if (!doc.exists) return ok(defaultCounts(userId));
        return ok(docToCounts(doc.data() as Record<string, unknown>));
      } catch (error) {
        return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error, 'Failed to get user group counts') });
      }
    },

    async listGroupSummaries(input: ListGroupSummariesInput): Promise<Result<ListGroupSummariesOutput, GroupSummaryError>> {
      try {
        let startAfterDoc: DocumentSnapshot | undefined;
        if (input.cursor !== undefined) {
          const cursorDocId = Buffer.from(input.cursor, 'base64').toString('utf-8');
          const cursorDoc = await firestore.collection(SUMMARIES_COLLECTION).doc(cursorDocId).get();
          if (cursorDoc.exists) startAfterDoc = cursorDoc;
        }

        const query = startAfterDoc !== undefined
          ? buildListQuery(firestore, input, startAfterDoc)
          : buildListQuery(firestore, input);
        const snapshot = await query.get();
        const docs = snapshot.docs;
        const hasMore = docs.length > input.limit;
        const pageDocs = hasMore ? docs.slice(0, input.limit) : docs;

        const summaries: TaskGroupSummary[] = pageDocs.map((doc) =>
          docToSummary(doc.data() as Record<string, unknown>),
        );

        const lastDoc = hasMore ? pageDocs[pageDocs.length - 1] : undefined;
        if (lastDoc === undefined) return ok({ summaries });

        const nextCursor = Buffer.from(lastDoc.id, 'utf-8').toString('base64');
        return ok({ summaries, nextCursor });
      } catch (error) {
        return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error, 'Failed to list group summaries') });
      }
    },

    async getSummary(userId: string, groupKey: string): Promise<Result<TaskGroupSummary | null, GroupSummaryError>> {
      try {
        const snapshot = await summaryDocRef(firestore, userId, groupKey).get();
        if (!snapshot.exists) {
          return ok(null);
        }
        return ok(docToSummary(snapshot.data() as Record<string, unknown>));
      } catch (error) {
        return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error, 'Failed to get group summary') });
      }
    },

    async recomputeGroupFromTasks(
      userId: string,
      groupKey: string,
      tasks: CodeTask[],
    ): Promise<Result<void, GroupSummaryError>> {
      return await recomputeGroup(userId, groupKey, tasks, authoritativeTaskReads);
    },

    async recomputeGroupFromSource(
      userId: string,
      groupKey: string,
    ): Promise<Result<void, GroupSummaryError>> {
      return await recomputeGroup(userId, groupKey, [], true);
    },

    async recomputeWithLabels(
      userId: string,
      linearIssueId: string,
      labels: { id: string; name: string }[],
      sourceTimestamp: string,
    ): Promise<Result<void, GroupSummaryError>> {
      try {
        const summaryRef = summaryDocRef(firestore, userId, linearIssueId);
        const labelHasImplementationReady = hasImplementationReadyLabel(labels);
        const labelHasMergeReady = hasMergeReadyLabel(labels);
        const sourceTs = Timestamp.fromDate(new Date(sourceTimestamp));

        const result = await firestore.runTransaction(async (tx) => {
          const now = Timestamp.fromDate(new Date());
          const summaryDoc = await tx.get(summaryRef);
          if (!summaryDoc.exists) return 'missing' as const;

          const existingCounts = await loadCounts(tx, userId);
          const current = docToSummary(summaryDoc.data() as Record<string, unknown>);
          // Fully-archived groups skip label updates — avoids unnecessary status recomputation
          if (current.aggregateStatus === 'archived') return 'stale' as const;
          if (current.labelsUpdatedAt !== undefined && sourceTs.toMillis() < current.labelsUpdatedAt.toMillis()) {
            return 'stale' as const;
          }
          const oldStatus = current.aggregateStatus;

          const updated: TaskGroupSummary = {
            ...current,
            hasImplementationReadyLabel: labelHasImplementationReady,
            hasMergeReadyLabel: labelHasMergeReady,
            labelsUpdatedAt: sourceTs,
            updatedAt: now,
          };
          updated.aggregateStatus = deriveAggregateStatusFromSummary(updated);
          tx.set(summaryRef, updated as unknown as DocumentData);

          if (updated.aggregateStatus !== oldStatus) {
            writeCounts(tx, userId, applyStatusChangeDelta(existingCounts, oldStatus, updated.aggregateStatus), now);
          }
          return 'updated' as const;
        });

        if (result === 'missing') {
          return err({ code: 'NOT_FOUND', message: `No group summary found for ${userId}/${linearIssueId}` });
        }
        return ok(undefined);
      } catch (error) {
        return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error, 'Failed to recompute group summary with labels') });
      }
    },

    async setImportant(userId: string, groupKey: string, important: boolean): Promise<Result<void, GroupSummaryError>> {
      const docRef = summaryDocRef(firestore, userId, groupKey);
      try {
        const snapshot = await docRef.get();
        if (!snapshot.exists) {
          return err({ code: 'NOT_FOUND', message: `No group summary found for ${userId}/${groupKey}` });
        }
        if (important) {
          await docRef.update({ isImportant: true, updatedAt: Timestamp.now() });
        } else {
          await docRef.update({ isImportant: FieldValue.delete(), updatedAt: Timestamp.now() });
        }
        return ok(undefined);
      } catch (error) {
        return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
      }
    },
  };
}
