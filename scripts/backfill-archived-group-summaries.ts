#!/usr/bin/env npx tsx
/**
 * One-time backfill: recreate group summaries for fully-archived task groups.
 *
 * Usage:
 *   npx tsx scripts/backfill-archived-group-summaries.ts [--dry-run]
 *
 * Logic:
 * 1. Query all code_tasks with status === 'archived'.
 * 2. Group by (userId, groupKey) where groupKey = linearIssueId || `standalone_${taskId}`.
 * 3. For each group, check if a task_group_summaries doc exists.
 * 4. If not, check if ANY non-archived task exists for that group.
 * 5. If no non-archived tasks exist, create a summary with aggregateStatus: 'archived'.
 * 6. Increment user_group_counts.archived and totalGroups for each created summary.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');
const PROJECT_ID = 'intexuraos-dev-pbuchman';
const SA_KEY_PATH = '/secrets/gcp-sa.json';

// ---------------------------------------------------------------------------
// Firebase initialization
// ---------------------------------------------------------------------------

if (getApps().length === 0) {
  if (existsSync(SA_KEY_PATH)) {
    const serviceAccount = JSON.parse(readFileSync(SA_KEY_PATH, 'utf-8')) as object;
    initializeApp({
      credential: cert(serviceAccount as Parameters<typeof cert>[0]),
      projectId: PROJECT_ID,
    });
    console.log(`Initialized Firebase with service account from ${SA_KEY_PATH}`);
  } else {
    // Use application default credentials (e.g., gcloud auth application-default login)
    const { applicationDefault } = await import('firebase-admin/app');
    initializeApp({
      credential: applicationDefault(),
      projectId: PROJECT_ID,
    });
    console.log('Initialized Firebase with application default credentials');
  }
}

const db = getFirestore();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUMMARIES_COLLECTION = 'task_group_summaries';
const COUNTS_COLLECTION = 'user_group_counts';
const TASKS_COLLECTION = 'code_tasks';
/** Firestore batch write limit is 500; use 400 to leave headroom. */
const BATCH_SIZE = 400;

const NON_ARCHIVED_STATUSES = [
  'queued',
  'dispatched',
  'running',
  'planned',
  'implemented',
  'reviewed',
  'failed',
  'interrupted',
  'cancelled',
] as const;

// ---------------------------------------------------------------------------
// Types (minimal, matching Firestore doc shapes)
// ---------------------------------------------------------------------------

interface ArchivedTask {
  id: string;
  userId: string;
  linearIssueId?: string;
  agentType?: string;
  status: string;
  result?: { prUrl?: string };
  prNumber?: number;
  createdAt: unknown;
  updatedAt: unknown;
  dispatchedAt?: unknown;
}

interface TaskGroupSummaryDoc {
  userId: string;
  linearIssueId: string | null;
  groupKey: string;
  taskCount: number;
  activeTaskCount: number;
  latestTaskStatus: string;
  latestTaskUpdatedAt: Timestamp;
  agentTypesPresent: string[];
  hasCompletedPlanning: boolean;
  hasCompletedExecution: boolean;
  hasCompletedExecutionAgent: boolean;
  hasImplementationTaskId: boolean;
  hasPrUrl: boolean;
  prNumber: number | null;
  latestReviewNeedsRemediation: boolean | null;
  oldestTaskCreatedAt: Timestamp;
  mostRecentDispatchedAt: Timestamp | null;
  aggregateStatus: string;
  updatedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGroupKey(task: ArchivedTask): string {
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
      return obj as unknown as Timestamp;
    }
    if ('_seconds' in obj && typeof obj['_seconds'] === 'number') {
      const seconds = obj['_seconds'];
      const nanos = typeof obj['_nanoseconds'] === 'number' ? obj['_nanoseconds'] : 0;
      return new Timestamp(seconds, nanos);
    }
  }
  return Timestamp.now();
}

