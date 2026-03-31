/**
 * One-time backfill script: populates task_group_summaries and user_group_counts
 * from existing non-archived code_tasks.
 *
 * Usage:
 *   npx tsx apps/code-agent/src/scripts/backfillGroupSummaries.ts
 *
 * Idempotent — uses .set() (overwrite). Safe to re-run.
 */

/* eslint-disable no-console, @typescript-eslint/restrict-template-expressions */

import { Firestore, Timestamp } from '@google-cloud/firestore';
import { deriveAggregateStatusFromSummary } from '../domain/issueGrouping/deriveAggregateStatusFromSummary.js';
import type { TaskGroupSummary, UserGroupCounts } from '../domain/models/taskGroupSummary.js';
import type { CodeTask } from '../domain/models/codeTask.js';

// Mirror of constants.ts — inlined to avoid circular import issues in standalone script context
const NON_ARCHIVED_STATUSES = [
  'queued', 'dispatched', 'running', 'planned', 'implemented', 'reviewed', 'failed', 'interrupted', 'cancelled',
] as const;

const ACTIVE_STATUSES = new Set(['queued', 'dispatched', 'running']);
const REMEDIATION_NOT_NEEDED = '0';

const SUMMARIES_COLLECTION = 'task_group_summaries';
const COUNTS_COLLECTION = 'user_group_counts';

/** Maximum Firestore batch size. */
const BATCH_SIZE = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGroupKey(task: CodeTask): string {
  if (task.linearIssueId !== undefined) {
    return task.linearIssueId;
  }
  return `standalone_${task.id}`;
}

function toTimestamp(value: unknown): Timestamp {
  if (value instanceof Timestamp) {
    return value;
  }
  if (value instanceof Date) {
    return Timestamp.fromDate(value);
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if ('toDate' in obj && typeof obj['toDate'] === 'function') {
      // Firestore Timestamp-like object
      return obj as unknown as Timestamp;
    }
    if ('_seconds' in obj && typeof obj['_seconds'] === 'number') {
      const seconds = obj['_seconds'];
      const nanos = typeof obj['_nanoseconds'] === 'number' ? obj['_nanoseconds'] : 0;
      return new Timestamp(seconds, nanos);
    }
  }
  // Fallback — should not occur for well-formed task data
  return Timestamp.now();
}

