/**
 * Read-only route-shaped verification for GET /code/issue-groups.
 *
 * Usage:
 *   npx tsx apps/code-agent/src/scripts/reportIssueGroupRouteView.ts --user-id=<userId>
 *   npx tsx apps/code-agent/src/scripts/reportIssueGroupRouteView.ts --user-id=<userId> --group-status=archived --sort-by=linear-id
 */

import { Firestore } from '@google-cloud/firestore';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { createFirestoreCodeTaskRepository } from '../infra/repositories/firestoreCodeTaskRepository.js';
import { createTaskGroupSummaryFirestoreRepository } from '../infra/firestore/taskGroupSummaryFirestoreRepository.js';
import type { GroupStatus, SortOption } from '../domain/issueGrouping/index.js';
import type { CodeTask } from '../domain/models/codeTask.js';
import type { TaskGroupSummary } from '../domain/models/taskGroupSummary.js';
/* v8 ignore start -- module-init: standalone verification script is never imported by test suites; cannot be unit-tested without a live Firestore connection @preserve */

const VALID_GROUP_STATUSES: ReadonlySet<GroupStatus> = new Set([
  'active',
  'needs-action',
  'done',
  'failed',
  'archived',
]);
const VALID_SORT_OPTIONS: ReadonlySet<SortOption> = new Set([
  'linear-id',
  'pr-number',
  'dispatched',
  'last-updated',
]);
const TASKS_PER_GROUP_LIMIT = 50;

function parseRequiredFlag(argv: string[], name: string): string {
  const flag = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (flag === undefined) {
    throw new Error(`Missing required --${name}=... flag`);
  }
  return flag.slice(name.length + 3);
}

function parseOptionalFlag(argv: string[], name: string): string | undefined {
  const flag = argv.find((arg) => arg.startsWith(`--${name}=`));
  return flag === undefined ? undefined : flag.slice(name.length + 3);
}

