import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { CodeTask } from '../models/codeTask.js';
import type { TaskGroupSummary } from '../models/taskGroupSummary.js';
import type { GitHubPRSummaryRepository } from '../repositories/gitHubPRSummaryRepository.js';
import type { GroupSummaryError, TaskGroupSummaryRepository } from '../ports/taskGroupSummaryRepository.js';
import { resolveCompletedTaskStatus } from '../utils/resolveCompletedTaskStatus.js';

export interface RepairArchivedOpenPrGroupsDeps {
  codeTaskRepo: {
    findRecentTasksByPR(
      repository: string,
      prNumber: number,
      limit: number,
    ): Promise<Result<CodeTask[]>>;
    findRecentTasksByLinearIssue(
      linearIssueId: string,
      limit: number,
    ): Promise<Result<CodeTask[]>>;
    update(
      taskId: string,
      input: { status: CodeTask['status']; updatedAt: Date },
    ): Promise<Result<CodeTask>>;
  };
  gitHubPRSummaryRepo: Pick<GitHubPRSummaryRepository, 'findAllOpen'>;
  groupSummaryRepo: Pick<TaskGroupSummaryRepository, 'recomputeGroupFromTasks'> & {
    getSummary?: (
      userId: string,
      groupKey: string,
    ) => Promise<Result<TaskGroupSummary | null, GroupSummaryError>>;
  };
  logger: Logger;
}

export interface RepairArchivedOpenPrGroupsInput {
  dryRun?: boolean;
  scanLimit?: number;
}

export interface RepairArchivedOpenPrGroupsWarning {
  repository: string;
  prNumber: number;
  userId?: string;
  groupKey?: string;
  reason: 'pr_task_window_capped' | 'group_task_window_capped';
}

export interface RepairArchivedOpenPrGroupsResult {
  dryRun: boolean;
  totalOpenPrsScanned: number;
  totalPrTasksFetched: number;
  groupsEvaluated: number;
  groupsRepaired: number;
  groupsSkippedAlreadyVisible: number;
  groupsSkippedScanLimit: number;
  prsSkippedScanLimit: number;
  tasksRestored: number;
  tasksFailed: number;
  summaryRecomputeFailures: number;
  durationMs: number;
  warnings: RepairArchivedOpenPrGroupsWarning[];
}

const DEFAULT_SCAN_LIMIT = 50;

function groupKeyOf(task: CodeTask): string {
  return task.linearIssueId ?? `standalone_${task.id}`;
}

function toDate(value: CodeTask['updatedAt']): Date {
  return value instanceof Date ? value : value.toDate();
}

function isNonArchived(task: CodeTask): boolean {
  return task.status !== 'archived';
}

function compareByUpdatedAtDesc(left: CodeTask, right: CodeTask): number {
  return right.updatedAt.toMillis() - left.updatedAt.toMillis();
}

function hasClosedOrMergedPr(task: CodeTask): boolean {
  return task.prMergedAt !== undefined || task.prClosedAt !== undefined;
}

function candidateVisibilityRank(
  task: CodeTask,
  existingSummary: TaskGroupSummary | null,
): number {
  if (task.agentType === 'planning') {
    return existingSummary?.hasImplementationReadyLabel === true ? 2 : 1;
  }

  if (
    task.agentType === 'review' &&
    task.result?.needs_remediation !== '1' &&
    existingSummary?.hasMergeReadyLabel === true
  ) {
    return 4;
  }

  if (task.agentType === 'execution') {
    return 3;
  }

  return 1;
}

function compareRepairCandidates(
  left: CodeTask,
  right: CodeTask,
  existingSummary: TaskGroupSummary | null,
): number {
  const leftStable = hasClosedOrMergedPr(left) ? 0 : 1;
  const rightStable = hasClosedOrMergedPr(right) ? 0 : 1;
  if (leftStable !== rightStable) {
    return rightStable - leftStable;
  }

  const leftVisibility = candidateVisibilityRank(left, existingSummary);
  const rightVisibility = candidateVisibilityRank(right, existingSummary);
  if (leftVisibility !== rightVisibility) {
    return rightVisibility - leftVisibility;
  }

  return compareByUpdatedAtDesc(left, right);
}