function computeSummaryFromTasks(
  userId: string,
  groupKey: string,
  tasks: CodeTask[],
  now: Timestamp,
): TaskGroupSummary {
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
  let hasImplementationTaskId = false;
  let hasPrUrl = false;
  let prNumber: number | null = null;
  let latestReviewNeedsRemediation: boolean | null = null;
  let latestReviewUpdatedAtMs = 0;

  const firstTask = tasks[0];
  const linearIssueId = firstTask?.linearIssueId ?? null;

  for (const task of tasks) {
    taskCount++;

    if (ACTIVE_STATUSES.has(task.status)) {
      activeTaskCount++;
    }

    if (task.agentType !== undefined) {
      agentTypesSet.add(task.agentType);
    }

    if (task.agentType === 'planning' && task.status === 'planned') {
      hasCompletedPlanning = true;
    }

    if (
      (task.agentType === 'execution' && (task.status === 'implemented' || task.status === 'reviewed')) ||
      (task.agentType === 'review' && task.status === 'reviewed')
    ) {
      hasCompletedExecution = true;
    }

    if (task.implementationTaskId !== undefined) {
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
      if (mostRecentDispatchedAt === null || dispatchedTs.toMillis() > mostRecentDispatchedAt.toMillis()) {
        mostRecentDispatchedAt = dispatchedTs;
      }
    }

    // Track latest review result (by updatedAt)
    if (task.agentType === 'review' && task.result !== undefined) {
      if (updatedAtMs > latestReviewUpdatedAtMs) {
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

  const summaryFields = {
    activeTaskCount,
    hasCompletedPlanning,
    hasCompletedExecution,
    hasImplementationTaskId,
    hasPrUrl,
    latestTaskStatus,
    latestReviewNeedsRemediation,
  };

  const aggregateStatus = deriveAggregateStatusFromSummary(summaryFields);

  return {
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
    hasImplementationTaskId,
    hasPrUrl,
    prNumber,
    latestReviewNeedsRemediation,
    oldestTaskCreatedAt: oldestTaskCreatedAt ?? now,
    mostRecentDispatchedAt,
    aggregateStatus,
    updatedAt: now,
  };
}

function computeUserGroupCounts(
  userId: string,
  summaries: TaskGroupSummary[],
  now: Timestamp,
): UserGroupCounts {
  let active = 0;
  let needsAction = 0;
  let done = 0;
  let failed = 0;

  for (const summary of summaries) {
    switch (summary.aggregateStatus) {
      case 'active':
        active++;
        break;
      case 'needs-action':
        needsAction++;
        break;
      case 'done':
        done++;
        break;
      case 'failed':
        failed++;
        break;
    }
  }

  return {
    userId,
    active,
    needsAction,
    done,
    failed,
    totalGroups: summaries.length,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const db = new Firestore();
  const now = Timestamp.fromDate(new Date());

  console.log('Fetching all non-archived tasks from code_tasks...');

  const snapshot = await db
    .collection('code_tasks')
    .where('status', 'in', [...NON_ARCHIVED_STATUSES])
    .orderBy('createdAt', 'desc')
    .get();

  const allTasks = snapshot.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      ...data,
      id: doc.id,
    } as CodeTask;
  });

  console.log(`Fetched ${allTasks.length} non-archived tasks.`);

  // Group tasks by (userId, groupKey)
  const groupMap = new Map<string, { userId: string; groupKey: string; tasks: CodeTask[] }>();

  for (const task of allTasks) {
    const groupKey = getGroupKey(task);
    const mapKey = `${task.userId}_${groupKey}`;

    const existing = groupMap.get(mapKey);
    if (existing !== undefined) {
      existing.tasks.push(task);
    } else {
      groupMap.set(mapKey, { userId: task.userId, groupKey, tasks: [task] });
    }
  }

  console.log(`Found ${groupMap.size} unique groups across ${new Set(allTasks.map((t) => t.userId)).size} users.`);

  // Compute summaries for all groups, indexed by docId for O(1) lookup
  const summaryMap = new Map<string, TaskGroupSummary>();
  const summariesByUser = new Map<string, TaskGroupSummary[]>();

  for (const [mapKey, { userId, groupKey, tasks }] of groupMap) {
    const summary = computeSummaryFromTasks(userId, groupKey, tasks, now);
    summaryMap.set(mapKey, summary);

    const existing = summariesByUser.get(userId);
    if (existing !== undefined) {
      existing.push(summary);
    } else {
      summariesByUser.set(userId, [summary]);
    }
  }

  // Compute user group counts
  const userCounts = new Map<string, UserGroupCounts>();
  for (const [userId, summaries] of summariesByUser) {
    userCounts.set(userId, computeUserGroupCounts(userId, summaries, now));
  }

  // Write summaries and counts in batches
  const allWrites: { docId: string; collection: string; data: object }[] = [];

  for (const [mapKey, summary] of summaryMap) {
    allWrites.push({ docId: mapKey, collection: SUMMARIES_COLLECTION, data: summary });
  }

  for (const [userId, counts] of userCounts) {
    allWrites.push({ docId: userId, collection: COUNTS_COLLECTION, data: counts });
  }

  console.log(`Writing ${allWrites.length} documents (${groupMap.size} summaries + ${userCounts.size} user counts)...`);

  let writtenCount = 0;

  for (let i = 0; i < allWrites.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = allWrites.slice(i, i + BATCH_SIZE);

    for (const write of chunk) {
      const ref = db.collection(write.collection).doc(write.docId);
      batch.set(ref, write.data);
    }

    await batch.commit();
    writtenCount += chunk.length;
    console.log(`  Committed batch: ${writtenCount}/${allWrites.length} documents written`);
  }

  const userCount = summariesByUser.size;
  console.log(
    `Backfill complete. Processed ${allTasks.length} tasks, ${groupMap.size} groups for ${userCount} users.`
  );
}

main().catch((error: unknown) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