function buildArchivedGroupSummary(
  userId: string,
  groupKey: string,
  tasks: ArchivedTask[],
  now: Timestamp,
): TaskGroupSummaryDoc {
  const firstTask = tasks[0];
  const linearIssueId = firstTask?.linearIssueId ?? null;

  const agentTypesSet = new Set<string>();
  let hasPrUrl = false;
  let prNumber: number | null = null;
  let oldestTaskCreatedAt: Timestamp | null = null;
  let latestTaskUpdatedAt: Timestamp = now;
  let latestTaskUpdatedAtMs = 0;
  let mostRecentDispatchedAt: Timestamp | null = null;

  for (const task of tasks) {
    if (task.agentType !== undefined) {
      agentTypesSet.add(task.agentType);
    }

    if (task.result?.prUrl !== undefined) {
      hasPrUrl = true;
      if (prNumber === null && task.prNumber !== undefined) {
        prNumber = task.prNumber;
      }
    }

    const createdAtMs = toTimestamp(task.createdAt).toMillis();
    if (oldestTaskCreatedAt === null || createdAtMs < oldestTaskCreatedAt.toMillis()) {
      oldestTaskCreatedAt = toTimestamp(task.createdAt);
    }

    const updatedAtMs = toTimestamp(task.updatedAt).toMillis();
    if (updatedAtMs > latestTaskUpdatedAtMs) {
      latestTaskUpdatedAtMs = updatedAtMs;
      latestTaskUpdatedAt = toTimestamp(task.updatedAt);
    }

    if (task.dispatchedAt !== undefined) {
      const dispatchedTs = toTimestamp(task.dispatchedAt);
      if (
        mostRecentDispatchedAt === null ||
        dispatchedTs.toMillis() > mostRecentDispatchedAt.toMillis()
      ) {
        mostRecentDispatchedAt = dispatchedTs;
      }
    }
  }

  return {
    userId,
    linearIssueId,
    groupKey,
    taskCount: 0, // no non-archived tasks counted
    activeTaskCount: 0,
    latestTaskStatus: 'archived',
    latestTaskUpdatedAt,
    agentTypesPresent: Array.from(agentTypesSet),
    hasCompletedPlanning: false,
    hasCompletedExecution: false,
    hasCompletedExecutionAgent: false,
    hasImplementationTaskId: false,
    hasPrUrl,
    prNumber,
    latestReviewNeedsRemediation: null,
    oldestTaskCreatedAt: oldestTaskCreatedAt ?? now,
    mostRecentDispatchedAt,
    aggregateStatus: 'archived',
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(DRY_RUN ? '[DRY RUN] No writes will be made.' : '[LIVE] Writing to Firestore.');

  // Step 1: Fetch all archived tasks
  console.log('Fetching all archived code_tasks...');
  const archivedSnapshot = await db
    .collection(TASKS_COLLECTION)
    .where('status', '==', 'archived')
    .get();

  const archivedTasks = archivedSnapshot.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return { ...data, id: doc.id } as ArchivedTask;
  });

  console.log(`Found ${archivedTasks.length} archived tasks.`);

  // Step 2: Group by (userId, groupKey)
  const groupMap = new Map<string, { userId: string; groupKey: string; tasks: ArchivedTask[] }>();

  for (const task of archivedTasks) {
    const groupKey = getGroupKey(task);
    const mapKey = `${task.userId}_${groupKey}`;

    const existing = groupMap.get(mapKey);
    if (existing !== undefined) {
      existing.tasks.push(task);
    } else {
      groupMap.set(mapKey, { userId: task.userId, groupKey, tasks: [task] });
    }
  }

  console.log(`Grouped into ${groupMap.size} unique (userId, groupKey) groups.`);

  // Step 3 & 4: For each group, check if summary already exists OR non-archived tasks exist
  const groupsToBackfill: Array<{
    docId: string;
    userId: string;
    groupKey: string;
    tasks: ArchivedTask[];
  }> = [];

  for (const [docId, { userId, groupKey, tasks }] of groupMap) {
    // Check if summary doc already exists
    const summaryRef = db.collection(SUMMARIES_COLLECTION).doc(docId);
    const summaryDoc = await summaryRef.get();

    if (summaryDoc.exists) {
      // Summary already exists — skip
      continue;
    }

    // Check if any non-archived task exists for this group
    const firstTask = tasks[0];
    const isStandalone = firstTask?.linearIssueId === undefined;

    let hasNonArchivedTask = false;

    if (!isStandalone) {
      // For linearIssueId-based groups, check if any non-archived task references this issue
      const linearIssueId = groupKey;
      const nonArchivedQuery = await db
        .collection(TASKS_COLLECTION)
        .where('userId', '==', userId)
        .where('linearIssueId', '==', linearIssueId)
        .where('status', 'in', [...NON_ARCHIVED_STATUSES])
        .limit(1)
        .get();

      hasNonArchivedTask = !nonArchivedQuery.empty;
    }
    // For standalone tasks, there's only one task (the archived one) — no non-archived variant possible.

    if (hasNonArchivedTask) {
      console.log(`  Skipping group ${docId}: non-archived tasks still exist.`);
      continue;
    }

    groupsToBackfill.push({ docId, userId, groupKey, tasks });
  }

  console.log(`\nFound ${groupsToBackfill.length} groups to backfill.`);

  if (DRY_RUN) {
    for (const { docId, tasks } of groupsToBackfill) {
      console.log(`  [DRY RUN] Would create summary for: ${docId} (${tasks.length} archived tasks)`);
    }
    console.log(`\nDry run complete. Would create ${groupsToBackfill.length} summaries.`);
    return;
  }

  if (groupsToBackfill.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  // Step 5: Write summaries in batches
  const now = Timestamp.fromDate(new Date());
  let createdCount = 0;

  for (let i = 0; i < groupsToBackfill.length; i += BATCH_SIZE) {
    const chunk = groupsToBackfill.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const { docId, userId, groupKey, tasks } of chunk) {
      const summary = buildArchivedGroupSummary(userId, groupKey, tasks, now);
      const summaryRef = db.collection(SUMMARIES_COLLECTION).doc(docId);
      batch.set(summaryRef, summary);
    }

    await batch.commit();
    createdCount += chunk.length;
    console.log(`  Committed summary batch: ${createdCount}/${groupsToBackfill.length}`);
  }

  // Step 6: Increment user_group_counts — one update per user with the total count gained
  // Accumulate total groups added per user
  const userIncrements = new Map<string, number>();
  for (const { userId } of groupsToBackfill) {
    userIncrements.set(userId, (userIncrements.get(userId) ?? 0) + 1);
  }

  console.log(`\nUpdating user_group_counts for ${userIncrements.size} users...`);

  const userEntries = Array.from(userIncrements.entries());
  for (let i = 0; i < userEntries.length; i += BATCH_SIZE) {
    const chunk = userEntries.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const [userId, increment] of chunk) {
      const countsRef = db.collection(COUNTS_COLLECTION).doc(userId);
      batch.set(
        countsRef,
        {
          userId,
          archived: FieldValue.increment(increment),
          totalGroups: FieldValue.increment(increment),
        },
        { merge: true },
      );
    }

    await batch.commit();
    console.log(`  Committed user_group_counts batch for ${chunk.length} users`);
  }

  console.log(`\nBackfill complete. Found ${groupsToBackfill.length} groups to backfill, created ${createdCount} summaries.`);
}

main().catch((error: unknown) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
