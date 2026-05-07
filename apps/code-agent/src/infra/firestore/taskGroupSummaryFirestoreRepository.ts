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
  buildInitialSummary, computeSummaryFromTasks, defaultCounts,
  docToCounts, docToSummary, getGroupKey,
} from './taskGroupSummary/serializer.js';
import { SUMMARIES_COLLECTION, buildListQuery, countsDocRef, summaryDocRef } from './taskGroupSummary/queries.js';

export function createTaskGroupSummaryFirestoreRepository(deps: { firestore: Firestore; logger: Logger }): TaskGroupSummaryRepository {
  const { firestore, logger } = deps;

  async function loadCounts(tx: Transaction, userId: string): Promise<UserGroupCounts> {
    const doc = await tx.get(countsDocRef(firestore, userId));
    return doc.exists ? docToCounts(doc.data() as Record<string, unknown>) : defaultCounts(userId);
  }

  function writeCounts(tx: Transaction, userId: string, counts: UserGroupCounts, now: Timestamp): void {
    tx.set(countsDocRef(firestore, userId), { ...counts, userId, updatedAt: now } as unknown as DocumentData);
  }

  return {
    async updateAfterCreate(task: CodeTask): Promise<void> {
      try {
        const summaryRef = summaryDocRef(firestore, task.userId, getGroupKey(task));
        await firestore.runTransaction(async (tx) => {
          const now = Timestamp.fromDate(new Date());
          const summaryDoc = await tx.get(summaryRef);
          const existingCounts = await loadCounts(tx, task.userId);

          if (!summaryDoc.exists) {
            const initial = buildInitialSummary(task, now);
            const aggregateStatus = deriveAggregateStatusFromSummary(initial);
            const summary: TaskGroupSummary = { ...initial, aggregateStatus };
            tx.set(summaryRef, summary as unknown as DocumentData);
            if (task.status !== 'archived') {
              writeCounts(tx, task.userId, applyNewGroupDelta(existingCounts, aggregateStatus), now);
            }
            return;
          }

          const current = docToSummary(summaryDoc.data() as Record<string, unknown>);
          const oldStatus = current.aggregateStatus;
          const updated = applyIncrementalCreateUpdate(current, task, now);
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
          const now = Timestamp.fromDate(new Date());
          const summaryDoc = await tx.get(summaryRef);
          if (!summaryDoc.exists) {
            logger.warn(
              { taskId: newTask.id, userId: newTask.userId, groupKey },
              'updateAfterStatusChange: summary doc not found — data inconsistency, will be fixed by backfill',
            );
            return;
          }

          const existingCounts = await loadCounts(tx, newTask.userId);
          const current = docToSummary(summaryDoc.data() as Record<string, unknown>);
          const oldStatus = current.aggregateStatus;
          const { updated, allArchived } = applyStatusChangeUpdate(current, oldTask, newTask, now);
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

    async recomputeGroupFromTasks(
      userId: string,
      groupKey: string,
      tasks: CodeTask[],
    ): Promise<Result<void, GroupSummaryError>> {
      try {
        if (tasks.length === 0) return ok(undefined);
        const now = Timestamp.fromDate(new Date());
        const summary = computeSummaryFromTasks(userId, groupKey, tasks, now);
        if (summary === null) return ok(undefined);

        const summaryRef = summaryDocRef(firestore, userId, groupKey);
        await firestore.runTransaction(async (tx) => {
          const existingSummaryDoc = await tx.get(summaryRef);
          const existingCounts = await loadCounts(tx, userId);
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

          summary.aggregateStatus = deriveAggregateStatusFromSummary(summary);
          tx.set(summaryRef, summary as unknown as DocumentData, { merge: true });

          if (existingSummary === null) {
            writeCounts(tx, userId, applyNewGroupDelta(existingCounts, summary.aggregateStatus), now);
            return;
          }
          if (existingSummary.aggregateStatus !== summary.aggregateStatus) {
            writeCounts(tx, userId, applyStatusChangeDelta(existingCounts, existingSummary.aggregateStatus, summary.aggregateStatus), now);
          }
        });
        return ok(undefined);
      } catch (error) {
        logger.warn(
          { userId, groupKey, error: getErrorMessage(error, 'Unknown error') },
          'recomputeGroupFromTasks: failed to recompute group summary (non-critical)',
        );
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Failed to recompute group summary'),
        });
      }
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