function parseLimit(argv: string[]): number {
  const raw = parseOptionalFlag(argv, 'limit');
  if (raw === undefined) {
    return 20;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --limit value: ${raw}`);
  }
  return parsed;
}

function parseSortBy(argv: string[]): SortOption {
  const raw = parseOptionalFlag(argv, 'sort-by');
  if (raw === undefined) {
    return 'linear-id';
  }
  if (VALID_SORT_OPTIONS.has(raw as SortOption)) {
    return raw as SortOption;
  }
  throw new Error(`Invalid --sort-by value: ${raw}`);
}

function parseStatusFilter(argv: string[]): GroupStatus[] | undefined {
  const raw = parseOptionalFlag(argv, 'group-status');
  if (raw === undefined || raw === '') {
    return undefined;
  }

  const parsed = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is GroupStatus => VALID_GROUP_STATUSES.has(value as GroupStatus));

  return parsed.length === 0 ? undefined : parsed;
}

function groupKeyForTask(task: CodeTask): string {
  return task.linearIssueId ?? `standalone_${task.id}`;
}

interface SummaryDisplayInfo {
  groupKey: string;
  linearIssueId: string | null;
  aggregateStatus: GroupStatus;
  linearIssueSortKey: number;
  rawTaskCount: number;
  displayableTaskCount: number;
  displayableTaskIds: string[];
  displayableStatuses: string[];
  taskFetchError?: string;
}

async function buildSummaryDisplayInfo(
  summary: TaskGroupSummary,
  userId: string,
  includeArchived: boolean,
  codeTaskRepo: ReturnType<typeof createFirestoreCodeTaskRepository>,
): Promise<SummaryDisplayInfo> {
  if (summary.linearIssueId !== null) {
    const tasksResult = await codeTaskRepo.findRecentTasksByLinearIssue(
      summary.linearIssueId,
      TASKS_PER_GROUP_LIMIT,
    );
    if (!tasksResult.ok) {
      return {
        groupKey: summary.groupKey,
        linearIssueId: summary.linearIssueId,
        aggregateStatus: summary.aggregateStatus,
        linearIssueSortKey: summary.linearIssueSortKey,
        taskFetchError: tasksResult.error.message,
        rawTaskCount: 0,
        displayableTaskCount: 0,
        displayableTaskIds: [],
        displayableStatuses: [],
      };
    }

    const displayableTasks = tasksResult.value.filter((task) =>
      task.userId === userId &&
      (includeArchived || task.status !== 'archived') &&
      task.agentType !== 'ask_agent' &&
      groupKeyForTask(task) === summary.groupKey,
    );

    return {
      groupKey: summary.groupKey,
      linearIssueId: summary.linearIssueId,
      aggregateStatus: summary.aggregateStatus,
      linearIssueSortKey: summary.linearIssueSortKey,
      rawTaskCount: tasksResult.value.length,
      displayableTaskCount: displayableTasks.length,
      displayableTaskIds: displayableTasks.map((task) => task.id),
      displayableStatuses: displayableTasks.map((task) => task.status),
    };
  }

  const taskId = summary.groupKey.replace(/^standalone_/, '');
  const taskResult = await codeTaskRepo.findById(taskId);
  if (!taskResult.ok) {
    return {
      groupKey: summary.groupKey,
      linearIssueId: null,
      aggregateStatus: summary.aggregateStatus,
      linearIssueSortKey: summary.linearIssueSortKey,
      taskFetchError: taskResult.error.message,
      rawTaskCount: 0,
      displayableTaskCount: 0,
      displayableTaskIds: [],
      displayableStatuses: [],
    };
  }

  const task = taskResult.value;
  const displayable = task.userId === userId &&
    (includeArchived || task.status !== 'archived') &&
    task.agentType !== 'ask_agent';

  return {
    groupKey: summary.groupKey,
    linearIssueId: null,
    aggregateStatus: summary.aggregateStatus,
    linearIssueSortKey: summary.linearIssueSortKey,
    rawTaskCount: 1,
    displayableTaskCount: displayable ? 1 : 0,
    displayableTaskIds: displayable ? [task.id] : [],
    displayableStatuses: displayable ? [task.status] : [],
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const userId = parseRequiredFlag(argv, 'user-id');
  const statusFilter = parseStatusFilter(argv);
  const sortBy = parseSortBy(argv);
  const limit = parseLimit(argv);
  const includeArchived = statusFilter?.includes('archived') === true;

  const logger = createAppLogger({ name: 'report-issue-group-route-view' });
  const firestore = new Firestore();
  const codeTaskRepo = createFirestoreCodeTaskRepository({ firestore, logger });
  const groupSummaryRepo = createTaskGroupSummaryFirestoreRepository({ firestore, logger });

  const [countsResult, summariesResult] = await Promise.all([
    groupSummaryRepo.getUserGroupCounts(userId),
    groupSummaryRepo.listGroupSummaries({
      userId,
      sortBy,
      limit,
      ...(statusFilter !== undefined ? { statusFilter } : {}),
    }),
  ]);
  if (!countsResult.ok) {
    throw new Error(countsResult.error.message);
  }
  if (!summariesResult.ok) {
    throw new Error(summariesResult.error.message);
  }
  const countsValue = countsResult.value;
  let phantomCheckSummaries: TaskGroupSummary[] = [];
  if (statusFilter !== undefined) {
    const statusesWithCounts: GroupStatus[] = [];
    if (countsValue.active > 0 && !statusFilter.includes('active')) statusesWithCounts.push('active');
    if (countsValue.needsAction > 0 && !statusFilter.includes('needs-action')) statusesWithCounts.push('needs-action');
    if (countsValue.done > 0 && !statusFilter.includes('done')) statusesWithCounts.push('done');
    if (countsValue.failed > 0 && !statusFilter.includes('failed')) statusesWithCounts.push('failed');

    if (statusesWithCounts.length > 0) {
      const phantomResult = await groupSummaryRepo.listGroupSummaries({
        userId,
        sortBy,
        limit: 100,
        statusFilter: statusesWithCounts,
      });
      if (!phantomResult.ok) {
        throw new Error(phantomResult.error.message);
      }
      phantomCheckSummaries = phantomResult.value.summaries;
    }
  }

  const groups = await Promise.all(summariesResult.value.summaries.map((summary) =>
    buildSummaryDisplayInfo(summary, userId, includeArchived, codeTaskRepo),
  ));
  const phantomCheckGroups = await Promise.all(phantomCheckSummaries.map((summary) =>
    buildSummaryDisplayInfo(summary, userId, includeArchived, codeTaskRepo),
  ));

  const phantomStatusDeltas: Partial<Record<GroupStatus, number>> = {};
  for (const group of groups) {
    if (group.displayableTaskCount === 0) {
      phantomStatusDeltas[group.aggregateStatus] = (phantomStatusDeltas[group.aggregateStatus] ?? 0) + 1;
    }
  }
  for (const group of phantomCheckGroups) {
    if (group.displayableTaskCount === 0) {
      phantomStatusDeltas[group.aggregateStatus] = (phantomStatusDeltas[group.aggregateStatus] ?? 0) + 1;
    }
  }

  const correctedCounts = {
    active: Math.max(0, countsValue.active - (phantomStatusDeltas.active ?? 0)),
    'needs-action': Math.max(0, countsValue.needsAction - (phantomStatusDeltas['needs-action'] ?? 0)),
    done: Math.max(0, countsValue.done - (phantomStatusDeltas.done ?? 0)),
    failed: Math.max(0, countsValue.failed - (phantomStatusDeltas.failed ?? 0)),
    archived: Math.max(0, countsValue.archived - (phantomStatusDeltas.archived ?? 0)),
  };

  const totalGroups = statusFilter !== undefined
    ? statusFilter.reduce((sum, status) => sum + correctedCounts[status], 0)
    : Object.values(correctedCounts).reduce((sum, count) => sum + count, 0);

  process.stdout.write(`${JSON.stringify({
    input: {
      userId,
      statusFilter: statusFilter ?? null,
      sortBy,
      limit,
    },
    rawCounts: countsValue,
    correctedCounts,
    totalGroups,
    summariesReturned: summariesResult.value.summaries.length,
    nextCursor: summariesResult.value.nextCursor ?? null,
    groups,
    phantomCheckGroups,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

/* v8 ignore stop @preserve */
