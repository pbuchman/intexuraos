import type { Firestore } from '@google-cloud/firestore';
import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import { getLinearIssueSortFields } from '../../infra/firestore/taskGroupSummary/serializer.js';
import { paginatedScan } from '../../infra/firestore/paginatedScan.js';

const SUMMARIES_COLLECTION = 'task_group_summaries';
const DEFAULT_BATCH_SIZE = 500;

export interface TaskGroupSummarySortKeyBackfillUpdate {
  docId: string;
  linearIssueId: string | null;
  before: {
    linearIssueNumber: unknown;
    linearIssueSortKey: unknown;
  };
  after: {
    linearIssueNumber: number | null;
    linearIssueSortKey: number;
  };
}

export interface TaskGroupSummarySortKeyBackfillResult {
  dryRun: boolean;
  scanned: number;
  updated: number;
  updates: TaskGroupSummarySortKeyBackfillUpdate[];
}

export interface RunTaskGroupSummarySortKeyBackfillInput {
  firestore: Firestore;
  dryRun?: boolean;
  batchSize?: number;
}

function normalizeLinearIssueId(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function needsUpdate(
  data: Record<string, unknown>,
  expected: TaskGroupSummarySortKeyBackfillUpdate['after'],
): boolean {
  return data['linearIssueNumber'] !== expected.linearIssueNumber ||
    data['linearIssueSortKey'] !== expected.linearIssueSortKey;
}

export async function runTaskGroupSummarySortKeyBackfill(
  input: RunTaskGroupSummarySortKeyBackfillInput,
): Promise<Result<TaskGroupSummarySortKeyBackfillResult>> {
  const dryRun = input.dryRun === true;
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;

  try {
    const updates: TaskGroupSummarySortKeyBackfillUpdate[] = [];
    let scanned = 0;

    for await (const doc of paginatedScan(input.firestore.collection(SUMMARIES_COLLECTION), { batchSize })) {
      scanned++;
      const data = doc.data() as Record<string, unknown>;
      const linearIssueId = normalizeLinearIssueId(data['linearIssueId']);
      const expected = getLinearIssueSortFields(linearIssueId);

      if (!needsUpdate(data, expected)) {
        continue;
      }

      updates.push({
        docId: doc.id,
        linearIssueId,
        before: {
          linearIssueNumber: data['linearIssueNumber'],
          linearIssueSortKey: data['linearIssueSortKey'],
        },
        after: expected,
      });
    }

    if (!dryRun) {
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = input.firestore.batch();
        for (const update of updates.slice(i, i + batchSize)) {
          batch.set(
            input.firestore.collection(SUMMARIES_COLLECTION).doc(update.docId),
            update.after,
            { merge: true },
          );
        }
        await batch.commit();
      }
    }

    return ok({
      dryRun,
      scanned,
      updated: updates.length,
      updates,
    });
  } catch (error) {
    return err(new Error(getErrorMessage(error, 'Failed to backfill task group summary sort keys')));
  }
}