export function createRepairArchivedOpenPrGroupsUseCase(
  deps: RepairArchivedOpenPrGroupsDeps,
): (
  input?: RepairArchivedOpenPrGroupsInput
) => Promise<Result<RepairArchivedOpenPrGroupsResult>> {
  const { codeTaskRepo, gitHubPRSummaryRepo, groupSummaryRepo, logger } = deps;

  return async (input?: RepairArchivedOpenPrGroupsInput): Promise<Result<RepairArchivedOpenPrGroupsResult>> => {
    const startedAt = Date.now();
    const dryRun = input?.dryRun === true;
    const scanLimit = input?.scanLimit ?? DEFAULT_SCAN_LIMIT;

    const openPrResult = await gitHubPRSummaryRepo.findAllOpen();
    if (!openPrResult.ok) {
      logger.error({ error: openPrResult.error }, 'Failed to list open PR summaries for archived-group repair');
      return err(new Error(openPrResult.error.message));
    }

    let totalPrTasksFetched = 0;
    let groupsEvaluated = 0;
    let groupsRepaired = 0;
    let groupsSkippedAlreadyVisible = 0;
    let groupsSkippedScanLimit = 0;
    let prsSkippedScanLimit = 0;
    let tasksRestored = 0;
    let tasksFailed = 0;
    let summaryRecomputeFailures = 0;
    const warnings: RepairArchivedOpenPrGroupsWarning[] = [];
    const seenGroups = new Set<string>();

    for (const openPr of openPrResult.value) {
      const prTasksResult = await codeTaskRepo.findRecentTasksByPR(
        openPr.repository,
        openPr.pullRequestNumber,
        scanLimit + 1,
      );
      if (!prTasksResult.ok) {
        logger.error(
          {
            repository: openPr.repository,
            prNumber: openPr.pullRequestNumber,
            error: prTasksResult.error,
          },
          'Failed to fetch PR-scoped tasks for archived-group repair',
        );
        return err(new Error(prTasksResult.error.message));
      }

      totalPrTasksFetched += prTasksResult.value.length;

      if (prTasksResult.value.length > scanLimit) {
        prsSkippedScanLimit++;
        warnings.push({
          repository: openPr.repository,
          prNumber: openPr.pullRequestNumber,
          reason: 'pr_task_window_capped',
        });
        logger.warn(
          {
            repository: openPr.repository,
            prNumber: openPr.pullRequestNumber,
            docsScanned: prTasksResult.value.length,
            scanLimit,
          },
          'Skipping open PR repair because the PR task window hit the scan cap',
        );
        continue;
      }

      const tasksByGroup = new Map<string, CodeTask[]>();
      for (const task of prTasksResult.value) {
        const key = `${task.userId}_${groupKeyOf(task)}`;
        const existing = tasksByGroup.get(key) ?? [];
        existing.push(task);
        tasksByGroup.set(key, existing);
      }

      for (const [groupIdentity, prGroupTasks] of tasksByGroup) {
        const latestPrTask = [...prGroupTasks].sort(compareByUpdatedAtDesc)[0];
        if (latestPrTask === undefined || seenGroups.has(groupIdentity)) {
          continue;
        }
        seenGroups.add(groupIdentity);

        groupsEvaluated++;

        if (isNonArchived(latestPrTask)) {
          groupsSkippedAlreadyVisible++;
          continue;
        }

        let groupTasks: CodeTask[];
        if (latestPrTask.linearIssueId === undefined) {
          groupTasks = [latestPrTask];
        } else {
          const groupTasksResult = await codeTaskRepo.findRecentTasksByLinearIssue(
            latestPrTask.linearIssueId,
            scanLimit + 1,
          );
          if (!groupTasksResult.ok) {
            logger.error(
              {
                linearIssueId: latestPrTask.linearIssueId,
                userId: latestPrTask.userId,
                error: groupTasksResult.error,
              },
              'Failed to fetch group tasks for archived-group repair',
            );
            return err(new Error(groupTasksResult.error.message));
          }

          if (groupTasksResult.value.length > scanLimit) {
            groupsSkippedScanLimit++;
            warnings.push({
              repository: latestPrTask.repository,
              prNumber: latestPrTask.prNumber ?? openPr.pullRequestNumber,
              userId: latestPrTask.userId,
              groupKey: groupKeyOf(latestPrTask),
              reason: 'group_task_window_capped',
            });
            logger.warn(
              {
                linearIssueId: latestPrTask.linearIssueId,
                userId: latestPrTask.userId,
                docsScanned: groupTasksResult.value.length,
                scanLimit,
              },
              'Skipping open PR repair because the group task window hit the scan cap',
            );
            continue;
          }

          groupTasks = groupTasksResult.value.filter((task) =>
            task.userId === latestPrTask.userId &&
            groupKeyOf(task) === groupKeyOf(latestPrTask),
          );
        }

        if (groupTasks.some(isNonArchived)) {
          groupsSkippedAlreadyVisible++;
          continue;
        }

        let existingSummary: TaskGroupSummary | null = null;
        if (groupSummaryRepo.getSummary !== undefined) {
          const summaryResult = await groupSummaryRepo.getSummary(
            latestPrTask.userId,
            groupKeyOf(latestPrTask),
          );
          if (!summaryResult.ok) {
            logger.error(
              {
                userId: latestPrTask.userId,
                groupKey: groupKeyOf(latestPrTask),
                error: summaryResult.error,
              },
              'Failed to fetch existing summary for archived-group repair',
            );
            return err(new Error(summaryResult.error.message));
          }
          existingSummary = summaryResult.value;
        }

        const latestGroupTask = [...groupTasks].sort((left, right) =>
          compareRepairCandidates(left, right, existingSummary),
        )[0];
        if (latestGroupTask === undefined) {
          continue;
        }

        const restoredStatus = resolveCompletedTaskStatus(latestGroupTask.agentType);
        const repairedGroupTasks = groupTasks.map((task) =>
          task.id === latestGroupTask.id
            ? { ...task, status: restoredStatus }
            : task,
        );

        if (dryRun) {
          groupsRepaired++;
          tasksRestored++;
          continue;
        }

        const updateResult = await codeTaskRepo.update(latestGroupTask.id, {
          status: restoredStatus,
          updatedAt: toDate(latestGroupTask.updatedAt),
        });
        if (!updateResult.ok) {
          tasksFailed++;
          logger.error(
            {
              taskId: latestGroupTask.id,
              repository: latestGroupTask.repository,
              prNumber: latestGroupTask.prNumber,
              error: updateResult.error,
            },
            'Failed to restore archived task for open PR group',
          );
          continue;
        }

        const recomputeResult = await groupSummaryRepo.recomputeGroupFromTasks(
          latestGroupTask.userId,
          groupKeyOf(latestGroupTask),
          repairedGroupTasks,
        );
        if (!recomputeResult.ok) {
          summaryRecomputeFailures++;
          logger.error(
            {
              taskId: latestGroupTask.id,
              userId: latestGroupTask.userId,
              groupKey: groupKeyOf(latestGroupTask),
              error: recomputeResult.error,
            },
            'Failed to recompute group summary after restoring archived open PR task',
          );
          const rollbackResult = await codeTaskRepo.update(latestGroupTask.id, {
            status: latestGroupTask.status,
            updatedAt: toDate(latestGroupTask.updatedAt),
          });
          if (!rollbackResult.ok) {
            tasksFailed++;
            logger.error(
              {
                taskId: latestGroupTask.id,
                userId: latestGroupTask.userId,
                groupKey: groupKeyOf(latestGroupTask),
                error: rollbackResult.error,
              },
              'Failed to roll back archived open PR task after summary recompute failure',
            );
          }
          continue;
        }
        groupsRepaired++;
        tasksRestored++;
      }
    }

    return ok({
      dryRun,
      totalOpenPrsScanned: openPrResult.value.length,
      totalPrTasksFetched,
      groupsEvaluated,
      groupsRepaired,
      groupsSkippedAlreadyVisible,
      groupsSkippedScanLimit,
      prsSkippedScanLimit,
      tasksRestored,
      tasksFailed,
      summaryRecomputeFailures,
      durationMs: Date.now() - startedAt,
      warnings,
    });
  };
}

export function formatRepairArchivedOpenPrGroupsError(error: unknown): string {
  return getErrorMessage(error, 'Unknown error');
}
