/**
 * Report archived task groups that still have an open PR summary.
 *
 * Usage:
 *   npx tsx apps/code-agent/src/scripts/reportArchivedOpenPrGroups.ts
 *
 * Read-only. Emits JSON to stdout.
 */

import { Firestore, Timestamp } from '@google-cloud/firestore';
/* v8 ignore start -- module-init: standalone report script is never imported by test suites; cannot be unit-tested without a live Firestore connection @preserve */

const TASKS_COLLECTION = 'code_tasks';
const SUMMARIES_COLLECTION = 'task_group_summaries';
const PR_SUMMARIES_COLLECTION = 'github-pr-summaries';

interface OpenPrSummary {
  repository: string;
  pullRequestNumber: number;
  title: string | null;
  baseBranch: string | null;
  headBranch: string | null;
  lastActivityAt: unknown;
}

interface ArchivedTaskHit {
  taskId: string;
  userId: string;
  linearIssueId: string | null;
  groupKey: string;
  repository: string;
  prNumber: number;
  status: string;
  updatedAt: unknown;
}

interface ArchivedOpenPrGroupReportItem {
  linearIssueId: string | null;
  repository: string;
  pullRequestNumber: number;
  archivedTaskCount: number;
  summaryStatus: string;
  userId: string;
  groupKey: string;
  taskIds: string[];
  title: string | null;
  baseBranch: string | null;
  headBranch: string | null;
  lastActivityAt: string | null;
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

function groupKeyForTask(data: Record<string, unknown>, taskId: string): string {
  return typeof data['linearIssueId'] === 'string'
    ? data['linearIssueId']
    : `standalone_${taskId}`;
}

function mapOpenPr(data: Record<string, unknown>): OpenPrSummary {
  return {
    repository: String(data['repository']),
    pullRequestNumber: Number(data['pullRequestNumber']),
    title: typeof data['title'] === 'string' ? data['title'] : null,
    baseBranch: typeof data['baseBranch'] === 'string' ? data['baseBranch'] : null,
    headBranch: typeof data['headBranch'] === 'string' ? data['headBranch'] : null,
    lastActivityAt: data['lastActivityAt'],
  };
}

function mapArchivedTask(docId: string, data: Record<string, unknown>): ArchivedTaskHit {
  const groupKey = groupKeyForTask(data, docId);
  return {
    taskId: docId,
    userId: String(data['userId']),
    linearIssueId: typeof data['linearIssueId'] === 'string' ? data['linearIssueId'] : null,
    groupKey,
    repository: String(data['repository']),
    prNumber: Number(data['prNumber']),
    status: String(data['status']),
    updatedAt: data['updatedAt'],
  };
}

async function main(): Promise<void> {
  const db = new Firestore();
  const openPrSnapshot = await db
    .collection(PR_SUMMARIES_COLLECTION)
    .where('state', '==', 'open')
    .get();

  const reportItems: ArchivedOpenPrGroupReportItem[] = [];
  const seenGroups = new Set<string>();

  for (const openPrDoc of openPrSnapshot.docs) {
    const openPr = mapOpenPr(openPrDoc.data() as Record<string, unknown>);
    const taskSnapshot = await db
      .collection(TASKS_COLLECTION)
      .where('repository', '==', openPr.repository)
      .where('prNumber', '==', openPr.pullRequestNumber)
      .where('status', '==', 'archived')
      .get();

    const tasks = taskSnapshot.docs.map((doc) =>
      mapArchivedTask(doc.id, doc.data() as Record<string, unknown>)
    );

    const taskGroups = new Map<string, ArchivedTaskHit[]>();
    for (const task of tasks) {
      const docId = `${task.userId}_${task.groupKey}`;
      const existing = taskGroups.get(docId) ?? [];
      existing.push(task);
      taskGroups.set(docId, existing);
    }

    for (const [docId, groupTasks] of taskGroups) {
      if (seenGroups.has(docId)) {
        continue;
      }

      const summaryDoc = await db.collection(SUMMARIES_COLLECTION).doc(docId).get();
      if (!summaryDoc.exists) {
        continue;
      }

      const summary = summaryDoc.data() as Record<string, unknown>;
      if (summary['aggregateStatus'] !== 'archived') {
        continue;
      }

      const firstTask = groupTasks[0];
      if (firstTask === undefined) {
        continue;
      }

      seenGroups.add(docId);
      reportItems.push({
        linearIssueId: firstTask.linearIssueId,
        repository: openPr.repository,
        pullRequestNumber: openPr.pullRequestNumber,
        archivedTaskCount: groupTasks.length,
        summaryStatus: 'archived',
        userId: firstTask.userId,
        groupKey: firstTask.groupKey,
        taskIds: groupTasks.map((task) => task.taskId),
        title: openPr.title,
        baseBranch: openPr.baseBranch,
        headBranch: openPr.headBranch,
        lastActivityAt: toIso(openPr.lastActivityAt),
      });
    }
  }

  process.stdout.write(`${JSON.stringify({
    scannedOpenPrs: openPrSnapshot.size,
    openPrGroupsArchived: reportItems,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

/* v8 ignore stop @preserve */
